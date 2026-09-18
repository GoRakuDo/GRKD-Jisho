import { afterEach, describe, expect, it, vi } from "vitest";

const {
  LanguageGuardErrorMock,
  checkRateLimitMock,
  commitFreePoolReservationMock,
  extractFirstTermMock,
  generateFreeWithLanguageGuardrailsMock,
  generateWithLanguageGuardrailsMock,
  getActivePromptForScopeMock,
  getCachedResponseMock,
  incrementUsageMock,
  recordLookupMock,
  releaseFreePoolReservationMock,
  reserveFreePoolMock,
  resolveOutputBucketKeyMock,
  sanitizeLookupQueryMock,
  saveResponseMock,
  traceEventMock,
} = vi.hoisted(() => {
  class LanguageGuardErrorMock extends Error {
    constructor(
      public readonly bucket: string,
      public readonly source: string,
      public readonly reaskAttempts: number,
      public readonly fallbackUsed: boolean,
      public readonly violations: Array<{ kind: string; label: string; sample: string }>,
      public readonly failureCategory: "language" | "quality" | "mixed" = "language",
    ) {
      super("Language guard validation failed");
      this.name = "LanguageGuardError";
    }
  }

  return {
    LanguageGuardErrorMock,
    checkRateLimitMock: vi.fn(),
    commitFreePoolReservationMock: vi.fn(),
    extractFirstTermMock: vi.fn(),
    generateFreeWithLanguageGuardrailsMock: vi.fn(),
    generateWithLanguageGuardrailsMock: vi.fn(),
    getActivePromptForScopeMock: vi.fn(),
    getCachedResponseMock: vi.fn(),
    incrementUsageMock: vi.fn(),
    recordLookupMock: vi.fn(),
    releaseFreePoolReservationMock: vi.fn(),
    reserveFreePoolMock: vi.fn(),
    resolveOutputBucketKeyMock: vi.fn(),
    sanitizeLookupQueryMock: vi.fn(),
    saveResponseMock: vi.fn(),
    traceEventMock: vi.fn().mockResolvedValue(undefined),
  };
});

vi.mock("../../config/env.js", () => ({
  env: {
    DISCORD_ALLOWED_CHANNELS: ["channel-1"],
    DISCORD_GUILD_ID: "guild-1",
    DISCORD_DM_OWNER_USER_ID: "owner-1",
  },
}));

vi.mock("../../services/llm.service.js", () => ({
  generateFreeWithLanguageGuardrails: generateFreeWithLanguageGuardrailsMock,
  generateWithLanguageGuardrails: generateWithLanguageGuardrailsMock,
  LanguageGuardError: LanguageGuardErrorMock,
  normalizePromptTemplate: (prompt: string) => prompt.trim(),
}));

vi.mock("../../services/extract-first-term.js", () => ({
  extractFirstTerm: extractFirstTermMock,
}));

vi.mock("../../services/role-mapper.service.js", () => ({
  resolveOutputBucketKey: resolveOutputBucketKeyMock,
}));

vi.mock("../../services/response-cache.service.js", () => ({
  getCachedResponse: getCachedResponseMock,
  saveResponse: saveResponseMock,
}));

vi.mock("../../services/lookup-log.service.js", () => ({
  recordLookup: recordLookupMock,
}));

vi.mock("../../services/rate-limit.service.js", () => ({
  checkRateLimit: checkRateLimitMock,
  commitFreePoolReservation: commitFreePoolReservationMock,
  incrementUsage: incrementUsageMock,
  releaseFreePoolReservation: releaseFreePoolReservationMock,
  reserveFreePool: reserveFreePoolMock,
}));

