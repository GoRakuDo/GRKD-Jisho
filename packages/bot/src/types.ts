import type { dictionaries, dictionaryEntries, OutputBucketKey } from "@grkd-jisho/db";

export type RoleKey = OutputBucketKey;

export type LookupMatchType = "term" | "reading" | "deinflected";

export interface LookupResult {
  dictionary: typeof dictionaries.$inferSelect;
  entry: typeof dictionaryEntries.$inferSelect;
  /** 一致したカラム種別 */
  matchedBy: LookupMatchType;
  /** 実際に使用した検索クエリ（正規化後） */
  normalizedQuery: string;
  /** deinflect で見つかった場合の元の活用形 */
  originalInflected?: string;
  /** deinflect で見つかった場合の辞書形 */
  deinflectedFrom?: string;
}

export interface CacheKey {
  normalizedQuery: string;
  dictionaryId: number;
  entryId: bigint;
  roleKey: RoleKey;
  promptVersion: string;
  promptContentHash: string;
  modelName: string;
}

export type TraceEventType =
  | "message.received"
  | "query.extracted"
  | "channel.allowed"
  | "rate_limit.checked"
  | "rate_limit.blocked"
  | "dictionary.lookup.started"
  | "dictionary.hit"
  | "dictionary.miss"
  | "cache.hit"
  | "cache.miss"
  | "cache.manual_override"
  | "llm.generate.started"
  | "llm.generated"
  | "llm.fallback"
  | "llm.language_guard.failed"
  | "llm.error"
  | "cache.saved"
  | "reply.sent"
  | "reply.error"
  | "wipe.started"
  | "wipe.completed"
  | "wipe.failed"
  | "wipe.command_executed"
  | "ops_job.started"
  | "ops_job.completed"
  | "ops_job.failed";
