import AdmZip from "adm-zip";
import { sql } from "drizzle-orm";
import { db } from "../../client";
import { dictionaries } from "../../schema/dictionaries";
import { dictionaryEntries } from "../../schema/dictionary-entries";
import { termFrequencies } from "../../schema/term-frequencies";
import { normalizeFreqEntry, dedupeFrequencyEntries } from "../../utils/frequency-parser";

type IndexJson = {
  title: string;
  revision: string;
  format?: 1 | 2 | 3;
  version?: 1 | 2 | 3;
  frequencyMode?: "rank-based" | "occurrence-based";
};

type RawTermEntry = unknown[];

export type ImportYomitanOptions = {
  dictionaryName?: string;
  priority: number;
};

export type ImportYomitanResult = {
  dictionaryId: string;
  dictionaryName: string;
  slug: string;
  revision: string;
  format: 1 | 2 | 3;
  importedEntries: number;
  skippedMalformed: number;
  importedFrequencies: number;
  skippedFrequencies: number;
};

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
  glossary: unknown[];
} {
  const [expression, rawReading, definitionTags, , , ...glossary] = record;

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

export async function importYomitanDictionaryFromBuffer(
  zipBuffer: Buffer,
  options: ImportYomitanOptions,
): Promise<ImportYomitanResult> {
  const zip = new AdmZip(zipBuffer);

  const indexEntry = zip.getEntry("index.json");
  if (!indexEntry) {
    throw new Error("index.json not found in zip");
  }

  const indexData = JSON.parse(indexEntry.getData().toString("utf8")) as IndexJson;
  const normalizedIndex = normalizeIndex(indexData);

  const dictionaryName = options.dictionaryName?.trim() || normalizedIndex.title;
  const slug = dictionaryName.toLowerCase().replace(/\s+/g, "-");

  const [dict] = await db
    .insert(dictionaries)
    .values({
      name: dictionaryName,
      slug,
      priority: options.priority,
    })
    .onConflictDoUpdate({
      target: dictionaries.slug,
      set: {
        name: dictionaryName,
        priority: options.priority,
        slug,
      },
    })
    .returning();

  if (!dict) {
    throw new Error("Failed to upsert dictionary");
  }

  const termBankEntries = zip
    .getEntries()
    .filter((e) => /^term_bank_(\d+)\.json$/.test(e.entryName))
    .sort((a, b) => a.entryName.localeCompare(b.entryName));

  let importedEntries = 0;
  let skippedMalformed = 0;

  for (const entry of termBankEntries) {
    const raw = JSON.parse(entry.getData().toString("utf8")) as unknown[][];
    if (!Array.isArray(raw)) {
      continue;
    }

    const CHUNK_SIZE = 500;
    for (let i = 0; i < raw.length; i += CHUNK_SIZE) {
      const chunk = raw.slice(i, i + CHUNK_SIZE);
      const rows: {
        dictionaryId: number;
        term: string;
        reading: string;
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
            continue;
          }

          // format 2/3 follows v3 converter structure
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
        } catch {
          skippedMalformed += 1;
        }
      }

      if (rows.length === 0) {
        continue;
      }

      const inserted = await db
        .insert(dictionaryEntries)
        .values(rows)
        .onConflictDoNothing({
          target: [
            dictionaryEntries.dictionaryId,
            dictionaryEntries.term,
            dictionaryEntries.reading,
          ],
        })
        .returning({ id: dictionaryEntries.id });

      importedEntries += inserted.length;
    }
  }

  const frequencyMode = indexData.frequencyMode ?? "rank-based";
  const metaBankEntries = zip
    .getEntries()
    .filter((e) => /^term_meta_bank_(\d+)\.json$/.test(e.entryName))
    .sort((a, b) => a.entryName.localeCompare(b.entryName));

  let importedFrequencies = 0;
  let skippedFrequencies = 0;

  const beforeFreqCount = await db
    .select({ count: sql<number>`count(*)::int` })
    .from(termFrequencies)
    .where(sql`${termFrequencies.dictionaryId} = ${dict.id}`)
    .then((r) => r[0]?.count ?? 0);

  for (const entry of metaBankEntries) {
    let raw: unknown;
    try {
      raw = JSON.parse(entry.getData().toString("utf8"));
    } catch {
      skippedFrequencies += 1;
      continue;
    }
    if (!Array.isArray(raw)) {
      continue;
    }

    // Normalize all records, then dedup before chunked insert.
    // JPDB has primary + secondary entries for the same (expression, reading)
    // which cause "ON CONFLICT DO UPDATE cannot be applied to the same row twice"
    // if both appear in the same INSERT batch.
    const normalized: {
      dictionaryId: number;
      expression: string;
      reading: string | null;
      frequencyValue: string;
      displayValue: string;
      frequencyMode: string;
      rawJson: unknown;
    }[] = [];

    for (const record of raw) {
      const n = normalizeFreqEntry(record, frequencyMode);
      if (!n) {
        skippedFrequencies += 1;
        continue;
      }
      normalized.push({
        dictionaryId: dict.id,
        expression: n.expression,
        reading: n.reading,
        frequencyValue: n.frequencyValue.toString(),
        displayValue: n.displayValue,
        frequencyMode: n.frequencyMode,
        rawJson: record,
      });
    }

    // Dedup by (expression, reading), keeping the best value per group.
    const { unique: uniqueRows, dedupedCount } = dedupeFrequencyEntries(
      normalized.map((r) => ({
        expression: r.expression,
        reading: r.reading,
        frequencyValue: Number(r.frequencyValue),
        displayValue: r.displayValue,
        frequencyMode: r.frequencyMode as "rank-based" | "occurrence-based",
        rawRecord: r.rawJson,
      })),
      frequencyMode,
    );
    skippedFrequencies += dedupedCount;

    const dedupedRows = uniqueRows.map((e) => ({
      dictionaryId: dict.id,
      expression: e.expression,
      reading: e.reading,
      frequencyValue: e.frequencyValue.toString(),
      displayValue: e.displayValue,
      frequencyMode: e.frequencyMode,
      rawJson: e.rawRecord,
    }));

    const CHUNK_SIZE = 500;
    for (let i = 0; i < dedupedRows.length; i += CHUNK_SIZE) {
      const chunk = dedupedRows.slice(i, i + CHUNK_SIZE);

      if (chunk.length === 0) {
        continue;
      }

      // ON CONFLICT DO UPDATE with LEAST: 同じ (dict, expression, reading) に対して
      // 既に小さい値が入っていれば維持し、入っていなければ新しい小さい値で上書きする。
      await db
        .insert(termFrequencies)
        .values(chunk)
        .onConflictDoUpdate({
          target: [
            termFrequencies.dictionaryId,
            termFrequencies.expression,
            termFrequencies.reading,
          ],
          set: {
            frequencyValue: sql`LEAST(${termFrequencies.frequencyValue}, EXCLUDED.frequency_value)`,
          },
        });
    }
  }

  const afterFreqCount = await db
    .select({ count: sql<number>`count(*)::int` })
    .from(termFrequencies)
    .where(sql`${termFrequencies.dictionaryId} = ${dict.id}`)
    .then((r) => r[0]?.count ?? 0);

  importedFrequencies = afterFreqCount - beforeFreqCount;

  return {
    dictionaryId: String(dict.id),
    dictionaryName,
    slug,
    revision: normalizedIndex.revision,
    format: normalizedIndex.format,
    importedEntries,
    skippedMalformed,
    importedFrequencies,
    skippedFrequencies,
  };
}
