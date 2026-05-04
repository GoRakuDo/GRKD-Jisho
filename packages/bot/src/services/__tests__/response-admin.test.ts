import { describe, it, expect } from "vitest";

// TODO: Phase 2 MCP 完了後に実装
// テスト対象: response-admin.service.ts
// - updateResponse のトランザクション一貫性
// - beforeText !== afterText の保証
// - deleteCacheByQuery の isManualOverride 除外
// - getResponseById の BigInt 変換

describe("response-admin.service", () => {
  it.todo("updateResponse は response_edits に正しい beforeText/afterText を保存する");
  it.todo("deleteCacheByQuery は isManualOverride=true のレコードを削除しない");
  it.todo("getResponseById は無効な ID で null を返す");
  it.todo("getResponseById は BigInt 変換の精度劣化がない");
});
