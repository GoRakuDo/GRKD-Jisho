import type { APIRoute } from "astro";
import { generateCsrfToken } from "../../../lib/csrf";
import { getSession } from "../../../lib/session";

/**
 * GET /api/auth/csrf-token
 *
 * Returns a CSRF token for the authenticated user.
 * The frontend must include this token in the X-CSRF-Token header
 * for all POST / PUT / DELETE requests.
 */
export const GET: APIRoute = async (context) => {
  try {
    const session = getSession(context);

    if (!session || !session.isAdmin) {
      return new Response(JSON.stringify({ error: "unauthorized" }), {
        status: 401,
        headers: { "Content-Type": "application/json" },
      });
    }

    const token = generateCsrfToken(session.discordUserId);

    return new Response(JSON.stringify({ token }), {
      status: 200,
      headers: { "Content-Type": "application/json" },
    });
  } catch {
    return new Response(JSON.stringify({ error: "internal error" }), {
      status: 500,
      headers: { "Content-Type": "application/json" },
    });
  }
};
