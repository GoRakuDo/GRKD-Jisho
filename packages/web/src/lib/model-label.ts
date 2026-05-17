/**
 * Model 名をテーブル向けに短く整形する。
 *
 * 表示は短く、詳細は title 属性で見られる前提。
 */
export function getShortModelLabel(value: string): string {
  const normalized = value.toLowerCase();

  if (normalized.includes("gemma-4")) return "Gemma 4";
  if (normalized.includes("gemini")) return "Gemini";
  if (normalized.includes("openrouter")) return "OpenRouter";

  const compact = value.split("/").pop() ?? value;
  return compact.length > 16 ? `${compact.slice(0, 13)}…` : compact;
}
