import { createHmac, randomBytes } from "node:crypto";
import type { APIContext } from "astro";

const SESSION_COOKIE = "grkd_session";
const STATE_COOKIE = "grkd_oauth_state";
export const SESSION_MAX_AGE_MS = 8 * 60 * 60 * 1000; // 8 hours
export const OAUTH_STATE_MAX_AGE_SEC = 300;

// One-time warning guard to avoid repeated insecure-cookie logs.
let hasWarnedInsecureHttps = false;

function isSecureCookieEnabled(): boolean {
  const explicit = process.env["SESSION_COOKIE_SECURE"];
  const baseUrl = process.env["WEB_BASE_URL"] ?? "";

  if (explicit === "true") return true;
  if (explicit === "false") {
    if (baseUrl.startsWith("https://") && !hasWarnedInsecureHttps) {
      hasWarnedInsecureHttps = true;
      console.warn("[Session] Insecure cookie config: SESSION_COOKIE_SECURE=false with HTTPS WEB_BASE_URL → Set SESSION_COOKIE_SECURE=true in production HTTPS");
    }
    return false;
  }

  return baseUrl.startsWith("https://");
}

export interface SessionData {
  discordUserId: string;
  guildId: string;
  isAdmin: boolean;
  expiresAt: number; // epoch ms
  authCheckedAt: number; // epoch ms
}

function getSecret(): string {
  const secret = process.env["SESSION_SECRET"];
  if (!secret) throw new Error("SESSION_SECRET is not set");
  return secret;
}

function sign(value: string): string {
  const hmac = createHmac("sha256", getSecret());
  hmac.update(value);
  return hmac.digest("base64url");
}

/** Serialize session data to a signed cookie string */
function encodeSession(data: SessionData): string {
  const payload = Buffer.from(JSON.stringify(data)).toString("base64url");
  const sig = sign(payload);
  return `${payload}.${sig}`;
}

/** Deserialize and verify a signed session cookie. Returns null if invalid or expired. */
function decodeSession(raw: string): SessionData | null {
  const dot = raw.lastIndexOf(".");
  if (dot === -1) return null;

  const payload = raw.slice(0, dot);
  const sig = raw.slice(dot + 1);

  const expectedSig = sign(payload);
  if (sig !== expectedSig) return null;

  try {
    const data: SessionData = JSON.parse(
      Buffer.from(payload, "base64url").toString("utf-8"),
    );
    if (data.expiresAt < Date.now()) return null;
    return data;
  } catch {
    return null;
  }
}

/** Read and verify session from request cookies */
export function getSession(context: APIContext): SessionData | null {
  const raw = context.cookies.get(SESSION_COOKIE)?.value;
  if (!raw) return null;
  return decodeSession(raw);
}

/** Set session cookie on response */
export function setSession(context: APIContext, data: SessionData): void {
  context.cookies.set(SESSION_COOKIE, encodeSession(data), {
    httpOnly: true,
    secure: isSecureCookieEnabled(),
    sameSite: "lax",
    path: "/",
    maxAge: SESSION_MAX_AGE_MS / 1000,
  });
}

/** Clear session cookie (logout) */
export function clearSession(context: APIContext): void {
  context.cookies.delete(SESSION_COOKIE, { path: "/" });
}

/** Generate a random OAuth state string and set it in a short-lived cookie */
export function setOAuthState(context: APIContext): string {
  const state = randomBytes(32).toString("hex");
  context.cookies.set(STATE_COOKIE, state, {
    httpOnly: true,
    secure: isSecureCookieEnabled(),
    sameSite: "lax",
    path: "/",
    maxAge: OAUTH_STATE_MAX_AGE_SEC,
  });
  return state;
}

/** Verify OAuth state cookie against the returned state parameter */
export function verifyOAuthState(context: APIContext, stateParam: string): boolean {
  const cookieState = context.cookies.get(STATE_COOKIE)?.value;
  if (!cookieState) return false;
  // Clear the state cookie after use
  context.cookies.delete(STATE_COOKIE, { path: "/" });
  return cookieState === stateParam;
}

/** Check if auth should be re-verified (authCheckedAt older than threshold) */
export function needsReAuth(session: SessionData): boolean {
  return Date.now() - session.authCheckedAt > SESSION_MAX_AGE_MS / 2;
}

/** Check if user is admin based on session */
export function requireSession(context: APIContext): SessionData | null {
  const session = getSession(context);
  if (!session || !session.isAdmin) return null;
  return session;
}
