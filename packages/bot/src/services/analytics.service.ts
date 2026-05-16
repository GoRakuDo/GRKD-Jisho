import { dirname } from "node:path";
import {
  existsSync,
  mkdirSync,
  readFileSync,
  renameSync,
  writeFileSync,
} from "node:fs";
import initSqlJs, { type Database as SqlJsDatabase } from "sql.js";
import { gte, sql, lt, and } from "drizzle-orm";
import { ANALYTICS_DB_PATH, db, schema } from "@grkd-jisho/db";

/** SQLite ファイルの保存場所（repo root/analytics/stats.db） */
const DB_PATH = ANALYTICS_DB_PATH;

/* ─── SQLite init（sql.js の WASM ロードは 1 回だけ） ─── */

let _SQL: Awaited<ReturnType<typeof initSqlJs>> | null = null;
let _db: SqlJsDatabase | null = null;

async function getDb(): Promise<SqlJsDatabase> {
  if (!_SQL) {
    _SQL = await initSqlJs();
  }

  if (!_db) {
    const dir = dirname(DB_PATH);
    if (!existsSync(dir)) {
      mkdirSync(dir, { recursive: true });
    }

    // 既存 DB があれば読み込む、なければ空の DB を作成
    if (existsSync(DB_PATH)) {
      const buffer = readFileSync(DB_PATH);
      _db = new _SQL.Database(buffer);
    } else {
      _db = new _SQL.Database();
    }

    // WAL モードは sql.js では不要（メモリ内 + 手動 export）
    _db.run("PRAGMA journal_mode = MEMORY");

    _db.run(`
      CREATE TABLE IF NOT EXISTS hourly_stats (
        hour              TEXT NOT NULL,
        bucket_key        TEXT NOT NULL DEFAULT '',
        total_lookups     INTEGER NOT NULL DEFAULT 0,
        cache_hits        INTEGER NOT NULL DEFAULT 0,
        cache_misses      INTEGER NOT NULL DEFAULT 0,
        llm_gemini        INTEGER NOT NULL DEFAULT 0,
        llm_openrouter    INTEGER NOT NULL DEFAULT 0,
        PRIMARY KEY (hour, bucket_key)
      );
    `);
  }

  return _db;
}

/** 現在の DB をディスクに書き出す */
function saveDb(): void {
  if (!_db) return;
  const dir = dirname(DB_PATH);
  if (!existsSync(dir)) {
    mkdirSync(dir, { recursive: true });
  }
  const tmpPath = `${DB_PATH}.tmp`;
  writeFileSync(tmpPath, Buffer.from(_db.export()));
  renameSync(tmpPath, DB_PATH);
}

/* ─── 集計（3時間分） ──────────────────────────────────── */
export async function aggregateHourly(): Promise<void> {
  const since = sql`date_trunc('hour', now()) - interval '3 hours'`;
  const until = sql`date_trunc('hour', now())`;

  const rows = await db
    .select({
      hour: sql<string>`date_trunc('hour', ${schema.lookupLogs.createdAt})`,
      bucketKey: schema.lookupLogs.outputBucketKey,
      lookups: sql<number>`count(${schema.lookupLogs.id})`,
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

  const db2 = await getDb();
  const stmt = db2.prepare(`
    INSERT OR REPLACE INTO hourly_stats (hour, bucket_key, total_lookups, cache_hits, cache_misses, llm_gemini, llm_openrouter)
    VALUES (?, ?, ?, ?, ?, ?, ?)
  `);

  for (const row of rows) {
    stmt.run([
      new Date(row.hour).toISOString(),
      row.bucketKey || "unknown",
      Number(row.lookups),
      Number(row.cacheHits),
      Number(row.cacheMisses),
      Number(row.llmGemini),
      Number(row.llmOpenrouter),
    ]);
  }
  stmt.free();

  saveDb();
  console.log(`[Analytics] Aggregated ${rows.length} hourly stat rows`);
}
