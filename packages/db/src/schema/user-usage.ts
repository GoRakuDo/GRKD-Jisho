import {
  pgTable, bigserial, text, integer, date,
  timestamp, index, unique
} from "drizzle-orm/pg-core";

export const userUsage = pgTable(
  "user_usage",
  {
    id: bigserial("id", { mode: "bigint" }).primaryKey(),
    userId: text("user_id").notNull(),
    guildId: text("guild_id").notNull(),
    usageDate: date("usage_date").notNull(),
    count: integer("count").notNull().default(0),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow(),
  },
  (table) => [
    unique("uq_user_usage_day").on(table.userId, table.guildId, table.usageDate),
    index("idx_user_usage_date").on(table.usageDate),
  ]
);

export type UserUsage = typeof userUsage.$inferSelect;
export type NewUserUsage = typeof userUsage.$inferInsert;
