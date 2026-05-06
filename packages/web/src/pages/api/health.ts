import { sql } from "drizzle-orm";
import type { APIRoute } from "astro";
import { getIsAuthenticated } from "../../lib/locals";

export const GET: APIRoute = async (context) => {
  const { db, schema } = await import("@grkd-jisho/db");
  try {
    await db.execute(sql`select 1 as ok`);

    // Web heartbeat を upsert（非同期、失敗しても応答は壊さない）
    try {
      await db
        .insert(schema.botHeartbeats)
        .values({
          serviceName: "@grkd-jisho/web",
          instanceId: "web-ssr",
          status: "ok",
          lastSeenAt: new Date(),
          metadataJson: {
            host: context.url.host,
            path: context.url.pathname,
          },
        })
        .onConflictDoUpdate({
          target: [
            schema.botHeartbeats.serviceName,
            schema.botHeartbeats.instanceId,
          ],
          set: {
            status: "ok",
            lastSeenAt: new Date(),
            metadataJson: {
              host: context.url.host,
              path: context.url.pathname,
            },
          },
        });
    } catch (err) {
      console.error("[Health] Failed to upsert web heartbeat:", err);
    }

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
