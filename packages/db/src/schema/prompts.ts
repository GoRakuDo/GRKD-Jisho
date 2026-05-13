/**
 * Prompt versions table
 *
 * Stores editable prompt templates.
 * The "default" version is seeded on fresh install.
 * User edits create new version with auto-generated timestamp labels
 * (e.g. "2026-05-09_163045"), keeping full edit history.
 * Only one version can be active at a time.
 */

import { pgTable, text, timestamp, boolean, uuid, index, uniqueIndex } from "drizzle-orm/pg-core";
import type { InferSelectModel, InferInsertModel } from "drizzle-orm";

export const PROMPT_SCOPE_KEYS = ["default", "daily-japanese", "indonesian"] as const;
export type PromptScopeKey = (typeof PROMPT_SCOPE_KEYS)[number];

export const PROMPT_SCOPE_LABELS: Record<PromptScopeKey, string> = {
  default: "Default Prompt",
  "daily-japanese": "Daily Japanese Override",
  indonesian: "Indonesian Override",
};

export const PROMPT_SCOPE_DESCRIPTIONS: Record<PromptScopeKey, string> = {
  default: "Shared baseline prompt used by every bucket unless overridden.",
  "daily-japanese": "Private override for the daily Japanese output bucket.",
  indonesian: "Private override for the Indonesian output bucket.",
};

export function isPromptScopeKey(value: string): value is PromptScopeKey {
  return (PROMPT_SCOPE_KEYS as readonly string[]).includes(value);
}

export const prompts = pgTable("prompts", {
  /** Unique record identifier */
  id: uuid("id").primaryKey().defaultRandom(),
  /** Scope for this prompt version */
  scopeKey: text("scope_key").notNull().default("default"),
  /** Version label: "default", or auto-generated timestamp ("2026-05-09_163045") */
  version: text("version").notNull(),
  /** Full prompt template content (Markdown/text) */
  content: text("content").notNull(),
  /** Whether this version is currently active */
  isActive: boolean("is_active").notNull().default(false),
  /** Last modified timestamp */
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
}, (table) => ({
  scopeUpdatedIdx: index("idx_prompts_scope_updated").on(table.scopeKey, table.updatedAt),
  scopeActiveIdx: index("idx_prompts_scope_active").on(table.scopeKey, table.isActive),
  scopeVersionUnique: uniqueIndex("uq_prompts_scope_version").on(table.scopeKey, table.version),
}));

/** Prompt record type */
export type Prompt = InferSelectModel<typeof prompts>;
/** New prompt record type (for insert) */
export type NewPrompt = InferInsertModel<typeof prompts>;
