import { type Interaction } from "discord.js";
import { getCommand } from "../commands/index.js";
import { isInteractionAdmin } from "../services/admin-permission.service.js";

export const interactionCreateHandler = async (
  interaction: Interaction,
): Promise<void> => {
  if (!interaction.isChatInputCommand()) return;

  const cmd = getCommand(interaction.commandName);
  if (!cmd) {
    await interaction.reply({
      content: "未知のコマンドです。",
      ephemeral: true,
    });
    return;
  }

  if (cmd.requiresAdmin && !isInteractionAdmin(interaction)) {
    await interaction.reply({
      content: "このコマンドを実行する権限がありません。",
      ephemeral: true,
    });
    return;
  }

  try {
    await cmd.execute(interaction);
  } catch (err) {
    console.error(
      `[Interaction] Command "${interaction.commandName}" failed:`,
      err,
    );
    const errorReply = {
      content: "コマンドの実行中にエラーが発生しました。",
      ephemeral: true,
    };
    if (interaction.replied || interaction.deferred) {
      await interaction.followUp(errorReply);
    } else {
      await interaction.reply(errorReply);
    }
  }
};
