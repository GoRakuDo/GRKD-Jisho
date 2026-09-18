import { existsSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { EmbedBuilder } from "discord.js";
import { getMessage, renderMessage } from "../config/messages.js";

const DISCORD_EMBED_DESCRIPTION_LIMIT = 3900;

// Wipe 後ガイドの添付画像（packages/bot/assets/ 配下）
export const WIPE_GUIDE_IMAGE_FILENAME = "usage-guide.png";

function clampDiscordEmbedDescription(text: string): string {
  if (text.length <= DISCORD_EMBED_DESCRIPTION_LIMIT) {
    return text;
  }

  const trimmed = text.slice(0, DISCORD_EMBED_DESCRIPTION_LIMIT).trimEnd();
  return `${trimmed}${renderMessage("truncatedSuffix")}`;
}

export function formatReply(text: string) {
  const embed = new EmbedBuilder()
    .setColor(0x00b7c3)
    .setDescription(clampDiscordEmbedDescription(text))
    .setTimestamp();

  return { embeds: [embed] };
}

export function formatNotFound(query: string) {
  const embed = new EmbedBuilder()
    .setColor(0xffa500)
    .setTitle(getMessage("notFound").title)
    .setDescription(renderMessage("notFound", { query }))
    .setTimestamp();

  return { embeds: [embed] };
}

export const SUPPORT_GUIDANCE = renderMessage("supportGuidance");

export function formatRateLimitExceeded(limit: number): string {
  return renderMessage("rateLimitExceeded", {
    limit: limit === Infinity ? "Tanpa Batas" : `${limit} kali`,
    support: SUPPORT_GUIDANCE,
  });
}

export function formatFreePoolExhausted(): string {
  return renderMessage("freePoolExhausted", { support: SUPPORT_GUIDANCE });
}

export function formatFreeModelError(): string {
  return renderMessage("freeModelError", { support: SUPPORT_GUIDANCE });
}

export function formatFreeModelErrorForMember(): string {
  return renderMessage("freeModelErrorForMember", { support: SUPPORT_GUIDANCE });
}

export function formatMemberPoolExhausted(limit: number): string {
  return renderMessage("memberPoolExhausted", { limit, support: SUPPORT_GUIDANCE });
}

export function formatError(reason: string) {
  const embed = new EmbedBuilder()
    .setColor(0xff0000)
    .setTitle(getMessage("error").title)
    .setDescription(renderMessage("error", { reason }))
    .setTimestamp();

  return { embeds: [embed] };
}

// usage-guide.png の絶対パスを import.meta.url 基準で解決する。
// dev (src/services) では packages/bot/assets/、build (dist/services) では dist/assets/ に展開される前提。
// 見つからない場合は undefined を返し、呼び出し側は画像なし（テキストのみ）でフォールバック。
export function resolveUsageGuideImagePath(): string | undefined {
  const currentDir = dirname(fileURLToPath(import.meta.url));
  const candidate = resolve(currentDir, "..", "..", "assets", WIPE_GUIDE_IMAGE_FILENAME);
  return existsSync(candidate) ? candidate : undefined;
}

// Wipe 完了後に投稿する使い方ガイド。imagePath があれば attachment 画像を付与する。
export function formatWipeGuide(imagePath?: string) {
  const message = getMessage("wipeGuide");
  const embed = new EmbedBuilder()
    .setColor(0x00b7c3)
    .setTitle(message.title)
    .setDescription(message.description)
    .setTimestamp();

  if (imagePath) {
    embed.setImage(`attachment://${WIPE_GUIDE_IMAGE_FILENAME}`);
  }

  return { embeds: [embed] };
}
