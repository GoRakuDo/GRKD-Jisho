import type { APIRoute } from "astro";
import { db } from "@grkd-jisho/db";
import { adminTotpSecrets } from "@grkd-jisho/db";
import speakeasy from "speakeasy";
import { SESSION_MAX_AGE_MS, setSession } from "../../../lib/session";
import { getEnv } from "../../../env";

/**
 * POST /api/auth/verify
 *
 * Verify a TOTP code and issue a session cookie.
 * Works both for initial setup verification and subsequent logins.
 *
 * Request body: { code: string }
 * Response (200): { ok: true } + Set-Cookie header
 * Response (400): { error: "invalid_code" }
 * Response (400): { error: "setup_required" } — no secret exists
 */
export const POST: APIRoute = async (context) => {
  try {
    const body = await context.request.json();
    const code = String(body.code ?? "").trim();

    if (!/^\d{6}$/.test(code)) {
      return new Response(JSON.stringify({ error: "invalid_code" }), {
        status: 400,
        headers: { "Content-Type": "application/json" },
      });
    }

    // Fetch stored secret
    const rows = await db.select().from(adminTotpSecrets).limit(1);
    if (rows.length === 0) {
      return new Response(JSON.stringify({ error: "setup_required" }), {
        status: 400,
        headers: { "Content-Type": "application/json" },
      });
    }

    const storedSecret = rows[0]!.secret;

    // Verify TOTP code
    const verified = speakeasy.totp.verify({
      secret: storedSecret,
      encoding: "base32",
      token: code,
      window: 1, // allow 1 step before/after for clock drift
    });

    if (!verified) {
      return new Response(JSON.stringify({ error: "invalid_code" }), {
        status: 400,
        headers: { "Content-Type": "application/json" },
      });
    }

    // Issue session
    const env = getEnv();
    setSession(context, {
      discordUserId: "totp_admin",
      guildId: env.DISCORD_GUILD_ID,
      isAdmin: true,
      expiresAt: Date.now() + SESSION_MAX_AGE_MS,
      authCheckedAt: Date.now(),
    });

    return new Response(JSON.stringify({ ok: true }), {
      status: 200,
      headers: { "Content-Type": "application/json" },
    });
  } catch (err) {
    const reason = err instanceof Error ? err.message : String(err);
    console.error(`[TOTP] Verify failed: ${reason} → Check DATABASE_URL and server logs`);
    return new Response(JSON.stringify({ error: "verify_failed" }), {
      status: 500,
      headers: { "Content-Type": "application/json" },
    });
  }
};
