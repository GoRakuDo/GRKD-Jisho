import {
  pgTable, bigserial, text, integer, bigint,
  boolean, timestamp, unique
} from "drizzle-orm/pg-core";
import { dictionaries } from "./dictionaries";
import { dictionaryEntries } from "./dictionary-entries";

export const responseCache = pgTable(
  "response_cache",
  {
    id: bigserial("id", { mode: "bigint" }).primaryKey(),
    query: text("query").notNull(),
    normalizedQuery: text("normalized_query").notNull(),
    dictionaryId: integer("dictionary_id")
      .references(() => dictionaries.id),
    dictionaryEntryId: bigint("dictionary_entry_id", { mode: "bigint" })
      .references(() => dictionaryEntries.id),
    roleKey: text("role_key").notNull(),
    promptVersion: text("prompt_version").notNull(),
    promptContentHash: text("prompt_content_hash").notNull(),
    modelName: text("model_name").notNull(),
    responseText: text("response_text").notNull(),
    isManualOverride: boolean("is_manual_override").notNull().default(false),
    isDeleteProtected: boolean("is_delete_protected").notNull().default(false),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow(),
  },
  (table) => [
    unique("uq_response_cache_key").on(
      table.normalizedQuery,
      table.dictionaryId,
      table.dictionaryEntryId,
      table.roleKey,
      table.promptVersion,
      table.promptContentHash,
      table.modelName
    ),
  ]
);

export type ResponseCache = typeof responseCache.$inferSelect;
export type NewResponseCache = typeof responseCache.$inferInsert;
