import { eq, and, inArray, gt, sql } from "drizzle-orm";
import { db, schema } from "@grkd-jisho/db";
import { toGMT7Date } from "./date-utils.js";

interface RateLimitParams {
  userId: string;
  guildId: string;
  memberRoles: string[];
  isOwner: boolean;
  hasAdminPermission: boolean;
  includeFreeUser?: boolean;
}

interface RateLimitResult {
  allowed: boolean;
  remaining: number;
  limit: number;
  /** true only when no member role row matched; Owner/Admin omit this flag */
  freeUser?: boolean;
}

export interface FreePoolReservation {
  usageDate: string;
}

export async function checkRateLimit(
  params: RateLimitParams,
): Promise<RateLimitResult> {
  if (params.isOwner || params.hasAdminPermission) {
    return { allowed: true, remaining: Infinity, limit: Infinity };
  }

  // 空配列の場合は DB クエリを飛ばさずデフォルト制限を使う
  let roleLimit: number | null = null;
  let hasMemberRole = false;
  if (params.memberRoles.length > 0) {
    const roleLimits = await db
      .select()
      .from(schema.roleRateLimits)
      .where(inArray(schema.roleRateLimits.discordRoleId, params.memberRoles));
    if (roleLimits.length > 0) {
      hasMemberRole = true;
      roleLimit = Math.max(...roleLimits.map((r) => r.dailyLimit));
    }
  }

  const limit = roleLimit ?? await getDefaultDailyLimit();

  if (limit === -1) {
    return {
      allowed: true,
      remaining: Infinity,
      limit: -1,
      ...(params.includeFreeUser ? { freeUser: !hasMemberRole } : {}),
    };
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
    ...(params.includeFreeUser ? { freeUser: !hasMemberRole } : {}),
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

/**
 * Atomically reserves one free-pool slot. The conditional conflict update
 * locks the daily row and only succeeds while committed + in-flight usage is
 * below the configured __default__ dailyLimit.
 */
export async function reserveFreePool(): Promise<FreePoolReservation | null> {
  const limit = await getConfiguredDefaultDailyLimit();
  if (limit === null || limit === 0) {
    return null;
  }

  const today = toGMT7Date(new Date());
  const insert = db
    .insert(schema.freePoolUsage)
    .values({ usageDate: today, count: 0, reservedCount: 1 })
    .onConflictDoUpdate({
      target: schema.freePoolUsage.usageDate,
      set: {
        reservedCount: sql`${schema.freePoolUsage.reservedCount} + 1`,
      },
      ...(limit === -1
        ? {}
        : {
            setWhere: sql`${schema.freePoolUsage.count} + ${schema.freePoolUsage.reservedCount} < ${limit}`,
          }),
    });

  const [reserved] = await insert
    .returning({ usageDate: schema.freePoolUsage.usageDate });

  return reserved ? { usageDate: reserved.usageDate } : null;
}

/** Mark a successful generation as consumed and release its in-flight slot. */
export async function commitFreePoolReservation(
  reservation: FreePoolReservation,
): Promise<void> {
  await db
    .update(schema.freePoolUsage)
    .set({
      count: sql`${schema.freePoolUsage.count} + 1`,
      reservedCount: sql`${schema.freePoolUsage.reservedCount} - 1`,
    })
    .where(
      and(
        eq(schema.freePoolUsage.usageDate, reservation.usageDate),
        gt(schema.freePoolUsage.reservedCount, 0),
      ),
    );
}

/** Release a slot when the one-shot free-model generation fails. */
export async function releaseFreePoolReservation(
  reservation: FreePoolReservation,
): Promise<void> {
  await db
    .update(schema.freePoolUsage)
    .set({
      reservedCount: sql`${schema.freePoolUsage.reservedCount} - 1`,
    })
    .where(
      and(
        eq(schema.freePoolUsage.usageDate, reservation.usageDate),
        gt(schema.freePoolUsage.reservedCount, 0),
      ),
    );
}

async function getDefaultDailyLimit(): Promise<number> {
  return (await getConfiguredDefaultDailyLimit()) ?? 10;
}

async function getConfiguredDefaultDailyLimit(): Promise<number | null> {
  const [defaultRecord] = await db
    .select()
    .from(schema.roleRateLimits)
    .where(eq(schema.roleRateLimits.discordRoleId, "__default__"))
    .limit(1);

  return defaultRecord?.dailyLimit ?? null;
}
