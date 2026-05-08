/**
 * pnpm deploy:check — デプロイ前提条件チェック
 *
 * 使用方法:
 *   pnpm deploy:check                # 標準チェック
 *   pnpm deploy:check --json        # JSON出力（CI向け）
 *
 * チェック項目:
 *   ✅ Node.js バージョン (>= 20)
 *   ✅ PostgreSQL インストール状態 (17 推奨)
 *   ✅ ディスク空き容量 (> 5GB)
 *   ✅ .env 環境変数 (C-4 の env-schema を流用)
 *   ✅ DB 接続 (DATABASE_URL)
 *   ✅ Discord Token フォーマット
 */
import { existsSync } from "node:fs";
import { execFileSync, type ExecFileSyncOptions } from "node:child_process";
import { totalmem, freemem } from "node:os";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import {
  databaseUrlSchema,
  discordTokenSchema,
  allRequiredVars,
  loadDotEnv,
} from "../env-schema.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const PROJECT_ROOT = resolve(__dirname, "..", "..", "..", "..");

// ── 型定義 ───────────────────────────────────────────────

interface CheckResult {
  name: string;
  status: "PASS" | "FAIL" | "WARN" | "SKIP";
  message: string;
  hint?: string;
}

interface CheckFunction {
  name: string;
  fn: () => CheckResult;
}

// ── チェック関数 ─────────────────────────────────────────

function checkNodeVersion(): CheckResult {
  const version = process.version;
  const major = Number(version.slice(1).split(".")[0]);
  if (major >= 20) {
    const r: CheckResult = {
      name: "Node.js バージョン",
      status: "PASS",
      message: `${version} (v20 LTS 推奨)`,
    };
    if (major >= 25) r.hint = "v25 は開発段階です。問題が発生した場合は nvm で v20 LTS に切り替えてください";
    return r;
  }
  return {
    name: "Node.js バージョン",
    status: "FAIL",
    message: `${version} — v20 LTS 以上が必要です`,
    hint: "nvm install 20 && nvm alias default 20",
  };
}

function checkPostgresInstalled(): CheckResult {
  try {
    const out = execFileSync("psql", ["--version"], {
      encoding: "utf-8",
      timeout: 5000,
    }).toString().trim();
    const match = out.match(/(\d+)/);
    const version = match?.[1] ? parseInt(match[1], 10) : 0;

    if (version === 17) {
      return { name: "PostgreSQL", status: "PASS", message: `psql ${version} インストール済み` };
    }
    if (version >= 14) {
      return {
        name: "PostgreSQL",
        status: "WARN",
        message: `psql ${version} (17 推奨)`,
        hint: `GRKD-Jisho は PostgreSQL 17 でテストされています。`,
      };
    }
    return {
      name: "PostgreSQL",
      status: "FAIL",
      message: `psql ${version} — 14 以上が必要です`,
      hint: "sudo apt install postgresql-17",
    };
  } catch {
    return {
      name: "PostgreSQL",
      status: "FAIL",
      message: "psql が見つかりません",
      hint: "sudo apt install postgresql-17",
    };
  }
}

function checkDiskSpace(): CheckResult {
  try {
    // ルートパーティションの空き容量をチェック
    let freeBytes = 0;
    if (process.platform === "win32") {
      // Windows: PowerShell 経由で実際の空き容量を取得
      const out = execFileSync("powershell", [
        "-NoProfile", "-NonInteractive", "-Command",
        "[System.IO.DriveInfo]::GetDrives() | Where-Object { $_.Name -eq 'C:\\' } | Select-Object -ExpandProperty AvailableFreeSpace",
      ], {
        encoding: "utf-8",
        timeout: 5000,
      }).toString().trim();
      freeBytes = parseInt(out, 10) || 0;
    } else {
      // Linux: df コマンド
      const dfOut = execFileSync("df", ["--output=avail", "/"], {
        encoding: "utf-8",
        timeout: 5000,
      }).toString().trim();
      const lines = dfOut.split("\n");
      if (lines.length >= 2) {
        freeBytes = (parseInt(lines[1] ?? "0", 10) || 0) * 1024;
      }
    }

    const freeGb = (freeBytes / 1024 / 1024 / 1024).toFixed(1);

    if (freeBytes > 5 * 1024 * 1024 * 1024) {
      return {
        name: "ディスク空き容量",
        status: "PASS",
        message: `${freeGb}GB 空き (> 5GB)`,
      };
    }
    return {
      name: "ディスク空き容量",
      status: "FAIL",
      message: `${freeGb}GB 空き — 5GB 以上必要です`,
    };
  } catch {
    return {
      name: "ディスク空き容量",
      status: "WARN",
      message: "確認できませんでした",
      hint: "df -h で手動確認してください",
    };
  }
}

