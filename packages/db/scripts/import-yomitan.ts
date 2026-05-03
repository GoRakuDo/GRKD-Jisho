import AdmZip from "adm-zip";
import { db } from "../src/client.js";
import { dictionaries, dictionaryEntries } from "../src/schema/index.js";
import { parseArgs } from "node:util";
import path from "node:path";

// ── CLI 引数パース ──────────────────────────────────────────
const { values } = parseArgs({
  options: {
    file: { type: "string" },
    name: { type: "string" },
    priority: { type: "string" },
  },
});

if (!values.file || !values.name || !values.priority) {
  console.error("Usage: import-yomitan --file <path> --name <name> --priority <number>");
  process.exit(1);
}

const filePath = path.resolve(values.file);
const dictName = values.name;
const priority = parseInt(values.priority, 10);
const slug = dictName.toLowerCase().replace(/\s+/g, "-");

// ── ZIP 展開 ────────────────────────────────────────────────
console.log(`Opening: ${filePath}`);
const zip = new AdmZip(filePath);

// index.json からメタ情報を取得
const indexEntry = zip.getEntry("index.json");
if (!indexEntry) throw new Error("index.json not found in zip");
const indexData = JSON.parse(indexEntry.getData().toString("utf8")) as {
  title: string;
  revision: string;
};
console.log(`Dictionary: ${indexData.title} (${indexData.revision})`);

// ── dictionaries テーブルに UPSERT ─────────────────────────
const [dict] = await db
  .insert(dictionaries)
  .values({ name: dictName, slug, priority })
  .onConflictDoUpdate({
    target: dictionaries.slug,
    set: { name: dictName, priority },
  })
  .returning();

console.log(`Dictionary record: id=${dict!.id}, slug=${dict!.slug}`);

// ── term_bank_*.json をパースして UPSERT ────────────────────
const termBankEntries = zip
  .getEntries()
  .filter((e) => e.entryName.startsWith("term_bank_"))
  .sort((a, b) => a.entryName.localeCompare(b.entryName));

console.log(`Found ${termBankEntries.length} term bank file(s)`);

let totalInserted = 0;

for (const entry of termBankEntries) {
  const raw = JSON.parse(entry.getData().toString("utf8")) as unknown[][];

  const CHUNK_SIZE = 500;
  for (let i = 0; i < raw.length; i += CHUNK_SIZE) {
    const chunk = raw.slice(i, i + CHUNK_SIZE);

    const rows = chunk.map((record) => ({
      dictionaryId: dict!.id,
      term: record[0] as string,
      reading: (record[1] as string) || null,
      definitionsJson: record[5] as unknown[],
      tagsJson: [],
      rawJson: record,
    }));

    await db
      .insert(dictionaryEntries)
      .values(rows)
      .onConflictDoNothing();

    totalInserted += rows.length;
  }

  process.stdout.write(`\rProcessed: ${totalInserted} entries`);
}

console.log(`\nDone! Total: ${totalInserted} entries imported into dictionary "${dictName}"`);
process.exit(0);
