import { PermissionsBitField, type ChatInputCommandInteraction, type ModalSubmitInteraction } from "discord.js";

/** 権限確認に必要なプロパティを持つ Interaction 型 */
type AdminCheckableInteraction =
  | ChatInputCommandInteraction
  | ModalSubmitInteraction;

/**
 * 管理者かどうかを判定する。
 * Discord の ManageGuild / Administrator 権限、または Guild Owner の場合に true。
 */
export function isInteractionAdmin(
  interaction: AdminCheckableInteraction,
): boolean {
  if (!interaction.member) return false;
  if (interaction.guild?.ownerId === interaction.user.id) return true;

  const member = interaction.member;
  if (!("permissions" in member)) return false;

  const perms =
    typeof member.permissions === "string"
      ? new PermissionsBitField(BigInt(member.permissions))
      : member.permissions;

  return perms.has("ManageGuild") || perms.has("Administrator");
}
