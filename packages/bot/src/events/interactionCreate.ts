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
      const reason = err instanceof Error ? err.message : String(err);
      console.error(`[Interaction] Button "${interaction.customId}" failed: ${reason} → Check interaction handler`);
      const errorReply = {
        content: "Terjadi kesalahan saat memproses tombol.",
        ephemeral: true,
      };
      try {
        if (interaction.replied || interaction.deferred) {
          await interaction.followUp(errorReply);
        } else {
          await interaction.reply(errorReply);
        }
      } catch (replyErr) {
        const r2 = replyErr instanceof Error ? replyErr.message : String(replyErr);
        console.error(`[Interaction] Button error reply also failed: ${r2} → Cannot recover`);
      }
    }
    return;
  }

  // ── Modal submit ──
  if (interaction.isModalSubmit()) {
    try {
      await handleModalSubmit(interaction);
    } catch (err) {
      const reason = err instanceof Error ? err.message : String(err);
      console.error(`[Interaction] Modal "${interaction.customId}" failed: ${reason} → Check modal handler`);
      const errorReply = {
        content: "Terjadi kesalahan saat memproses modal.",
        ephemeral: true,
      };
      try {
        if (interaction.replied || interaction.deferred) {
          await interaction.followUp(errorReply);
        } else {
          await interaction.reply(errorReply);
        }
      } catch (replyErr) {
        const r2 = replyErr instanceof Error ? replyErr.message : String(replyErr);
        console.error(`[Interaction] Modal error reply also failed: ${r2} → Cannot recover`);
      }
    }
    return;
  }

  // ── Slash command ──
  if (!interaction.isChatInputCommand()) return;

  const cmd = getCommand(interaction.commandName);
  if (!cmd) {
    await interaction.reply({
      content: "Perintah tidak dikenal.",
      ephemeral: true,
    });
    return;
  }

  if (cmd.requiresAdmin && !isInteractionAdmin(interaction)) {
    await interaction.reply({
      content: "Anda tidak memiliki izin untuk menjalankan perintah ini (Khusus Administrator).",
      ephemeral: true,
    });
    return;
  }

  try {
    await cmd.execute(interaction);
  } catch (err) {
    const reason = err instanceof Error ? err.message : String(err);
    console.error(
      `[Interaction] Command "${interaction.commandName}" failed: ${reason} → Check command handler`,
    );
    const errorReply = {
      content: "Terjadi kesalahan saat menjalankan perintah.",
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
      content: "Dibatalkan.",
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
        content: "Channel tidak ditemukan. Kemungkinan channel telah dihapus.",
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
        content: `Berhasil menghapus ${deletedCount} pesan di channel <#${channelId}>.`,
        components: [],
      });
    } catch (err) {
      const reason = err instanceof Error ? err.message : String(err);
      console.error(`[Button] wipe-now failed for ${channelId}: ${reason} → Check permissions (MANAGE_MESSAGES)`);
      await interaction.editReply({
        content: "Gagal menghapus pesan. Silakan periksa izin Anda.",
        components: [],
      });
    }
    return;
  }

  // 未知のボタン
  await interaction.update({
    content: "Tombol tidak dapat diproses.",
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
      content: "Modal tidak dapat diproses.",
      ephemeral: true,
    });
    return;
  }

  if (!isInteractionAdmin(interaction)) {
    await interaction.reply({
      content: "Anda tidak memiliki izin untuk menjalankan perintah ini (Khusus Administrator).",
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
      content: "Teks kosong tidak dapat disimpan.",
      ephemeral: true,
    });
    return;
  }

  try {
    await updateResponse(responseId, newText, interaction.user.id, reason);
    await interaction.reply({
      content: `Pembaruan berhasil untuk ID ${responseId}. \`is_manual_override = true\``,
      ephemeral: true,
    });
  } catch (err) {
    const reason = err instanceof Error ? err.message : String(err);
    console.error(`[Modal] edit_jisho_${responseId} failed: ${reason} → Check response ID and DB`);
    await interaction.reply({
      content: "Terjadi kesalahan saat memperbarui.",
      ephemeral: true,
    });
  }
}
