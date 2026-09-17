import { pgTable, text, integer } from "drizzle-orm/pg-core";

/**
 * Daily shared quota for users without a role_rate_limits role.
 * reservedCount tracks in-flight generations so concurrent requests cannot
 * reserve more capacity than the configured daily limit.
 */
export const freePoolUsage = pgTable("free_pool_usage", {
  usageDate: text("usage_date").primaryKey(),
  count: integer("count").notNull().default(0),
  reservedCount: integer("reserved_count").notNull().default(0),
});

export type FreePoolUsage = typeof freePoolUsage.$inferSelect;
export type NewFreePoolUsage = typeof freePoolUsage.$inferInsert;
