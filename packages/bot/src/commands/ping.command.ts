import { SlashCommandBuilder } from "discord.js";
import type { Command } from "./types.js";

export const pingCommand: Command = {
  builder: new SlashCommandBuilder()
    .setName("ping")
    .setDescription("Bot の応答確認"),
  requiresAdmin: false,
  async execute(interaction) {
    await interaction.reply({
      content: "pong!",
      ephemeral: true,
    });
  },
};
