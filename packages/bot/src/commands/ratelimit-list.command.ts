import { SlashCommandBuilder, PermissionFlagsBits } from "discord.js";
import type { Command } from "./types.js";
import { getRoleLimits } from "../services/rate-limit-admin.service.js";

export const ratelimitListCommand: Command = {
  builder: new SlashCommandBuilder()
    .setName("ratelimit-list")
    .setDescription("ロール別検索上限の一覧を表示")
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild),
  requiresAdmin: true,
  async execute(interaction) {
    const limits = await getRoleLimits();

    if (limits.length === 0) {
      await interaction.reply({
        content: "ロール別上限が設定されていません。",
        ephemeral: true,
      });
      return;
    }

    const lines = limits.map(
      (r) =>
        `- \`${r.discordRoleId}\`${r.roleLabel ? ` (${r.roleLabel})` : ""}: ${r.dailyLimit === -1 ? "無制限" : `${r.dailyLimit}回/日`}`,
    );

    await interaction.reply({
      content: `ロール別検索上限:\n${lines.join("\n")}`,
      ephemeral: true,
    });
  },
};
