import type { APIRoute } from "astro";
import { db } from "@grkd-jisho/db";
import { adminTotpSecrets } from "@grkd-jisho/db";

/**
 * GET /api/auth/status
 *
 * Returns whether TOTP setup is required (no secret exists).
 * Used by /auth/login to decide whether to redirect to /auth/setup.
 *
 * Response: { setupRequired: boolean }
 */
export const GET: APIRoute = async () => {
  try {
    const rows = await db.select().from(adminTotpSecrets).limit(1);
    return new Response(
      JSON.stringify({ setupRequired: rows.length === 0 }),
      {
        status: 200,
        headers: { "Content-Type": "application/json" },
      },
    );
  } catch (err) {
    const reason = err instanceof Error ? err.message : String(err);
    console.error(`[TOTP] Status check failed: ${reason} → Check DATABASE_URL`);
    return new Response(JSON.stringify({ error: "status_failed" }), {
      status: 500,
      headers: { "Content-Type": "application/json" },
    });
  }
};
