import { SlashCommandBuilder, PermissionFlagsBits } from "discord.js";
import type { Command } from "./types.js";
import { searchResponse } from "../services/response-admin.service.js";
import { getOutputBucketLabel } from "@grkd-jisho/db";

export const searchJishoCommand: Command = {
  builder: new SlashCommandBuilder()
    .setName("search-jisho")
    .setDescription("生成済み回答を検索")
    .addStringOption((opt) =>
      opt.setName("word").setDescription("検索語").setRequired(true),
    )
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild),
  requiresAdmin: true,
  async execute(interaction) {
    const word = interaction.options.getString("word", true).trim();
    if (!word) {
      await interaction.reply({ content: "検索語を入力してください。", ephemeral: true });
      return;
    }

    const results = await searchResponse(word);
    if (results.length === 0) {
      await interaction.reply({ content: `「${word}」の生成済み回答は見つかりませんでした。`, ephemeral: true });
      return;
    }

    const lines = results.map(
      (r) =>
        `**#${r.id}** | ${getOutputBucketLabel(r.roleKey)} | ${r.modelName} | v${r.promptVersion}${r.isManualOverride ? " | ✏️手動" : ""} | ${r.updatedAt?.toISOString().slice(0, 10) ?? "---"}\n\`\`\`${r.responseText.slice(0, 80)}...\`\`\``,
    );

    await interaction.reply({
      content: `「${word}」の検索結果（${results.length}件）:\n\n${lines.slice(0, 10).join("\n")}`,
      ephemeral: true,
    });
  },
};
