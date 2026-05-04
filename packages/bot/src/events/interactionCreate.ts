import {
  type Interaction,
  type ModalSubmitInteraction,
  type ButtonInteraction,
  TextChannel,
} from "discord.js";
import { getCommand } from "../commands/index.js";
import { isInteractionAdmin } from "../services/admin-permission.service.js";
import { updateResponse } from "../services/response-admin.service.js";
import { wipeChannel } from "../services/channel-wipe.service.js";
import { traceEvent } from "../services/observability.service.js";

export const interactionCreateHandler = async (
  interaction: Interaction,
): Promise<void> => {
  // ── Button ──
  if (interaction.isButton()) {
    try {
      await handleButtonInteraction(interaction);
    } catch (err) {
      console.error(`[Interaction] Button "${interaction.customId}" failed:`, err);
      const errorReply = {
        content: "ボタン処理中にエラーが発生しました。",
        ephemeral: true,
      };
      try {
        if (interaction.replied || interaction.deferred) {
          await interaction.followUp(errorReply);
        } else {
          await interaction.reply(errorReply);
        }
      } catch (replyErr) {
        console.error("[Interaction] Failed to send button error reply:", replyErr);
      }
    }
    return;
  }

  // ── Modal submit ──
  if (interaction.isModalSubmit()) {
    try {
      await handleModalSubmit(interaction);
    } catch (err) {
      console.error(`[Interaction] Modal "${interaction.customId}" failed:`, err);
      const errorReply = {
        content: "モーダル処理中にエラーが発生しました。",
        ephemeral: true,
      };
      try {
        if (interaction.replied || interaction.deferred) {
          await interaction.followUp(errorReply);
        } else {
          await interaction.reply(errorReply);
        }
      } catch (replyErr) {
        console.error("[Interaction] Failed to send modal error reply:", replyErr);
      }
    }
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

/** `/wipe-now` の確認ボタンを処理する。 */
async function handleButtonInteraction(
  interaction: ButtonInteraction,
): Promise<void> {
  const customId = interaction.customId;

  // キャンセル
  if (customId === "wipe_now_cancel") {
    await interaction.update({
      content: "キャンセルしました。",
      components: [],
    });
    return;
  }

  // wipe-now 確認
  if (customId.startsWith("wipe_now_confirm_")) {
    const channelId = customId.replace("wipe_now_confirm_", "");
    const channel = interaction.client.channels.cache.get(channelId);

    if (!(channel instanceof TextChannel)) {
      await interaction.update({
        content: "チャンネルが見つかりません。削除された可能性があります。",
        components: [],
      });
      return;
    }

    // 先に deferUpdate で 3秒 timeout を回避する
    await interaction.deferUpdate();

    try {
      const { deletedCount } = await wipeChannel(channel);
      const traceId = `wipe_cmd_${channel.id}_${Date.now()}`;
      await traceEvent(traceId, "wipe.command_executed", "info", {
        channelId: channel.id,
        deletedCount,
        triggeredBy: interaction.user.id,
      });
      await interaction.editReply({
        content: `チャンネル <#${channelId}> のメッセージ ${deletedCount}件を削除しました。`,
        components: [],
      });
    } catch (err) {
      console.error(`[Button] wipe-now failed for ${channelId}:`, err);
      await interaction.editReply({
        content: `削除に失敗しました。権限を確認してください。`,
        components: [],
      });
    }
    return;
  }

  // 未知のボタン
  await interaction.update({
    content: "処理できないボタンです。",
    components: [],
  });
}

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
