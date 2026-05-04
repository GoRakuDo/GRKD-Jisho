import { PermissionsBitField, type ChatInputCommandInteraction } from "discord.js";

/**
 * 管理者かどうかを判定する。
 * Discord の ManageGuild / Administrator 権限、または Guild Owner の場合に true。
 */
export function isInteractionAdmin(
  interaction: ChatInputCommandInteraction,
): boolean {
  if (!interaction.member) return false;
  if (interaction.guild?.ownerId === interaction.user.id) return true;

  const member = interaction.member;
  if (!("permissions" in member)) return false;

  // APIInteractionGuildMember の permissions は文字列の場合がある
  const perms =
    typeof member.permissions === "string"
      ? new PermissionsBitField(BigInt(member.permissions))
      : member.permissions;

  return perms.has("ManageGuild") || perms.has("Administrator");
}
