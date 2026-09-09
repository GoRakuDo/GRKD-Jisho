import { existsSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { EmbedBuilder } from "discord.js";

const DISCORD_EMBED_DESCRIPTION_LIMIT = 3900;
const DISCORD_EMBED_TRUNCATED_SUFFIX = "\n\n… (Teks terlalu panjang dan terpotong. Silakan periksa detail cache untuk teks lengkap.)";

// Wipe 後ガイドの添付画像（packages/bot/assets/ 配下）
export const WIPE_GUIDE_IMAGE_FILENAME = "usage-guide.png";

const WIPE_GUIDE_DESCRIPTION = `Kanal ini telah dibersihkan secara otomatis.
Kamu bisa mencari arti kata bahasa Jepang dengan 2 cara:

1. **Tag / Mention Bot**
   \`@GRKD-Jisho <kata>\`
   Contoh: \`@GRKD-Jisho 重ね重ね\`

2. **Slash Command**
   \`/definisi word:<kata>\`
   Contoh: \`/definisi word:重ね重ね\`

Penjelasan kartu kamus akan dibuat dengan nuansa bahasa Indonesia alami!`;

function clampDiscordEmbedDescription(text: string): string {
  if (text.length <= DISCORD_EMBED_DESCRIPTION_LIMIT) {
    return text;
  }

  const trimmed = text.slice(0, DISCORD_EMBED_DESCRIPTION_LIMIT).trimEnd();
  return `${trimmed}${DISCORD_EMBED_TRUNCATED_SUFFIX}`;
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
    .setTitle("Kata Tidak Ditemukan")
    .setDescription(
      `"${query}" tidak ditemukan dalam data kamus saat ini.\nSilakan coba dengan kata lain, atau periksa kembali ejaan kata yang dimasukkan.`,
    )
    .setTimestamp();

  return { embeds: [embed] };
}

export function formatError(reason: string) {
  const embed = new EmbedBuilder()
    .setColor(0xff0000)
    .setTitle("Terjadi Kesalahan")
    .setDescription(`${reason}\nSilakan coba lagi beberapa saat kemudian.`)
    .setTimestamp();

  return { embeds: [embed] };
}

// usage-guide.png の絶対パスを import.meta.url 基準で解決する。
// dev (src/services) では packages/bot/assets/、build (dist/services) では dist/assets/ に展開される前提。
// 見つからない場合は undefined を返し、呼び出し側は画像なし（テキストのみ）でフォールバックする。
export function resolveUsageGuideImagePath(): string | undefined {
  const currentDir = dirname(fileURLToPath(import.meta.url));
  const candidate = resolve(currentDir, "..", "..", "assets", WIPE_GUIDE_IMAGE_FILENAME);
  return existsSync(candidate) ? candidate : undefined;
}

// Wipe 完了後に投稿する使い方ガイド。imagePath があれば attachment 画像を付与する。
export function formatWipeGuide(imagePath?: string) {
  const embed = new EmbedBuilder()
    .setColor(0x00b7c3)
    .setTitle("Panduan Penggunaan GRKD-Jisho")
    .setDescription(WIPE_GUIDE_DESCRIPTION)
    .setTimestamp();

  if (imagePath) {
    embed.setImage(`attachment://${WIPE_GUIDE_IMAGE_FILENAME}`);
  }

  return { embeds: [embed] };
}
