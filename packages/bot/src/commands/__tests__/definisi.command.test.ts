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
      content: "Perintah ini hanya dapat digunakan di channel pencarian kamus yang telah ditentukan.",
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
    expect(reserveFreePoolMock).not.toHaveBeenCalled();
  });

  it("無料ユーザーは共有枠があれば専用モデルで一度だけ生成する", async () => {
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
    checkRateLimitMock.mockResolvedValue({ allowed: true, limit: 10, freeUser: true });
    getActivePromptForScopeMock.mockResolvedValue({ content: "PROMPT", version: "v1" });
    reserveFreePoolMock.mockResolvedValue({ usageDate: "2026-05-06" });
    generateFreeWithLanguageGuardrailsMock.mockResolvedValue({
      text: "Makan makanan",
      source: "google1-grkd-jisho-free-gemma-4-26b-a4b-it",
    });

    const deferReply = vi.fn().mockResolvedValue(undefined);
    const editReply = vi.fn().mockResolvedValue(undefined);
    const interaction = {
      id: "interaction-free-1",
      inGuild: () => true,
      guildId: "guild-1",
      channelId: "channel-1",
      user: { id: "free-user-1" },
      options: { getString: () => "食べる" },
      member: { roles: { cache: { map: () => [] } } },
      memberPermissions: { has: () => false },
      guild: { ownerId: "owner-2" },
      deferReply,
      editReply,
    };

    await definisiCommand.execute(interaction as never);

    expect(checkRateLimitMock).toHaveBeenCalledWith(
      expect.objectContaining({ memberRoles: [], includeFreeUser: true }),
    );
    expect(generateFreeWithLanguageGuardrailsMock).toHaveBeenCalledTimes(1);
    expect(generateWithLanguageGuardrailsMock).not.toHaveBeenCalled();
    expect(getCachedResponseMock).not.toHaveBeenCalled();
    expect(saveResponseMock).not.toHaveBeenCalled();
    expect(commitFreePoolReservationMock).toHaveBeenCalledWith({ usageDate: "2026-05-06" });
    expect(incrementUsageMock).toHaveBeenCalledWith({
      userId: "free-user-1",
      guildId: "guild-1",
    });
    expect(editReply).toHaveBeenCalledWith(
      expect.objectContaining({ kind: "reply", text: "Makan makanan" }),
    );
  });

  it("無料共有枠が切れている場合は生成せず専用メッセージを返す", async () => {
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
    checkRateLimitMock.mockResolvedValue({ allowed: true, limit: 10, freeUser: true });
    getActivePromptForScopeMock.mockResolvedValue({ content: "PROMPT", version: "v1" });
    reserveFreePoolMock.mockResolvedValue(null);

    const deferReply = vi.fn().mockResolvedValue(undefined);
    const editReply = vi.fn().mockResolvedValue(undefined);
    const interaction = {
      id: "interaction-free-2",
      inGuild: () => true,
      guildId: "guild-1",
      channelId: "channel-1",
      user: { id: "free-user-2" },
      options: { getString: () => "食べる" },
      member: { roles: { cache: { map: () => [] } } },
      memberPermissions: { has: () => false },
      guild: { ownerId: "owner-2" },
      deferReply,
      editReply,
    };

    await definisiCommand.execute(interaction as never);

    expect(editReply).toHaveBeenCalledWith("free-pool-exhausted");
    expect(generateFreeWithLanguageGuardrailsMock).not.toHaveBeenCalled();
    expect(commitFreePoolReservationMock).not.toHaveBeenCalled();
    expect(incrementUsageMock).not.toHaveBeenCalled();
  });

  it("無料モデルの生成失敗時は枠を解放し、使用量を増やさない", async () => {
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
    checkRateLimitMock.mockResolvedValue({ allowed: true, limit: 10, freeUser: true });
    getActivePromptForScopeMock.mockResolvedValue({ content: "PROMPT", version: "v1" });
    reserveFreePoolMock.mockResolvedValue({ usageDate: "2026-05-06" });
    generateFreeWithLanguageGuardrailsMock.mockRejectedValue(new Error("CPA unavailable"));

    const deferReply = vi.fn().mockResolvedValue(undefined);
    const editReply = vi.fn().mockResolvedValue(undefined);
    const interaction = {
      id: "interaction-free-3",
      inGuild: () => true,
      guildId: "guild-1",
      channelId: "channel-1",
      user: { id: "free-user-3" },
      options: { getString: () => "食べる" },
      member: { roles: { cache: { map: () => [] } } },
      memberPermissions: { has: () => false },
      guild: { ownerId: "owner-2" },
      deferReply,
      editReply,
    };

    await definisiCommand.execute(interaction as never);

    expect(editReply).toHaveBeenCalledWith("free-model-error");
    expect(releaseFreePoolReservationMock).toHaveBeenCalledWith({ usageDate: "2026-05-06" });
    expect(commitFreePoolReservationMock).not.toHaveBeenCalled();
    expect(incrementUsageMock).not.toHaveBeenCalled();
    expect(recordLookupMock).not.toHaveBeenCalled();
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
    expect(editReply).toHaveBeenCalledWith("rate-limit-5");
    expect(generateWithLanguageGuardrailsMock).not.toHaveBeenCalled();
  });

  it("メンバー上限到達後に共有枠があれば専用モデルで生成する", async () => {
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
    checkRateLimitMock.mockResolvedValue({ allowed: false, limit: 5, freeUser: false, freePoolFallback: true });
    getActivePromptForScopeMock.mockResolvedValue({ content: "PROMPT", version: "v1" });
    reserveFreePoolMock.mockResolvedValue({ usageDate: "2026-05-06" });
    generateFreeWithLanguageGuardrailsMock.mockResolvedValue({
      text: "Makan makanan",
      source: "google1-grkd-jisho-free-gemma-4-26b-a4b-it",
    });

    const deferReply = vi.fn().mockResolvedValue(undefined);
    const editReply = vi.fn().mockResolvedValue(undefined);
    const interaction = {
      id: "interaction-member-1",
      inGuild: () => true,
      guildId: "guild-1",
      channelId: "channel-1",
      user: { id: "member-1" },
      options: { getString: () => "食べる" },
      member: { roles: { cache: { map: () => ["member-role"] } } },
      memberPermissions: { has: () => false },
      guild: { ownerId: "owner-2" },
      deferReply,
      editReply,
    };

    await definisiCommand.execute(interaction as never);

    expect(generateFreeWithLanguageGuardrailsMock).toHaveBeenCalledTimes(1);
    expect(generateWithLanguageGuardrailsMock).not.toHaveBeenCalled();
    expect(commitFreePoolReservationMock).toHaveBeenCalledWith({ usageDate: "2026-05-06" });
    expect(incrementUsageMock).toHaveBeenCalledWith({ userId: "member-1", guildId: "guild-1" });
    expect(editReply).toHaveBeenCalledWith(expect.objectContaining({ kind: "reply", text: "Makan makanan" }));
  });

  it("メンバーの個人上限到達時に共有枠が切れていれば専用の枯渇エラーを返す", async () => {
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
    checkRateLimitMock.mockResolvedValue({ allowed: false, limit: 5, freeUser: false, freePoolFallback: true });
    getActivePromptForScopeMock.mockResolvedValue({ content: "PROMPT", version: "v1" });
    reserveFreePoolMock.mockResolvedValue(null);

    const deferReply = vi.fn().mockResolvedValue(undefined);
    const editReply = vi.fn().mockResolvedValue(undefined);
    const interaction = {
      id: "interaction-member-2",
      inGuild: () => true,
      guildId: "guild-1",
      channelId: "channel-1",
      user: { id: "member-2" },
      options: { getString: () => "食べる" },
      member: { roles: { cache: { map: () => ["member-role"] } } },
      memberPermissions: { has: () => false },
      guild: { ownerId: "owner-2" },
      deferReply,
      editReply,
    };

    await definisiCommand.execute(interaction as never);

    expect(editReply).toHaveBeenCalledWith("member-pool-exhausted-5");
    expect(generateFreeWithLanguageGuardrailsMock).not.toHaveBeenCalled();
    expect(incrementUsageMock).not.toHaveBeenCalled();
  });

  it("メンバーの無料モデル失敗時は専用障害文言を返し、共有枠を解放する", async () => {
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
    checkRateLimitMock.mockResolvedValue({ allowed: false, limit: 5, freeUser: false, freePoolFallback: true });
    getActivePromptForScopeMock.mockResolvedValue({ content: "PROMPT", version: "v1" });
    reserveFreePoolMock.mockResolvedValue({ usageDate: "2026-05-06" });
    generateFreeWithLanguageGuardrailsMock.mockRejectedValue(new Error("CPA unavailable"));

    const deferReply = vi.fn().mockResolvedValue(undefined);
    const editReply = vi.fn().mockResolvedValue(undefined);
    const interaction = {
      id: "interaction-member-3",
      inGuild: () => true,
      guildId: "guild-1",
      channelId: "channel-1",
      user: { id: "member-3" },
      options: { getString: () => "食べる" },
      member: { roles: { cache: { map: () => ["member-role"] } } },
      memberPermissions: { has: () => false },
      guild: { ownerId: "owner-2" },
      deferReply,
      editReply,
    };

    await definisiCommand.execute(interaction as never);

    expect(editReply).toHaveBeenCalledWith("member-free-model-error");
    expect(releaseFreePoolReservationMock).toHaveBeenCalledWith({ usageDate: "2026-05-06" });
    expect(commitFreePoolReservationMock).not.toHaveBeenCalled();
    expect(incrementUsageMock).not.toHaveBeenCalled();
  });
});
