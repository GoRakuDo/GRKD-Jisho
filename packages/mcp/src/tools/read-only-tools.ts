import { and, desc, eq, gte, inArray, sql } from "drizzle-orm";
import { db, schema } from "@grkd-jisho/db";
import { redactDeep } from "../utils/redact.js";

function daysAgo(days: number): Date {
  return new Date(Date.now() - (days * 24 * 60 * 60 * 1000));
}

export async function getHealth() {
  const now = new Date();
  const heartbeatThreshold = new Date(now.getTime() - (5 * 60 * 1000));

  const [dbCheck] = await db.execute(sql`select 1 as ok`);

  const recentHeartbeats = await db
    .select({
      serviceName: schema.botHeartbeats.serviceName,
      instanceId: schema.botHeartbeats.instanceId,
      status: schema.botHeartbeats.status,
      lastSeenAt: schema.botHeartbeats.lastSeenAt,
    })
    .from(schema.botHeartbeats)
    .where(gte(schema.botHeartbeats.lastSeenAt, heartbeatThreshold))
    .orderBy(desc(schema.botHeartbeats.lastSeenAt))
    .limit(20);

  const [errorCountRow] = await db
    .select({ count: sql<number>`cast(count(*) as int)` })
    .from(schema.botEvents)
    .where(
      and(
        eq(schema.botEvents.level, "error"),
        gte(schema.botEvents.createdAt, heartbeatThreshold),
      ),
    );

  const errorCount = errorCountRow?.count ?? 0;
  const degraded = recentHeartbeats.length === 0 || errorCount > 0;

  return {
    db: { ok: dbCheck !== undefined },
    heartbeats: recentHeartbeats,
    recentErrorCount: errorCount,
    degraded,
  };
}

export async function getRecentErrors(params: { limit: number; level?: "warn" | "error" | undefined }) {
  const whereClause = params.level
    ? eq(schema.botEvents.level, params.level)
    : inArray(schema.botEvents.level, ["warn", "error"]);

  const rows = await db
    .select({
      traceId: schema.botEvents.traceId,
      level: schema.botEvents.level,
      eventType: schema.botEvents.eventType,
      payloadJson: schema.botEvents.payloadJson,
      createdAt: schema.botEvents.createdAt,
    })
    .from(schema.botEvents)
    .where(whereClause)
    .orderBy(desc(schema.botEvents.createdAt))
    .limit(params.limit);

  return rows.map((row) => ({
    ...row,
    payloadJson: redactDeep(row.payloadJson),
  }));
}

export async function getTrace(traceId: string) {
  const rows = await db
    .select({
      traceId: schema.botEvents.traceId,
      level: schema.botEvents.level,
      eventType: schema.botEvents.eventType,
      payloadJson: schema.botEvents.payloadJson,
      durationMs: schema.botEvents.durationMs,
      createdAt: schema.botEvents.createdAt,
    })
    .from(schema.botEvents)
    .where(eq(schema.botEvents.traceId, traceId))
    .orderBy(schema.botEvents.createdAt);

  return rows.map((row) => ({
    ...row,
    payloadJson: redactDeep(row.payloadJson),
  }));
}

export async function getLookupStats(days: number) {
  const since = daysAgo(days);

  const [lookupCountRow] = await db
    .select({ count: sql<number>`cast(count(*) as int)` })
    .from(schema.lookupLogs)
    .where(gte(schema.lookupLogs.createdAt, since));

  const [uniqueUsersRow] = await db
    .select({ count: sql<number>`cast(count(distinct ${schema.lookupLogs.userId}) as int)` })
    .from(schema.lookupLogs)
    .where(gte(schema.lookupLogs.createdAt, since));

  const topQueries = await db
    .select({
      normalizedQuery: schema.lookupLogs.normalizedQuery,
      count: sql<number>`cast(count(*) as int)`,
    })
    .from(schema.lookupLogs)
    .where(gte(schema.lookupLogs.createdAt, since))
    .groupBy(schema.lookupLogs.normalizedQuery)
    .orderBy(desc(sql`count(*)`))
    .limit(10);

  const dictionaryHitCount = await db
    .select({
      dictionaryId: schema.lookupLogs.dictionaryIdUsed,
      count: sql<number>`cast(count(*) as int)`,
    })
    .from(schema.lookupLogs)
    .where(
      and(
        gte(schema.lookupLogs.createdAt, since),
        sql`${schema.lookupLogs.dictionaryIdUsed} is not null`,
      ),
    )
    .groupBy(schema.lookupLogs.dictionaryIdUsed)
    .orderBy(desc(sql`count(*)`));

  const [cacheStatsRow] = await db
    .select({
      total: sql<number>`cast(count(*) as int)`,
      hits: sql<number>`cast(sum(case when ${schema.lookupLogs.cacheHit} then 1 else 0 end) as int)`,
    })
    .from(schema.lookupLogs)
    .where(gte(schema.lookupLogs.createdAt, since));

  const totalLookups = lookupCountRow?.count ?? 0;
  const cacheHits = cacheStatsRow?.hits ?? 0;
  const cacheHitRatio = totalLookups === 0 ? 0 : Number((cacheHits / totalLookups).toFixed(4));

  return {
    windowDays: days,
    lookupCount: totalLookups,
    uniqueUsers: uniqueUsersRow?.count ?? 0,
    topQueries,
    dictionaryHitCount,
    cacheHitRatio,
  };
}

