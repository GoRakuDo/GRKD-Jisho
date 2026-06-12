import { describe, it, expect, vi } from "vitest";

// Set dummy DATABASE_URL before @grkd-jisho/db import
vi.hoisted(() => {
  if (!process.env.DATABASE_URL) process.env.DATABASE_URL = "postgresql://test:test@localhost:5432/test";
});

import {
  normalizeFreqEntry,
  parseFrequencyEntries,
  previewFrequencyEntries,
  dedupeFrequencyEntries,
} from "@grkd-jisho/db";

describe("normalizeFreqEntry", () => {
  it("parses JPDB format with reading object", () => {
    const record = [
      "人間",
      "freq",
      { reading: "にんげん", frequency: { value: 158, displayValue: "158" } },
    ];
    const result = normalizeFreqEntry(record, "rank-based");
    expect(result).not.toBeNull();
    expect(result!.expression).toBe("人間");
    expect(result!.reading).toBe("にんげん");
    expect(result!.frequencyValue).toBe(158);
    expect(result!.displayValue).toBe("158");
    expect(result!.frequencyMode).toBe("rank-based");
    expect(result!.rawRecord).toBe(record);
  });

  it("parses BCCWJ format (plain number)", () => {
    const record = ["人間", "freq", 178];
    const result = normalizeFreqEntry(record, "occurrence-based");
    expect(result).not.toBeNull();
    expect(result!.expression).toBe("人間");
    expect(result!.reading).toBeNull();
    expect(result!.frequencyValue).toBe(178);
    expect(result!.displayValue).toBe("178");
    expect(result!.frequencyMode).toBe("occurrence-based");
    expect(result!.rawRecord).toBe(record);
  });

  it("parses CC100 format (reading as string)", () => {
    const record = [
      "人間",
      "freq",
      { reading: "にんげん", frequency: 294 },
    ];
    const result = normalizeFreqEntry(record, "rank-based");
    expect(result).not.toBeNull();
    expect(result!.expression).toBe("人間");
    expect(result!.reading).toBe("にんげん");
    expect(result!.frequencyValue).toBe(294);
    expect(result!.displayValue).toBe("294");
    expect(result!.frequencyMode).toBe("rank-based");
    expect(result!.rawRecord).toBe(record);
  });

  it("rejects non-freq mode entries", () => {
    const record = ["人間", "kanji", { reading: "にんげん" }];
    const result = normalizeFreqEntry(record, "rank-based");
    expect(result).toBeNull();
  });

  it("rejects empty expression", () => {
    const record = ["", "freq", 100];
    const result = normalizeFreqEntry(record, "rank-based");
    expect(result).toBeNull();
  });

  it("rejects non-string expression", () => {
    const record = [123, "freq", 100];
    const result = normalizeFreqEntry(record, "rank-based");
    expect(result).toBeNull();
  });

  it("rejects too-short arrays", () => {
    expect(normalizeFreqEntry(["a", "freq"], "rank-based")).toBeNull();
    expect(normalizeFreqEntry([], "rank-based")).toBeNull();
  });

  it("handles non-array input", () => {
    expect(normalizeFreqEntry("not an array", "rank-based")).toBeNull();
    expect(normalizeFreqEntry(null, "rank-based")).toBeNull();
  });

  it("extracts nested frequency value from {value: {value: N}}", () => {
    const record = [
      "テスト",
      "freq",
      { reading: "てすと", frequency: { value: { value: 42 }, displayValue: "42位" } },
    ];
    const result = normalizeFreqEntry(record, "rank-based");
    expect(result).not.toBeNull();
    expect(result!.expression).toBe("テスト");
    expect(result!.reading).toBe("てすと");
    expect(result!.frequencyValue).toBe(42);
    expect(result!.displayValue).toBe("42位");
    expect(result!.frequencyMode).toBe("rank-based");
    expect(result!.rawRecord).toBe(record);
  });
});

describe("parseFrequencyEntries", () => {
  function makeZipEntry(name: string, data: unknown[]) {
    return {
      entryName: name,
      getData: () => Buffer.from(JSON.stringify(data)),
    };
  }

  it("parses single term_meta_bank file", () => {
    const entries = [
      makeZipEntry("term_meta_bank_1.json", [
        ["人間", "freq", { reading: "にんげん", frequency: 158 }],
        ["猫", "freq", { reading: "ねこ", frequency: 300 }],
      ]),
    ];
    const result = parseFrequencyEntries(entries, "rank-based");
    expect(result.entries).toHaveLength(2);
    expect(result.skipped).toBe(0);
  });

  it("parses multiple term_meta_bank files in order", () => {
    const entries = [
      makeZipEntry("term_meta_bank_2.json", [
        ["猫", "freq", { reading: "ねこ", frequency: 300 }],
      ]),
      makeZipEntry("term_meta_bank_1.json", [
        ["人間", "freq", { reading: "にんげん", frequency: 158 }],
      ]),
    ];
    const result = parseFrequencyEntries(entries, "rank-based");
    expect(result.entries).toHaveLength(2);
    // Sorted by entryName: bank_1 first, bank_2 second
    expect(result.entries[0]!.expression).toBe("人間");
    expect(result.entries[1]!.expression).toBe("猫");
  });

  it("returns empty when no term_meta_bank files", () => {
    const entries = [
      makeZipEntry("term_bank_1.json", [["word", "reading", 0, 0, 0, ["def"]]]),
    ];
    const result = parseFrequencyEntries(entries, "rank-based");
    expect(result.entries).toHaveLength(0);
    expect(result.skipped).toBe(0);
  });

  it("skips malformed entries", () => {
    const entries = [
      makeZipEntry("term_meta_bank_1.json", [
        ["人間", "freq", { reading: "にんげん", frequency: 158 }],
        "not an array",
        [42],
        ["", "freq", 100],
      ]),
    ];
    const result = parseFrequencyEntries(entries, "rank-based");
    expect(result.entries).toHaveLength(1);
    expect(result.skipped).toBe(3);
  });
});

