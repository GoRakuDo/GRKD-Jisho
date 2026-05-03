import { pgTable, serial, text, integer, timestamp } from "drizzle-orm/pg-core";

export const roleRateLimits = pgTable("role_rate_limits", {
  id: serial("id").primaryKey(),
  discordRoleId: text("discord_role_id").notNull().unique(),
  roleLabel: text("role_label"),
  dailyLimit: integer("daily_limit").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow(),
});

export type RoleRateLimit = typeof roleRateLimits.$inferSelect;
export type NewRoleRateLimit = typeof roleRateLimits.$inferInsert;
