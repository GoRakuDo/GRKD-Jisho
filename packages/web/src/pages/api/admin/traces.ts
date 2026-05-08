import type { APIRoute } from "astro";
import { getIsAuthenticated } from "../../../lib/locals";
import { getSession } from "../../../lib/session";
import { eq, desc } from "drizzle-orm";
import { db, schema } from "@grkd-jisho/db";

export const GET: APIRoute = async (context) => {
  const session = getSession(context);
  if (!session || !getIsAuthenticated(context)) {
    return new Response(JSON.stringify({ error: "unauthorized" }), {
      status: 401,
      headers: { "Content-Type": "application/json" },
    });
  }

  const { url } = context;
  const traceId = url.searchParams.get("traceId");

  try {
    if (traceId) {
      const events = await db
        .select()
        .from(schema.botEvents)
        .where(eq(schema.botEvents.traceId, traceId))
        .orderBy(desc(schema.botEvents.createdAt))
        .limit(200);

      return new Response(
        JSON.stringify({
          traceId,
          events: events.map((e) => ({
            id: String(e.id),
            traceId: e.traceId,
            eventType: e.eventType,
            level: e.level,
            createdAt: e.createdAt,
            payloadJson: e.payloadJson,
          })),
        }),
        { status: 200, headers: { "Content-Type": "application/json" } },
      );
    }

    // List recent trace IDs
    const recent = await db
      .select({
        traceId: schema.botEvents.traceId,
        eventType: schema.botEvents.eventType,
        level: schema.botEvents.level,
        createdAt: schema.botEvents.createdAt,
      })
      .from(schema.botEvents)
      .orderBy(desc(schema.botEvents.createdAt))
      .limit(100);

    // Deduplicate by traceId
    const seen = new Set<string>();
    const traces: {
      traceId: string;
      eventType: string;
      level: string;
      createdAt: Date | null;
    }[] = [];
    for (const row of recent) {
      if (!seen.has(row.traceId)) {
        seen.add(row.traceId);
        traces.push(row);
      }
    }

    return new Response(
      JSON.stringify({ traces: traces.slice(0, 30) }),
      { status: 200, headers: { "Content-Type": "application/json" } },
    );
  } catch (err) {
    const reason = err instanceof Error ? err.message : String(err);
    console.error(`[TracesAPI] Request failed: ${reason} → Check traceId/date filters and DB connectivity`);
    return new Response(JSON.stringify({ error: "internal error" }), {
      status: 500,
      headers: { "Content-Type": "application/json" },
    });
  }
};
