/**
 * pnpm env:validate — 環境変数検証CLI
 *
 * 使用方法:
 *   pnpm env:validate              # 人間向け出力
 *   pnpm env:validate --json      # CI向けJSON出力
 *   pnpm env:validate --strict    # 全必須変数を厳密チェック
 *
 * .env ファイルを読み込み、全パッケージ横断で必須環境変数の
 * 充足状況とフォーマットを検証する。
 */
import { existsSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import {
  databaseUrlSchema,
  discordTokenSchema,
  allRequiredVars,
  botRequiredVars,
  webRequiredVars,
  mcpRequiredVars,
  loadDotEnv,
} from "../env-schema.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const PROJECT_ROOT = resolve(__dirname, "..", "..", "..", "..");

interface CheckResult {
  name: string;
  status: "PASS" | "FAIL" | "SKIP";
  message: string;
}

function getEnvFilePath(): string {
  // pnpm env:validate を実行したディレクトリの .env を探す
  // プロジェクトルートの .env も許容
  const cwd = process.cwd();
  const candidates = [
    resolve(cwd, ".env"),
    resolve(PROJECT_ROOT, ".env"),
  ];
  for (const p of candidates) {
    if (existsSync(p)) return p;
  }
  return candidates[0] as string; // fallback (candidates は常に1件以上)
}

function runChecks(env: Record<string, string>, strict: boolean): CheckResult[] {
  const results: CheckResult[] = [];

  // 1. .env ファイル存在チェック
  results.push({
    name: ".env",
    status: existsSync(getEnvFilePath()) ? "PASS" : "FAIL",
    message: existsSync(getEnvFilePath())
      ? `${getEnvFilePath()}`
      : `${getEnvFilePath()} が見つかりません`,
  });

  // 2. Node.js バージョンチェック
  const nodeMajor = Number(process.version.slice(1).split(".")[0]);
  results.push({
    name: "Node.js",
    status: nodeMajor >= 20 ? "PASS" : "FAIL",
    message: `${process.version}（v20 LTS 推奨。v${nodeMajor} で動作確認済み）`,
  });

  // 3. 全必須変数の存在チェック
  const varsToCheck = strict ? allRequiredVars : botRequiredVars;
  for (const varName of varsToCheck) {
    const value = env[varName];
    if (!value || value.length === 0) {
      results.push({
        name: varName,
        status: "FAIL",
        message: "(empty)",
      });
    } else {
      results.push({
        name: varName,
        status: "PASS",
        message: "set",
      });
    }
  }

  // 4. DATABASE_URL フォーマット検証
  if (env["DATABASE_URL"]) {
    const parsed = databaseUrlSchema.safeParse(env["DATABASE_URL"]);
    results.push({
      name: "DATABASE_URL (format)",
      status: parsed.success ? "PASS" : "FAIL",
      message: parsed.success ? "valid URL" : parsed.error.issues[0]?.message ?? "unknown error",
    });
  }

  // 5. DISCORD_TOKEN フォーマット検証
  if (env["DISCORD_TOKEN"]) {
    const parsed = discordTokenSchema.safeParse(env["DISCORD_TOKEN"]);
    results.push({
      name: "DISCORD_TOKEN (format)",
      status: parsed.success ? "PASS" : "FAIL",
      message: parsed.success
        ? "valid format"
        : "invalid format (expected: Bot Token pattern)",
    });
  }

  // 6. SESSION_SECRET 長さ検証（web）
  if (env["SESSION_SECRET"] && env["SESSION_SECRET"].length > 0) {
    results.push({
      name: "SESSION_SECRET (length)",
      status: env["SESSION_SECRET"].length >= 32 ? "PASS" : "FAIL",
      message: `${env["SESSION_SECRET"].length} chars (minimum 32)`,
    });
  }

  // 7. パッケージ別サマリ
  const botMissing = botRequiredVars.filter((v) => !env[v] || env[v].length === 0);
  const webMissing = webRequiredVars.filter((v) => !env[v] || env[v].length === 0);
  const mcpMissing = mcpRequiredVars.filter((v) => !env[v] || env[v].length === 0);

  results.push({
    name: "Bot readiness",
    status: botMissing.length === 0 ? "PASS" : "FAIL",
    message:
      botMissing.length === 0
        ? "all required vars set"
        : `missing: ${botMissing.join(", ")}`,
  });

  results.push({
    name: "Web Admin UI readiness",
    status: webMissing.length === 0 ? "PASS" : "FAIL",
    message:
      webMissing.length === 0
        ? "all required vars set"
        : `missing: ${webMissing.join(", ")}`,
  });

  results.push({
    name: "MCP readiness",
    status: mcpMissing.length === 0 ? "PASS" : "FAIL",
    message:
      mcpMissing.length === 0
        ? "all required vars set"
        : `missing: ${mcpMissing.join(", ")}`,
  });

  return results;
}

function printHuman(results: CheckResult[]): void {
  const passed = results.filter((r) => r.status === "PASS").length;
  const failed = results.filter((r) => r.status === "FAIL").length;

  for (const r of results) {
    switch (r.status) {
      case "PASS":
        console.log(`✅ ${r.name}: ${r.message}`);
        break;
      case "FAIL":
        console.log(`❌ ${r.name}: ${r.message}`);
        break;
      case "SKIP":
        console.log(`⏭ ${r.name}: ${r.message}`);
        break;
    }
  }

  console.log(`\n${passed} passed, ${failed} failed`);
  if (failed > 0) {
    console.log("💡 .env.example をコピーして必要な値を設定してください");
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
    })),
  };
  console.log(JSON.stringify(output, null, 2));
  if (!output.valid) process.exit(1);
}

function main(): void {
  const args = process.argv.slice(2);
  const jsonMode = args.includes("--json");
  const strictMode = args.includes("--strict");

  const envFile = getEnvFilePath();
  const env = loadDotEnv(envFile);
  const results = runChecks(env, strictMode);

  if (jsonMode) {
    printJson(results);
  } else {
    printHuman(results);
  }
}

main();
