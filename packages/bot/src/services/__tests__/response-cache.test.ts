import { describe, it, expect, vi, beforeEach } from "vitest";

// ── 呼び出しカウントで戻り値を切り替えられるDBモック ──
const { mockDb, mockSchema, setDbResults } = vi.hoisted(() => {
  let resultsQueue: unknown[] = [];
  let callIndex = 0;

  const qb: Record<string, ReturnType<typeof vi.fn>> = {};
  const chainMethods = [
    "from", "where", "orderBy", "limit",
    "values", "onConflictDoNothing", "returning",
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
    insert: vi.fn(() => qb),
  };

  const schema = {
    responseCache: {
      normalizedQuery: "test", dictionaryId: "test",
      dictionaryEntryId: "test", roleKey: "test",
      promptVersion: "test", modelName: "test",
      isManualOverride: "test", query: "test",
      responseText: "test",
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

import { getCachedResponse, saveResponse } from "../response-cache.service";
import type { CacheKey } from "../../types";

const baseKey: CacheKey = {
  normalizedQuery: "test",
  dictionaryId: 1,
  entryId: BigInt(100),
  roleKey: "pemula",
  promptVersion: "v1",
  modelName: "gemini-2.0-flash",
};

describe("getCachedResponse", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    setDbResults();
  });

  it("全 cache key 一致でレコードを返す", async () => {
    const row = {
      id: BigInt(1),
      normalizedQuery: "test",
      dictionaryId: 1,
      dictionaryEntryId: BigInt(100),
      roleKey: "pemula",
      promptVersion: "v1",
      modelName: "gemini-2.0-flash",
      responseText: "answer",
      isManualOverride: false,
      query: "test",
    };
    setDbResults([row]);

    const result = await getCachedResponse(baseKey);
    expect(result).not.toBeNull();
    expect(result!.responseText).toBe("answer");
  });

  it("該当レコードなしで null を返す", async () => {
    setDbResults([]);

    const result = await getCachedResponse(baseKey);
    expect(result).toBeNull();
  });

  it("isManualOverride=true のレコードを優先する", async () => {
    const manualRow = {
      id: BigInt(2),
      normalizedQuery: "test",
      dictionaryId: 1,
      dictionaryEntryId: BigInt(100),
      roleKey: "pemula",
      promptVersion: "v1",
      modelName: "gemini-2.0-flash",
      responseText: "manual answer",
      isManualOverride: true,
      query: "test",
    };
    setDbResults([manualRow]);

    const result = await getCachedResponse(baseKey);
    expect(result).not.toBeNull();
    expect(result!.responseText).toBe("manual answer");
    expect(result!.isManualOverride).toBe(true);
  });
});

describe("saveResponse", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    setDbResults();
  });

  it("ON CONFLICT DO NOTHING で重複をスキップする", async () => {
    setDbResults([]);

    const result = await saveResponse({
      ...baseKey,
      responseText: "new answer",
    });
    expect(result).toBeNull();
  });

  it("新規保存時はレコードを返す", async () => {
    const savedRow = {
      id: BigInt(3),
      normalizedQuery: "test",
      dictionaryId: 1,
      dictionaryEntryId: BigInt(100),
      roleKey: "pemula",
      promptVersion: "v1",
      modelName: "gemini-2.0-flash",
      responseText: "saved",
      isManualOverride: false,
      query: "test",
    };
    setDbResults([savedRow]);

    const result = await saveResponse({
      ...baseKey,
      responseText: "saved",
    });
    expect(result).not.toBeNull();
    expect(result!.responseText).toBe("saved");
  });
});
