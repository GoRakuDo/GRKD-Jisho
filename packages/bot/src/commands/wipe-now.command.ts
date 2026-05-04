import {
  SlashCommandBuilder,
  ChannelType,
  ButtonBuilder,
  ButtonStyle,
  ActionRowBuilder,
} from "discord.js";
import type { Command } from "./types.js";
import { getChannelSetting } from "../services/wipe-admin.service.js";

export const wipeNowCommand: Command = {
  builder: new SlashCommandBuilder()
    .setName("wipe-now")
    .setDescription("指定チャンネルを即時消去（確認ボタン付き）")
    .addChannelOption((opt) =>
      opt
        .setName("channel")
        .setDescription("対象チャンネル")
        .addChannelTypes(ChannelType.GuildText)
        .setRequired(true),
    )
    .setDefaultMemberPermissions(8),
  requiresAdmin: true,
  async execute(interaction) {
    if (!interaction.guildId) {
      await interaction.reply({
        content: "このコマンドはサーバー内でのみ使用できます。",
        ephemeral: true,
      });
      return;
    }

    const channel = interaction.options.getChannel("channel", true);

    // wipe_enabled が true 以外のチャンネルでは実行しない
    const setting = await getChannelSetting(channel.id);
    if (!setting?.wipeEnabled) {
      await interaction.reply({
        content: `チャンネル <#${channel.id}> は自動消去が有効ではありません。先に \`/wipe-channel\` で ON にしてください。`,
        ephemeral: true,
      });
      return;
    }

    const confirm = new ButtonBuilder()
      .setCustomId(`wipe_now_confirm_${channel.id}`)
      .setLabel("確認して実行")
      .setStyle(ButtonStyle.Danger);

    const cancel = new ButtonBuilder()
      .setCustomId("wipe_now_cancel")
      .setLabel("キャンセル")
      .setStyle(ButtonStyle.Secondary);

    const row = new ActionRowBuilder<ButtonBuilder>().addComponents(confirm, cancel);

    await interaction.reply({
      content: `チャンネル <#${channel.id}> のメッセージ（直近24時間、ピン留めは保持）を全て削除します。よろしいですか？`,
      components: [row],
      ephemeral: true,
    });
  },
};
