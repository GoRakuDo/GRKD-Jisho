import { createHmac, randomBytes } from "node:crypto";

const CSRF_HEADER = "x-csrf-token";

function getSecret(): string {
  const secret = process.env["SESSION_SECRET"];
  if (!secret) throw new Error("SESSION_SECRET is not set");
  return secret;
}

/** Generate a CSRF token tied to the current session */
export function generateCsrfToken(discordUserId: string): string {
  const nonce = randomBytes(16).toString("hex");
  const hmac = createHmac("sha256", getSecret());
  hmac.update(`${discordUserId}:${nonce}`);
  return `${nonce}.${hmac.digest("base64url")}`;
}

/** Verify a CSRF token for the given user */
export function verifyCsrfToken(discordUserId: string, token: string): boolean {
  const dot = token.lastIndexOf(".");
  if (dot === -1) return false;

  const nonce = token.slice(0, dot);
  const sig = token.slice(dot + 1);

  const hmac = createHmac("sha256", getSecret());
  hmac.update(`${discordUserId}:${nonce}`);
  const expectedSig = hmac.digest("base64url");

  // Constant-time comparison
  if (sig.length !== expectedSig.length) return false;
  let match = true;
  for (let i = 0; i < sig.length; i++) {
    if (sig[i] !== expectedSig[i]) match = false;
  }
  return match;
}

/**
 * Validate CSRF for a request.
 * Checks the X-CSRF-Token header against the session user's token.
 * Called in POST / PUT / DELETE API handlers.
 */
export function validateCsrfRequest(
  discordUserId: string,
  request: Request,
): boolean {
  const token = request.headers.get(CSRF_HEADER);
  if (!token) return false;
  return verifyCsrfToken(discordUserId, token);
}
