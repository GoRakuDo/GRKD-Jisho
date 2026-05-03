import { sql } from "drizzle-orm";
import { pgTable, serial, text, boolean, timestamp, index } from "drizzle-orm/pg-core";

export const channelSettings = pgTable(
  "channel_settings",
  {
    id: serial("id").primaryKey(),
    guildId: text("guild_id").notNull(),
    channelId: text("channel_id").notNull().unique(),
    wipeEnabled: boolean("wipe_enabled").notNull().default(false),
    lastWipeAt: timestamp("last_wipe_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow(),
  },
  (table) => [
    index("idx_channel_wipe_enabled").on(table.wipeEnabled).where(sql`wipe_enabled = true`),
  ]
);

export type ChannelSetting = typeof channelSettings.$inferSelect;
export type NewChannelSetting = typeof channelSettings.$inferInsert;
