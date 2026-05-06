import { describe, it, expect, vi, beforeEach } from "vitest";

// ── 呼び出しカウントで戻り値を切り替えられるDBモック ──
const { mockDb, mockSchema, setDbResults } = vi.hoisted(() => {
  let resultsQueue: unknown[] = [];
  let callIndex = 0;

  const qb: Record<string, ReturnType<typeof vi.fn>> = {};
  const chainMethods = [
    "from", "where", "orderBy", "limit",
    "values", "onConflictDoNothing", "onConflictDoUpdate", "returning",
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
    delete: vi.fn(() => qb),
    update: vi.fn(() => qb),
  };

  const schema = {
    roleRateLimits: { discordRoleId: "test", dailyLimit: "test" },
    userUsage: { userId: "test", guildId: "test", usageDate: "test" as const },
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

vi.mock("../date-utils.js", () => ({
  toGMT7Date: vi.fn(() => "2026-05-06"),
}));

import { checkRateLimit, incrementUsage } from "../rate-limit.service";

describe("checkRateLimit", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    setDbResults();
  });

  it("Owner は常に allowed=true, remaining=Infinity", async () => {
    const result = await checkRateLimit({
      userId: "1", guildId: "1", memberRoles: [],
      isOwner: true, hasAdminPermission: false,
    });
    expect(result).toEqual({ allowed: true, remaining: Infinity, limit: Infinity });
    expect(mockDb.select).not.toHaveBeenCalled();
  });

  it("Administrator は常に allowed=true, remaining=Infinity", async () => {
    const result = await checkRateLimit({
      userId: "2", guildId: "1", memberRoles: [],
      isOwner: false, hasAdminPermission: true,
    });
    expect(result).toEqual({ allowed: true, remaining: Infinity, limit: Infinity });
    expect(mockDb.select).not.toHaveBeenCalled();
  });

  it("空 memberRoles は直接 __default__ を参照する", async () => {
    setDbResults(
      [{ discordRoleId: "__default__", dailyLimit: 10 }],
      [],
    );

    const result = await checkRateLimit({
      userId: "3", guildId: "1", memberRoles: [],
      isOwner: false, hasAdminPermission: false,
    });
    expect(result.allowed).toBe(true);
    expect(result.limit).toBe(10);
    expect(result.remaining).toBe(10);
  });

  it("ロール別上限がない場合、__default__ を使う", async () => {
    setDbResults(
      [],
      [{ discordRoleId: "__default__", dailyLimit: 10 }],
      [],
    );

    const result = await checkRateLimit({
      userId: "3", guildId: "1", memberRoles: ["role_a"],
      isOwner: false, hasAdminPermission: false,
    });
    expect(result.allowed).toBe(true);
    expect(result.limit).toBe(10);
    expect(result.remaining).toBe(10);
  });

  it("daily_limit=-1 は無制限", async () => {
    setDbResults([{ discordRoleId: "role_a", dailyLimit: -1 }]);

    const result = await checkRateLimit({
      userId: "4", guildId: "1", memberRoles: ["role_a"],
      isOwner: false, hasAdminPermission: false,
    });
    expect(result).toEqual({ allowed: true, remaining: Infinity, limit: -1 });
  });

  it("複数ロールを持つ場合、最も緩い上限を使う", async () => {
    setDbResults([
      { discordRoleId: "role_a", dailyLimit: 5 },
      { discordRoleId: "role_b", dailyLimit: 20 },
    ]);

    const result = await checkRateLimit({
      userId: "6", guildId: "1", memberRoles: ["role_a", "role_b"],
      isOwner: false, hasAdminPermission: false,
    });
    expect(result.limit).toBe(20);
    expect(result.allowed).toBe(true);
  });

  it("usage が上限に達している場合は allowed=false", async () => {
    setDbResults(
      [],
      [{ discordRoleId: "__default__", dailyLimit: 10 }],
      [{ count: 10 }],
    );

    const result = await checkRateLimit({
      userId: "7", guildId: "1", memberRoles: ["role_unknown"],
      isOwner: false, hasAdminPermission: false,
    });
    expect(result.allowed).toBe(false);
    expect(result.remaining).toBe(0);
    expect(result.limit).toBe(10);
  });
});

describe("incrementUsage", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    setDbResults();
  });

  it("INSERT + onConflictDoUpdate を呼ぶ", async () => {
    await incrementUsage({ userId: "u1", guildId: "g1" });
    expect(mockDb.insert).toHaveBeenCalledTimes(1);
  });
});
