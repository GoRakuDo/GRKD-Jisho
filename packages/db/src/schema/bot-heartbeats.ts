import {
  pgTable, bigserial, text, jsonb, timestamp, uniqueIndex,
} from "drizzle-orm/pg-core";

export const botHeartbeats = pgTable(
  "bot_heartbeats",
  {
    id: bigserial("id", { mode: "bigint" }).primaryKey(),
    serviceName: text("service_name").notNull(),
    instanceId: text("instance_id").notNull(),
    status: text("status").notNull(),
    lastSeenAt: timestamp("last_seen_at", { withTimezone: true }).notNull(),
    metadataJson: jsonb("metadata_json").default({}),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow(),
  },
  (table) => [
    uniqueIndex("idx_bot_heartbeats_service_instance").on(
      table.serviceName,
      table.instanceId,
    ),
  ],
);

export type BotHeartbeat = typeof botHeartbeats.$inferSelect;
export type NewBotHeartbeat = typeof botHeartbeats.$inferInsert;
