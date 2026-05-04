import {
  pgTable, bigserial, text, jsonb, integer, timestamp, index,
} from "drizzle-orm/pg-core";

export const botEvents = pgTable(
  "bot_events",
  {
    id: bigserial("id", { mode: "bigint" }).primaryKey(),
    traceId: text("trace_id").notNull(),
    level: text("level").notNull(),
    eventType: text("event_type").notNull(),
    guildId: text("guild_id"),
    channelId: text("channel_id"),
    userId: text("user_id"),
    payloadJson: jsonb("payload_json").default({}),
    durationMs: integer("duration_ms"),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow(),
  },
  (table) => [
    index("idx_bot_events_trace_id").on(table.traceId),
    index("idx_bot_events_created_at").on(table.createdAt),
    index("idx_bot_events_level").on(table.level),
  ],
);

export type BotEvent = typeof botEvents.$inferSelect;
export type NewBotEvent = typeof botEvents.$inferInsert;
