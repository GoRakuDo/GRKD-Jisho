import { SlashCommandBuilder, PermissionFlagsBits } from "discord.js";
import type { Command } from "./types.js";
import { resetUserUsage } from "../services/rate-limit-admin.service.js";

export const ratelimitResetCommand: Command = {
  builder: new SlashCommandBuilder()
    .setName("ratelimit-reset")
    .setDescription("特定ユーザーの今日の検索回数をリセット")
    .addUserOption((opt) =>
      opt.setName("user").setDescription("リセットするユーザー").setRequired(true),
    )
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild),
  requiresAdmin: true,
  async execute(interaction) {
    const user = interaction.options.getUser("user", true);
    if (!interaction.guildId) {
      await interaction.reply({
        content: "このコマンドはサーバー内でのみ使用できます。",
        ephemeral: true,
      });
      return;
    }

    const updated = await resetUserUsage(user.id, interaction.guildId);
    await interaction.reply({
      content: updated > 0
        ? `ユーザー <@${user.id}> の今日の検索回数をリセットしました。`
        : `ユーザー <@${user.id}> は今日まだ検索していません。`,
      ephemeral: true,
    });
  },
};
