/**
 * Role bindings administration services
 *
 * CRUD for Discord role name → system role key mappings per guild.
 */

import { db } from "../../client";
import { roleBindings, type RoleBinding } from "../../schema/role-bindings";
import { eq, sql } from "drizzle-orm";

/**
 * Get all role bindings for a guild
 */
export async function getRoleBindings(guildId: string): Promise<RoleBinding[]> {
  return await db
    .select()
    .from(roleBindings)
    .where(eq(roleBindings.guildId, guildId))
    .orderBy(roleBindings.discordRoleName);
}

/**
 * Upsert a role binding (create or update by guildId + discordRoleName).
 * Uses INSERT ON CONFLICT DO UPDATE for atomicity.
 */
export async function upsertRoleBinding(
  guildId: string,
  discordRoleName: string,
  systemRoleKey: string,
): Promise<RoleBinding> {
  const [result] = await db
    .insert(roleBindings)
    .values({ guildId, discordRoleName, systemRoleKey })
    .onConflictDoUpdate({
      target: [roleBindings.guildId, roleBindings.discordRoleName],
      set: { systemRoleKey, updatedAt: sql`now()` },
    })
    .returning();
  if (!result) throw new Error("Failed to upsert role binding");
  return result;
}

/**
 * Delete a role binding by id
 * Returns true if a row was deleted, false if id not found.
 */
export async function deleteRoleBinding(id: number): Promise<boolean> {
  const [deleted] = await db.delete(roleBindings).where(eq(roleBindings.id, id)).returning();
  return deleted !== undefined;
}
