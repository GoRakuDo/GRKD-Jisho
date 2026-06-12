import { describe, it, expect, vi, beforeEach } from "vitest";

// ── 呼び出しカウントで戻り値を切り替えられるDBモック ──
const { mockDb, mockSchema, setDbResults } = vi.hoisted(() => {
  let resultsQueue: unknown[] = [];
  let callIndex = 0;

  const qb: Record<string, ReturnType<typeof vi.fn>> = {};
  const chainMethods = [
    "from", "where", "orderBy", "limit",
  ] as const;
  for (const k of chainMethods) {
    qb[k] = vi.fn(() => qb);
  }
  (qb as unknown as { then: (r: (v: unknown) => void) => void }).then = (resolve) => {
    const idx = callIndex < resultsQueue.length ? callIndex : resultsQueue.length - 1;
    const r = idx >= 0 && idx < resultsQueue.length ? resultsQueue[idx] : [];
    callIndex++;
    resolve(r);
  };

  const db = {
    select: vi.fn(() => qb),
  };

  const schema = {
    dictionaries: { enabled: "test", priority: "test" },
    dictionaryEntries: { dictionaryId: "test", term: "test", reading: "test" },
    termFrequencies: {
      dictionaryId: "tf.dict",
      expression: "tf.expr",
      reading: "tf.reading",
      frequencyValue: "tf.fv",
      frequencyMode: "tf.mode",
    },
  };

  return {
    mockDb: db,
    mockSchema: schema,
    setDbResults: (...vals: unknown[][]) => { resultsQueue = vals; callIndex = 0; },
  };
});

vi.mock("@grkd-jisho/db", () => ({
  db: mockDb,
  schema: mockSchema,
}));

import { lookupWord } from "../dictionary.service";

