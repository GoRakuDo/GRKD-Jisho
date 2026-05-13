import { afterEach, describe, expect, it, vi } from "vitest";

const { mockGetRoleBindings } = vi.hoisted(() => ({
  mockGetRoleBindings: vi.fn(),
}));

vi.mock("@grkd-jisho/db", () => ({
  getRoleBindings: mockGetRoleBindings,
  isOutputBucketKey: (value: string) => value === "daily-japanese" || value === "indonesian",
}));

import { resolveOutputBucketKey } from "../role-mapper.service";

type BindingRow = {
  id: number;
  guildId: string;
  discordRoleId: string;
  outputBucketKey: string;
  createdAt: Date | null;
  updatedAt: Date | null;
};

const makeBinding = (discordRoleId: string, outputBucketKey: string): BindingRow => ({
  id: 1,
  guildId: "guild-1",
  discordRoleId,
  outputBucketKey,
  createdAt: null,
  updatedAt: null,
});

describe("resolveOutputBucketKey", () => {
  // No in-memory cache: each call queries the DB directly.
  // Reset mocks after each assertion block to keep tests isolated.
  afterEach(() => {
    mockGetRoleBindings.mockReset();
  });

  it("日常日本語のバインドがあれば優先される", async () => {
    mockGetRoleBindings.mockResolvedValueOnce([
      makeBinding("role-indonesian", "indonesian"),
      makeBinding("role-daily", "daily-japanese"),
    ] satisfies BindingRow[]);

    await expect(resolveOutputBucketKey(["role-indonesian", "role-daily"], "guild-1")).resolves.toBe("daily-japanese");
  });

  it("日常日本語がなければインドネシア語に落ちる", async () => {
    mockGetRoleBindings.mockResolvedValueOnce([
      makeBinding("role-indonesian", "indonesian"),
    ] satisfies BindingRow[]);

    await expect(resolveOutputBucketKey(["role-indonesian"], "guild-1")).resolves.toBe("indonesian");
  });

  it("legacy の古いロール値は無視してインドネシア語に落ちる", async () => {
    mockGetRoleBindings.mockResolvedValueOnce([
      makeBinding("role-legacy", "legacy-role-value"),
    ] satisfies BindingRow[]);

    await expect(resolveOutputBucketKey(["role-legacy"], "guild-1")).resolves.toBe("indonesian");
  });

  it("DB 読み込み失敗時は黙って fallback せずエラーを返す", async () => {
    mockGetRoleBindings.mockRejectedValueOnce(new Error("database unavailable"));

    await expect(resolveOutputBucketKey(["role-daily"], "guild-1")).rejects.toThrow(
      "Failed to load role bindings for guild guild-1",
    );
  });
});
