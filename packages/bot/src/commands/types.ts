import type {
  SlashCommandBuilder,
  ChatInputCommandInteraction,
} from "discord.js";

export interface Command {
  builder: SlashCommandBuilder;
  execute: (interaction: ChatInputCommandInteraction) => Promise<void>;
  requiresAdmin: boolean;
}
