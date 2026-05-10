import { pgTable, serial, text, timestamp, unique } from "drizzle-orm/pg-core";

/**
 * Role bindings — maps Discord role IDs to system role keys per guild.
 *
 * Example: "123456789012345678" → "pemula", "234567890123456789" → "pemula-atas"
 * Each guild can define its own mapping. Falls back to hardcoded defaults
 * when no binding exists for a role ID.
 */
export const roleBindings = pgTable(
  "role_bindings",
  {
    id: serial("id").primaryKey(),
    guildId: text("guild_id").notNull(),
    // Legacy physical column name kept for DB compatibility; semantic value is the Discord role ID.
    discordRoleId: text("discord_role_name").notNull(),
    systemRoleKey: text("system_role_key").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow(),
  },
  (table) => ({
    // One mapping per Discord role ID per guild
    guildRoleUnique: unique().on(table.guildId, table.discordRoleId),
  }),
);

export type RoleBinding = typeof roleBindings.$inferSelect;
export type NewRoleBinding = typeof roleBindings.$inferInsert;

/** Valid system role keys used in prompt routing */
export const SYSTEM_ROLE_KEYS = [
  "pemula",
  "pemula-atas",
  "menengah",
  "mahir",
] as const;

export type SystemRoleKey = (typeof SYSTEM_ROLE_KEYS)[number];
