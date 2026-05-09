/**
 * Prompt versions table
 *
 * Stores editable prompt templates (v1, v2, custom versions).
 * Only one version can be active at a time.
 * Edit history is tracked in response_edits (prompt_edit type).
 */

import { pgEnum, pgTable, text, timestamp, boolean, uuid } from "drizzle-orm/pg-core";
import type { InferSelectModel, InferInsertModel } from "drizzle-orm";

export const promptVersionEnum = pgEnum("prompt_version", ["v1", "v2", "custom"]);

export const prompts = pgTable("prompts", {
  /** Unique version identifier */
  id: uuid("id").primaryKey().defaultRandom(),
  /** Version label: v1, v2, or custom name */
  version: promptVersionEnum("version").notNull().unique(),
  /** Full prompt template content (Markdown/text) */
  content: text("content").notNull(),
  /** Whether this version is currently active */
  isActive: boolean("is_active").notNull().default(false),
  /** Last modified timestamp */
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

/** Prompt record type */
export type Prompt = InferSelectModel<typeof prompts>;
/** New prompt record type (for insert) */
export type NewPrompt = InferInsertModel<typeof prompts>;