vi.mock("../../services/reply-formatter.js", () => ({
  formatFreeModelError: () => "free-model-error",
  formatFreeModelErrorForMember: () => "member-free-model-error",
  formatFreePoolExhausted: () => "free-pool-exhausted",
  formatMemberPoolExhausted: (limit: number) => `member-pool-exhausted-${limit}`,
  formatRateLimitExceeded: (limit: number) => `rate-limit-${limit}`,
  // 実物と同じく embeds を返す（wipe で返信先が消えたときの再送経路を再現するため）
  formatReply: (text: string) => ({ kind: "reply", text, embeds: [{ description: text }] }),
  formatNotFound: (query: string) => ({ kind: "notfound", query, embeds: [{ description: query }] }),
  formatError: (reason: string) => ({ kind: "error", reason, embeds: [{ description: reason }] }),
}));

vi.mock("../../services/observability.service.js", () => ({
  traceEvent: traceEventMock,
}));

vi.mock("@grkd-jisho/db", () => ({
  getActivePromptForScope: getActivePromptForScopeMock,
  sanitizeLookupQuery: sanitizeLookupQueryMock,
}));

import { messageCreateHandler } from "../messageCreate.js";

afterEach(() => {
  vi.clearAllMocks();
});

describe("messageCreateHandler", () => {
  it("Bot への返信（reply to bot）では反応しない", async () => {
    const reply = vi.fn();
    await messageCreateHandler({
      author: { bot: false, id: "user-1" },
      client: { user: { id: "bot-1" } },
      guildId: "guild-1",
      channelId: "channel-1",
      content: "ありがとう",
      reference: { messageId: "msg-123" },
      mentions: {
        has: (id: string) => id === "bot-1",
        repliedUser: { id: "bot-1" },
      },
      reply,
    } as never);

    expect(reply).not.toHaveBeenCalled();
    expect(traceEventMock).not.toHaveBeenCalled();
  });

  it("guild path の language guard failure を専用エラーとして返す", async () => {
    sanitizeLookupQueryMock.mockReturnValue("意味をください");
    extractFirstTermMock.mockResolvedValue({
      term: "意味をください",
      result: {
        dictionary: { id: 1, name: "JMdict" },
        entry: { id: BigInt(1), term: "意味をください", reading: "いみをください", definitionsJson: {} },
        matchedBy: "term",
        normalizedQuery: "意味をください",
      },
    });
    resolveOutputBucketKeyMock.mockResolvedValue("daily-japanese");
    checkRateLimitMock.mockResolvedValue({ allowed: true, limit: 10 });
    getActivePromptForScopeMock.mockResolvedValue({ content: "PROMPT", version: "v1" });
    getCachedResponseMock.mockResolvedValue(null);
    generateWithLanguageGuardrailsMock.mockRejectedValue(
      new LanguageGuardErrorMock(
        "daily-japanese",
        "google-grkd-jisho-gemini-flash-lite",
        2,
        true,
        [{ kind: "garbage-marker", label: "Repeated at-mark", sample: "@@@" }],
      ),
    );

    const reply = vi.fn().mockResolvedValue(undefined);
    const sendTyping = vi.fn().mockResolvedValue(undefined);
    const guildMember = {
      roles: { cache: { size: 1, map: () => ["role-1"] } },
      permissions: { has: () => false },
    };

    await messageCreateHandler({
      author: { bot: false, id: "user-1" },
      client: { user: { id: "bot-1" } },
      guildId: "guild-1",
      channelId: "channel-1",
      content: "@bot 意味をください",
      mentions: { has: (id: string) => id === "bot-1" },
      channel: { sendTyping },
      member: guildMember,
      guild: {
        ownerId: "owner-2",
        members: {
          fetch: vi.fn().mockResolvedValue(guildMember),
        },
      },
      reply,
    } as never);

    expect(generateWithLanguageGuardrailsMock).toHaveBeenCalledTimes(1);
    expect(traceEventMock).toHaveBeenCalledWith(
      expect.any(String),
      "llm.language_guard.failed",
      "warn",
      expect.objectContaining({ bucket: "daily-japanese", source: "google-grkd-jisho-gemini-flash-lite", reaskAttempts: 2, fallbackUsed: true }),
    );
    expect(reply).toHaveBeenCalledWith(expect.objectContaining({ kind: "error", reason: "Hasil generasi AI tidak memenuhi aturan bahasa. Silakan coba lagi." }));
    expect(saveResponseMock).not.toHaveBeenCalled();
    expect(incrementUsageMock).not.toHaveBeenCalled();
    expect(reserveFreePoolMock).not.toHaveBeenCalled();
    expect(recordLookupMock).not.toHaveBeenCalled();
  });

  it("本文中の @here / @everyone は query 前に除去される", async () => {
    sanitizeLookupQueryMock.mockImplementation((s: string) => s.trim());
    extractFirstTermMock.mockResolvedValue({
      term: "食べる",
      result: {
        dictionary: { id: 1, name: "JMdict" },
        entry: { id: BigInt(1), term: "食べる", reading: "たべる", definitionsJson: {} },
        matchedBy: "term",
        normalizedQuery: "食べる",
      },
    });
    resolveOutputBucketKeyMock.mockResolvedValue("indonesian");
    checkRateLimitMock.mockResolvedValue({ allowed: true, limit: 10 });
    getActivePromptForScopeMock.mockResolvedValue({ content: "PROMPT", version: "v1" });
    getCachedResponseMock.mockResolvedValue({ id: BigInt(99), responseText: "Makan" });

    const reply = vi.fn().mockResolvedValue(undefined);
    const sendTyping = vi.fn().mockResolvedValue(undefined);
    const guildMember = {
      roles: { cache: { size: 1, map: () => ["role-1"] } },
      permissions: { has: () => false },
    };

    await messageCreateHandler({
      author: { bot: false, id: "user-1" },
      client: { user: { id: "bot-1" } },
      guildId: "guild-1",
      channelId: "channel-1",
      content: "<@bot-1> @everyone 食べる",
      mentions: { has: (id: string) => id === "bot-1" },
      channel: { sendTyping },
      member: guildMember,
      guild: {
        ownerId: "owner-2",
        members: {
          fetch: vi.fn().mockResolvedValue(guildMember),
        },
      },
      reply,
    } as never);

    expect(sanitizeLookupQueryMock).toHaveBeenCalledWith("<@bot-1>   食べる");
    expect(reply).toHaveBeenCalledWith(expect.objectContaining({ kind: "reply", text: "Makan" }));
    expect(reserveFreePoolMock).not.toHaveBeenCalled();
  });

  it("無料ユーザーはキャッシュヒット時に生成せずプールも使用量も消費しない", async () => {
    sanitizeLookupQueryMock.mockReturnValue("食べる");
    extractFirstTermMock.mockResolvedValue({
      term: "食べる",
      result: {
        dictionary: { id: 1, name: "JMdict" },
        entry: { id: BigInt(1), term: "食べる", reading: "たべる", definitionsJson: {} },
        matchedBy: "term",
        normalizedQuery: "食べる",
      },
    });
    resolveOutputBucketKeyMock.mockResolvedValue("indonesian");
    checkRateLimitMock.mockResolvedValue({ allowed: true, limit: 10, freeUser: true });
    getActivePromptForScopeMock.mockResolvedValue({ content: "PROMPT", version: "v1" });
    getCachedResponseMock.mockResolvedValue({ id: BigInt(77), responseText: "Makan" });

    const reply = vi.fn().mockResolvedValue(undefined);
    const sendTyping = vi.fn().mockResolvedValue(undefined);
    const guildMember = {
      roles: { cache: { size: 0, map: () => [] } },
      permissions: { has: () => false },
    };

    await messageCreateHandler({
      author: { bot: false, id: "free-user-9" },
      client: { user: { id: "bot-1" } },
      guildId: "guild-1",
      channelId: "channel-1",
      content: "<@bot-1> 食べる",
      mentions: { has: (id: string) => id === "bot-1" },
      channel: { sendTyping },
      member: guildMember,
      guild: {
        ownerId: "owner-2",
        members: { fetch: vi.fn().mockResolvedValue(guildMember) },
      },
      reply,
    } as never);

    expect(reply).toHaveBeenCalledWith(expect.objectContaining({ kind: "reply", text: "Makan" }));
    expect(generateFreeWithLanguageGuardrailsMock).not.toHaveBeenCalled();
    expect(reserveFreePoolMock).not.toHaveBeenCalled();
    expect(commitFreePoolReservationMock).not.toHaveBeenCalled();
    expect(incrementUsageMock).not.toHaveBeenCalled();
  });

  it("無料ユーザーは共有枠があれば専用モデルで生成し、成功時だけ使用量を増やす", async () => {
    sanitizeLookupQueryMock.mockReturnValue("食べる");
    extractFirstTermMock.mockResolvedValue({
      term: "食べる",
      result: {
        dictionary: { id: 1, name: "JMdict" },
        entry: { id: BigInt(1), term: "食べる", reading: "たべる", definitionsJson: {} },
        matchedBy: "term",
        normalizedQuery: "食べる",
      },
    });
    resolveOutputBucketKeyMock.mockResolvedValue("indonesian");
    checkRateLimitMock.mockResolvedValue({ allowed: true, limit: 10, freeUser: true });
    getActivePromptForScopeMock.mockResolvedValue({ content: "PROMPT", version: "v1" });
    getCachedResponseMock.mockResolvedValue(null);
    reserveFreePoolMock.mockResolvedValue({ usageDate: "2026-05-06" });
    generateFreeWithLanguageGuardrailsMock.mockResolvedValue({
      text: "Makan",
      source: "google1-grkd-jisho-free-gemma-4-26b-a4b-it",
    });

    const reply = vi.fn().mockResolvedValue(undefined);
    const sendTyping = vi.fn().mockResolvedValue(undefined);
    const guildMember = {
      roles: { cache: { size: 0, map: () => [] } },
      permissions: { has: () => false },
    };

    await messageCreateHandler({
      author: { bot: false, id: "free-user-1" },
      client: { user: { id: "bot-1" } },
      guildId: "guild-1",
      channelId: "channel-1",
      content: "<@bot-1> 食べる",
      mentions: { has: (id: string) => id === "bot-1" },
      channel: { sendTyping },
      member: guildMember,
      guild: {
        ownerId: "owner-2",
        members: { fetch: vi.fn().mockResolvedValue(guildMember) },
      },
      reply,
    } as never);

    expect(generateFreeWithLanguageGuardrailsMock).toHaveBeenCalledTimes(1);
    expect(generateWithLanguageGuardrailsMock).not.toHaveBeenCalled();
    expect(getCachedResponseMock).toHaveBeenCalledTimes(1);
    expect(saveResponseMock).toHaveBeenCalledWith(
      expect.objectContaining({
        modelName: "google1-grkd-jisho-free-gemma-4-26b-a4b-it",
        responseText: "Makan",
      }),
    );
    expect(commitFreePoolReservationMock).toHaveBeenCalledWith({ usageDate: "2026-05-06" });
    expect(incrementUsageMock).toHaveBeenCalledWith({ userId: "free-user-1", guildId: "guild-1" });
    expect(reply).toHaveBeenCalledWith(expect.objectContaining({ kind: "reply", text: "Makan" }));
  });

  it("無料共有枠が切れている場合は生成せず専用メッセージを返す", async () => {
    sanitizeLookupQueryMock.mockReturnValue("食べる");
    extractFirstTermMock.mockResolvedValue({
      term: "食べる",
      result: {
        dictionary: { id: 1, name: "JMdict" },
        entry: { id: BigInt(1), term: "食べる", reading: "たべる", definitionsJson: {} },
        matchedBy: "term",
        normalizedQuery: "食べる",
      },
    });
    resolveOutputBucketKeyMock.mockResolvedValue("indonesian");
    checkRateLimitMock.mockResolvedValue({ allowed: true, limit: 10, freeUser: true });
    getActivePromptForScopeMock.mockResolvedValue({ content: "PROMPT", version: "v1" });
    getCachedResponseMock.mockResolvedValue(null);
    reserveFreePoolMock.mockResolvedValue(null);

    const reply = vi.fn().mockResolvedValue(undefined);
    const sendTyping = vi.fn().mockResolvedValue(undefined);
    const guildMember = {
      roles: { cache: { size: 0, map: () => [] } },
      permissions: { has: () => false },
    };

    await messageCreateHandler({
      author: { bot: false, id: "free-user-2" },
      client: { user: { id: "bot-1" } },
      guildId: "guild-1",
      channelId: "channel-1",
      content: "<@bot-1> 食べる",
      mentions: { has: (id: string) => id === "bot-1" },
      channel: { sendTyping },
      member: guildMember,
      guild: {
        ownerId: "owner-2",
        members: { fetch: vi.fn().mockResolvedValue(guildMember) },
      },
      reply,
    } as never);

    expect(reply).toHaveBeenCalledWith("free-pool-exhausted");
    expect(generateFreeWithLanguageGuardrailsMock).not.toHaveBeenCalled();
    expect(commitFreePoolReservationMock).not.toHaveBeenCalled();
    expect(incrementUsageMock).not.toHaveBeenCalled();
  });

  it("無料モデルの生成失敗時は障害メッセージを返し、枠と使用量を戻す", async () => {
    sanitizeLookupQueryMock.mockReturnValue("食べる");
    extractFirstTermMock.mockResolvedValue({
      term: "食べる",
      result: {
        dictionary: { id: 1, name: "JMdict" },
        entry: { id: BigInt(1), term: "食べる", reading: "たべる", definitionsJson: {} },
        matchedBy: "term",
        normalizedQuery: "食べる",
      },
    });
    resolveOutputBucketKeyMock.mockResolvedValue("indonesian");
    checkRateLimitMock.mockResolvedValue({ allowed: true, limit: 10, freeUser: true });
    getActivePromptForScopeMock.mockResolvedValue({ content: "PROMPT", version: "v1" });
    getCachedResponseMock.mockResolvedValue(null);
    reserveFreePoolMock.mockResolvedValue({ usageDate: "2026-05-06" });
    generateFreeWithLanguageGuardrailsMock.mockRejectedValue(new Error("CPA unavailable"));

    const reply = vi.fn().mockResolvedValue(undefined);
    const sendTyping = vi.fn().mockResolvedValue(undefined);
    const guildMember = {
      roles: { cache: { size: 0, map: () => [] } },
      permissions: { has: () => false },
    };

    await messageCreateHandler({
      author: { bot: false, id: "free-user-3" },
      client: { user: { id: "bot-1" } },
      guildId: "guild-1",
      channelId: "channel-1",
      content: "<@bot-1> 食べる",
      mentions: { has: (id: string) => id === "bot-1" },
      channel: { sendTyping },
      member: guildMember,
      guild: {
        ownerId: "owner-2",
        members: { fetch: vi.fn().mockResolvedValue(guildMember) },
      },
      reply,
    } as never);

    expect(reply).toHaveBeenCalledWith("free-model-error");
    expect(releaseFreePoolReservationMock).toHaveBeenCalledWith({ usageDate: "2026-05-06" });
    expect(commitFreePoolReservationMock).not.toHaveBeenCalled();
    expect(incrementUsageMock).not.toHaveBeenCalled();
    expect(recordLookupMock).not.toHaveBeenCalled();
  });

  it("メンバー上限到達後に共有枠があれば専用モデルで生成する", async () => {
    sanitizeLookupQueryMock.mockReturnValue("食べる");
    extractFirstTermMock.mockResolvedValue({
      term: "食べる",
      result: {
        dictionary: { id: 1, name: "JMdict" },
        entry: { id: BigInt(1), term: "食べる", reading: "たべる", definitionsJson: {} },
        matchedBy: "term",
        normalizedQuery: "食べる",
      },
    });
    resolveOutputBucketKeyMock.mockResolvedValue("indonesian");
    checkRateLimitMock.mockResolvedValue({ allowed: false, limit: 5, freeUser: false, freePoolFallback: true });
    getActivePromptForScopeMock.mockResolvedValue({ content: "PROMPT", version: "v1" });
    getCachedResponseMock.mockResolvedValue(null);
    reserveFreePoolMock.mockResolvedValue({ usageDate: "2026-05-06" });
    generateFreeWithLanguageGuardrailsMock.mockResolvedValue({
      text: "Makan",
      source: "google1-grkd-jisho-free-gemma-4-26b-a4b-it",
    });

    const reply = vi.fn().mockResolvedValue(undefined);
    const sendTyping = vi.fn().mockResolvedValue(undefined);
    const guildMember = {
      roles: { cache: { size: 1, map: () => ["member-role"] } },
      permissions: { has: () => false },
    };

    await messageCreateHandler({
      author: { bot: false, id: "member-1" },
      client: { user: { id: "bot-1" } },
      guildId: "guild-1",
      channelId: "channel-1",
      content: "<@bot-1> 食べる",
      mentions: { has: (id: string) => id === "bot-1" },
      channel: { sendTyping },
      member: guildMember,
      guild: {
        ownerId: "owner-2",
        members: { fetch: vi.fn().mockResolvedValue(guildMember) },
      },
      reply,
    } as never);

    expect(generateFreeWithLanguageGuardrailsMock).toHaveBeenCalledTimes(1);
    expect(generateWithLanguageGuardrailsMock).not.toHaveBeenCalled();
    expect(commitFreePoolReservationMock).toHaveBeenCalledWith({ usageDate: "2026-05-06" });
    expect(incrementUsageMock).toHaveBeenCalledWith({ userId: "member-1", guildId: "guild-1" });
    expect(reply).toHaveBeenCalledWith(expect.objectContaining({ kind: "reply", text: "Makan" }));
  });

  it("メンバーの個人上限到達時に共有枠が切れていれば専用の枯渇エラーを返す", async () => {
    sanitizeLookupQueryMock.mockReturnValue("食べる");
    extractFirstTermMock.mockResolvedValue({
      term: "食べる",
      result: {
        dictionary: { id: 1, name: "JMdict" },
        entry: { id: BigInt(1), term: "食べる", reading: "たべる", definitionsJson: {} },
        matchedBy: "term",
        normalizedQuery: "食べる",
      },
    });
    resolveOutputBucketKeyMock.mockResolvedValue("indonesian");
    checkRateLimitMock.mockResolvedValue({ allowed: false, limit: 5, freeUser: false, freePoolFallback: true });
    getActivePromptForScopeMock.mockResolvedValue({ content: "PROMPT", version: "v1" });
    getCachedResponseMock.mockResolvedValue(null);
    reserveFreePoolMock.mockResolvedValue(null);

    const reply = vi.fn().mockResolvedValue(undefined);
    const sendTyping = vi.fn().mockResolvedValue(undefined);
    const guildMember = {
      roles: { cache: { size: 1, map: () => ["member-role"] } },
      permissions: { has: () => false },
    };

    await messageCreateHandler({
      author: { bot: false, id: "member-2" },
      client: { user: { id: "bot-1" } },
      guildId: "guild-1",
      channelId: "channel-1",
      content: "<@bot-1> 食べる",
      mentions: { has: (id: string) => id === "bot-1" },
      channel: { sendTyping },
      member: guildMember,
      guild: {
        ownerId: "owner-2",
        members: { fetch: vi.fn().mockResolvedValue(guildMember) },
      },
      reply,
    } as never);

    expect(reply).toHaveBeenCalledWith("member-pool-exhausted-5");
    expect(generateFreeWithLanguageGuardrailsMock).not.toHaveBeenCalled();
    expect(incrementUsageMock).not.toHaveBeenCalled();
  });

  it("メンバーの無料モデル失敗時は専用障害文言を返し、共有枠を解放する", async () => {
    sanitizeLookupQueryMock.mockReturnValue("食べる");
    extractFirstTermMock.mockResolvedValue({
      term: "食べる",
      result: {
        dictionary: { id: 1, name: "JMdict" },
        entry: { id: BigInt(1), term: "食べる", reading: "たべる", definitionsJson: {} },
        matchedBy: "term",
        normalizedQuery: "食べる",
      },
    });
    resolveOutputBucketKeyMock.mockResolvedValue("indonesian");
    checkRateLimitMock.mockResolvedValue({ allowed: false, limit: 5, freeUser: false, freePoolFallback: true });
    getActivePromptForScopeMock.mockResolvedValue({ content: "PROMPT", version: "v1" });
    getCachedResponseMock.mockResolvedValue(null);
    reserveFreePoolMock.mockResolvedValue({ usageDate: "2026-05-06" });
    generateFreeWithLanguageGuardrailsMock.mockRejectedValue(new Error("CPA unavailable"));

    const reply = vi.fn().mockResolvedValue(undefined);
    const sendTyping = vi.fn().mockResolvedValue(undefined);
    const guildMember = {
      roles: { cache: { size: 1, map: () => ["member-role"] } },
      permissions: { has: () => false },
    };

    await messageCreateHandler({
      author: { bot: false, id: "member-3" },
      client: { user: { id: "bot-1" } },
      guildId: "guild-1",
      channelId: "channel-1",
      content: "<@bot-1> 食べる",
      mentions: { has: (id: string) => id === "bot-1" },
      channel: { sendTyping },
      member: guildMember,
      guild: {
        ownerId: "owner-2",
        members: { fetch: vi.fn().mockResolvedValue(guildMember) },
      },
      reply,
    } as never);

    expect(reply).toHaveBeenCalledWith("member-free-model-error");
    expect(releaseFreePoolReservationMock).toHaveBeenCalledWith({ usageDate: "2026-05-06" });
    expect(commitFreePoolReservationMock).not.toHaveBeenCalled();
    expect(incrementUsageMock).not.toHaveBeenCalled();
  });

  it("返信先が wipe で消えた場合（code 10008）はユーザータグ付きで再送する", async () => {
    sanitizeLookupQueryMock.mockReturnValue("食べる");
    extractFirstTermMock.mockResolvedValue({
      term: "食べる",
      result: {
        dictionary: { id: 1, name: "JMdict" },
        entry: { id: BigInt(1), term: "食べる", reading: "たべる", definitionsJson: {} },
        matchedBy: "term",
        normalizedQuery: "食べる",
      },
    });
    resolveOutputBucketKeyMock.mockResolvedValue("indonesian");
    checkRateLimitMock.mockResolvedValue({ allowed: true, limit: 10 });
    getActivePromptForScopeMock.mockResolvedValue({ content: "PROMPT", version: "v1" });
    getCachedResponseMock.mockResolvedValue(null);
    generateWithLanguageGuardrailsMock.mockResolvedValue({ text: "Makan", source: "model-1" });
    saveResponseMock.mockResolvedValue({ id: BigInt(7) });

    const reply = vi.fn().mockRejectedValue({ code: 10008, message: "Unknown Message" });
    const send = vi.fn().mockResolvedValue(undefined);
    const sendTyping = vi.fn().mockResolvedValue(undefined);
    const guildMember = {
      roles: { cache: { size: 1, map: () => ["role-1"] } },
      permissions: { has: () => false },
    };

    await messageCreateHandler({
      author: { bot: false, id: "user-1" },
      client: { user: { id: "bot-1" } },
      guildId: "guild-1",
      channelId: "channel-1",
      content: "<@bot-1> 食べる",
      mentions: { has: (id: string) => id === "bot-1" },
      channel: { send, sendTyping },
      member: guildMember,
      guild: {
        ownerId: "owner-2",
        members: { fetch: vi.fn().mockResolvedValue(guildMember) },
      },
      reply,
    } as never);

    expect(reply).toHaveBeenCalledWith(expect.objectContaining({ kind: "reply", text: "Makan" }));
    expect(send).toHaveBeenCalledWith(expect.objectContaining({ content: "<@user-1>", embeds: expect.any(Array) }));
  });

  it("MESSAGE_REFERENCE_UNKNOWN_MESSAGE（code 50035）でもタグ付きで再送する", async () => {
    sanitizeLookupQueryMock.mockReturnValue("食べる");
    extractFirstTermMock.mockResolvedValue({
      term: "食べる",
      result: {
        dictionary: { id: 1, name: "JMdict" },
        entry: { id: BigInt(1), term: "食べる", reading: "たべる", definitionsJson: {} },
        matchedBy: "term",
        normalizedQuery: "食べる",
      },
    });
    checkRateLimitMock.mockResolvedValue({ allowed: false, limit: 5 });

    const reply = vi.fn().mockRejectedValue({
      code: 50035,
      message: "Invalid Form Body\nmessage_reference: MESSAGE_REFERENCE_UNKNOWN_MESSAGE",
    });
    const send = vi.fn().mockResolvedValue(undefined);
    const sendTyping = vi.fn().mockResolvedValue(undefined);
    const guildMember = {
      roles: { cache: { size: 1, map: () => ["role-1"] } },
      permissions: { has: () => false },
    };

    await messageCreateHandler({
      author: { bot: false, id: "user-1" },
      client: { user: { id: "bot-1" } },
      guildId: "guild-1",
      channelId: "channel-1",
      content: "<@bot-1> 食べる",
      mentions: { has: (id: string) => id === "bot-1" },
      channel: { send, sendTyping },
      member: guildMember,
      guild: {
        ownerId: "owner-2",
        members: { fetch: vi.fn().mockResolvedValue(guildMember) },
      },
      reply,
    } as never);

    expect(reply).toHaveBeenCalledWith("rate-limit-5");
    expect(send).toHaveBeenCalledWith("<@user-1> rate-limit-5");
  });

  it("返信先消失以外のエラーでは再送しない", async () => {
    sanitizeLookupQueryMock.mockReturnValue("食べる");
    extractFirstTermMock.mockResolvedValue({
      term: "食べる",
      result: {
        dictionary: { id: 1, name: "JMdict" },
        entry: { id: BigInt(1), term: "食べる", reading: "たべる", definitionsJson: {} },
        matchedBy: "term",
        normalizedQuery: "食べる",
      },
    });
    checkRateLimitMock.mockResolvedValue({ allowed: false, limit: 5 });

    const reply = vi.fn().mockRejectedValue({ code: 50013, message: "Missing Permissions" });
    const send = vi.fn().mockResolvedValue(undefined);
    const sendTyping = vi.fn().mockResolvedValue(undefined);
    const guildMember = {
      roles: { cache: { size: 1, map: () => ["role-1"] } },
      permissions: { has: () => false },
    };

    await messageCreateHandler({
      author: { bot: false, id: "user-1" },
      client: { user: { id: "bot-1" } },
      guildId: "guild-1",
      channelId: "channel-1",
      content: "<@bot-1> 食べる",
      mentions: { has: (id: string) => id === "bot-1" },
      channel: { send, sendTyping },
      member: guildMember,
      guild: {
        ownerId: "owner-2",
        members: { fetch: vi.fn().mockResolvedValue(guildMember) },
      },
      reply,
    } as never);

    expect(reply).toHaveBeenCalledWith("rate-limit-5");
    expect(send).not.toHaveBeenCalled();
    expect(traceEventMock).toHaveBeenCalledWith(
      expect.any(String),
      "reply.error",
      "error",
      expect.objectContaining({ channelId: "channel-1", userId: "user-1" }),
    );
  });
});
