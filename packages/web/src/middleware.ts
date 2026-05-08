import { defineMiddleware } from "astro:middleware";
import { getSession, needsReAuth, setSession } from "./lib/session";
import { setLocals } from "./lib/locals";
import { validateCsrfRequest } from "./lib/csrf";

/** Paths that do not require authentication */
const PUBLIC_PATHS = new Set(["/auth/login", "/api/auth/callback", "/auth/logout"]);

/** Paths that are exempt from CSRF check */
const CSRF_EXEMPT_PATHS = new Set(["/api/health", "/api/auth/authorize"]);

export const onRequest = defineMiddleware(async (context, next) => {
  const { url, request } = context;
  const pathname = url.pathname;

  // Initialize locals
  setLocals(context, { user: null, isAuthenticated: false });

  // Auth routes are public
  if (PUBLIC_PATHS.has(pathname)) {
    return next();
  }

  // Protect /admin/* and /api/*
  if (pathname.startsWith("/admin") || pathname.startsWith("/api")) {
    const session = getSession(context);

    if (!session || !session.isAdmin) {
      return context.redirect("/auth/login");
    }

    // CSRF check for non-GET, non-HEAD requests (write operations)
    if (!CSRF_EXEMPT_PATHS.has(pathname)) {
      const method = request.method.toUpperCase();
      if (!["GET", "HEAD"].includes(method)) {
        const isValid = validateCsrfRequest(session.discordUserId, request);
        if (!isValid) {
          return new Response("CSRF validation failed", { status: 403 });
        }
      }
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
