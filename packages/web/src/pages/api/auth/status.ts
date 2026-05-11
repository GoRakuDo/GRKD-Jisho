import type { APIRoute } from "astro";
import { db } from "@grkd-jisho/db";
import { adminTotpSecrets } from "@grkd-jisho/db";

/**
 * GET /api/auth/status
 *
 * Returns whether TOTP setup is required (no verified setup exists).
 * Used by /auth/login to decide whether to show the QR setup lane.
 *
 * Response: { setupRequired: boolean }
 */
export const GET: APIRoute = async () => {
  try {
    const rows = await db.select().from(adminTotpSecrets).limit(1);
    const setupRequired = rows.length === 0 || rows[0]?.verifiedAt === null;

    return new Response(JSON.stringify({ setupRequired }), {
      status: 200,
      headers: { "Content-Type": "application/json" },
    });
  } catch (err) {
    const reason = err instanceof Error ? err.message : String(err);
    console.error(`[TOTP] Status check failed: ${reason} → Check DATABASE_URL`);
    return new Response(JSON.stringify({ error: "status_failed" }), {
      status: 500,
      headers: { "Content-Type": "application/json" },
    });
  }
};
