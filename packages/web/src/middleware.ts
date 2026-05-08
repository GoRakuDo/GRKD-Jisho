import { defineMiddleware } from "astro:middleware";
import { getSession, needsReAuth, setSession } from "./lib/session";
import { setLocals } from "./lib/locals";
import { validateCsrfRequest } from "./lib/csrf";

/** Paths that do not require authentication */
const PUBLIC_PATHS = new Set([
  "/auth/login",
  "/api/auth/authorize",
  "/api/auth/callback",
  "/auth/logout",
]);

/** Paths that are exempt from CSRF check */
const CSRF_EXEMPT_PATHS = new Set([
  "/api/health",
  "/api/auth/authorize",
  // Defense-in-depth: callback is already public, keep exempt if PUBLIC_PATHS changes later.
  "/api/auth/callback",
  // Import preview validates CSRF again inside route handler; avoid duplicate middleware check.
  "/api/admin/dictionaries/import-preview",
]);

function normalizePath(pathname: string): string {
  if (pathname === "/") return pathname;
  return pathname.replace(/\/+$/, "");
}

export const onRequest = defineMiddleware(async (context, next) => {
  const { url, request } = context;
  const pathname = normalizePath(url.pathname);

  // Initialize locals
  setLocals(context, { user: null, isAuthenticated: false });

  if (pathname === "/api/admin/dictionaries/import-preview" && request.method.toUpperCase() === "POST") {
    console.error("[ImportPreview] Request arrived at middleware: POST /api/admin/dictionaries/import-preview → Checking auth/CSRF gates");
  }

  // Auth routes are public
  if (PUBLIC_PATHS.has(pathname)) {
    return next();
  }

  // Protect /admin/* and /api/*
  if (
    pathname === "/admin" ||
    pathname.startsWith("/admin/") ||
    pathname === "/api" ||
    pathname.startsWith("/api/")
  ) {
    const session = getSession(context);

    if (!session || !session.isAdmin) {
      return context.redirect("/auth/login");
    }

    // CSRF check for non-GET, non-HEAD requests (write operations)
    if (!CSRF_EXEMPT_PATHS.has(pathname)) {
      const method = request.method.toUpperCase();
      console.log(`[CSRF] Gate check: ${method} ${pathname} exempt=false`);
      if (!["GET", "HEAD"].includes(method)) {
        const isValid = validateCsrfRequest(session.discordUserId, request);
        if (!isValid) {
          const token = request.headers.get("x-csrf-token");
          const tokenState = token && token.length > 0 ? "present" : "missing";
          console.warn(`[CSRF] Validation failed on ${method} ${pathname}: token=${tokenState} → Refresh page and retry; if persistent, check /api/auth/csrf-token response and session cookie`);
          return new Response("CSRF validation failed", { status: 403 });
        }
      }
    } else {
      const method = request.method.toUpperCase();
      console.log(`[CSRF] Gate bypass: ${method} ${pathname} exempt=true`);
    }

    // Refresh authCheckedAt if stale (keep session alive)
    if (needsReAuth(session)) {
      setSession(context, {
        ...session,
        authCheckedAt: Date.now(),
      });
    }

    setLocals(context, {
      user: {
        discordUserId: session.discordUserId,
        guildId: session.guildId,
        isAdmin: session.isAdmin,
      },
      isAuthenticated: true,
    });
  }

  return next();
});