function checkEnvFile(): CheckResult {
  const envPath = resolve(PROJECT_ROOT, ".env");
  if (!existsSync(envPath)) {
    return {
      name: ".env ファイル",
      status: "FAIL",
      message: `${envPath} が見つかりません`,
      hint: "cp .env.example .env して必要な値を設定してください",
    };
  }
  return {
    name: ".env ファイル",
    status: "PASS",
    message: envPath,
  };
}

function checkEnvVars(): CheckResult {
  const envPath = resolve(PROJECT_ROOT, ".env");
  if (!existsSync(envPath)) {
    return {
      name: "環境変数",
      status: "FAIL",
      message: ".env がないため確認できません",
      hint: "cp .env.example .env",
    };
  }

  const env = loadDotEnv(envPath);

  const missing: string[] = [];
  const empty: string[] = [];

  for (const varName of allRequiredVars) {
    if (!(varName in env)) {
      missing.push(varName);
    } else {
      const val: string = env[varName] as string;
      if (val.length === 0) {
        empty.push(varName);
      }
    }
  }

  if (missing.length === 0 && empty.length === 0) {
    return {
      name: "環境変数 (必須)",
      status: "PASS",
      message: `${allRequiredVars.length} 個の必須変数全て設定済み`,
    };
  }

  const issues: string[] = [];
  if (missing.length > 0) issues.push(`未定義: ${missing.join(", ")}`);
  if (empty.length > 0) issues.push(`空欄: ${empty.join(", ")}`);

  return {
    name: "環境変数 (必須)",
    status: "FAIL",
    message: issues.join(" / "),
    hint: ".env の該当項目に値を設定してください",
  };
}

function checkDatabaseUrl(): CheckResult {
  const dbUrl = process.env["DATABASE_URL"];
  if (!dbUrl) {
    return {
      name: "DATABASE_URL 接続",
      status: "FAIL",
      message: "DATABASE_URL が未設定",
      hint: ".env の DATABASE_URL を確認してください",
    };
  }

  const parsed = databaseUrlSchema.safeParse(dbUrl);
  if (!parsed.success) {
    return {
      name: "DATABASE_URL 接続",
      status: "FAIL",
      message: `URL フォーマットエラー`,
      hint: parsed.error.issues[0]?.message ?? "unknown error",
    };
  }

  // 接続試行
  try {
    const out = execFileSync("psql", [
      "-d", dbUrl,
      "-tAc", "SELECT 1",
    ], {
      encoding: "utf-8",
      timeout: 10000,
    }).toString().trim();
    if (out === "1") {
      return {
        name: "DATABASE_URL 接続",
        status: "PASS",
        message: "接続成功",
      };
    }
    return {
      name: "DATABASE_URL 接続",
      status: "FAIL",
      message: "接続できましたが予期しない応答",
    };
  } catch {
    return {
      name: "DATABASE_URL 接続",
      status: "FAIL",
      message: "接続できません",
      hint: "データベースが起動しているか確認: sudo systemctl status postgresql",
    };
  }
}

