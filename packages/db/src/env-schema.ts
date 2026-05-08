import { z } from "zod";
import { existsSync, readFileSync } from "node:fs";

/**
 * .env ファイルをパースして {KEY: value} のオブジェクトを返す。
 * コメント行・空行を無視し、引用符（" と '）を除去する。
 * 全CLIから共通で使うため env-schema.ts に置く。
 */
export function loadDotEnv(filePath: string): Record<string, string> {
  const vars: Record<string, string> = {};
  if (!existsSync(filePath)) return vars;
  const content = readFileSync(filePath, "utf-8");
  for (const line of content.split("\n")) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const eqIdx = trimmed.indexOf("=");
    if (eqIdx === -1) continue;
    const key = trimmed.slice(0, eqIdx).trim();
    let value = trimmed.slice(eqIdx + 1).trim();
    if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
      value = value.slice(1, -1);
    }
    if (key) vars[key] = value;
  }
  return vars;
}

/**
 * 全パッケージ共通の環境変数スキーマ。
 *
 * 各パッケージの env.ts はこのスキーマを拡張して使う。
 * 重複定義を防ぎ、pnpm env:validate でも参照される。
 */
export const databaseUrlSchema = z.string().url();

/**
 * Discord ID の共通フォーマット（snowflake）
 */
export const discordIdSchema = z.string().regex(/^\d{17,20}$/);

/**
 * Discord Bot Token の共通フォーマット検証
 */
export const discordTokenSchema = z
  .string()
  .regex(/^[A-Za-z0-9_-]{24,}\.[\w-]{6,}\.[\w-]{27,}$/);

/**
 * Bot パッケージに必要な必須変数一覧（名前のみ）
 * env-validate CLI が「必須だが空欄」を検出するために使う
 */
export const botRequiredVars = [
  "DISCORD_TOKEN",
  "DISCORD_CLIENT_ID",
  "DISCORD_GUILD_ID",
  "DISCORD_ALLOWED_CHANNELS",
  "DATABASE_URL",
  "GEMINI_API_KEY",
] as const;

/**
 * Web パッケージに必要な必須変数一覧
 */
export const webRequiredVars = [
  "DATABASE_URL",
  "DISCORD_CLIENT_ID",
  "DISCORD_CLIENT_SECRET",
  "DISCORD_GUILD_ID",
  "SESSION_SECRET",
  "WEB_BASE_URL",
] as const;

/**
 * MCP パッケージに必要な必須変数一覧
 */
export const mcpRequiredVars = ["DATABASE_URL"] as const;

/**
 * 全パッケージ横断の必須変数一覧（重複排除）
 */
export const allRequiredVars = [
  ...new Set([...botRequiredVars, ...webRequiredVars, ...mcpRequiredVars]),
];
