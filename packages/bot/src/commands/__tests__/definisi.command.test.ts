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

import { definisiCommand } from "../definisi.command.js";

afterEach(() => {
  vi.clearAllMocks();
});

describe("definisiCommand", () => {
  it("DM での実行は拒否する", async () => {
    const reply = vi.fn().mockResolvedValue(undefined);
    const interaction = {
      inGuild: () => false,
      channelId: "channel-1",
      reply,
    };

    await definisiCommand.execute(interaction as never);
    expect(reply).toHaveBeenCalledWith({
      content: "Perintah ini hanya dapat digunakan di server.",
      ephemeral: true,
    });
  });

  it("許可されていないチャンネルでの実行は拒否する", async () => {
    const reply = vi.fn().mockResolvedValue(undefined);
    const interaction = {
      inGuild: () => true,
      channelId: "channel-disallowed",
      reply,
    };

    await definisiCommand.execute(interaction as never);
    expect(reply).toHaveBeenCalledWith({
      content: "Perintah ini hanya dapat digunakan di channel yang diizinkan.",
      ephemeral: true,
    });
  });

  it("許可チャンネルで辞書ヒット＆キャッシュミス時に LLM 生成して公開返信する", async () => {
    sanitizeLookupQueryMock.mockReturnValue("食べる");
    extractFirstTermMock.mockResolvedValue({
      term: "食べる",
      result: {
        dictionary: { id: 1, name: "JMdict" },
        entry: { id: BigInt(10), term: "食べる", reading: "たべる", definitionsJson: {} },
        matchedBy: "term",
        normalizedQuery: "食べる",
      },
    });
    resolveOutputBucketKeyMock.mockResolvedValue("indonesian");
    checkRateLimitMock.mockResolvedValue({ allowed: true, limit: 10 });
    getActivePromptForScopeMock.mockResolvedValue({ content: "PROMPT", version: "v1" });
    getCachedResponseMock.mockResolvedValue(null);
    generateWithLanguageGuardrailsMock.mockResolvedValue({
      text: "Makan makanan",
      source: "openreouter-grkd-jisho-gemma-4-31b-it",
    });
    saveResponseMock.mockResolvedValue({ id: BigInt(100) });

    const deferReply = vi.fn().mockResolvedValue(undefined);
    const editReply = vi.fn().mockResolvedValue(undefined);
    const interaction = {
      id: "interaction-1",
      inGuild: () => true,
      guildId: "guild-1",
      channelId: "channel-1",
      user: { id: "user-1" },
      options: {
        getString: () => "食べる",
      },
      member: {
        roles: { cache: { map: () => ["role-1"] } },
      },
      memberPermissions: {
        has: () => false,
      },
      guild: {
        ownerId: "owner-1",
      },
      deferReply,
      editReply,
    };

    await definisiCommand.execute(interaction as never);

    expect(deferReply).toHaveBeenCalled();
    expect(generateWithLanguageGuardrailsMock).toHaveBeenCalledTimes(1);
    expect(saveResponseMock).toHaveBeenCalledWith(
      expect.objectContaining({
        modelName: "openreouter-grkd-jisho-gemma-4-31b-it",
        responseText: "Makan makanan",
      }),
    );
    expect(editReply).toHaveBeenCalledWith(
      expect.objectContaining({ kind: "reply", text: "Makan makanan" }),
    );
    expect(recordLookupMock).toHaveBeenCalledWith(
      expect.objectContaining({
        query: "食べる",
        llmSource: "openreouter-grkd-jisho-gemma-4-31b-it",
        responseCacheId: BigInt(100),
      }),
    );
    expect(incrementUsageMock).toHaveBeenCalledWith({
      userId: "user-1",
      guildId: "guild-1",
    });
  });

  it("rate limit 上限到達時は案内メッセージを返す", async () => {
    sanitizeLookupQueryMock.mockReturnValue("食べる");
    checkRateLimitMock.mockResolvedValue({ allowed: false, limit: 5 });

    const deferReply = vi.fn().mockResolvedValue(undefined);
    const editReply = vi.fn().mockResolvedValue(undefined);
    const interaction = {
      id: "interaction-1",
      inGuild: () => true,
      guildId: "guild-1",
      channelId: "channel-1",
      user: { id: "user-1" },
      options: {
        getString: () => "食べる",
      },
      member: {
        roles: { cache: { map: () => [] } },
      },
      memberPermissions: {
        has: () => false,
      },
      guild: {
        ownerId: "owner-2",
      },
      deferReply,
      editReply,
    };

    await definisiCommand.execute(interaction as never);

    expect(deferReply).toHaveBeenCalled();
    expect(editReply).toHaveBeenCalledWith(
      expect.stringContaining("本日の検索上限（5回）に達しました"),
    );
    expect(generateWithLanguageGuardrailsMock).not.toHaveBeenCalled();
  });
});