describe("previewFrequencyEntries", () => {
  function makeZipEntry(name: string, data: unknown[]) {
    return {
      entryName: name,
      getData: () => Buffer.from(JSON.stringify(data)),
    };
  }

  it("returns total count and first 20 samples", () => {
    const items = Array.from({ length: 50 }, (_, i) => [
      `word${i}`,
      "freq",
      { reading: `word${i}`, frequency: i + 1 },
    ]);
    const entries = [makeZipEntry("term_meta_bank_1.json", items)];
    const result = previewFrequencyEntries(entries, "rank-based");
    expect(result.totalEntries).toBe(50);
    expect(result.sampleEntries).toHaveLength(20);
    expect(result.frequencyMode).toBe("rank-based");
  });

  it("returns all samples when fewer than 20", () => {
    const entries = [
      makeZipEntry("term_meta_bank_1.json", [
        ["人間", "freq", { reading: "にんげん", frequency: 158 }],
      ]),
    ];
    const result = previewFrequencyEntries(entries, "rank-based");
    expect(result.totalEntries).toBe(1);
    expect(result.sampleEntries).toHaveLength(1);
    expect(result.sampleEntries[0]!.expression).toBe("人間");
  });
});

describe("dedupeFrequencyEntries", () => {
  function makeEntry(expression: string, reading: string | null, value: number) {
    return {
      expression,
      reading,
      frequencyValue: value,
      displayValue: String(value),
      frequencyMode: "rank-based" as const,
      rawRecord: null,
    };
  }

  it("keeps lowest value for rank-based mode", () => {
    const entries = [
      makeEntry("人間", "にんげん", 37433),
      makeEntry("人間", "にんげん", 158),
    ];
    const { unique, dedupedCount } = dedupeFrequencyEntries(entries, "rank-based");
    expect(unique).toHaveLength(1);
    expect(unique[0]!.frequencyValue).toBe(158);
    expect(dedupedCount).toBe(1);
  });

  it("keeps highest value for occurrence-based mode", () => {
    const entries = [
      makeEntry("test", "test", 100),
      makeEntry("test", "test", 500),
    ];
    const { unique, dedupedCount } = dedupeFrequencyEntries(entries, "occurrence-based");
    expect(unique).toHaveLength(1);
    expect(unique[0]!.frequencyValue).toBe(500);
    expect(dedupedCount).toBe(1);
  });

  it("preserves first entry on tie", () => {
    const e1 = makeEntry("word", "reading", 100);
    const e2 = makeEntry("word", "reading", 100);
    const { unique } = dedupeFrequencyEntries([e1, e2], "rank-based");
    expect(unique).toHaveLength(1);
    expect(unique[0]!.frequencyValue).toBe(100);
  });

  it("does not merge different expressions", () => {
    const entries = [
      makeEntry("人間", "にんげん", 158),
      makeEntry("人", "ひと", 50),
    ];
    const { unique } = dedupeFrequencyEntries(entries, "rank-based");
    expect(unique).toHaveLength(2);
  });

  it("does not merge different readings for same expression", () => {
    const entries = [
      makeEntry("間", "あいだ", 308),
      makeEntry("間", "かん", 1639),
    ];
    const { unique } = dedupeFrequencyEntries(entries, "rank-based");
    expect(unique).toHaveLength(2);
    expect(unique[0]!.reading).toBe("あいだ");
    expect(unique[1]!.reading).toBe("かん");
  });

  it("deduplicates null readings without collapsing with empty string", () => {
    const entries = [
      makeEntry("の", null, 1),
      makeEntry("の", "", 2),
    ];
    const { unique } = dedupeFrequencyEntries(entries, "rank-based");
    expect(unique).toHaveLength(2);
  });

  it("returns empty array for empty input", () => {
    const { unique, dedupedCount } = dedupeFrequencyEntries([], "rank-based");
    expect(unique).toHaveLength(0);
    expect(dedupedCount).toBe(0);
  });

  it("handles single entry", () => {
    const entries = [makeEntry("一", "いち", 42)];
    const { unique, dedupedCount } = dedupeFrequencyEntries(entries, "rank-based");
    expect(unique).toHaveLength(1);
    expect(dedupedCount).toBe(0);
  });
});
