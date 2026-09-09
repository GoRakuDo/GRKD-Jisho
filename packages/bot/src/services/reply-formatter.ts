import { EmbedBuilder } from "discord.js";

const DISCORD_EMBED_DESCRIPTION_LIMIT = 3900;
const DISCORD_EMBED_TRUNCATED_SUFFIX = "\n\n… (Teks terlalu panjang dan terpotong. Silakan periksa detail cache untuk teks lengkap.)";

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
