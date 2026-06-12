import AdmZip from "adm-zip";
import { sql } from "drizzle-orm";
import { db } from "../../client";
import { dictionaries } from "../../schema/dictionaries";
import { termFrequencies } from "../../schema/term-frequencies";
import { parseFrequencyEntries, previewFrequencyEntries, dedupeFrequencyEntries } from "../../utils/frequency-parser";
import type { FrequencyPreviewResult } from "../../utils/frequency-parser";

export type FrequencyImportResult = {
  dictionaryId: string;
  dictionaryName: string;
  slug: string;
  imported: number;
  skipped: number;
  totalParsed: number;
};

/**
 * Preview a frequency zip without writing to DB.
 */
export function previewFrequencyZip(
  zipBuffer: Buffer,
  frequencyMode: "rank-based" | "occurrence-based" = "rank-based",
): FrequencyPreviewResult {
  const zip = new AdmZip(zipBuffer);
  const zipEntries = zip.getEntries().map((e) => ({
    entryName: e.entryName,
    getData: () => e.getData(),
  }));

  return previewFrequencyEntries(zipEntries, frequencyMode);
}

/**
 * Import frequency-only zip into a dedicated dictionary.
 * Creates or upserts a dictionary record and bulk-inserts frequencies.
 */
export async function importFrequencyZip(
  zipBuffer: Buffer,
  options: {
    dictionaryName: string;
    frequencyMode?: "rank-based" | "occurrence-based";
  },
): Promise<FrequencyImportResult> {
  const frequencyMode = options.frequencyMode ?? "rank-based";

  const zip = new AdmZip(zipBuffer);
  const zipEntries = zip.getEntries().map((e) => ({
    entryName: e.entryName,
    getData: () => e.getData(),
  }));

  const { entries, skipped } = parseFrequencyEntries(zipEntries, frequencyMode);

  if (entries.length === 0) {
    throw new Error("No valid frequency entries found in zip");
  }

  const slug = `freq-${options.dictionaryName.toLowerCase().replace(/\s+/g, "-")}`;

  const [dict] = await db
    .insert(dictionaries)
    .values({
      name: options.dictionaryName,
      slug,
      priority: 0,
      enabled: false,
      isFrequencyOnly: true,
    })
    .onConflictDoUpdate({
      target: dictionaries.slug,
      set: { name: options.dictionaryName },
    })
    .returning();

  if (!dict) {
    throw new Error("Failed to upsert frequency dictionary");
  }

  const { unique: uniqueEntries, dedupedCount } = dedupeFrequencyEntries(entries, frequencyMode);

  const CHUNK_SIZE = 500;
  const beforeCount = await db
    .select({ count: sql<number>`count(*)::int` })
    .from(termFrequencies)
    .where(sql`${termFrequencies.dictionaryId} = ${dict.id}`)
    .then((r) => r[0]?.count ?? 0);

  for (let i = 0; i < uniqueEntries.length; i += CHUNK_SIZE) {
    const chunk = uniqueEntries.slice(i, i + CHUNK_SIZE);
    const rows = chunk.map((e) => ({
      dictionaryId: dict.id,
      expression: e.expression,
      reading: e.reading,
      frequencyValue: e.frequencyValue.toString(),
      displayValue: e.displayValue,
      frequencyMode: e.frequencyMode,
      rawJson: e.rawRecord,
    }));

    await db
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
      });
  }

  const afterCount = await db
    .select({ count: sql<number>`count(*)::int` })
    .from(termFrequencies)
    .where(sql`${termFrequencies.dictionaryId} = ${dict.id}`)
    .then((r) => r[0]?.count ?? 0);

  const imported = afterCount - beforeCount;

  return {
    dictionaryId: String(dict.id),
    dictionaryName: options.dictionaryName,
    slug,
    imported,
    skipped: skipped + dedupedCount,
    totalParsed: entries.length,
  };
}
