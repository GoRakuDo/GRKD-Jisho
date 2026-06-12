import AdmZip from "adm-zip";
import { sql } from "drizzle-orm";
import { db } from "../../client";
import { dictionaries } from "../../schema/dictionaries";
import { dictionaryEntries } from "../../schema/dictionary-entries";
import { termFrequencies } from "../../schema/term-frequencies";

type IndexJson = {
  title: string;
  revision: string;
  format?: 1 | 2 | 3;
  version?: 1 | 2 | 3;
  frequencyMode?: "rank-based" | "occurrence-based";
};

type RawTermEntry = unknown[];

type NormalizedFrequency = {
  expression: string;
  reading: string | null;
  frequencyValue: number;
  displayValue: string;
  frequencyMode: "rank-based" | "occurrence-based";
};

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

function isFiniteNumber(v: unknown): v is number {
  return typeof v === "number" && Number.isFinite(v);
}

function parseFrequencyValue(v: unknown): { value: number; display: string } | null {
  if (isFiniteNumber(v)) {
    return { value: v, display: String(v) };
  }
  if (typeof v === "string") {
    const trimmed = v.trim();
    if (trimmed.length === 0) return null;
    const num = Number(trimmed);
    if (Number.isFinite(num)) {
      return { value: num, display: trimmed };
    }
    return null;
  }
  if (typeof v === "object" && v !== null) {
    const obj = v as Record<string, unknown>;
    if ("value" in obj) {
      const inner = parseFrequencyValue(obj["value"]);
      if (!inner) return null;
      const displayRaw = obj["displayValue"];
      const display = typeof displayRaw === "string" ? displayRaw : inner.display;
      return { value: inner.value, display };
    }
    if ("frequency" in obj) {
      const inner = parseFrequencyValue(obj["frequency"]);
      return inner;
    }
  }
  return null;
}

function convertTermMetaFreqEntry(
  record: unknown,
  frequencyMode: "rank-based" | "occurrence-based"
): NormalizedFrequency | null {
  if (!Array.isArray(record) || record.length < 3) {
    return null;
  }

  const expression = record[0];
  const mode = record[1];
  const data = record[2];

  if (typeof expression !== "string" || expression.length === 0) return null;
  if (mode !== "freq") return null;

  const reading = typeof data === "object" && data !== null && !Array.isArray(data) &&
    "reading" in (data as Record<string, unknown>) &&
    typeof (data as Record<string, unknown>)["reading"] === "string"
      ? ((data as Record<string, unknown>)["reading"] as string)
      : null;

  const parsed = parseFrequencyValue(data);
  if (!parsed) return null;

  return {
    expression,
    reading,
    frequencyValue: parsed.value,
    displayValue: parsed.display,
    frequencyMode,
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

  for (const entry of metaBankEntries) {
    const raw = JSON.parse(entry.getData().toString("utf8")) as unknown[];
    if (!Array.isArray(raw)) {
      continue;
    }

    const CHUNK_SIZE = 500;
    for (let i = 0; i < raw.length; i += CHUNK_SIZE) {
      const chunk = raw.slice(i, i + CHUNK_SIZE);
      const rows: {
        dictionaryId: number;
        expression: string;
        reading: string | null;
        frequencyValue: string;
        displayValue: string;
        frequencyMode: string;
        rawJson: unknown;
      }[] = [];

      for (const record of chunk) {
        const normalized = convertTermMetaFreqEntry(record, frequencyMode);
        if (!normalized) {
          skippedFrequencies += 1;
          continue;
        }
        rows.push({
          dictionaryId: dict.id,
          expression: normalized.expression,
          reading: normalized.reading,
          frequencyValue: normalized.frequencyValue.toString(),
          displayValue: normalized.displayValue,
          frequencyMode: normalized.frequencyMode,
          rawJson: record,
        });
      }

      if (rows.length === 0) {
        continue;
      }

      // ON CONFLICT DO UPDATE with LEAST: 同じ (dict, expression, reading) に対して
      // 既に小さい値が入っていれば維持し、入っていなければ新しい小さい値で上書きする。
      // これで JPDB の `人間/にんげん=158` と `人間/にんげん=37433㋕` がどんな順序で
      // 入ってきても、最終的にテーブルには MIN 値だけが残る。
      const inserted = await db
        .insert(termFrequencies)
        .values(rows)
        .onConflictDoUpdate({
          target: [
            termFrequencies.dictionaryId,
            termFrequencies.expression,
            termFrequencies.reading,
          ],
          set: {
            frequencyValue: sql`LEAST(${termFrequencies.frequencyValue}, EXCLUDED.frequency_value)`,
          },
        })
        .returning({ id: termFrequencies.id });

      importedFrequencies += inserted.length;
      // DO UPDATE なので conflict した行も returning に含まれる。
      // parse 失敗は skippedFrequencies に既に計上済み。
    }
  }

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
