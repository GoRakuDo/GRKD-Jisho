import { type Interaction, type ModalSubmitInteraction } from "discord.js";
import { getCommand } from "../commands/index.js";
import { isInteractionAdmin } from "../services/admin-permission.service.js";
import { updateResponse } from "../services/response-admin.service.js";

export const interactionCreateHandler = async (
  interaction: Interaction,
): Promise<void> => {
  // ── Modal submit ──
  if (interaction.isModalSubmit()) {
    await handleModalSubmit(interaction);
    return;
  }

  // ── Slash command ──
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

/** `/edit-jisho` のモーダル送信を処理する。 */
async function handleModalSubmit(
  interaction: ModalSubmitInteraction,
): Promise<void> {
  const customId = interaction.customId;

  if (!customId.startsWith("edit_jisho_")) {
    await interaction.reply({
      content: "処理できないモーダルです。",
      ephemeral: true,
    });
    return;
  }

  if (!isInteractionAdmin(interaction)) {
    await interaction.reply({
      content: "権限がありません。",
      ephemeral: true,
    });
    return;
  }

  const responseId = customId.replace("edit_jisho_", "");
  const newText = interaction.fields.getTextInputValue("response_text");
  const reason =
    interaction.fields.getTextInputValue("edit_reason") || undefined;

  if (!newText.trim()) {
    await interaction.reply({
      content: "空のテキストは保存できません。",
      ephemeral: true,
    });
    return;
  }

  try {
    await updateResponse(responseId, newText, interaction.user.id, reason);
    await interaction.reply({
      content: `ID ${responseId} の回答を更新しました。\`is_manual_override = true\``,
      ephemeral: true,
    });
  } catch (err) {
    console.error(`[Modal] edit_jisho_${responseId} failed:`, err);
    await interaction.reply({
      content: "更新中にエラーが発生しました。",
      ephemeral: true,
    });
  }
}
