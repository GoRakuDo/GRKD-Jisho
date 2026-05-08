import AdmZip from "adm-zip";
import { db } from "../src/client.js";
import { dictionaries, dictionaryEntries } from "../src/schema/index.js";
import { parseArgs } from "node:util";
import path from "node:path";

type IndexJson = {
  title: string;
  revision: string;
  format?: 1 | 2 | 3;
  version?: 1 | 2 | 3;
};

type RawTermEntry = unknown[];

function normalizeIndex(indexData: IndexJson): { title: string; revision: string; format: 1 | 2 | 3 } {
  if (!indexData.title || !indexData.revision) {
    throw new Error("index.json must contain title and revision");
  }

  const format = indexData.format ?? indexData.version;
  if (format !== 1 && format !== 2 && format !== 3) {
    throw new Error("index.json must contain format/version = 1, 2, or 3");
  }

  return {
    title: indexData.title,
    revision: indexData.revision,
    format,
  };
}

function convertTermBankEntryV1(record: RawTermEntry): {
  term: string;
  reading: string;
  definitionTags: unknown;
  rules: unknown;
  score: unknown;
  glossary: unknown[];
} {
  const [expression, rawReading, definitionTags, rules, score, ...glossary] = record;

  if (typeof expression !== "string" || expression.length === 0) {
    throw new Error("invalid v1 term entry: expression must be non-empty string");
  }
  if (typeof rawReading !== "string") {
    throw new Error("invalid v1 term entry: reading must be string");
  }

  const reading = rawReading.length > 0 ? rawReading : expression;
  return {
    term: expression,
    reading,
    definitionTags,
    rules,
    score,
    glossary,
  };
}

function convertTermBankEntryV3(record: RawTermEntry): {
  term: string;
  reading: string;
  definitionTags: unknown;
  rules: unknown;
  score: unknown;
  glossary: unknown;
  sequence: unknown;
  termTags: unknown;
} {
  const [expression, rawReading, definitionTags, rules, score, glossary, sequence, termTags] = record;

  if (typeof expression !== "string" || expression.length === 0) {
    throw new Error("invalid v3 term entry: expression must be non-empty string");
  }
  if (typeof rawReading !== "string") {
    throw new Error("invalid v3 term entry: reading must be string");
  }

  const reading = rawReading.length > 0 ? rawReading : expression;
  return {
    term: expression,
    reading,
    definitionTags,
    rules,
    score,
    glossary,
    sequence,
    termTags,
  };
}

// ── CLI 引数パース ──────────────────────────────────────────
const { values } = parseArgs({
  options: {
    file: { type: "string" },
    name: { type: "string" },
    priority: { type: "string" },
  },
});

if (!values.file || !values.priority) {
  console.error("Usage: import-yomitan --file <path> [--name <name>] --priority <number>");
  process.exit(1);
}

const filePath = path.resolve(values.file);
const priority = parseInt(values.priority, 10);

if (Number.isNaN(priority)) {
  console.error("Invalid --priority: must be a number");
  process.exit(1);
}

// ── ZIP 展開 ────────────────────────────────────────────────
console.log(`Opening: ${filePath}`);
const zip = new AdmZip(filePath);

// index.json からメタ情報を取得
const indexEntry = zip.getEntry("index.json");
if (!indexEntry) throw new Error("index.json not found in zip");
const indexData = JSON.parse(indexEntry.getData().toString("utf8")) as IndexJson;
const normalizedIndex = normalizeIndex(indexData);

const dictName = values.name ?? normalizedIndex.title;
const slug = dictName.toLowerCase().replace(/\s+/g, "-");

console.log(`Dictionary: ${normalizedIndex.title} (${normalizedIndex.revision})`);
console.log(`Format: v${normalizedIndex.format}`);

// ── dictionaries テーブルに UPSERT ─────────────────────────
const [dict] = await db
  .insert(dictionaries)
  .values({ name: dictName, slug, priority })
  .onConflictDoUpdate({
    target: dictionaries.slug,
    set: { name: dictName, priority },
  })
  .returning();

if (!dict) {
  throw new Error("Failed to upsert dictionary record");
}

console.log(`Dictionary record: id=${dict.id}, slug=${dict.slug}`);

// ── term_bank_*.json をパースして UPSERT ────────────────────
const termBankEntries = zip
  .getEntries()
  .filter((e) => /^term_bank_(\d+)\.json$/.test(e.entryName))
  .sort((a, b) => a.entryName.localeCompare(b.entryName));

console.log(`Found ${termBankEntries.length} term bank file(s)`);

let totalInserted = 0;
let skippedMalformed = 0;
let malformedLogged = 0;

for (const entry of termBankEntries) {
  const raw = JSON.parse(entry.getData().toString("utf8")) as unknown[][];

  if (!Array.isArray(raw)) {
    console.warn(`Skipping ${entry.entryName}: not an array`);
    continue;
  }

  const CHUNK_SIZE = 500;
  for (let i = 0; i < raw.length; i += CHUNK_SIZE) {
    const chunk = raw.slice(i, i + CHUNK_SIZE);

    const rows: {
      dictionaryId: bigint;
      term: string;
      reading: string | null;
      definitionsJson: unknown;
      tagsJson: unknown;
      rawJson: unknown;
    }[] = [];

    for (const record of chunk) {
      try {
        if (!Array.isArray(record)) {
          throw new Error("term entry is not an array");
        }

        if (normalizedIndex.format === 1) {
          const v1 = convertTermBankEntryV1(record);
          rows.push({
            dictionaryId: dict.id,
            term: v1.term,
            reading: v1.reading,
            definitionsJson: v1.glossary,
            tagsJson: v1.definitionTags,
            rawJson: record,
          });
        } else if (normalizedIndex.format === 2 || normalizedIndex.format === 3) {
          // Yomitan importer treats format 2/3 term banks with v3 schema/converter.
          // Ref: ext/js/dictionary/dictionary-importer.js::_getDataBankSchemas(version)
          const v3 = convertTermBankEntryV3(record);
          rows.push({
            dictionaryId: dict.id,
            term: v3.term,
            reading: v3.reading,
            definitionsJson: v3.glossary,
            tagsJson: {
              definitionTags: v3.definitionTags,
              termTags: v3.termTags,
              rules: v3.rules,
              score: v3.score,
              sequence: v3.sequence,
            },
            rawJson: record,
          });
        } else {
          throw new Error(`unsupported format: ${normalizedIndex.format}`);
        }
      } catch (err) {
        skippedMalformed += 1;
        if (malformedLogged < 5) {
          const reason = err instanceof Error ? err.message : String(err);
          console.warn(`[ImportYomitan] malformed entry skipped: ${reason}`);
          malformedLogged += 1;
        }
      }
    }

    if (rows.length === 0) {
      continue;
    }

    await db
      .insert(dictionaryEntries)
      .values(rows)
      .onConflictDoNothing();

    totalInserted += rows.length;
  }

  process.stdout.write(`\rProcessed: ${totalInserted} entries`);
}

console.log(`\nDone! Total: ${totalInserted} entries imported into dictionary "${dictName}"`);
if (skippedMalformed > 0) {
  console.warn(`Skipped malformed entries: ${skippedMalformed}`);
}
process.exit(0);