export async function getCacheStats() {
  const since = daysAgo(7);

  const [totalRow] = await db
    .select({ count: sql<number>`cast(count(*) as int)` })
    .from(schema.responseCache);

  const [manualOverrideRow] = await db
    .select({ count: sql<number>`cast(count(*) as int)` })
    .from(schema.responseCache)
    .where(eq(schema.responseCache.isManualOverride, true));

  const [deleteProtectedRow] = await db
    .select({ count: sql<number>`cast(count(*) as int)` })
    .from(schema.responseCache)
    .where(eq(schema.responseCache.isDeleteProtected, true));

  const byPromptVersion = await db
    .select({
      promptVersion: schema.responseCache.promptVersion,
      count: sql<number>`cast(count(*) as int)`,
    })
    .from(schema.responseCache)
    .groupBy(schema.responseCache.promptVersion)
    .orderBy(desc(sql`count(*)`));

  const byModelName = await db
    .select({
      modelName: schema.responseCache.modelName,
      count: sql<number>`cast(count(*) as int)`,
    })
    .from(schema.responseCache)
    .groupBy(schema.responseCache.modelName)
    .orderBy(desc(sql`count(*)`));

  const [recentCreatedRow] = await db
    .select({ count: sql<number>`cast(count(*) as int)` })
    .from(schema.responseCache)
    .where(gte(schema.responseCache.createdAt, since));

  return {
    totalResponseCache: totalRow?.count ?? 0,
    manualOverrideCount: manualOverrideRow?.count ?? 0,
    deleteProtectedCount: deleteProtectedRow?.count ?? 0,
    byPromptVersion,
    byModelName,
    recentCreatedCount7d: recentCreatedRow?.count ?? 0,
  };
}

export async function getRateLimitStatus(params: { userId?: string | undefined; roleId?: string | undefined }) {
  const roleLimits = params.roleId
    ? await db
      .select({
        discordRoleId: schema.roleRateLimits.discordRoleId,
        roleLabel: schema.roleRateLimits.roleLabel,
        dailyLimit: schema.roleRateLimits.dailyLimit,
        updatedAt: schema.roleRateLimits.updatedAt,
      })
      .from(schema.roleRateLimits)
      .where(eq(schema.roleRateLimits.discordRoleId, params.roleId))
    : await db
      .select({
        discordRoleId: schema.roleRateLimits.discordRoleId,
        roleLabel: schema.roleRateLimits.roleLabel,
        dailyLimit: schema.roleRateLimits.dailyLimit,
        updatedAt: schema.roleRateLimits.updatedAt,
      })
      .from(schema.roleRateLimits)
      .orderBy(schema.roleRateLimits.discordRoleId);

  const todayUsage = params.userId
    ? await db
      .select({
        userId: schema.userUsage.userId,
        guildId: schema.userUsage.guildId,
        usageDate: schema.userUsage.usageDate,
        count: schema.userUsage.count,
      })
      .from(schema.userUsage)
      .where(
        and(
          eq(schema.userUsage.userId, params.userId),
          sql`${schema.userUsage.usageDate} = (now() at time zone 'Asia/Jakarta')::date`,
        ),
      )
    : await db
      .select({
        userId: schema.userUsage.userId,
        guildId: schema.userUsage.guildId,
        usageDate: schema.userUsage.usageDate,
        count: schema.userUsage.count,
      })
      .from(schema.userUsage)
      .where(sql`${schema.userUsage.usageDate} = (now() at time zone 'Asia/Jakarta')::date`)
      .orderBy(desc(schema.userUsage.count))
      .limit(100);

  return {
    resetTimezone: "GMT+7 (Asia/Jakarta)",
    roleLimits,
    todayUsage,
  };
}

export async function getWipeStatus() {
  const settings = await db
    .select({
      guildId: schema.channelSettings.guildId,
      channelId: schema.channelSettings.channelId,
      wipeEnabled: schema.channelSettings.wipeEnabled,
      lastWipeAt: schema.channelSettings.lastWipeAt,
      updatedAt: schema.channelSettings.updatedAt,
    })
    .from(schema.channelSettings)
    .orderBy(schema.channelSettings.channelId);

  const wipeEvents = await db
    .select({
      traceId: schema.botEvents.traceId,
      eventType: schema.botEvents.eventType,
      level: schema.botEvents.level,
      channelId: schema.botEvents.channelId,
      payloadJson: schema.botEvents.payloadJson,
      createdAt: schema.botEvents.createdAt,
    })
    .from(schema.botEvents)
    .where(inArray(schema.botEvents.eventType, ["wipe.started", "wipe.completed", "wipe.failed"]))
    .orderBy(desc(schema.botEvents.createdAt))
    .limit(50);

  return {
    channelSettings: settings,
    recentWipeEvents: wipeEvents.map((row) => ({
      ...row,
      payloadJson: redactDeep(row.payloadJson),
    })),
  };
}
