import { SlashCommandBuilder, PermissionFlagsBits } from "discord.js";
import type { Command } from "./types.js";
import { getLookupSource } from "../services/response-admin.service.js";

export const sourceJishoCommand: Command = {
  builder: new SlashCommandBuilder()
    .setName("source-jisho")
    .setDescription("単語がどの辞書から取得されたか確認")
    .addStringOption((opt) =>
      opt.setName("word").setDescription("単語").setRequired(true),
    )
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild),
  requiresAdmin: true,
  async execute(interaction) {
    const word = interaction.options.getString("word", true).trim();
    const sources = await getLookupSource(word);

    if (sources.length === 0) {
      await interaction.reply({
        content: `「${word}」の検索履歴はまだありません。`,
        ephemeral: true,
      });
      return;
    }

    const lines = sources.map(
      (s) =>
        `- **辞書:** ${s.dictionaryName ?? "不明"} | **Cache:** ${s.cacheId ?? "なし"} | **Hit:** ${s.cacheHit ? "✅" : "❌"} | **日時:** ${s.createdAt?.toISOString().slice(0, 19) ?? "---"}`,
    );

    await interaction.reply({
      content: `「${word}」の検索ソース（直近${sources.length}件）:\n${lines.join("\n")}`,
      ephemeral: true,
    });
  },
};
