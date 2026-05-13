import { pgTable, serial, text, timestamp, unique } from "drizzle-orm/pg-core";

/**
 * Role bindings — maps Discord role IDs to output buckets per guild.
 *
 * Example: "123456789012345678" → "daily-japanese", "234567890123456789" → "indonesian"
 * Multiple Discord role IDs can point to the same bucket.
 * Priority: daily-japanese wins; indonesian is the fallback bucket.
 */
export const OUTPUT_BUCKET_KEYS = [
  "daily-japanese",
  "indonesian",
] as const;

export type OutputBucketKey = (typeof OUTPUT_BUCKET_KEYS)[number];

export const OUTPUT_BUCKET_LABELS = {
  "daily-japanese": "日常日本語の出力",
  indonesian: "インドネシア語の出力",
} as const satisfies Record<OutputBucketKey, string>;

export const DEFAULT_OUTPUT_BUCKET_KEY: OutputBucketKey = "indonesian";

export function isOutputBucketKey(value: string): value is OutputBucketKey {
  return (OUTPUT_BUCKET_KEYS as readonly string[]).includes(value);
}

export function getOutputBucketLabel(value: string): string {
  return isOutputBucketKey(value) ? OUTPUT_BUCKET_LABELS[value] : `Legacy: ${value}`;
}

export const roleBindings = pgTable(
  "role_bindings",
  {
    id: serial("id").primaryKey(),
    guildId: text("guild_id").notNull(),
    // Legacy physical column name kept for DB compatibility; semantic value is the Discord role ID.
    discordRoleId: text("discord_role_name").notNull(),
    outputBucketKey: text("system_role_key").notNull(),
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

/**
 * Legacy aliases kept for compatibility with older imports.
 * @deprecated Use OUTPUT_BUCKET_KEYS / OutputBucketKey.
 */
export const SYSTEM_ROLE_KEYS = OUTPUT_BUCKET_KEYS;

/** @deprecated Use OutputBucketKey. */
export type SystemRoleKey = OutputBucketKey;
