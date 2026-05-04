import { SlashCommandBuilder, PermissionFlagsBits } from "discord.js";
import type { Command } from "./types.js";
import { deleteCacheByQuery } from "../services/response-admin.service.js";

export const refreshJishoCommand: Command = {
  builder: new SlashCommandBuilder()
    .setName("refresh-jisho")
    .setDescription("生成済み回答を削除して次回再生成させる")
    .addStringOption((opt) =>
      opt.setName("word").setDescription("単語").setRequired(true),
    )
    .addStringOption((opt) =>
      opt
        .setName("role")
        .setDescription("ロールキー（pemula / pemula-atas / menengah / mahir）")
        .setRequired(false),
    )
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild),
  requiresAdmin: true,
  async execute(interaction) {
    const word = interaction.options.getString("word", true).trim();
    const roleKey = interaction.options.getString("role")?.trim() || undefined;

    const deleted = await deleteCacheByQuery(word, roleKey);
    if (deleted === 0) {
      await interaction.reply({
        content: `「${word}」の削除可能なキャッシュは見つかりませんでした（手動編集済みは対象外）。`,
        ephemeral: true,
      });
      return;
    }

    await interaction.reply({
      content: `「${word}」${roleKey ? `（${roleKey}）` : ""}のキャッシュ ${deleted}件を削除しました。次回検索時に再生成されます。`,
      ephemeral: true,
    });
  },
};