function checkDiscordToken(): CheckResult {
  const envPath = resolve(PROJECT_ROOT, ".env");
  if (!existsSync(envPath)) {
    return {
      name: "DISCORD_TOKEN",
      status: "SKIP",
      message: ".env がないため確認できません",
    };
  }

  const env = loadDotEnv(envPath);
  const token = env["DISCORD_TOKEN"] ?? "";

  if (!token || token.length === 0) {
    return {
      name: "DISCORD_TOKEN フォーマット",
      status: "FAIL",
      message: "(empty)",
      hint: "Discord Developer Portal から Bot Token を取得してください",
    };
  }

  const parsed = discordTokenSchema.safeParse(token);
  if (parsed.success) {
    return {
      name: "DISCORD_TOKEN フォーマット",
      status: "PASS",
      message: "有効なフォーマット",
    };
  }
  return {
    name: "DISCORD_TOKEN フォーマット",
    status: "WARN",
    message: "標準フォーマットと異なります（通常は問題ありません）",
    hint: "最新の Discord Token 形式に更新されている可能性があります",
  };
}

function checkOsMemory(): CheckResult {
  const total = totalmem();
  const free = freemem();
  const totalGb = (total / 1024 / 1024 / 1024).toFixed(1);
  const freeMb = Math.round(free / 1024 / 1024);

  if (total >= 1 * 1024 * 1024 * 1024) {
    return {
      name: "メモリ",
      status: "PASS",
      message: `合計 ${totalGb}GB / 空き ${freeMb}MB`,
    };
  }
  return {
    name: "メモリ",
    status: "FAIL",
    message: `合計 ${totalGb}GB — 1GB 以上必要です`,
  };
}

// ── メイン ────────────────────────────────────────────────

const checks: CheckFunction[] = [
  { name: "Node.js バージョン", fn: checkNodeVersion },
  { name: "PostgreSQL インストール", fn: checkPostgresInstalled },
  { name: "OS メモリ", fn: checkOsMemory },
  { name: "ディスク空き容量", fn: checkDiskSpace },
  { name: ".env ファイル", fn: checkEnvFile },
  { name: "環境変数", fn: checkEnvVars },
  { name: "DATABASE_URL 接続", fn: checkDatabaseUrl },
  { name: "DISCORD_TOKEN", fn: checkDiscordToken },
];

function printHuman(results: CheckResult[]): void {
  const passed = results.filter((r) => r.status === "PASS").length;
  const warned = results.filter((r) => r.status === "WARN").length;
  const failed = results.filter((r) => r.status === "FAIL").length;

  console.log("━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━");
  console.log("  GRKD-Jisho デプロイ前提チェック");
  console.log("━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n");

  for (const r of results) {
    switch (r.status) {
      case "PASS":
        console.log(`  ✅  ${r.name}`);
        console.log(`      ${r.message}`);
        break;
      case "WARN":
        console.log(`  ⚠️   ${r.name}`);
        console.log(`      ${r.message}`);
        break;
      case "FAIL":
        console.log(`  ❌  ${r.name}`);
        console.log(`      ${r.message}`);
        break;
    }
    if (r.hint) {
      console.log(`      💡 ${r.hint}`);
    }
    console.log("");
  }

  console.log("━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━");
  console.log(`  ${passed} passed, ${warned} warnings, ${failed} failed`);
  console.log("━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n");

  if (failed > 0) {
    const hints = results
      .filter((r) => r.status === "FAIL" && r.hint)
      .map((r) => `  ❌ ${r.name}: ${r.hint}`);
    console.log("💡 修正ヒント:");
    for (const h of hints) console.log(h);
    process.exit(1);
  }
}

function printJson(results: CheckResult[]): void {
  const output = {
    valid: results.every((r) => r.status !== "FAIL"),
    checks: results.map((r) => ({
      name: r.name,
      status: r.status,
      message: r.message,
      hint: r.hint,
    })),
  };
  console.log(JSON.stringify(output, null, 2));
  if (!output.valid) process.exit(1);
}

function main(): void {
  const args = process.argv.slice(2);
  const jsonMode = args.includes("--json");

  const results = checks.map((c) => {
    try {
      return c.fn();
    } catch (e) {
      return {
        name: c.name,
        status: "FAIL" as const,
        message: `エラー: ${(e as Error).message}`,
      };
    }
  });

  if (jsonMode) {
    printJson(results);
  } else {
    printHuman(results);
  }
}

main();
