import { pgTable, text, timestamp } from "drizzle-orm/pg-core";

/**
 * TOTP secret for Web Admin login (singleton — max 1 row).
 *
 * - If a row exists, TOTP is set up → login page shows code input.
 * - If no row exists, TOTP is not set up → setup page shows QR.
 * - Reset: DELETE the row via CLI → triggers setup flow on next login.
 */
export const adminTotpSecrets = pgTable("admin_totp_secrets", {
  id: text("id").primaryKey().default("singleton"),
  secret: text("secret").notNull(),
  createdAt: timestamp("created_at").notNull().defaultNow(),
});
