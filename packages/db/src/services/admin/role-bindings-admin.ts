/**
 * Role bindings administration services
 *
 * CRUD for Discord role ID → output bucket mappings per guild.
 */

import { db } from "../../client";
import { roleBindings, type RoleBinding, type OutputBucketKey } from "../../schema/role-bindings";
import { and, eq, sql } from "drizzle-orm";

/**
 * Get all role bindings for a guild
 */
export async function getRoleBindings(guildId: string): Promise<RoleBinding[]> {
  return await db
    .select()
    .from(roleBindings)
    .where(eq(roleBindings.guildId, guildId))
    .orderBy(roleBindings.discordRoleId);
}

/**
 * Upsert a role binding (create or update by guildId + discordRoleId).
 * Uses INSERT ON CONFLICT DO UPDATE for atomicity.
 */
export async function upsertRoleBinding(
  guildId: string,
  discordRoleId: string,
  outputBucketKey: OutputBucketKey,
): Promise<RoleBinding> {
  const [result] = await db
    .insert(roleBindings)
    .values({ guildId, discordRoleId, outputBucketKey })
    .onConflictDoUpdate({
      target: [roleBindings.guildId, roleBindings.discordRoleId],
      set: { outputBucketKey, updatedAt: sql`now()` },
    })
    .returning();
  if (!result) throw new Error("Failed to upsert role binding");
  return result;
}

/**
 * Delete a role binding by guildId + id.
 * Returns true if a row was deleted, false if id not found.
 */
export async function deleteRoleBinding(guildId: string, id: number): Promise<boolean> {
  const [deleted] = await db
    .delete(roleBindings)
    .where(and(eq(roleBindings.guildId, guildId), eq(roleBindings.id, id)))
    .returning();
  return deleted !== undefined;
}
