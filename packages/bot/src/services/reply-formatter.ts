import { EmbedBuilder } from "discord.js";

const DISCORD_EMBED_DESCRIPTION_LIMIT = 3900;
const DISCORD_EMBED_TRUNCATED_SUFFIX = "\n\n…（長文のため途中で切れました。全文はキャッシュ詳細を確認してください。）";

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
    .setTitle("見つかりませんでした")
    .setDescription(
      `「${query}」は現在の辞書データに見つかりませんでした。\n別の単語で試すか、辞書がインポートされているか確認してください。`,
    )
    .setTimestamp();

  return { embeds: [embed] };
}

export function formatError(reason: string) {
  const embed = new EmbedBuilder()
    .setColor(0xff0000)
    .setTitle("エラーが発生しました")
    .setDescription(`${reason}\nしばらく経ってからもう一度試してください。`)
    .setTimestamp();

  return { embeds: [embed] };
}
