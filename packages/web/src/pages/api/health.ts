import { sql } from "drizzle-orm";
import type { APIRoute } from "astro";
import { getIsAuthenticated } from "../../lib/locals";

export const GET: APIRoute = async (context) => {
  const { db } = await import("@grkd-jisho/db");
  try {
    await db.execute(sql`select 1 as ok`);
    return new Response(
      JSON.stringify({
        status: "healthy",
        service: "@grkd-jisho/web",
        authenticated: getIsAuthenticated(context),
      }),
      {
        status: 200,
        headers: { "Content-Type": "application/json" },
      },
    );
  } catch {
    return new Response(
      JSON.stringify({
        status: "unhealthy",
        service: "@grkd-jisho/web",
        error: "database connection failed",
      }),
      {
        status: 503,
        headers: { "Content-Type": "application/json" },
      },
    );
  }
};
