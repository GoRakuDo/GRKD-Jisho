import type { APIRoute } from "astro";
import { db } from "@grkd-jisho/db";
import { adminTotpSecrets } from "@grkd-jisho/db";
import speakeasy from "speakeasy";
import QRCode from "qrcode";

/**
 * GET /api/auth/setup
 *
 * Generate a TOTP secret and return a QR code data URL.
 * Only works when no secret exists yet (first-time setup).
 *
 * Response (200): { qrDataUrl: string, secret: string, alreadySetup: boolean }
 * Response (200, already setup): { alreadySetup: true }
 */
export const GET: APIRoute = async () => {
  try {
    // Check if already set up
    const existing = await db.select().from(adminTotpSecrets).limit(1);
    if (existing.length > 0) {
      return new Response(JSON.stringify({ alreadySetup: true }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      });
    }

    // Generate new TOTP secret
    const secret = speakeasy.generateSecret({
      name: "GRKD-Jisho Admin",
    });

    if (!secret.otpauth_url || !secret.base32) {
      return new Response(
        JSON.stringify({ error: "Failed to generate TOTP secret" }),
        {
          status: 500,
          headers: { "Content-Type": "application/json" },
        },
      );
    }

    // Generate QR code as data URL
    const qrDataUrl = await QRCode.toDataURL(secret.otpauth_url);

    // Save secret to DB
    await db.insert(adminTotpSecrets).values({
      id: "singleton",
      secret: secret.base32,
    });

    return new Response(
      JSON.stringify({ qrDataUrl, secret: secret.base32, alreadySetup: false }),
      {
        status: 200,
        headers: { "Content-Type": "application/json" },
      },
    );
  } catch (err) {
    const reason = err instanceof Error ? err.message : String(err);
    console.error(`[TOTP] Setup failed: ${reason} → Check DATABASE_URL and server logs`);
    return new Response(JSON.stringify({ error: "Setup failed" }), {
      status: 500,
      headers: { "Content-Type": "application/json" },
    });
  }
};
