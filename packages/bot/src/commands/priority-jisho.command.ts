import { SlashCommandBuilder, PermissionFlagsBits } from "discord.js";
import type { Command } from "./types.js";
import { getDictionaryList } from "../services/response-admin.service.js";

export const priorityJishoCommand: Command = {
  builder: new SlashCommandBuilder()
    .setName("priority-jisho")
    .setDescription("辞書の優先順位一覧を表示")
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild),
  requiresAdmin: true,
  async execute(interaction) {
    const dicts = await getDictionaryList();
    if (dicts.length === 0) {
      await interaction.reply({
        content: "辞書が登録されていません。",
        ephemeral: true,
      });
      return;
    }

    const lines = dicts.map(
      (d) =>
        `**#${d.priority}** | ${d.name} (\`${d.slug}\`) | ${d.enabled ? "✅有効" : "⛔無効"} | ${d.createdAt?.toISOString().slice(0, 10) ?? "---"}`,
    );

    await interaction.reply({
      content: `辞書一覧:\n${lines.join("\n")}`,
      ephemeral: true,
    });
  },
};
