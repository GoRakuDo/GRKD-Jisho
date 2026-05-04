import { describe, it, expect } from "vitest";

// TODO: Phase 2 MCP 完了後に実装
// テスト対象: response-cache.service.ts
// - getCachedResponse の cache key 一致/不一致
// - saveResponse の ON CONFLICT DO NOTHING 動作
// - isManualOverride 優先順位

describe("response-cache.service", () => {
  it.todo("getCachedResponse は全 cache key 一致でレコードを返す");
  it.todo("getCachedResponse は 1 カラムでも不一致なら null を返す");
  it.todo("getCachedResponse は isManualOverride が true のレコードを優先する");
  it.todo("saveResponse は ON CONFLICT DO NOTHING で重複をスキップする");
});
