import type { dictionaries, dictionaryEntries } from "@grkd-jisho/db";

export type RoleKey = "pemula" | "pemula-atas" | "menengah" | "mahir";

export interface LookupResult {
  dictionary: typeof dictionaries.$inferSelect;
  entry: typeof dictionaryEntries.$inferSelect;
}

export interface CacheKey {
  normalizedQuery: string;
  dictionaryId: number;
  entryId: bigint;
  roleKey: RoleKey;
  promptVersion: string;
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
  | "llm.error"
  | "cache.saved"
  | "reply.sent"
  | "reply.error"
  | "wipe.started"
  | "wipe.completed"
  | "wipe.failed"
  | "ops_job.started"
  | "ops_job.completed"
  | "ops_job.failed";
