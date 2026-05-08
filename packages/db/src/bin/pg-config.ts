/**
 * pnpm deploy:pg-config — PostgreSQL 自動チューニング
 *
 * 使用方法:
 *   pnpm deploy:pg-config             # 自動チューニング + 適用
 *   pnpm deploy:pg-config --dry-run   # 計算結果を表示のみ（変更なし）
 *   pnpm deploy:pg-config --show      # 現在の設定値を表示
 *
 * システムのRAMを検出し、最適な PostgreSQL 設定値を計算して
 * ALTER SYSTEM SET で適用する。
 *
 * 採用理由:
 * - ALTER SYSTEM は PostgreSQL 9.4+ 標準の設定変更API
 * - 設定ファイルのパス検出が不要（OS/ディストリビューション非依存）
 * - pg_reload_conf() で再起動不要で反映可能
 * - Docker 環境でも psql が使えれば動作する
 */
import { totalmem } from "node:os";
import { execFileSync, type ExecFileSyncOptions } from "node:child_process";

// ── SQL エスケープ ────────────────────────────────────────

function escapeLiteral(s: string): string {
  return `'${s.replace(/'/g, "''")}'`;
}

/** ALTER SYSTEM で設定可能なパラメータ名のホワイトリスト */
const ALLOWED_ALTER_PARAMS = new Set([
  "shared_buffers",
  "work_mem",
  "maintenance_work_mem",
  "effective_cache_size",
  "max_wal_size",
  "min_wal_size",
]);

function assertAllowedParam(param: string): void {
  if (!ALLOWED_ALTER_PARAMS.has(param)) {
    throw new Error(`Security: "${param}" is not in the allowed ALTER SYSTEM parameter list`);
  }
}

// ── 設定値計算 ───────────────────────────────────────────

interface PgConfig {
  shared_buffers: string;
  work_mem: string;
  maintenance_work_mem: string;
  effective_cache_size: string;
  max_wal_size: string;
  min_wal_size: string;
}

function toMb(bytes: number): number {
  return Math.round(bytes / 1024 / 1024);
}

function toHumanMb(mb: number): string {
  if (mb >= 1024) return `${(mb / 1024).toFixed(1)}GB`;
  return `${mb}MB`;
}

function calculateConfig(): PgConfig {
  const ramMb = toMb(totalmem());

  return {
    shared_buffers: toHumanMb(
      Math.max(256, Math.min(2048, Math.round(ramMb * 0.15))),
    ),
    work_mem: toHumanMb(
      Math.max(4, Math.min(64, Math.round(ramMb * 0.005))),
    ),
    maintenance_work_mem: toHumanMb(
      Math.max(64, Math.min(512, Math.round(ramMb * 0.02))),
    ),
    effective_cache_size: toHumanMb(
      Math.max(1024, Math.min(8192, Math.round(ramMb * 0.5))),
    ),
    max_wal_size: "2GB",
    min_wal_size: "256MB",
  };
}

// ── psql ヘルパー ─────────────────────────────────────────

function psql(
  sql: string,
  extra: { host?: string; port?: string; user?: string; dbname?: string } = {},
): string {
  const host = extra.host || process.env["PGHOST"] || "localhost";
  const port = extra.port || process.env["PGPORT"] || "5432";
  const user = extra.user || process.env["PGUSER"] || "postgres";
  const db = extra.dbname || process.env["PGDATABASE"] || "postgres";

  const args = [
    "-h", host,
    "-p", port,
    "-U", user,
    "-d", db,
    "-tAc", sql,
  ];
  const opts: ExecFileSyncOptions = {
    encoding: "utf-8",
    timeout: 15000,
  };
  // PGPASSWORD がない場合は環境変数から拾う
  try {
    return execFileSync("psql", args, opts).toString().trim();
  } catch (e: unknown) {
    const err = e as Error & { stderr?: Buffer };
    throw new Error(`psql error: ${err.stderr?.toString() || err.message}`);
  }
}

// ── メイン ────────────────────────────────────────────────

