/**
 * Prompt versions table
 *
 * Stores editable prompt templates.
 * The "default" version is seeded on fresh install.
 * User edits create new version with auto-generated timestamp labels
 * (e.g. "2026-05-09_163045"), keeping full edit history.
 * Only one version can be active at a time.
 */

import { pgTable, text, timestamp, boolean, uuid } from "drizzle-orm/pg-core";
import type { InferSelectModel, InferInsertModel } from "drizzle-orm";

export const prompts = pgTable("prompts", {
  /** Unique record identifier */
  id: uuid("id").primaryKey().defaultRandom(),
  /** Version label: "default", or auto-generated timestamp ("2026-05-09_163045") */
  version: text("version").notNull().unique(),
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
