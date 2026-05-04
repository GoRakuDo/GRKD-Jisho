import { SlashCommandBuilder } from "discord.js";
import type { Command } from "./types.js";
import { setRoleLimit } from "../services/rate-limit-admin.service.js";

export const ratelimitSetCommand: Command = {
  builder: new SlashCommandBuilder()
    .setName("ratelimit-set")
    .setDescription("ロール別の1日あたり検索上限を設定")
    .addStringOption((opt) =>
      opt
        .setName("role-id")
        .setDescription("DiscordロールID または __default__")
        .setRequired(true),
    )
    .addIntegerOption((opt) =>
      opt
        .setName("limit")
        .setDescription("上限回数（-1で無制限）")
        .setRequired(true)
        .setMinValue(-1),
    )
    .setDefaultMemberPermissions(8),
  requiresAdmin: true,
  async execute(interaction) {
    const roleId = interaction.options.getString("role-id", true).trim();
    const limit = interaction.options.getInteger("limit", true);

    if (!roleId) {
      await interaction.reply({
        content: "ロールIDを入力してください。",
        ephemeral: true,
      });
      return;
    }

    await setRoleLimit(roleId, null, limit);
    await interaction.reply({
      content: `ロール \`${roleId}\` の1日あたり上限を ${limit === -1 ? "無制限" : `${limit}回`} に設定しました。`,
      ephemeral: true,
    });
  },
};
