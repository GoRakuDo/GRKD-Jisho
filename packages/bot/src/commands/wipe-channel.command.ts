import { SlashCommandBuilder, ChannelType, PermissionFlagsBits } from "discord.js";
import type { Command } from "./types.js";
import { setWipeEnabled } from "../services/wipe-admin.service.js";

export const wipeChannelCommand: Command = {
  builder: new SlashCommandBuilder()
    .setName("wipe-channel")
    .setDescription("チャンネルの自動消去を ON/OFF")
    .addChannelOption((opt) =>
      opt
        .setName("channel")
        .setDescription("対象チャンネル")
        .addChannelTypes(ChannelType.GuildText)
        .setRequired(true),
    )
    .addBooleanOption((opt) =>
      opt
        .setName("enabled")
        .setDescription("自動消去を有効にする")
        .setRequired(true),
    )
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild),
  requiresAdmin: true,
  async execute(interaction) {
    const channel = interaction.options.getChannel("channel", true);
    const enabled = interaction.options.getBoolean("enabled", true);

    if (!interaction.guildId) {
      await interaction.reply({
        content: "このコマンドはサーバー内でのみ使用できます。",
        ephemeral: true,
      });
      return;
    }

    await setWipeEnabled(interaction.guildId, channel.id, enabled);
    await interaction.reply({
      content: `チャンネル <#${channel.id}> の自動消去を ${enabled ? "ON" : "OFF"} にしました。`,
      ephemeral: true,
    });
  },
};
