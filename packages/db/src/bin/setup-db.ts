/**
 * pnpm db:setup — DB 初期化CLI
 *
 * 使用方法:
 *   pnpm db:setup                # 通常実行
 *   DRY_RUN=true pnpm db:setup   # 変更なしで確認のみ
 *
 * .env の DATABASE_URL を読んで以下を自動実行:
 *   1. PostgreSQL が起動しているか確認
 *   2. DB ユーザーを作成（存在しなければ）
 *   3. DB を作成（存在しなければ）
 *   4. パスワード認証で接続テスト
 *   5. pnpm db:migrate でスキーマ適用
 *
 * SQL 文字列はスクリプトが生成するため、SSH越しでの
 * quoting 地獄（PowerShell → bash → psql の3層解釈）が
 * 発生しない。安全に SCP 経由で送って実行できる。
 */
import { execFileSync, type ExecFileSyncOptions } from "node:child_process";
import { join, dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
const __dirname = dirname(fileURLToPath(import.meta.url));
const PROJECT_ROOT = resolve(__dirname, "..", "..", "..", "..");

// ── SQL エスケープ ────────────────────────────────────────

/**
 * PostgreSQL の文字列リテラルを安全にエスケープする。
 * シングルクォートを '' にエスケープし、全体を '...' で囲む。
 */
function escapeLiteral(s: string): string {
  return `'${s.replace(/'/g, "''")}'`;
}

/**
 * PostgreSQL の識別子（テーブル名、カラム名、ユーザー名、DB名）を
 * 安全にエスケープする。ダブルクォートを "" にエスケープし、全体を "..." で囲む。
 */
function escapeIdent(s: string): string {
  return `"${s.replace(/"/g, '""')}"`;
}

// ── DATABASE_URL パース ───────────────────────────────────

interface ParsedUrl {
  user: string;
  password: string;
  host: string;
  port: string;
  dbname: string;
}

function parseDatabaseUrl(url: string): ParsedUrl {
  // postgresql://user:password@host:port/dbname
  const prefix = url.startsWith("postgresql://") ? "postgresql://" : "postgres://";
  const rest = url.slice(prefix.length);
  const atIdx = rest.indexOf("@");
  if (atIdx === -1) throw new Error("Invalid DATABASE_URL: missing @");
  const userInfo = rest.slice(0, atIdx);
  const colonIdx = userInfo.indexOf(":");
  const user = colonIdx === -1 ? userInfo : decodeURIComponent(userInfo.slice(0, colonIdx));
  const password = colonIdx === -1 ? "" : decodeURIComponent(userInfo.slice(colonIdx + 1));
  const hostPortDb = rest.slice(atIdx + 1);
  const slashIdx = hostPortDb.indexOf("/");
  const hostPort = slashIdx === -1 ? hostPortDb : hostPortDb.slice(0, slashIdx);
  const dbname = slashIdx === -1 ? "" : decodeURIComponent(hostPortDb.slice(slashIdx + 1));
  const bracketIdx = hostPort.startsWith("[") ? hostPort.indexOf("]") : -1;
  let host: string;
  let port: string;
  if (bracketIdx !== -1) {
    host = hostPort.slice(1, bracketIdx);
    port = hostPort.slice(bracketIdx + 2) || "5432";
  } else {
    const hcIdx = hostPort.indexOf(":");
    host = hcIdx === -1 ? hostPort : hostPort.slice(0, hcIdx);
    port = hcIdx === -1 ? "5432" : hostPort.slice(hcIdx + 1);
  }
  return { user, password, host, port, dbname: dbname || "grkd_jisho" };
}

// ── psql ヘルパー ─────────────────────────────────────────

function psql(
  db: string,
  user: string,
  sql: string,
  extra: { password?: string; host?: string; port?: string } = {},
): string {
  const args = [
    "-h", extra.host || "localhost",
    "-p", extra.port || "5432",
    "-U", user,
    "-d", db,
    "-tAc", sql,
  ];
  const opts: ExecFileSyncOptions = {
    encoding: "utf-8",
    timeout: 15000,
  };
  if (extra.password) {
    opts.env = { ...process.env, PGPASSWORD: extra.password };
  }
  try {
    return execFileSync("psql", args, opts).toString().trim();
  } catch (e: unknown) {
    const err = e as Error & { stderr?: Buffer };
    throw new Error(`psql error: ${err.stderr?.toString() || err.message}`);
  }
}

function psqlFile(
  db: string,
  user: string,
  sqlFile: string,
  extra: { password?: string; host?: string; port?: string } = {},
): string {
  const args = [
    "-h", extra.host || "localhost",
    "-p", extra.port || "5432",
    "-U", user,
    "-d", db,
    "-f", sqlFile,
  ];
  const opts: ExecFileSyncOptions = {
    encoding: "utf-8",
    timeout: 15000,
  };
  if (extra.password) {
    opts.env = { ...process.env, PGPASSWORD: extra.password };
  }
  try {
    return execFileSync("psql", args, opts).toString().trim();
  } catch (e: unknown) {
    const err = e as Error & { stderr?: Buffer };
    throw new Error(`psql error: ${err.stderr?.toString() || err.message}`);
  }
}

// ── メインロジック ────────────────────────────────────────

function loadEnv(): Record<string, string> {
  // process.env から直接読む（.env は dotenv で事前にロード済みを想定）
  // tsx 起動時は dotenv -e ../../.env -- tsx ... で読み込める
  return process.env as Record<string, string>;
}

function main(): void {
  const env = loadEnv();
  const dbUrl = env["DATABASE_URL"];
  if (!dbUrl) {
    console.error("❌ DATABASE_URL is not set in environment");
    process.exit(1);
  }

  const useDryRun = process.env["DRY_RUN"] === "true" || process.argv.includes("--dry-run");
  const parsed = parseDatabaseUrl(dbUrl);

  console.log(`🔍 Target: ${parsed.host}:${parsed.port}, DB: ${parsed.dbname}, User: ${parsed.user}`);

  // Step 1: PG が起動しているか確認（postgres DB に接続）
  console.log("🔍 Checking PostgreSQL connectivity...");
  try {
    const version = psql("postgres", "postgres", "SELECT version()", {
      host: parsed.host,
      port: parsed.port,
    });
    console.log(`   ✅ PostgreSQL 応答あり: ${version.split(",")[0]}`);
  } catch {
    console.error("❌ PostgreSQL に接続できません。");
    console.error("   💡 サーバーが起動しているか確認: sudo systemctl status postgresql");
    process.exit(1);
  }

  // Step 2: DB ユーザー作成（存在しなければ）
  const userExists = psql("postgres", "postgres", `SELECT 1 FROM pg_roles WHERE rolname=${escapeLiteral(parsed.user)}`, {
    host: parsed.host,
    port: parsed.port,
  });

  if (userExists === "1") {
    console.log(`   ✅ User "${parsed.user}" already exists`);
  } else {
    const createUserSql = `CREATE USER ${escapeIdent(parsed.user)} WITH PASSWORD ${escapeLiteral(parsed.password)}`;
    if (useDryRun) {
      console.log(`   🔷 DRY RUN: ${createUserSql}`);
    } else {
      psql("postgres", "postgres", createUserSql, {
        host: parsed.host,
        port: parsed.port,
      });
      console.log(`   ✅ User "${parsed.user}" created`);
    }
  }

  // Step 3: DB 作成（存在しなければ）
  const dbExists = psql("postgres", "postgres", `SELECT 1 FROM pg_database WHERE datname=${escapeLiteral(parsed.dbname)}`, {
    host: parsed.host,
    port: parsed.port,
  });

  if (dbExists === "1") {
    console.log(`   ✅ Database "${parsed.dbname}" already exists`);
  } else {
    // CREATE DATABASE はトランザクション内で実行できないため
    // 直接 psql -c で実行
    const createDbSql = `CREATE DATABASE ${escapeIdent(parsed.dbname)} OWNER ${escapeIdent(parsed.user)}`;
    if (useDryRun) {
      console.log(`   🔷 DRY RUN: ${createDbSql}`);
    } else {
      psql("postgres", "postgres", createDbSql, {
        host: parsed.host,
        port: parsed.port,
      });
      console.log(`   ✅ Database "${parsed.dbname}" created`);
    }
  }

  // Step 4: パスワード認証で接続テスト
  if (!useDryRun) {
    try {
      const result = psql(parsed.dbname, parsed.user, "SELECT current_user, current_database()", {
        host: parsed.host,
        port: parsed.port,
        password: parsed.password,
      });
      console.log(`   ✅ パスワード認証成功: ${result}`);
    } catch {
      console.error("❌ パスワード認証に失敗しました。パスワードが正しいか確認してください。");
      process.exit(1);
    }
  }

  // Step 5: migration 適用
  if (!useDryRun) {
    console.log("🔍 Running migrations...");
    try {
      execFileSync("pnpm", ["db:migrate"], {
        cwd: PROJECT_ROOT,
        stdio: "inherit",
        timeout: 60000,
      });
      console.log("   ✅ Migrations applied");
    } catch {
      console.error("❌ Migration に失敗しました。");
      console.error("   💡 pnpm db:generate が必要かもしれません");
      process.exit(1);
    }
  }

  console.log("\n✅ db:setup completed successfully");
}

main();
