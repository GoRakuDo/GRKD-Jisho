import type { APIRoute } from "astro";
import { getIsAuthenticated } from "../../../lib/locals";
import { getSession } from "../../../lib/session";
import { eq, and, gte, sql, count } from "drizzle-orm";
import { db, schema, toGMT7Date } from "@grkd-jisho/db";

export const GET: APIRoute = async (context) => {
  const session = getSession(context);
  if (!session || !getIsAuthenticated(context)) {
    return new Response(JSON.stringify({ error: "unauthorized" }), {
      status: 401,
      headers: { "Content-Type": "application/json" },
    });
  }

  try {
    const today = toGMT7Date(new Date());

    // Lookups today
    const [lookupRow] = await db
      .select({ count: count(schema.lookupLogs.id) })
      .from(schema.lookupLogs)
      .where(gte(schema.lookupLogs.createdAt, sql`${today}::date`));
    const lookupsToday = lookupRow ? Number(lookupRow.count) : 0;

    // Cache hits today
    const [hitRow] = await db
      .select({ count: count(schema.lookupLogs.id) })
      .from(schema.lookupLogs)
      .where(
        and(
          eq(schema.lookupLogs.cacheHit, true),
          gte(schema.lookupLogs.createdAt, sql`${today}::date`),
        ),
      );
    const hitsToday = hitRow ? Number(hitRow.count) : 0;

    // Cache hit ratio = hits / total lookups
    const cacheHitRatio =
      lookupsToday > 0
        ? ((hitsToday / lookupsToday) * 100).toFixed(1)
        : "0.0";

    // Pending ops jobs
    const [pendingRow] = await db
      .select({ count: count(schema.opsJobs.id) })
      .from(schema.opsJobs)
      .where(eq(schema.opsJobs.status, "pending"));
    const pendingJobs = pendingRow ? Number(pendingRow.count) : 0;

    // Recent errors (last 24h)
    const [errorRow] = await db
      .select({ count: count(schema.botEvents.id) })
      .from(schema.botEvents)
      .where(
        and(
          eq(schema.botEvents.level, "error"),
          gte(schema.botEvents.createdAt, sql`now() - interval '24 hours'`),
        ),
      );
    const recentErrors = errorRow ? Number(errorRow.count) : 0;

    // Recent traces
    const recentTraces = await db
      .select({
        id: schema.botEvents.id,
        traceId: schema.botEvents.traceId,
        eventType: schema.botEvents.eventType,
        level: schema.botEvents.level,
        createdAt: schema.botEvents.createdAt,
      })
      .from(schema.botEvents)
      .orderBy(sql`${schema.botEvents.createdAt} desc`)
      .limit(10);

    // Recent errors list
    const recentErrorList = await db
      .select({
        id: schema.botEvents.id,
        traceId: schema.botEvents.traceId,
        eventType: schema.botEvents.eventType,
        createdAt: schema.botEvents.createdAt,
      })
      .from(schema.botEvents)
      .where(eq(schema.botEvents.level, "error"))
      .orderBy(sql`${schema.botEvents.createdAt} desc`)
      .limit(10);

    return new Response(
      JSON.stringify({
        lookupsToday,
        cacheHitRatio,
        pendingJobs,
        recentErrors,
        recentTraces: recentTraces.map((r) => ({
          ...r,
          id: String(r.id),
        })),
        recentErrorList: recentErrorList.map((r) => ({
          ...r,
          id: String(r.id),
        })),
      }),
      {
        status: 200,
        headers: { "Content-Type": "application/json" },
      },
    );
  } catch (err) {
    console.error("Dashboard stats error:", err);
    return new Response(JSON.stringify({ error: "internal error" }), {
      status: 500,
      headers: { "Content-Type": "application/json" },
    });
  }
};
