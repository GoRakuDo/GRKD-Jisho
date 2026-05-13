import {
  pgTable, bigserial, text, integer, bigint,
  boolean, jsonb, timestamp
} from "drizzle-orm/pg-core";
import { dictionaries } from "./dictionaries";
import { responseCache } from "./response-cache";

export const lookupLogs = pgTable("lookup_logs", {
  id: bigserial("id", { mode: "bigint" }).primaryKey(),
  guildId: text("guild_id").notNull(),
  channelId: text("channel_id").notNull(),
  messageId: text("message_id").notNull(),
  userId: text("user_id").notNull(),
  userRolesJson: jsonb("user_roles_json").default([]),
  query: text("query").notNull(),
  normalizedQuery: text("normalized_query").notNull(),
  dictionaryIdUsed: integer("dictionary_id_used")
    .references(() => dictionaries.id),
  responseCacheId: bigint("response_cache_id", { mode: "bigint" })
    // Cache delete relies on FK cascade; keep this in sync with the current DB migration.
    .references(() => responseCache.id, { onDelete: "cascade" }),
  cacheHit: boolean("cache_hit").notNull().default(false),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow(),
});

export type LookupLog = typeof lookupLogs.$inferSelect;
export type NewLookupLog = typeof lookupLogs.$inferInsert;
