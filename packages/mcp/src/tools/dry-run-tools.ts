import { and, desc, eq, sql } from "drizzle-orm";
import { db, schema } from "@grkd-jisho/db";
export async function dryRunRateLimitChange(params: {
  roleId: string;
  newDailyLimit: number;
  guildId?: string | undefined;
}) {
  const [current] = await db
    .select({
      discordRoleId: schema.roleRateLimits.discordRoleId,
      roleLabel: schema.roleRateLimits.roleLabel,
      dailyLimit: schema.roleRateLimits.dailyLimit,
      updatedAt: schema.roleRateLimits.updatedAt,
    })
    .from(schema.roleRateLimits)
    .where(eq(schema.roleRateLimits.discordRoleId, params.roleId));

  const usageRows = await db
    .select({
      userId: schema.userUsage.userId,
      guildId: schema.userUsage.guildId,
      usageDate: schema.userUsage.usageDate,
      count: schema.userUsage.count,
    })
    .from(schema.userUsage)
    .where(
      and(
        params.guildId ? eq(schema.userUsage.guildId, params.guildId) : sql`true`,
        sql`${schema.userUsage.usageDate} = (now() at time zone 'Asia/Jakarta')::date`,
      ),
    )
    .orderBy(desc(schema.userUsage.count))
    .limit(5000);

  const overNewLimit = usageRows.filter((r) => r.count > params.newDailyLimit);

  return {
    input: params,
    currentLimit: current ?? null,
    newLimit: params.newDailyLimit,
    todayRowsScanned: usageRows.length,
    usersOverNewLimit: overNewLimit.map((r) => ({
      userId: r.userId,
      guildId: r.guildId,
      count: r.count,
    })),
    affectedUsageRowCount: overNewLimit.length,
    notes: [
      "user_usage does not record role membership; this dry-run reports users already over the new limit today (Asia/Jakarta).",
      "Result is capped by query limit (5000 rows).",
    ],
  };
}

export async function dryRunCacheRefresh(params: {
  normalizedQuery: string;
  roleKey?: string | undefined;
  dictionaryId?: number | undefined;
}) {
  const whereParts = [eq(schema.responseCache.normalizedQuery, params.normalizedQuery)];
  if (params.roleKey) whereParts.push(eq(schema.responseCache.roleKey, params.roleKey));
  if (params.dictionaryId) whereParts.push(eq(schema.responseCache.dictionaryId, params.dictionaryId));

  const whereClause = and(...whereParts);

  const [counts] = await db
    .select({
      total: sql<number>`cast(count(*) as int)`,
      manual: sql<number>`cast(sum(case when ${schema.responseCache.isManualOverride} then 1 else 0 end) as int)`,
      deleteProtected: sql<number>`cast(sum(case when ${schema.responseCache.isDeleteProtected} then 1 else 0 end) as int)`,
    })
    .from(schema.responseCache)
    .where(whereClause);

  const sampleIds = await db
    .select({ id: schema.responseCache.id })
    .from(schema.responseCache)
    .where(whereClause)
    .orderBy(desc(schema.responseCache.updatedAt))
    .limit(20);

  const total = counts?.total ?? 0;
  const manual = counts?.manual ?? 0;
  const deleteProtected = counts?.deleteProtected ?? 0;
  const deletable = Math.max(0, total - deleteProtected);

  return {
    input: params,
    matchingCacheCount: total,
    manualOverrideCount: manual,
    deletableCount: deletable,
    sampleCacheIds: sampleIds.map((r) => String(r.id)),
    notes: [
      "dry-run only; delete-protected rows are not deletable and should never be removed by refresh.",
    ],
  };
}
