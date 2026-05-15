import { resolve } from "node:path";
import { existsSync, readFileSync } from "node:fs";
import type { APIRoute } from "astro";
import { getIsAuthenticated } from "../../../lib/locals";
import { getSession } from "../../../lib/session";
import { eq, gte, sql, count, and } from "drizzle-orm";
import { db, schema } from "@grkd-jisho/db";

/* ─── Types ──────────────────────────────────────────── */

interface BucketResponse {
  totalLookups: number;
  cacheHitRate: number;
  llmUsage: { gemini: number; openrouter: number };
  hourly: Array<{
    hour: string;
    lookups: number;
    cacheHits: number;
    cacheMisses: number;
    llmGemini: number;
    llmOpenrouter: number;
  }>;
}

interface HourlyStatRow {
  hour: string;
  bucketKey: string;
  totalLookups: number;
  cacheHits: number;
  cacheMisses: number;
  llmGemini: number;
  llmOpenrouter: number;
}

/* ─── SQLite reader ───────────────────────────────────── */

const SQLITE_PATH = resolve(process.cwd(), "analytics", "stats.db");

async function querySqlite(days: number): Promise<HourlyStatRow[] | null> {
  if (!existsSync(SQLITE_PATH)) return null;

  try {
    const initSqlJs = (await import("sql.js")).default;
    const SQL = await initSqlJs();
    const buffer = readFileSync(SQLITE_PATH);
    const db2 = new SQL.Database(buffer);

    const since = new Date(
      Date.now() - days * 24 * 60 * 60 * 1000,
    ).toISOString();

    const stmt = db2.prepare(
      `SELECT * FROM hourly_stats
       WHERE hour >= ?
       ORDER BY hour ASC, bucket_key ASC`,
    );
    stmt.bind([since]);

    const results: HourlyStatRow[] = [];
    while (stmt.step()) {
      const row = stmt.getAsObject() as Record<string, unknown>;
      results.push({
        hour: String(row.hour ?? ""),
        bucketKey: String(row.bucket_key ?? ""),
        totalLookups: Number(row.total_lookups ?? 0),
        cacheHits: Number(row.cache_hits ?? 0),
        cacheMisses: Number(row.cache_misses ?? 0),
        llmGemini: Number(row.llm_gemini ?? 0),
        llmOpenrouter: Number(row.llm_openrouter ?? 0),
      });
    }
    stmt.free();
    db2.close();

    return results.length > 0 ? results : null;
  } catch {
    return null;
  }
}

function buildBucketsFromRows(rows: HourlyStatRow[]): Record<string, BucketResponse> {
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

  for (const row of rows) {
    const bk = row.bucketKey || "unknown";
    if (!bucketMap.has(bk)) {
      bucketMap.set(bk, {
        totalLookups: 0, totalHits: 0, totalMisses: 0,
        gemini: 0, openrouter: 0,
        hourly: new Map(),
      });
    }
    const bucket = bucketMap.get(bk)!;
    bucket.totalLookups += row.totalLookups;
    bucket.totalHits += row.cacheHits;
    bucket.totalMisses += row.cacheMisses;
    bucket.gemini += row.llmGemini;
    bucket.openrouter += row.llmOpenrouter;

    if (!bucket.hourly.has(row.hour)) {
      bucket.hourly.set(row.hour, {
        hour: new Date(row.hour).toISOString(),
        lookups: 0, cacheHits: 0, cacheMisses: 0,
        llmGemini: 0, llmOpenrouter: 0,
      });
    }
    const h = bucket.hourly.get(row.hour)!;
    h.lookups += row.totalLookups;
    h.cacheHits += row.cacheHits;
    h.cacheMisses += row.cacheMisses;
    h.llmGemini += row.llmGemini;
    h.llmOpenrouter += row.llmOpenrouter;
  }

  const buckets: Record<string, BucketResponse> = {};
  for (const [bk, b] of bucketMap) {
    const sortedHours = [...b.hourly.values()].sort(
      (a, b2) => new Date(a.hour).getTime() - new Date(b2.hour).getTime(),
    );
    buckets[bk] = {
      totalLookups: b.totalLookups,
      cacheHitRate: b.totalLookups > 0
        ? +(b.totalHits / b.totalLookups).toFixed(4)
        : 0,
      llmUsage: { gemini: b.gemini, openrouter: b.openrouter },
      hourly: sortedHours,
    };
  }
  return buckets;
}

