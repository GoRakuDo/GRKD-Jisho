import { describe, it, expect, vi, beforeEach } from "vitest";

// ── DB mock (term_frequencies 専用) ──
const { mockDb, mockSchema, setFrequencyRows } = vi.hoisted(() => {
  let resultsQueue: unknown[][] = [];
  let callIndex = 0;

  const qb: Record<string, ReturnType<typeof vi.fn>> = {};
  const chainMethods = ["from", "where", "limit", "orderBy", "asc", "innerJoin"] as const;
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
    termFrequencies: {
      dictionaryId: "tf.dict",
      expression: "tf.expr",
      reading: "tf.reading",
      frequencyValue: "tf.fv",
      frequencyMode: "tf.mode",
    },
    dictionaries: {
      id: "d.id",
      isFrequencyOnly: "d.is_frequency_only",
    },
  };

  return {
    mockDb: db,
    mockSchema: schema,
    setFrequencyRows: (...vals: unknown[][]) => { resultsQueue = vals; callIndex = 0; },
  };
});

vi.mock("@grkd-jisho/db", () => ({
  db: mockDb,
  schema: mockSchema,
}));

import { rankTermMatchesByFrequency, filterByExplicitReading } from "../reading-ranker.service";

type FakeEntry = {
  id: bigint;
  createdAt: Date | null;
  dictionaryId: number;
  term: string;
  reading: string;
  definitionsJson: unknown;
  tagsJson: unknown;
  rawJson: unknown;
};

function entry(id: bigint, term: string, reading: string): FakeEntry {
  return {
    id,
    createdAt: null,
    dictionaryId: 1,
    term,
    reading,
    definitionsJson: [],
    tagsJson: {},
    rawJson: [],
  };
}
const NingenEntries: FakeEntry[] = [entry(BigInt(1), "人間", "にんげん"), entry(BigInt(2), "人間", "じんかん")];
const MaEntries: FakeEntry[] = [
  entry(BigInt(10), "間", "あいだ"),
  entry(BigInt(11), "間", "かん"),
  entry(BigInt(12), "間", "ま"),
];

