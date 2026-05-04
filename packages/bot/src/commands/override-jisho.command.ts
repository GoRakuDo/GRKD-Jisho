import { SlashCommandBuilder } from "discord.js";
import type { Command } from "./types.js";
import {
  getResponseById,
  updateResponse,
} from "../services/response-admin.service.js";

export const overrideJishoCommand: Command = {
  builder: new SlashCommandBuilder()
    .setName("override-jisho")
    .setDescription("回答を短いテキストで即時上書き")
    .addStringOption((opt) =>
      opt.setName("response-id").setDescription("回答ID").setRequired(true),
    )
    .addStringOption((opt) =>
      opt.setName("text").setDescription("新しい回答テキスト").setRequired(true),
    )
    .setDefaultMemberPermissions(8), // ManageGuild
  requiresAdmin: true,
  async execute(interaction) {
    const rawId = interaction.options.getString("response-id", true).trim();
    const text = interaction.options.getString("text", true);

    const response = await getResponseById(rawId);
    if (!response) {
      await interaction.reply({
        content: `ID ${rawId} の回答が見つかりません。`,
        ephemeral: true,
      });
      return;
    }

    if (text.length > 4000) {
      await interaction.reply({
        content: "テキストが長すぎます（最大4000文字）。長文は `/edit-jisho` のモーダルを使ってください。",
        ephemeral: true,
      });
      return;
    }

    await updateResponse(rawId, text, interaction.user.id, "override-jisho command");
    await interaction.reply({
      content: `ID ${rawId} の回答を上書きしました。\`is_manual_override = true\` になりました。`,
      ephemeral: true,
    });
  },
};