/**
 * GET /api/admin/analytics?period=7d
 *
 * 優先的に SQLite（analytics/stats.db）から集計データを読み込む。
 * SQLite が空 or 未存在の場合は PostgreSQL lookup_logs から直接クエリする。
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
    // ── Try SQLite first ──
    const sqliteRows = await querySqlite(days);
    if (sqliteRows) {
      const buckets = buildBucketsFromRows(sqliteRows);
      return respond(period, buckets, days);
    }

    // ── Fallback: PostgreSQL direct query ──
    const since = sql`now() - ${days}::int * interval '1 day'`;

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

    const bucketMap = new Map<string, {
      totalLookups: number; totalHits: number; totalMisses: number;
      gemini: number; openrouter: number;
      hourly: Map<string, {
        hour: string; lookups: number; cacheHits: number; cacheMisses: number;
        llmGemini: number; llmOpenrouter: number;
      }>;
    }>();

    for (const row of hourlyRaw) {
      const bk = row.bucketKey || "unknown";
      if (!bucketMap.has(bk)) {
        bucketMap.set(bk, {
          totalLookups: 0, totalHits: 0, totalMisses: 0,
          gemini: 0, openrouter: 0,
          hourly: new Map(),
        });
      }
      const bucket = bucketMap.get(bk)!;
      const hourLookups = Number(row.lookups);
      bucket.totalLookups += hourLookups;
      bucket.totalHits += Number(row.cacheHits);
      bucket.totalMisses += Number(row.cacheMisses);
      if (row.llmSource === "gemini") bucket.gemini += hourLookups;
      if (row.llmSource === "openrouter") bucket.openrouter += hourLookups;

      if (!bucket.hourly.has(row.hour)) {
        bucket.hourly.set(row.hour, {
          hour: row.hour, lookups: 0, cacheHits: 0, cacheMisses: 0,
          llmGemini: 0, llmOpenrouter: 0,
        });
      }
      const h = bucket.hourly.get(row.hour)!;
      h.lookups += hourLookups;
      h.cacheHits += Number(row.cacheHits);
      h.cacheMisses += Number(row.cacheMisses);
      if (row.llmSource === "gemini") h.llmGemini += hourLookups;
      if (row.llmSource === "openrouter") h.llmOpenrouter += hourLookups;
    }

    const buckets: Record<string, BucketResponse> = {};
    for (const [bk, b] of bucketMap) {
      const sortedHours = [...b.hourly.values()].sort(
        (a, b2) => new Date(a.hour).getTime() - new Date(b2.hour).getTime(),
      );
      buckets[bk] = {
        totalLookups: b.totalLookups,
        cacheHitRate: b.totalLookups > 0
          ? +(b.totalHits / b.totalLookups).toFixed(4)
          : 0,
        llmUsage: { gemini: b.gemini, openrouter: b.openrouter },
        hourly: sortedHours.map((h) => ({
          ...h, hour: new Date(h.hour).toISOString(),
        })),
      };
    }

    return respond(period, buckets, days);
  } catch (err) {
    const reason = err instanceof Error ? err.message : String(err);
    console.error(`[AnalyticsAPI] Query failed: ${reason} → Check analytics DB and lookup_logs`);
    return new Response(JSON.stringify({ error: "internal error" }), {
      status: 500,
      headers: { "Content-Type": "application/json" },
    });
  }
};

/** 共通レスポンス: buckets + popularQueries + dictionaryHits */
async function respond(
  period: string,
  buckets: Record<string, BucketResponse>,
  days: number,
): Promise<Response> {
  const since = sql`now() - ${days}::int * interval '1 day'`;

  const [popularQueries, dictionaryHits] = await Promise.all([
    db
      .select({
        query: schema.lookupLogs.normalizedQuery,
        count: count(schema.lookupLogs.id),
      })
      .from(schema.lookupLogs)
      .where(gte(schema.lookupLogs.createdAt, since))
      .groupBy(schema.lookupLogs.normalizedQuery)
      .orderBy(sql`count desc`)
      .limit(20),
    db
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
      .groupBy(schema.lookupLogs.dictionaryIdUsed, schema.dictionaries.name)
      .orderBy(sql`count desc`)
      .limit(10),
  ]);

  return new Response(
    JSON.stringify({
      period,
      buckets,
      popularQueries: popularQueries.map((r) => ({
        query: r.query, count: Number(r.count),
      })),
      dictionaryHits: dictionaryHits.map((r) => ({
        dictionaryName: r.dictionaryName ?? "unknown",
        hitCount: Number(r.hitCount),
      })),
    }),
    { status: 200, headers: { "Content-Type": "application/json" } },
  );
}

/** Convert period string to number of days */
function parsePeriodToDays(period: string): number | null {
  switch (period) {
    case "1d": return 1;
    case "3d": return 3;
    case "7d": return 7;
    case "2w": return 14;
    case "3w": return 21;
    case "1m": return 30;
    case "3m": return 90;
    default: return null;
  }
}