function printCurrentConfig(): void {
  console.log("📊 Current PostgreSQL configuration:");
  const params = [
    "shared_buffers",
    "work_mem",
    "maintenance_work_mem",
    "effective_cache_size",
    "max_wal_size",
    "min_wal_size",
  ];
  for (const param of params) {
    try {
      const val = psql(`SELECT setting, unit FROM pg_settings WHERE name=${escapeLiteral(param)}`);
      console.log(`   ${param}: ${val || "(unknown)"}`);
    } catch {
      console.log(`   ${param}: (connect failed)`);
    }
  }
}

function main(): void {
  const args = process.argv.slice(2);
  const dryRun = args.includes("--dry-run");
  const showOnly = args.includes("--show");

  const ramMb = toMb(totalmem());
  const config = calculateConfig();

  console.log(`🔍 System RAM: ${toHumanMb(ramMb)} (${(ramMb / 1024).toFixed(1)}GB)`);
  console.log("");
  console.log("📋 Calculated configuration:");

  type ParamEntry = { key: keyof PgConfig; desc: string };
  const params: ParamEntry[] = [
    { key: "shared_buffers", desc: "共有メモリバッファ" },
    { key: "work_mem", desc: "ソート・ハッシュ用メモリ" },
    { key: "maintenance_work_mem", desc: "メンテナンス作業用メモリ" },
    { key: "effective_cache_size", desc: "OSキャッシュ込みの見積もり" },
    { key: "max_wal_size", desc: "WAL最大サイズ（固定）" },
    { key: "min_wal_size", desc: "WAL最小サイズ（固定）" },
  ];

  for (const { key, desc } of params) {
    const value = config[key];
    // count spaces for alignment
    const paddedKey = key.padEnd(24);
    console.log(`   ${paddedKey} ${value}  (${desc})`);
  }

  if (showOnly) {
    printCurrentConfig();
    return;
  }

  if (dryRun) {
    console.log("\n🔷 DRY RUN — 適用はしません");
    console.log("   実際に適用するには --dry-run を外して実行:");
    console.log("   pnpm deploy:pg-config");
    return;
  }

  // ここから本番適用
  console.log("\n⚙️  Applying configuration via ALTER SYSTEM...");

  const paramMap: Record<string, string> = {
    shared_buffers: config.shared_buffers,
    work_mem: config.work_mem,
    maintenance_work_mem: config.maintenance_work_mem,
    effective_cache_size: config.effective_cache_size,
    max_wal_size: config.max_wal_size,
    min_wal_size: config.min_wal_size,
  };

  for (const [param, value] of Object.entries(paramMap)) {
    try {
      assertAllowedParam(param);
      psql(`ALTER SYSTEM SET ${param} = ${escapeLiteral(value)}`);
      console.log(`   ✅ ALTER SYSTEM SET ${param} = ${escapeLiteral(value)}`);
    } catch (e) {
      console.error(`   ❌ ${param}: 設定に失敗しました — ${(e as Error).message}`);
      // ALTER SYSTEM はパラメータごとに独立して失敗しうる
      // 1つ失敗しても続行
    }
  }

  // 設定反映
  console.log("\n⚙️  Reloading configuration (pg_reload_conf)...");
  try {
    const reloadResult = psql("SELECT pg_reload_conf()");
    if (reloadResult === "t") {
      console.log("   ✅ pg_reload_conf() succeeded");
    } else {
      console.log("   ⚠️  pg_reload_conf() returned false（サーバーの再起動が必要かもしれません）");
    }
  } catch {
    console.log("   ⚠️  pg_reload_conf() failed（一部の設定はサーバー再起動後に反映されます）");
  }

  // 確認
  console.log("\n🔍 Verifying configuration...");
  printCurrentConfig();

  console.log("\n✅ deploy:pg-config completed");
  console.log("   💡 注意: 一部の設定（shared_buffers など）は PostgreSQL の再起動が必要な場合があります");
  console.log("   💡 確認: sudo systemctl restart postgresql");
}

main();