describe("lookupWord", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    setDbResults();
  });

  it("term exactly — 最初の辞書から term 一致で返す", async () => {
    const dict = { id: 1, name: "JMdict", enabled: true, priority: 1 };
    const entry = { id: BigInt(10), term: "test", reading: null, dictionaryId: 1 };
    // 1st select: enabled dictionaries → [dict]
    // 2nd select: term query → [entry]
    setDbResults([dict], [entry]);

    const result = await lookupWord("  test  ");
    expect(result).not.toBeNull();
    expect(result!.dictionary.id).toBe(1);
    expect(result!.entry.id).toBe(BigInt(10));
    expect(result!.matchedBy).toBe("term");
    expect(result!.normalizedQuery).toBe("test");
  });

  it("reading fallback — term miss で reading 一致を返す", async () => {
    const dict = { id: 2, name: "JMdict", enabled: true, priority: 1 };
    const entry = { id: BigInt(20), term: "可憐", reading: "かれん", dictionaryId: 2 };
    // 1st select: enabled dictionaries → [dict]
    // 2nd select: term query → [] (miss)
    // 3rd select: reading query → [entry] (hit)
    setDbResults([dict], [], [entry]);

    const result = await lookupWord("かれん");
    expect(result).not.toBeNull();
    expect(result!.entry.id).toBe(BigInt(20));
    expect(result!.matchedBy).toBe("reading");
    expect(result!.normalizedQuery).toBe("かれん");
  });

  it("カタカナ query はひらがなに正規化されてから検索される", async () => {
    const dict = { id: 3, name: "JMdict", enabled: true, priority: 1 };
    const entry = { id: BigInt(30), term: "かれん", reading: null, dictionaryId: 3 };
    // カタカナ「カレン」→ NFKCで全角→ひらがな「かれん」
    setDbResults([dict], [entry]);

    const result = await lookupWord("カレン");
    expect(result).not.toBeNull();
    expect(result!.matchedBy).toBe("term");
    expect(result!.normalizedQuery).toBe("かれん");
  });

  it("term exactly が reading より優先される", async () => {
    const dict = { id: 4, name: "JMdict", enabled: true, priority: 1 };
    const termEntry = { id: BigInt(40), term: "はし", reading: null, dictionaryId: 4 };
    const readingEntry = { id: BigInt(41), term: "橋", reading: "はし", dictionaryId: 4 };
    // term hit で short-circuit
    setDbResults([dict], [termEntry]);

    const result = await lookupWord("はし");
    expect(result).not.toBeNull();
    expect(result!.entry.id).toBe(BigInt(40));
    expect(result!.matchedBy).toBe("term");
  });

  it("全辞書で見つからない場合は null", async () => {
    const dict = { id: 5, name: "JMdict", enabled: true, priority: 1 };
    // dict found → term miss → reading miss → null
    setDbResults([dict], [], []);

    const result = await lookupWord("存在しない単語");
    expect(result).toBeNull();
  });

  it("term miss の後、次の辞書を試す", async () => {
    const dict1 = { id: 10, name: "dict1", enabled: true, priority: 1 };
    const dict2 = { id: 20, name: "dict2", enabled: true, priority: 2 };
    const entry2 = { id: BigInt(200), term: "test", reading: null, dictionaryId: 20 };
    // dict1: term miss → no reading match
    // dict2: term hit
    setDbResults([dict1, dict2], [], [], [entry2]);

    const result = await lookupWord("test");
    expect(result).not.toBeNull();
    expect(result!.dictionary.id).toBe(20);
    expect(result!.matchedBy).toBe("term");
  });

  it("文語形容詞: 止事無き は 止 まで短縮されず 止事無い に deinflect される", async () => {
    const dict = { id: 30, name: "広辞苑", enabled: true, priority: 3 };
    const entry = { id: BigInt(300), term: "止事無い", reading: "やんごとない", dictionaryId: 30 };

    // dict found → exact term miss → exact reading miss → deinflected term hit
    setDbResults([dict], [], [], [entry]);

    const result = await lookupWord("止事無き");

    expect(result).not.toBeNull();
    expect(result!.entry.term).toBe("止事無い");
    expect(result!.matchedBy).toBe("deinflected");
    expect(result!.originalInflected).toBe("止事無き");
    expect(result!.deinflectedFrom).toBe("止事無い");
  });

  it("multi-reading 漢字: ranker で frequency ベストが優先される", async () => {
    const dict = { id: 40, name: "新明解", enabled: true, priority: 1 };
    const entryA = { id: BigInt(401), term: "人間", reading: "にんげん", dictionaryId: 40 };
    const entryB = { id: BigInt(402), term: "人間", reading: "じんかん", dictionaryId: 40 };
    // 1: dictionaries → [dict]
    // 2: term query → [entryA, entryB] (2 件)
    // 3: term_frequencies query → ranker へ
    setDbResults(
      [dict],
      [entryA, entryB],
      [
        { reading: "じんかん", frequencyValue: "12345", frequencyMode: "rank-based" },
        { reading: "にんげん", frequencyValue: "158", frequencyMode: "rank-based" },
      ]
    );

    const result = await lookupWord("人間");

    expect(result).not.toBeNull();
    expect(result!.entry.reading).toBe("にんげん"); // ranker が 158 を選ぶ
    expect(result!.matchedBy).toBe("term");
  });

  it("multi-reading 漢字: frequency データが空なら元の順序を維持", async () => {
    const dict = { id: 41, name: "新明解", enabled: true, priority: 1 };
    const entryA = { id: BigInt(411), term: "人間", reading: "にんげん", dictionaryId: 41 };
    const entryB = { id: BigInt(412), term: "人間", reading: "じんかん", dictionaryId: 41 };
    setDbResults([dict], [entryA, entryB], []); // no frequency data

    const result = await lookupWord("人間");
    expect(result).not.toBeNull();
    expect(result!.entry.reading).toBe("にんげん"); // 元の順序 (id 順)
  });

  it("explicit reading: 多読み候補の中で指定の reading を返す", async () => {
    const dict = { id: 50, name: "新明解", enabled: true, priority: 1 };
    const entryA = { id: BigInt(501), term: "人間", reading: "にんげん", dictionaryId: 50 };
    const entryB = { id: BigInt(502), term: "人間", reading: "じんかん", dictionaryId: 50 };
    setDbResults([dict], [entryA, entryB]);

    const result = await lookupWord("人間", "じんかん");
    expect(result).not.toBeNull();
    expect(result!.entry.reading).toBe("じんかん");
    expect(result!.matchedBy).toBe("term");
  });

  it("explicit reading: 指定 reading が辞書に無ければ null (reading fallback しない)", async () => {
    const dict = { id: 60, name: "新明解", enabled: true, priority: 1 };
    const entryA = { id: BigInt(601), term: "人間", reading: "にんげん", dictionaryId: 60 };
    const entryB = { id: BigInt(602), term: "人間", reading: "じんかん", dictionaryId: 60 };
    // explicit reading = "あいだ" → 多読み候補に無い → null
    // reading match は explicit reading 指定時には走らない
    setDbResults([dict], [entryA, entryB]);

    const result = await lookupWord("人間", "あいだ");
    expect(result).toBeNull();
  });
});
