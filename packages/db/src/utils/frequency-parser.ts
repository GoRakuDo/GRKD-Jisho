/**
 * Pure frequency parser — no DB dependency.
 * Separated from frequency-import.ts so it can be tested without DATABASE_URL.
 */

type NormalizedFrequency = {
  expression: string;
  reading: string | null;
  frequencyValue: number;
  displayValue: string;
  frequencyMode: "rank-based" | "occurrence-based";
  rawRecord: unknown;
};

export type FrequencyPreviewResult = {
  totalEntries: number;
  sampleEntries: { expression: string; reading: string | null; frequency: number; display: string }[];
  frequencyMode: "rank-based" | "occurrence-based";
};

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
      return parseFrequencyValue(obj["frequency"]);
    }
  }
  return null;
}

export function normalizeFreqEntry(
  record: unknown,
  frequencyMode: "rank-based" | "occurrence-based",
): NormalizedFrequency | null {
  if (!Array.isArray(record) || record.length < 3) return null;

  const expression = record[0];
  const mode = record[1];
  const data = record[2];

  if (typeof expression !== "string" || expression.length === 0) return null;
  if (mode !== "freq") return null;

  const reading =
    typeof data === "object" &&
    data !== null &&
    !Array.isArray(data) &&
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
    rawRecord: record,
  };
}

/**
 * Parse term_meta_bank_*.json entries from raw zip buffer.
 * Pure function — no side effects, no DB.
 */
export function parseFrequencyEntries(
  zipEntries: { entryName: string; getData: () => Buffer }[],
  frequencyMode: "rank-based" | "occurrence-based" = "rank-based",
): { entries: NormalizedFrequency[]; skipped: number } {
  const metaBankFiles = zipEntries
    .filter((e) => /^term_meta_bank_(\d+)\.json$/.test(e.entryName))
    .sort((a, b) => a.entryName.localeCompare(b.entryName, undefined, { numeric: true }));

  if (metaBankFiles.length === 0) {
    return { entries: [], skipped: 0 };
  }

  const entries: NormalizedFrequency[] = [];
  let skipped = 0;

  for (const entry of metaBankFiles) {
    let raw: unknown;
    try {
      raw = JSON.parse(entry.getData().toString("utf8"));
    } catch {
      skipped++;
      continue;
    }
    if (!Array.isArray(raw)) continue;

    for (const record of raw) {
      const normalized = normalizeFreqEntry(record, frequencyMode);
      if (normalized) {
        entries.push(normalized);
      } else {
        skipped++;
      }
    }
  }

  return { entries, skipped };
}

/**
 * Preview a frequency zip without writing to DB.
 */
export function previewFrequencyEntries(
  zipEntries: { entryName: string; getData: () => Buffer }[],
  frequencyMode: "rank-based" | "occurrence-based" = "rank-based",
): FrequencyPreviewResult {
  const { entries, skipped } = parseFrequencyEntries(zipEntries, frequencyMode);

  return {
    totalEntries: entries.length + skipped,
    sampleEntries: entries.slice(0, 20).map((e) => ({
      expression: e.expression,
      reading: e.reading,
      frequency: e.frequencyValue,
      display: e.displayValue,
    })),
    frequencyMode,
  };
}
