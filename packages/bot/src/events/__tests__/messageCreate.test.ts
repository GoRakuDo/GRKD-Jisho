import { afterEach, describe, expect, it, vi } from "vitest";

const {
  LanguageGuardErrorMock,
  checkRateLimitMock,
  extractFirstTermMock,
  generateWithLanguageGuardrailsMock,
  getActivePromptForScopeMock,
  getCachedResponseMock,
  incrementUsageMock,
  recordLookupMock,
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
    extractFirstTermMock: vi.fn(),
    generateWithLanguageGuardrailsMock: vi.fn(),
    getActivePromptForScopeMock: vi.fn(),
    getCachedResponseMock: vi.fn(),
    incrementUsageMock: vi.fn(),
    recordLookupMock: vi.fn(),
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
  incrementUsage: incrementUsageMock,
}));

vi.mock("../../services/reply-formatter.js", () => ({
  formatReply: (text: string) => ({ kind: "reply", text }),
  formatNotFound: (query: string) => ({ kind: "notfound", query }),
  formatError: (reason: string) => ({ kind: "error", reason }),
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
        "gemini-3.7-flash-high",
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
      expect.objectContaining({ bucket: "daily-japanese", source: "gemini-3.7-flash-high", reaskAttempts: 2, fallbackUsed: true }),
    );
    expect(reply).toHaveBeenCalledWith(expect.objectContaining({ kind: "error", reason: "Hasil generasi AI tidak memenuhi aturan bahasa. Silakan coba lagi." }));
    expect(saveResponseMock).not.toHaveBeenCalled();
    expect(incrementUsageMock).not.toHaveBeenCalled();
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
  });
});
