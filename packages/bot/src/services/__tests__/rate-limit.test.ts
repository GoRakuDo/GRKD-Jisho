import { describe, it, expect } from "vitest";

// TODO: Phase 2 MCP 完了後に実装
// テスト対象: rate-limit.service.ts
// - Owner/Admin は無制限
// - ロール別上限の優先順位
// - __default__ のフォールバック
// - incrementUsage の重複加算防止

describe("rate-limit.service", () => {
  it.todo("Owner は常に allowed=true, remaining=Infinity");
  it.todo("Administrator は常に allowed=true, remaining=Infinity");
  it.todo("ロール別上限がない場合、__default__ を使う");
  it.todo("複数ロールを持つ場合、最も緩い上限を使う");
  it.todo("残り回数を使い切ったら allowed=false");
});
