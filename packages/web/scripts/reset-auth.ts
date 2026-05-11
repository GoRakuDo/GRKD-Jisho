/**
 * CLI script to reset TOTP authentication.
 *
 * Deletes the TOTP secret from the database so the next login
 * triggers the initial setup flow (QR code scan).
 *
 * Usage:
 *   pnpm auth:reset
 *   # or directly:
 *   tsx scripts/reset-auth.ts
 *
 * Prerequisites:
 *   - DATABASE_URL must be set in the environment (or .env)
 *   - The @grkd-jisho/db package must be built (pnpm --filter @grkd-jisho/db build)
 */

import { db } from "@grkd-jisho/db";
import { adminTotpSecrets } from "@grkd-jisho/db/schema/admin-totp-secrets";

async function main() {
  console.log("[TOTP/Reset] Deleting TOTP secret…");

  await db.delete(adminTotpSecrets);

  console.log("[TOTP/Reset] Done. TOTP secret deleted.");
  console.log("[TOTP/Reset] Next login attempt will redirect to /auth/setup for QR scan.");
  process.exit(0);
}

main().catch((err) => {
  console.error(`[TOTP/Reset] Failed: ${err.message}`);
  console.error("[TOTP/Reset] → Ensure DATABASE_URL is set and @grkd-jisho/db is built");
  process.exit(1);
});
