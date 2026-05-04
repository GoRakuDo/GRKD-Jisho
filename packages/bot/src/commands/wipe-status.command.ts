import { SlashCommandBuilder, PermissionFlagsBits } from "discord.js";
import type { Command } from "./types.js";
import { getChannelSettings } from "../services/wipe-admin.service.js";

export const wipeStatusCommand: Command = {
  builder: new SlashCommandBuilder()
    .setName("wipe-status")
    .setDescription("全チャンネルの自動消去設定を表示")
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild),
  requiresAdmin: true,
  async execute(interaction) {
    if (!interaction.guildId) {
      await interaction.reply({
        content: "このコマンドはサーバー内でのみ使用できます。",
        ephemeral: true,
      });
      return;
    }

    const settings = await getChannelSettings(interaction.guildId);

    if (settings.length === 0) {
      await interaction.reply({
        content: "チャンネル設定がありません。",
        ephemeral: true,
      });
      return;
    }

    const lines = settings.map(
      (s) =>
        `- <#${s.channelId}> | ${s.wipeEnabled ? "✅ ON" : "⛔ OFF"} | 最終: ${s.lastWipeAt?.toISOString().slice(0, 19) ?? "なし"} | ID: \`${s.channelId}\``,
    );

    await interaction.reply({
      content: `チャンネル自動消去設定:\n${lines.join("\n")}`,
      ephemeral: true,
    });
  },
};
