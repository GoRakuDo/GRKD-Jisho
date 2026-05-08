import type { APIRoute } from "astro";
import { getIsAuthenticated } from "../../../lib/locals";
import { getSession } from "../../../lib/session";
import { eq, and, gte, sql, count } from "drizzle-orm";
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
  const days = Math.max(1, Math.min(Number(url.searchParams.get("days") ?? "7"), 30));

  try {
    const since = sql`now() - ${days}::int * interval '1 day'`;

    // Total lookups
    const [totalRow] = await db
      .select({ count: count(schema.lookupLogs.id) })
      .from(schema.lookupLogs)
      .where(gte(schema.lookupLogs.createdAt, since));
    const totalLookups = totalRow ? Number(totalRow.count) : 0;

    // Cache hits
    const [hitRow] = await db
      .select({ count: count(schema.lookupLogs.id) })
      .from(schema.lookupLogs)
      .where(
        and(
          eq(schema.lookupLogs.cacheHit, true),
          gte(schema.lookupLogs.createdAt, since),
        ),
      );
    const cacheHits = hitRow ? Number(hitRow.count) : 0;
    const cacheHitRatio =
      totalLookups > 0
        ? ((cacheHits / totalLookups) * 100).toFixed(1)
        : "0.0";

    // Popular queries
    const popularQueries = await db
      .select({
        query: schema.lookupLogs.normalizedQuery,
        count: count(schema.lookupLogs.id),
      })
      .from(schema.lookupLogs)
      .where(gte(schema.lookupLogs.createdAt, since))
      .groupBy(schema.lookupLogs.normalizedQuery)
      .orderBy(sql`count desc`)
      .limit(20);

    // Dictionary hit count
    const dictHits = await db
      .select({
        dictionaryId: schema.lookupLogs.dictionaryIdUsed,
        count: count(schema.lookupLogs.id),
      })
      .from(schema.lookupLogs)
      .where(
        and(
          sql`${schema.lookupLogs.dictionaryIdUsed} is not null`,
          gte(schema.lookupLogs.createdAt, since),
        ),
      )
      .groupBy(schema.lookupLogs.dictionaryIdUsed)
      .orderBy(sql`count desc`)
      .limit(10);

    // Error/warn summary
    const [errorRow] = await db
      .select({ count: count(schema.botEvents.id) })
      .from(schema.botEvents)
      .where(
        and(
          eq(schema.botEvents.level, "error"),
          gte(schema.botEvents.createdAt, since),
        ),
      );

    const [warnRow] = await db
      .select({ count: count(schema.botEvents.id) })
      .from(schema.botEvents)
      .where(
        and(
          eq(schema.botEvents.level, "warn"),
          gte(schema.botEvents.createdAt, since),
        ),
      );

    return new Response(
      JSON.stringify({
        periodDays: days,
        totalLookups,
        cacheHits,
        cacheHitRatio,
        errors: errorRow ? Number(errorRow.count) : 0,
        warns: warnRow ? Number(warnRow.count) : 0,
        popularQueries,
        dictHits,
      }),
      { status: 200, headers: { "Content-Type": "application/json" } },
    );
  } catch (err) {
    const reason = err instanceof Error ? err.message : String(err);
    console.error(`[LogsAPI] Request failed: ${reason} → Check periodDays parameter and logs query constraints`);
    return new Response(JSON.stringify({ error: "internal error" }), {
      status: 500,
      headers: { "Content-Type": "application/json" },
    });
  }
};
