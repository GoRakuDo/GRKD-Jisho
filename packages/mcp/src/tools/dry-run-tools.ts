import { and, desc, eq, gte, sql } from "drizzle-orm";
import { db, schema } from "@grkd-jisho/db";
import { redactDeep } from "../utils/redact.js";

function daysAgo(days: number): Date {
  return new Date(Date.now() - (days * 24 * 60 * 60 * 1000));
}

export async function dryRunWipe(params: { guildId: string; channelId: string }) {
  const [setting] = await db
    .select({
      guildId: schema.channelSettings.guildId,
      channelId: schema.channelSettings.channelId,
      wipeEnabled: schema.channelSettings.wipeEnabled,
      lastWipeAt: schema.channelSettings.lastWipeAt,
      updatedAt: schema.channelSettings.updatedAt,
    })
    .from(schema.channelSettings)
    .where(
      and(
        eq(schema.channelSettings.guildId, params.guildId),
        eq(schema.channelSettings.channelId, params.channelId),
      ),
    );

  const wipeEvents = await db
    .select({
      traceId: schema.botEvents.traceId,
      level: schema.botEvents.level,
      eventType: schema.botEvents.eventType,
      payloadJson: schema.botEvents.payloadJson,
      createdAt: schema.botEvents.createdAt,
    })
    .from(schema.botEvents)
    .where(
      and(
        gte(schema.botEvents.createdAt, daysAgo(14)),
        sql`${schema.botEvents.eventType} like 'wipe.%'`,
      ),
    )
    .orderBy(desc(schema.botEvents.createdAt))
    .limit(50);

  return {
    input: params,
    channelSetting: setting ?? null,
    recentWipeEvents: wipeEvents.map((row) => ({
      ...row,
      payloadJson: redactDeep(row.payloadJson),
    })),
    wouldRequireBotFinalCheck: true,
    notes: [
      "MCP dry-run does not call Discord API; pins and current bot permissions must be re-checked at execution time by the bot.",
    ],
  };
}

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
