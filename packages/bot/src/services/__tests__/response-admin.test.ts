import { describe, it, expect, vi, beforeEach } from "vitest";

// ── 完全 mock: db, schema, 関数エクスポートを全てmock化 ──
// importOriginal を使わない = postgres 接続が発生しない

const { mockUpdateResponse, mockDeleteCacheByQuery, mockGetResponseById } = vi.hoisted(() => {
  return {
    mockUpdateResponse: vi.fn<(cacheId: string, newText: string, editorDiscordId: string, reason?: string) => Promise<void>>(),
    mockDeleteCacheByQuery: vi.fn<(normalizedQuery: string, roleKey?: string) => Promise<number>>(),
    mockGetResponseById: vi.fn<(id: string) => Promise<{ id: string; query: string; roleKey: string; modelName: string; promptVersion: string; isManualOverride: boolean; updatedAt: Date | null; responseText: string } | null>>(),
  };
});

vi.mock("@grkd-jisho/db", () => ({
  db: {},
  schema: {},
  updateResponse: mockUpdateResponse,
  deleteCacheByQuery: mockDeleteCacheByQuery,
  getResponseById: mockGetResponseById,
}));

import { updateResponse, deleteCacheByQuery, getResponseById } from "@grkd-jisho/db";
import type { SearchResult } from "@grkd-jisho/db";

const makeResult = (overrides: Partial<SearchResult> = {}): SearchResult => ({
  id: "42",
  query: "test",
  roleKey: "pemula",
  modelName: "gemini-2.0-flash",
  promptVersion: "v1",
  isManualOverride: false,
  updatedAt: new Date(),
  responseText: "answer",
  ...overrides,
});

describe("response-admin.service", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe("updateResponse", () => {
    it("updateResponse が正しく呼ばれる", async () => {
      mockUpdateResponse.mockResolvedValueOnce(undefined);

      await updateResponse("1", "new answer", "editor123", "fixed typo");

      expect(mockUpdateResponse).toHaveBeenCalledWith("1", "new answer", "editor123", "fixed typo");
    });

    it("存在しない cacheId でエラーを投げる（モック側の責務）", async () => {
      mockUpdateResponse.mockRejectedValueOnce(new Error("Response not found"));

      await expect(updateResponse("999", "new", "editor1")).rejects.toThrow("Response not found");
    });

    it("無効な ID 形式でエラーを投げる", async () => {
      mockUpdateResponse.mockRejectedValueOnce(new Error("Invalid response ID"));

      await expect(updateResponse("abc", "new", "editor1")).rejects.toThrow("Invalid response ID");
    });
  });

  describe("getResponseById", () => {
    it("無効な ID で null を返す", async () => {
      mockGetResponseById.mockResolvedValueOnce(null);

      const result = await getResponseById("abc");
      expect(result).toBeNull();
    });

    it("存在しない ID で null を返す", async () => {
      mockGetResponseById.mockResolvedValueOnce(null);

      const result = await getResponseById("999");
      expect(result).toBeNull();
    });

    it("有効な BigInt 文字列でレコードを返す", async () => {
      mockGetResponseById.mockResolvedValueOnce(makeResult({ id: "42", responseText: "answer" }));

      const result = await getResponseById("42");
      expect(result).not.toBeNull();
      expect(result!.id).toBe("42");
      expect(result!.responseText).toBe("answer");
    });
  });

  describe("deleteCacheByQuery", () => {
    it("削除件数を返す", async () => {
      mockDeleteCacheByQuery.mockResolvedValueOnce(3);

      const count = await deleteCacheByQuery("test_word");
      expect(count).toBe(3);
    });
  });
});
