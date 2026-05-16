import { existsSync, readFileSync } from "node:fs";
import type { APIRoute } from "astro";
import { getIsAuthenticated } from "../../../lib/locals";
import { getSession } from "../../../lib/session";
import { eq, gte, sql, count, and, lt } from "drizzle-orm";
import { ANALYTICS_DB_PATH, db, schema } from "@grkd-jisho/db";

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

interface SqlJsStatement {
  bind(params?: unknown[]): boolean;
  step(): boolean;
  getAsObject(params?: unknown[]): Record<string, unknown>;
  free(): void;
}

interface SqlJsDatabase {
  prepare(sql: string): SqlJsStatement;
  close(): void;
}

/* ─── SQLite reader ───────────────────────────────────── */

const SQLITE_PATH = ANALYTICS_DB_PATH;

async function querySqlite(days: number): Promise<HourlyStatRow[] | null> {
  if (!existsSync(SQLITE_PATH)) return null;

  const until = new Date();
  until.setMinutes(0, 0, 0);

  let db2: SqlJsDatabase | undefined;
  let stmt: SqlJsStatement | undefined;

  try {
    const initSqlJs = (await import("sql.js")).default;
    const SQL = await initSqlJs();
    const buffer = readFileSync(SQLITE_PATH);
    db2 = new SQL.Database(buffer);

    const since = new Date(
      Date.now() - days * 24 * 60 * 60 * 1000,
    ).toISOString();

    stmt = db2.prepare(
      `SELECT * FROM hourly_stats
       WHERE hour >= ? AND hour < ?
       ORDER BY hour ASC, bucket_key ASC`,
    );
    stmt.bind([since, until.toISOString()]);

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

    return results.length > 0 ? results : null;
  } catch (err) {
    const reason = err instanceof Error ? err.message : String(err);
    console.error(`[AnalyticsAPI] SQLite read failed: ${reason} → Falling back to PostgreSQL`);
    return null;
  } finally {
    stmt?.free();
    db2?.close();
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
    const totalLookups = Number(row.totalLookups ?? 0);
    const cacheHits = Number(row.cacheHits ?? 0);
    const cacheMisses = Number(row.cacheMisses ?? 0);
    const llmGemini = Number(row.llmGemini ?? 0);
    const llmOpenrouter = Number(row.llmOpenrouter ?? 0);

    if (!bucketMap.has(bk)) {
      bucketMap.set(bk, {
        totalLookups: 0, totalHits: 0, totalMisses: 0,
        gemini: 0, openrouter: 0,
        hourly: new Map(),
      });
    }
    const bucket = bucketMap.get(bk)!;
    bucket.totalLookups += totalLookups;
    bucket.totalHits += cacheHits;
    // cacheMisses は「キャッシュ外だったが応答が生成された」行だけ数える。
    // LLM エラー行は lookup_logs に残さない設計なので、総 lookup と分母を揃える。
    bucket.totalMisses += cacheMisses;
    bucket.gemini += llmGemini;
    bucket.openrouter += llmOpenrouter;

    if (!bucket.hourly.has(row.hour)) {
      bucket.hourly.set(row.hour, {
        hour: new Date(row.hour).toISOString(),
        lookups: 0, cacheHits: 0, cacheMisses: 0,
        llmGemini: 0, llmOpenrouter: 0,
      });
    }
    const h = bucket.hourly.get(row.hour)!;
    h.lookups += totalLookups;
    h.cacheHits += cacheHits;
    h.cacheMisses += cacheMisses;
    h.llmGemini += llmGemini;
    h.llmOpenrouter += llmOpenrouter;
  }

  const buckets: Record<string, BucketResponse> = {};
  for (const [bk, bucket] of bucketMap) {
    const sortedHours = [...bucket.hourly.values()].sort(
      (a, b) => new Date(a.hour).getTime() - new Date(b.hour).getTime(),
    );
    buckets[bk] = {
      totalLookups: bucket.totalLookups,
      cacheHitRate: bucket.totalLookups > 0
        ? +(bucket.totalHits / bucket.totalLookups).toFixed(4)
        : 0,
      llmUsage: { gemini: bucket.gemini, openrouter: bucket.openrouter },
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
      headers: { "Content-Type": "application/json", "Cache-Control": "no-store" },
    });
  }

  const period = context.url.searchParams.get("period") ?? "7d";
  const days = parsePeriodToDays(period);
  if (days === null) {
    return new Response(JSON.stringify({ error: `Invalid period: ${period}` }), {
      status: 400,
      headers: { "Content-Type": "application/json", "Cache-Control": "no-store" },
    });
  }

  try {
    // ── Try SQLite first ──
    const sqliteRows = await querySqlite(days);
    if (sqliteRows) {
      const buckets = buildBucketsFromRows(sqliteRows);
      const totalLookups = Object.values(buckets).reduce(
        (sum, bucket) => sum + bucket.totalLookups,
        0,
      );
      console.log(`[AnalyticsAPI] period=${period} source=sqlite totalLookups=${totalLookups} sqlitePath=${SQLITE_PATH}`);
      return respond(period, buckets, days);
    }

    // ── Fallback: PostgreSQL direct query ──
    const since = sql`now() - ${days}::int * interval '1 day'`;
    const until = sql`date_trunc('hour', now())`;

    const hourlyRaw = await db
      .select({
        hour: sql<string>`date_trunc('hour', ${schema.lookupLogs.createdAt})`,
        bucketKey: schema.lookupLogs.outputBucketKey,
        totalLookups: sql<number>`count(${schema.lookupLogs.id})`,
        cacheHits:
          sql<number>`count(*) filter (where ${schema.lookupLogs.cacheHit} = true)`,
        cacheMisses:
          sql<number>`count(*) filter (where ${schema.lookupLogs.cacheHit} = false and ${schema.lookupLogs.responseCacheId} is not null)`,
        llmGemini:
          sql<number>`count(*) filter (where ${schema.lookupLogs.llmSource} = 'gemini')`,
        llmOpenrouter:
          sql<number>`count(*) filter (where ${schema.lookupLogs.llmSource} = 'openrouter')`,
      })
      .from(schema.lookupLogs)
      .where(and(gte(schema.lookupLogs.createdAt, since), lt(schema.lookupLogs.createdAt, until)))
      .groupBy(sql`1`, schema.lookupLogs.outputBucketKey)
      .orderBy(sql`1`);

    const buckets = buildBucketsFromRows(hourlyRaw);
    const totalLookups = Object.values(buckets).reduce(
      (sum, bucket) => sum + bucket.totalLookups,
      0,
    );
    console.log(`[AnalyticsAPI] period=${period} source=postgres totalLookups=${totalLookups} sqlitePath=${SQLITE_PATH}`);
    return respond(period, buckets, days);
  } catch (err) {
    const reason = err instanceof Error ? err.message : String(err);
    console.error(`[AnalyticsAPI] Query failed: ${reason} → Check analytics DB and lookup_logs`);
    return new Response(JSON.stringify({ error: "internal error" }), {
      status: 500,
      headers: { "Content-Type": "application/json", "Cache-Control": "no-store" },
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
    { status: 200, headers: { "Content-Type": "application/json", "Cache-Control": "no-store" } },
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
