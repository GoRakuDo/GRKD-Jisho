import { and, eq, sql } from "drizzle-orm";
import { db, schema } from "@grkd-jisho/db";
import { createOpsJobWithAudit } from "../services/audit.service.js";
import { env } from "../config/env.js";

/** キャッシュリフレッシュの件数上限を超えていないか事前確認 */
async function checkCacheRefreshLimit(
  normalizedQuery: string,
  roleKey?: string | undefined,
  dictionaryId?: number | undefined,
): Promise<{ ok: boolean; deletable: number; total: number; manual: number }> {
  const conditions = [eq(schema.responseCache.normalizedQuery, normalizedQuery)];
  if (roleKey) conditions.push(eq(schema.responseCache.roleKey, roleKey));
  if (dictionaryId) conditions.push(eq(schema.responseCache.dictionaryId, dictionaryId));
  const whereClause = and(...conditions);

  const [counts] = await db
    .select({
      total: sql<number>`cast(count(*) as int)`,
      manual: sql<number>`cast(sum(case when ${schema.responseCache.isManualOverride} then 1 else 0 end) as int)`,
    })
    .from(schema.responseCache)
    .where(whereClause);

  const total = counts?.total ?? 0;
  const manual = counts?.manual ?? 0;
  const deletable = Math.max(0, total - manual);
  const max = env.maxCacheRefreshRows;

  return {
    ok: deletable <= max,
    deletable,
    total,
    manual,
  };
}

// ── Tool handler factories ──

export async function requestCacheRefresh(args: {
  normalized_query: string;
  role_key?: string | undefined;
  dictionary_id?: number | undefined;
  reason: string;
}) {
  const limitCheck = await checkCacheRefreshLimit(
    args.normalized_query,
    args.role_key,
    args.dictionary_id,
  );

  if (!limitCheck.ok) {
    return {
      status: "rejected",
      message: `Deletable count (${limitCheck.deletable}) exceeds max (${env.maxCacheRefreshRows}). Use dry_run_cache_refresh first to narrow the scope.`,
      deletable: limitCheck.deletable,
      maxAllowed: env.maxCacheRefreshRows,
    };
  }

  const jobArgs: Record<string, unknown> = {
    normalizedQuery: args.normalized_query,
    reason: args.reason,
  };
  if (args.role_key) jobArgs.roleKey = args.role_key;
  if (args.dictionary_id !== undefined) jobArgs.dictionaryId = args.dictionary_id;

  const result = await createOpsJobWithAudit({
    agentId: env.agentId,
    toolName: "grkd-jisho.request_cache_refresh",
    jobType: "cache_refresh",
    args: jobArgs,
    approvalRequired: false,
    rawToolArgs: args,
  });

  return {
    ...result,
    preview: {
      totalMatching: limitCheck.total,
      manualOverrideCount: limitCheck.manual,
      deletableCount: limitCheck.deletable,
    },
  };
}

export async function requestUserUsageReset(args: {
  guild_id: string;
  user_id: string;
  usage_date?: string | undefined;
  reason: string;
}) {
  const jobArgs: Record<string, unknown> = {
    guildId: args.guild_id,
    userId: args.user_id,
    reason: args.reason,
  };
  if (args.usage_date) jobArgs.usageDate = args.usage_date;

  const result = await createOpsJobWithAudit({
    agentId: env.agentId,
    toolName: "grkd-jisho.request_user_usage_reset",
    jobType: "user_usage_reset",
    args: jobArgs,
    approvalRequired: false,
    rawToolArgs: args,
  });

  return result;
}

export async function requestRateLimitChange(args: {
  discord_role_id: string;
  daily_limit: number;
  role_label?: string | undefined;
  reason: string;
}) {
  if (args.daily_limit < -1) {
    return {
      status: "rejected",
      message: "daily_limit must be >= -1 (-1 means unlimited)",
    };
  }

  const jobArgs: Record<string, unknown> = {
    discordRoleId: args.discord_role_id,
    dailyLimit: args.daily_limit,
    reason: args.reason,
  };
  if (args.role_label) jobArgs.roleLabel = args.role_label;

  const result = await createOpsJobWithAudit({
    agentId: env.agentId,
    toolName: "grkd-jisho.request_rate_limit_change",
    jobType: "rate_limit_change",
    args: jobArgs,
    approvalRequired: true,
    rawToolArgs: args,
  });

  return {
    ...result,
    note: "This change requires human approval via Web Admin UI before execution.",
  };
}

export async function requestToggleWipe(args: {
  guild_id: string;
  channel_id: string;
  wipe_enabled: boolean;
  reason: string;
}) {
  const jobArgs: Record<string, unknown> = {
    guildId: args.guild_id,
    channelId: args.channel_id,
    wipeEnabled: args.wipe_enabled,
    reason: args.reason,
  };

  const result = await createOpsJobWithAudit({
    agentId: env.agentId,
    toolName: "grkd-jisho.request_toggle_wipe",
    jobType: "toggle_wipe",
    args: jobArgs,
    approvalRequired: true,
    rawToolArgs: args,
  });

  return {
    ...result,
    note: "This change requires human approval via Web Admin UI before execution.",
  };
}
