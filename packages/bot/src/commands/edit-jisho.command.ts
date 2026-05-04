import {
  SlashCommandBuilder,
  ModalBuilder,
  TextInputBuilder,
  TextInputStyle,
  ActionRowBuilder,
} from "discord.js";
import type { Command } from "./types.js";
import { getResponseById } from "../services/response-admin.service.js";

export const editJishoCommand: Command = {
  builder: new SlashCommandBuilder()
    .setName("edit-jisho")
    .setDescription("生成済み回答をモーダルで編集")
    .addStringOption((opt) =>
      opt.setName("response-id").setDescription("回答ID").setRequired(true),
    )
    .setDefaultMemberPermissions(8), // ManageGuild
  requiresAdmin: true,
  async execute(interaction) {
    const rawId = interaction.options.getString("response-id", true).trim();
    const response = await getResponseById(rawId);
    if (!response) {
      await interaction.reply({
        content: `ID ${rawId} の回答が見つかりません。`,
        ephemeral: true,
      });
      return;
    }

    const modal = new ModalBuilder()
      .setCustomId(`edit_jisho_${rawId}`)
      .setTitle("回答を編集");

    const textInput = new TextInputBuilder()
      .setCustomId("response_text")
      .setLabel("回答テキスト")
      .setStyle(TextInputStyle.Paragraph)
      .setValue(response.responseText)
      .setRequired(true)
      .setMaxLength(4000);

    const reasonInput = new TextInputBuilder()
      .setCustomId("edit_reason")
      .setLabel("編集理由（省略可）")
      .setStyle(TextInputStyle.Short)
      .setRequired(false)
      .setMaxLength(200);

    const row1 = new ActionRowBuilder<TextInputBuilder>().addComponents(textInput);
    const row2 = new ActionRowBuilder<TextInputBuilder>().addComponents(reasonInput);

    modal.addComponents(row1, row2);
    await interaction.showModal(modal);
  },
};
