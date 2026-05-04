import { eq, and, inArray } from "drizzle-orm";
import { sql } from "drizzle-orm";
import { db, schema } from "@grkd-jisho/db";
import { toGMT7Date } from "./date-utils.js";

interface RateLimitParams {
  userId: string;
  guildId: string;
  memberRoles: string[];
  isOwner: boolean;
  hasAdminPermission: boolean;
}

interface RateLimitResult {
  allowed: boolean;
  remaining: number;
  limit: number;
}

export async function checkRateLimit(
  params: RateLimitParams,
): Promise<RateLimitResult> {
  if (params.isOwner || params.hasAdminPermission) {
    return { allowed: true, remaining: Infinity, limit: Infinity };
  }

  // 空配列の場合は DB クエリを飛ばさずデフォルト制限を使う
  let roleLimit: number | null = null;
  if (params.memberRoles.length > 0) {
    const roleLimits = await db
      .select()
      .from(schema.roleRateLimits)
      .where(inArray(schema.roleRateLimits.discordRoleId, params.memberRoles));
    if (roleLimits.length > 0) {
      roleLimit = Math.max(...roleLimits.map((r) => r.dailyLimit));
    }
  }

  const limit = roleLimit ?? await getDefaultDailyLimit();

  if (limit === -1) {
    return { allowed: true, remaining: Infinity, limit: -1 };
  }

  const today = toGMT7Date(new Date());
  const [usage] = await db
    .select()
    .from(schema.userUsage)
    .where(
      and(
        eq(schema.userUsage.userId, params.userId),
        eq(schema.userUsage.guildId, params.guildId),
        eq(schema.userUsage.usageDate, today),
      ),
    );

  const currentCount = usage?.count ?? 0;
  const allowed = currentCount < limit;

  return {
    allowed,
    remaining: Math.max(0, limit - currentCount),
    limit,
  };
}

export async function incrementUsage(params: {
  userId: string;
  guildId: string;
}): Promise<void> {
  const today = toGMT7Date(new Date());
  await db
    .insert(schema.userUsage)
    .values({
      userId: params.userId,
      guildId: params.guildId,
      usageDate: today,
      count: 1,
    })
    .onConflictDoUpdate({
      target: [
        schema.userUsage.userId,
        schema.userUsage.guildId,
        schema.userUsage.usageDate,
      ],
      set: { count: sql`${schema.userUsage.count} + 1` },
    });
}

async function getDefaultDailyLimit(): Promise<number> {
  const [defaultRecord] = await db
    .select()
    .from(schema.roleRateLimits)
    .where(eq(schema.roleRateLimits.discordRoleId, "__default__"))
    .limit(1);

  return defaultRecord?.dailyLimit ?? 10;
}
