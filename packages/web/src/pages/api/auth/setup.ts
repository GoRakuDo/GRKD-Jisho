import type { APIRoute } from "astro";
import { db } from "@grkd-jisho/db";
import { adminTotpSecrets } from "@grkd-jisho/db";
import { sql } from "drizzle-orm";
import speakeasy from "speakeasy";
import QRCode from "qrcode";

/**
 * GET /api/auth/setup
 *
 * Generate a TOTP secret and return a QR code data URL.
 * If a secret exists but is not verified yet, return the existing QR.
 *
 * Response (200): { qrDataUrl: string, secret: string, alreadySetup: boolean }
 * Response (200, already setup): { alreadySetup: true }
 */
export const GET: APIRoute = async () => {
  try {
    const result = await db.transaction(async (tx) => {
      await tx.execute(sql`select pg_advisory_xact_lock(42424242)`);

      const existing = await tx.select().from(adminTotpSecrets).limit(1);
      if (existing.length > 0) {
        const row = existing[0]!;
        if (row.verifiedAt !== null) {
          return { alreadySetup: true as const };
        }

        const qrDataUrl = await QRCode.toDataURL(
          `otpauth://totp/GRKD-Jisho%20Admin?secret=${encodeURIComponent(row.secret)}&issuer=GRKD-Jisho`,
        );

        return {
          alreadySetup: false as const,
          secret: row.secret,
          qrDataUrl,
        };
      }

      // Generate new TOTP secret for the first setup.
      const secret = speakeasy.generateSecret({
        name: "GRKD-Jisho Admin",
      });

      if (!secret.otpauth_url || !secret.base32) {
        throw new Error("Failed to generate TOTP secret");
      }

      await tx.insert(adminTotpSecrets).values({
        id: "singleton",
        secret: secret.base32,
        verifiedAt: null,
      });

      const qrDataUrl = await QRCode.toDataURL(
        `otpauth://totp/GRKD-Jisho%20Admin?secret=${encodeURIComponent(secret.base32)}&issuer=GRKD-Jisho`,
      );

      return {
        alreadySetup: false as const,
        secret: secret.base32,
        qrDataUrl,
      };
    });

    if (result.alreadySetup) {
      return new Response(JSON.stringify({ alreadySetup: true }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      });
    }

    return new Response(
      JSON.stringify({ qrDataUrl: result.qrDataUrl, secret: result.secret, alreadySetup: false }),
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
