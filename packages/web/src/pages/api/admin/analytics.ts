import type { APIRoute } from "astro";
import { getIsAuthenticated } from "../../../lib/locals";
import { getSession } from "../../../lib/session";
import { eq, gte, sql, count, and } from "drizzle-orm";
import { db, schema } from "@grkd-jisho/db";

/**
 * GET /api/admin/analytics?period=7d
 *
 * Returns per-bucket analytics from lookup_logs.
 * Uses output_bucket_key for per-bucket grouping, llm_source for model tracking.
 * Periods: 1d, 3d, 7d, 2w, 3w, 1m, 3m
 */
export const GET: APIRoute = async (context) => {
  const session = getSession(context);
  if (!session || !getIsAuthenticated(context)) {
    return new Response(JSON.stringify({ error: "unauthorized" }), {
      status: 401,
      headers: { "Content-Type": "application/json" },
    });
  }

  const period = context.url.searchParams.get("period") ?? "7d";
  const days = parsePeriodToDays(period);
  if (days === null) {
    return new Response(JSON.stringify({ error: `Invalid period: ${period}` }), {
      status: 400,
      headers: { "Content-Type": "application/json" },
    });
  }

  try {
    const since = sql`now() - ${days}::int * interval '1 day'`;

    // ── Per-bucket hourly breakdown ──
    const hourlyRaw = await db
      .select({
        hour: sql<string>`date_trunc('hour', ${schema.lookupLogs.createdAt})`,
        bucketKey: schema.lookupLogs.outputBucketKey,
        lookups: count(schema.lookupLogs.id),
        cacheHits:
          sql`count(*) filter (where ${schema.lookupLogs.cacheHit} = true)`,
        cacheMisses:
          sql`count(*) filter (where ${schema.lookupLogs.cacheHit} = false)`,
        llmSource: schema.lookupLogs.llmSource,
      })
      .from(schema.lookupLogs)
      .where(gte(schema.lookupLogs.createdAt, since))
      .groupBy(sql`1, ${schema.lookupLogs.outputBucketKey}, ${schema.lookupLogs.llmSource}`)
      .orderBy(sql`1`);

    // ── Build per-bucket structure ──
    const bucketMap = new Map<string, {
      totalLookups: number;
      totalHits: number;
      totalMisses: number;
      gemini: number;
      openrouter: number;
      hourly: Map<string, {
        hour: string;
        lookups: number;
        cacheHits: number;
        cacheMisses: number;
        llmGemini: number;
        llmOpenrouter: number;
      }>;
    }>();

    for (const row of hourlyRaw) {
      const bk = row.bucketKey || "unknown";
      if (!bucketMap.has(bk)) {
        bucketMap.set(bk, {
          totalLookups: 0,
          totalHits: 0,
          totalMisses: 0,
          gemini: 0,
          openrouter: 0,
          hourly: new Map(),
        });
      }
      const bucket = bucketMap.get(bk)!;

      const hourLookups = Number(row.lookups);
      const hourHits = Number(row.cacheHits);
      const hourMisses = Number(row.cacheMisses);
      bucket.totalLookups += hourLookups;
      bucket.totalHits += hourHits;
      bucket.totalMisses += hourMisses;

      if (row.llmSource === "gemini") bucket.gemini += hourLookups;
      if (row.llmSource === "openrouter") bucket.openrouter += hourLookups;

      // Aggregate by hour (llmSource splits rows for the same hour)
      if (!bucket.hourly.has(row.hour)) {
        bucket.hourly.set(row.hour, {
          hour: row.hour,
          lookups: 0,
          cacheHits: 0,
          cacheMisses: 0,
          llmGemini: 0,
          llmOpenrouter: 0,
        });
      }
      const h = bucket.hourly.get(row.hour)!;
      h.lookups += hourLookups;
      h.cacheHits += hourHits;
      h.cacheMisses += hourMisses;
      if (row.llmSource === "gemini") h.llmGemini += hourLookups;
      if (row.llmSource === "openrouter") h.llmOpenrouter += hourLookups;
    }

    const buckets: Record<string, unknown> = {};
    for (const [bk, b] of bucketMap) {
      const sortedHours = [...b.hourly.values()].sort(
        (a, b2) => new Date(a.hour).getTime() - new Date(b2.hour).getTime(),
      );
      buckets[bk] = {
        totalLookups: b.totalLookups,
        cacheHitRate:
          b.totalLookups > 0
            ? +(b.totalHits / b.totalLookups).toFixed(4)
            : 0,
        llmUsage: { gemini: b.gemini, openrouter: b.openrouter },
        hourly: sortedHours.map((h) => ({
          ...h,
          hour: new Date(h.hour + "Z").toISOString(),
        })),
      };
    }

    // ── Popular queries ──
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

    // ── Dictionary hits ──
    const dictionaryHits = await db
      .select({
        dictionaryName: schema.dictionaries.name,
        hitCount: count(schema.lookupLogs.id),
      })
      .from(schema.lookupLogs)
      .leftJoin(
        schema.dictionaries,
        eq(schema.lookupLogs.dictionaryIdUsed, schema.dictionaries.id),
      )
      .where(
        and(
          sql`${schema.lookupLogs.dictionaryIdUsed} is not null`,
          gte(schema.lookupLogs.createdAt, since),
        ),
      )
      .groupBy(
        schema.lookupLogs.dictionaryIdUsed,
        schema.dictionaries.name,
      )
      .orderBy(sql`count desc`)
      .limit(10);

    return new Response(
      JSON.stringify({
        period,
        buckets,
        popularQueries: popularQueries.map((r) => ({
          query: r.query,
          count: Number(r.count),
        })),
        dictionaryHits: dictionaryHits.map((r) => ({
          dictionaryName: r.dictionaryName ?? "unknown",
          hitCount: Number(r.hitCount),
        })),
      }),
      {
        status: 200,
        headers: { "Content-Type": "application/json" },
      },
    );
  } catch (err) {
    const reason = err instanceof Error ? err.message : String(err);
    console.error(
      `[AnalyticsAPI] Query failed: ${reason} → Check lookup_logs columns and period parameter`,
    );
    return new Response(JSON.stringify({ error: "internal error" }), {
      status: 500,
      headers: { "Content-Type": "application/json" },
    });
  }
};

/** Convert period string to number of days, or null if invalid */
function parsePeriodToDays(period: string): number | null {
  switch (period) {
    case "1d":
      return 1;
    case "3d":
      return 3;
    case "7d":
      return 7;
    case "2w":
      return 14;
    case "3w":
      return 21;
    case "1m":
      return 30;
    case "3m":
      return 90;
    default:
      return null;
  }
}