describe("rankTermMatchesByFrequency", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    setFrequencyRows();
  });

  it("候補が 1件なら ranker を呼ばずにそのまま返す", async () => {
    const single = [NingenEntries[0]!];
    const result = await rankTermMatchesByFrequency("人間", single);
    expect(result).toEqual(single);
  });

  it("Frequency データが空なら元の順序を維持", async () => {
    setFrequencyRows([]); // no rows
    const result = await rankTermMatchesByFrequency("人間", [...NingenEntries]);
    expect(result[0]!.reading).toBe("にんげん");
    expect(result[1]!.reading).toBe("じんかん");
  });

  it("rank-based: にんげん (158) が じんかん (12345) より優先される", async () => {
    setFrequencyRows([
      { reading: "じんかん", frequencyValue: "12345", frequencyMode: "rank-based" },
      { reading: "にんげん", frequencyValue: "158", frequencyMode: "rank-based" },
    ]);
    const result = await rankTermMatchesByFrequency("人間", [...NingenEntries]);
    expect(result[0]!.reading).toBe("にんげん");
    expect(result[1]!.reading).toBe("じんかん");
  });

  it("occurrence-based: にんげん (50000) が じんかん (300) より優先される", async () => {
    setFrequencyRows([
      { reading: "にんげん", frequencyValue: "50000", frequencyMode: "occurrence-based" },
      { reading: "じんかん", frequencyValue: "300", frequencyMode: "occurrence-based" },
    ]);
    const result = await rankTermMatchesByFrequency("人間", [...NingenEntries]);
    expect(result[0]!.reading).toBe("にんげん");
    expect(result[1]!.reading).toBe("じんかん");
  });

  it("間: あいだ=298, かん=1309, ま=1396 → あいだが最優先", async () => {
    setFrequencyRows([
      { reading: "あいだ", frequencyValue: "298", frequencyMode: "rank-based" },
      { reading: "かん", frequencyValue: "1309", frequencyMode: "rank-based" },
      { reading: "ま", frequencyValue: "1396", frequencyMode: "rank-based" },
    ]);
    const result = await rankTermMatchesByFrequency("間", [...MaEntries]);
    expect(result.map((e) => e.reading)).toEqual(["あいだ", "かん", "ま"]);
  });

  it("reading-specific score がある候補を、無い候補より優先", async () => {
    const candidates: FakeEntry[] = [
      entry(BigInt(20), "X", "no-score"),
      entry(BigInt(21), "X", "has-score"),
    ];
    setFrequencyRows([
      { reading: "has-score", frequencyValue: "10", frequencyMode: "rank-based" },
    ]);
    const result = await rankTermMatchesByFrequency("X", candidates);
    expect(result[0]!.reading).toBe("has-score");
    expect(result[1]!.reading).toBe("no-score");
  });

  it("同じ (reading) に対して複数の frequency entry がある場合、最小値を採用", async () => {
    // あいだ(候補) には rank=100/298/500 の3行 → MIN=100
    // かん(候補)  には rank=50   のみ
    // rank-based: 50 < 100 なので かん が先頭に、2番目は あいだ (MIN=100)
    setFrequencyRows([
      { reading: "あいだ", frequencyValue: "500", frequencyMode: "rank-based" },
      { reading: "あいだ", frequencyValue: "100", frequencyMode: "rank-based" },
      { reading: "あいだ", frequencyValue: "298", frequencyMode: "rank-based" },
      { reading: "かん",  frequencyValue: "50",  frequencyMode: "rank-based" },
    ]);
    const candidates: FakeEntry[] = [MaEntries[0]!, MaEntries[1]!]; // あいだ, かん
    const result = await rankTermMatchesByFrequency("間", candidates);
    expect(result[0]!.reading).toBe("かん");
    expect(result[1]!.reading).toBe("あいだ");
  });

  it("MIN 採用の反証: あいだ MIN=80 が かん=200 に勝つ (FIRST 採用なら負ける)", async () => {
    // あいだ FIRST=500, MIN=80, かん=200
    // rank-based: MIN を採用するなら 80<200 で あいだ が先頭。
    // FIRST を採用するなら 500>200 で かん が先頭。
    // → あいだ が先頭になることで MIN 採用を証明できる。
    setFrequencyRows([
      { reading: "あいだ", frequencyValue: "500", frequencyMode: "rank-based" },
      { reading: "あいだ", frequencyValue: "80",  frequencyMode: "rank-based" },
      { reading: "あいだ", frequencyValue: "300", frequencyMode: "rank-based" },
      { reading: "かん",   frequencyValue: "200", frequencyMode: "rank-based" },
    ]);
    const candidates: FakeEntry[] = [MaEntries[0]!, MaEntries[1]!];
    const result = await rankTermMatchesByFrequency("間", candidates);
    expect(result[0]!.reading).toBe("あいだ");
    expect(result[1]!.reading).toBe("かん");
  });

  it("term-level のみ (reading=NULL) データしか無い場合は元順序維持", async () => {
    // BCCWJ シナリオ: reading 情報は無くて term-level (reading=null) だけある
    // 設計上の制約として、term-level データは候補間 tie-breaker としては
    // 使わず、元の順序を維持する
    setFrequencyRows([
      { reading: null, frequencyValue: "100", frequencyMode: "rank-based" },
      { reading: null, frequencyValue: "200", frequencyMode: "rank-based" },
    ]);
    const result = await rankTermMatchesByFrequency("間", [...MaEntries]);
    expect(result.map((e) => e.reading)).toEqual(["あいだ", "かん", "ま"]);
  });
});

describe("filterByExplicitReading", () => {
  it("明示 reading に一致する候補を返す", () => {
    const result = filterByExplicitReading([...NingenEntries], "じんかん");
    expect(result?.id).toBe(BigInt(2));
  });

  it("一致する候補が無い場合は null", () => {
    const result = filterByExplicitReading([...NingenEntries], "あいだ");
    expect(result).toBeNull();
  });

  it("候補リストが空なら null", () => {
    const result = filterByExplicitReading([], "じんかん");
    expect(result).toBeNull();
  });
});
