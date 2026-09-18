import { existsSync, readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { z } from "zod";

/**
 * Bot が Discord へ返すユーザー向け文言の定義（messages.json）。
 *
 * - 文言はインドネシア語で統一する（AGENTS.md §8-3）。コード内へ直書きしない。
 * - `description` 内の `{{var}}` は renderMessage の vars で置換する。
 * - `image` は将来の添付画像ファイル名（packages/bot/assets/ 配下）。未設定は null。
 *   現時点では全件 null で、読み側も画像なしで動作する（土台のみ）。
 */
export const messageEntrySchema = z.object({
  title: z.string().nullable(),
  description: z.string(),
  image: z.string().nullable(),
});

export type MessageEntry = z.infer<typeof messageEntrySchema>;

export const messagesSchema = z.record(z.string().min(1), messageEntrySchema);

export type MessagesConfig = z.infer<typeof messagesSchema>;

function resolveMessagesJsonPath(): string {
  const currentDir = dirname(fileURLToPath(import.meta.url));
  const sameDirPath = resolve(currentDir, "messages.json");
  if (existsSync(sameDirPath)) return sameDirPath;

  const srcConfigPath = resolve(currentDir, "..", "..", "src", "config", "messages.json");
  if (existsSync(srcConfigPath)) return srcConfigPath;

  return sameDirPath;
}

export function loadMessages(jsonContent?: string): MessagesConfig {
  try {
    const raw: unknown = jsonContent !== undefined
      ? JSON.parse(jsonContent)
      : JSON.parse(readFileSync(resolveMessagesJsonPath(), "utf-8"));

    return messagesSchema.parse(raw);
  } catch (err) {
    console.error(`[Config] messages.json load failed: ${err instanceof Error ? err.message : String(err)} → Check packages/bot/src/config/messages.json schema (title/description/image)`);
    throw err;
  }
}

export const MESSAGES: MessagesConfig = loadMessages();

export function getMessage(key: string): MessageEntry {
  const entry = MESSAGES[key];
  if (!entry) {
    throw new Error(`[Config] message key not found: "${key}" → Add it to packages/bot/src/config/messages.json`);
  }
  return entry;
}

/**
 * `{{var}}` プレースホルダを vars で置換した本文を返す。
 * vars に無いプレースホルダは原文のまま残す（欠落を握りつぶさない）。
 */
export function renderMessage(key: string, vars: Record<string, string | number> = {}): string {
  return getMessage(key).description.replace(/\{\{(\w+)\}\}/g, (placeholder, name: string) => {
    const value = vars[name];
    return value === undefined ? placeholder : String(value);
  });
}
