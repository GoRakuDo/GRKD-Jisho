import { eq, and, asc, sql, gt } from "drizzle-orm";
import { db, schema } from "@grkd-jisho/db";
import { toGMT7Date } from "./date-utils.js";

export async function setRoleLimit(
  roleId: string,
  label: string | null,
  limit: number,
): Promise<void> {
  await db
    .insert(schema.roleRateLimits)
    .values({
      discordRoleId: roleId,
      roleLabel: label,
      dailyLimit: limit,
    })
    .onConflictDoUpdate({
      target: schema.roleRateLimits.discordRoleId,
      set: {
        dailyLimit: limit,
        roleLabel: label,
        updatedAt: sql`now()`,
      },
    });
}

export async function getRoleLimits() {
  return db
    .select()
    .from(schema.roleRateLimits)
    .orderBy(asc(schema.roleRateLimits.dailyLimit));
}

export async function resetUserUsage(
  userId: string,
  guildId: string,
): Promise<number> {
  const today = toGMT7Date(new Date());

  const result = await db
    .update(schema.userUsage)
    .set({ count: 0 })
    .where(
      and(
        eq(schema.userUsage.userId, userId),
        eq(schema.userUsage.guildId, guildId),
        eq(schema.userUsage.usageDate, today),
        gt(schema.userUsage.count, 0),
      ),
    )
    .returning({ id: schema.userUsage.id });

  return result.length;
}
