import { EmbedBuilder } from "discord.js";

export function formatReply(text: string) {
  const embed = new EmbedBuilder()
    .setColor(0x00b7c3)
    .setDescription(text)
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
