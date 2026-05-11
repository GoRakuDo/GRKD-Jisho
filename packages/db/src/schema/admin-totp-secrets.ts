import { pgTable, text, timestamp } from "drizzle-orm/pg-core";

/**
 * TOTP secret for Web Admin login (singleton — max 1 row).
 *
 * - If a row exists and verified_at is set, TOTP is configured → login page shows code input.
 * - If no row exists, or verified_at is null, setup is not complete → QR setup flow.
 * - Reset: DELETE the row via CLI → triggers setup flow on next login.
 */
export const adminTotpSecrets = pgTable("admin_totp_secrets", {
  id: text("id").primaryKey().default("singleton"),
  secret: text("secret").notNull(),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  // null until the first successful TOTP verification completes.
  verifiedAt: timestamp("verified_at"),
});
