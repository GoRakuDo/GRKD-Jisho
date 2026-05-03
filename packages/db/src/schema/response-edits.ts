import { pgTable, bigserial, bigint, text, timestamp } from "drizzle-orm/pg-core";
import { responseCache } from "./response-cache";

export const responseEdits = pgTable("response_edits", {
  id: bigserial("id", { mode: "bigint" }).primaryKey(),
  responseCacheId: bigint("response_cache_id", { mode: "bigint" })
    .notNull()
    .references(() => responseCache.id),
  editorDiscordId: text("editor_discord_id").notNull(),
  beforeText: text("before_text").notNull(),
  afterText: text("after_text").notNull(),
  reason: text("reason"),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow(),
});

export type ResponseEdit = typeof responseEdits.$inferSelect;
export type NewResponseEdit = typeof responseEdits.$inferInsert;
