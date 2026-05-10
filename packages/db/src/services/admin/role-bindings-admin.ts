/**
 * Role bindings administration services
 *
 * CRUD for Discord role name → system role key mappings per guild.
 */

import { db } from "../../client";
import { roleBindings, type RoleBinding, type NewRoleBinding } from "../../schema/role-bindings";
import { eq, and } from "drizzle-orm";

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
 * Upsert a role binding (create or update by guildId + discordRoleName)
 */
export async function upsertRoleBinding(
  guildId: string,
  discordRoleName: string,
  systemRoleKey: string,
): Promise<RoleBinding> {
  const existing = await db
    .select()
    .from(roleBindings)
    .where(
      and(
        eq(roleBindings.guildId, guildId),
        eq(roleBindings.discordRoleName, discordRoleName),
      ),
    )
    .limit(1);

  if (existing.length > 0) {
    const existingRow = existing[0]!;
    const [updated] = await db
      .update(roleBindings)
      .set({ systemRoleKey, updatedAt: new Date() })
      .where(eq(roleBindings.id, existingRow.id))
      .returning();
    if (!updated) throw new Error("Failed to update role binding");
    return updated;
  }

  const newBinding: NewRoleBinding = { guildId, discordRoleName, systemRoleKey };
  const [created] = await db.insert(roleBindings).values(newBinding).returning();
  if (!created) throw new Error("Failed to create role binding");
  return created;
}

/**
 * Delete a role binding by id
 * Returns true if a row was deleted, false if id not found.
 */
export async function deleteRoleBinding(id: number): Promise<boolean> {
  const [deleted] = await db.delete(roleBindings).where(eq(roleBindings.id, id)).returning();
  return deleted !== undefined;
}
