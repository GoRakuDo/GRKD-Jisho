import { eq, and, or, sql } from "drizzle-orm";
import { db, schema } from "@grkd-jisho/db";
import { traceEvent } from "./observability.service.js";
import { env } from "../config/env.js";

let pollingInProgress = false;

/**
 * pending（approval 不要）または approved（approval 済み）のジョブを取得して実行する。
 * Bot の ready イベントで定期ポーリングする（30秒間隔）。
 */
export async function pollAndExecuteJobs(): Promise<void> {
  if (pollingInProgress) return;
  pollingInProgress = true;
  try {
    // 承認不要: status=pending のみ
    const pending = await db
      .select()
      .from(schema.opsJobs)
      .where(
        and(
          eq(schema.opsJobs.status, "pending"),
          eq(schema.opsJobs.approvalRequired, false),
        ),
      );

    // 承認済み: status=approved のみ
    const approved = await db
      .select()
      .from(schema.opsJobs)
      .where(
        and(
          eq(schema.opsJobs.status, "approved"),
          eq(schema.opsJobs.approvalRequired, true),
        ),
      );

    const allJobs = [...pending, ...approved];

    for (const job of allJobs) {
      const traceId = `ops_${job.id}_${Date.now()}`;
      await traceEvent(traceId, "ops_job.started", "info", {
        jobId: job.id.toString(),
        jobType: job.jobType,
      });

      try {
        // claim: atomic に status を running に更新する
        // where 条件で承認状態を再検証する
        const claimed = await db
          .update(schema.opsJobs)
          .set({ status: "running" })
          .where(
            and(
              eq(schema.opsJobs.id, job.id),
              or(
                and(
                  eq(schema.opsJobs.approvalRequired, false),
                  eq(schema.opsJobs.status, "pending"),
                ),
                and(
                  eq(schema.opsJobs.approvalRequired, true),
                  eq(schema.opsJobs.status, "approved"),
                ),
              ),
            ),
          )
          .returning({ id: schema.opsJobs.id });

        if (claimed.length === 0) {
          // 別プロセスに取られた、または承認状態が変わった
          continue;
        }

        const result = await executeJob(job);

        await db
          .update(schema.opsJobs)
          .set({
            status: "succeeded",
            resultJson: result,
            completedAt: new Date(),
          })
          .where(eq(schema.opsJobs.id, job.id));

        await traceEvent(traceId, "ops_job.completed", "info", {
          jobId: job.id.toString(),
          jobType: job.jobType,
        });
      } catch (err) {
        const errorMsg = String(err);
        await db
          .update(schema.opsJobs)
          .set({
            status: "failed",
            errorMessage: errorMsg,
            completedAt: new Date(),
          })
          .where(eq(schema.opsJobs.id, job.id));

        await traceEvent(traceId, "ops_job.failed", "error", {
          jobId: job.id.toString(),
          jobType: job.jobType,
          error: errorMsg,
        });
      }
    }
  } finally {
    pollingInProgress = false;
  }
}

/**
 * 各ジョブタイプの argsJson 構造。
 * write-request-tools.ts が保存する camelCase に合わせる。
 */
interface CacheRefreshArgs {
  normalizedQuery: string;
  roleKey?: string;
  dictionaryId?: number;
}

interface UserUsageResetArgs {
  guildId: string;
  userId: string;
  usageDate?: string;
}

interface RateLimitChangeArgs {
  discordRoleId: string;
  dailyLimit: number;
  roleLabel?: string;
}

interface ToggleWipeArgs {
  guildId: string;
  channelId: string;
  wipeEnabled: boolean;
}

/**
 * ジョブタイプ別の実処理を実行する。
 * 戻り値は resultJson として保存される。
 */
async function executeJob(
  job: typeof schema.opsJobs.$inferSelect,
): Promise<Record<string, unknown>> {
  if (!isRecord(job.argsJson)) {
    throw new Error(`Invalid argsJson for job ${job.id.toString()}`);
  }

  const args = job.argsJson;

  switch (job.jobType) {
    case "cache_refresh":
      return executeCacheRefresh(args as unknown as CacheRefreshArgs);
    case "user_usage_reset":
      return executeUserUsageReset(args as unknown as UserUsageResetArgs);
    case "rate_limit_change":
      return executeRateLimitChange(args as unknown as RateLimitChangeArgs);
    case "toggle_wipe":
      return executeToggleWipe(args as unknown as ToggleWipeArgs);
    default:
      throw new Error(`Unknown job type: ${job.jobType}`);
  }
}

async function executeCacheRefresh(
  args: CacheRefreshArgs,
): Promise<Record<string, unknown>> {
  const maxRows = env.CACHE_REFRESH_MAX_ROWS;

  if (maxRows === 0) {
    return { deleted_count: 0, skipped: "maxRows is 0 (disabled)" };
  }

  if (!args.normalizedQuery) {
    throw new Error("normalizedQuery is required for cache_refresh");
  }

  // 対象件数を再計算
  const conditions = and(
    eq(schema.responseCache.isDeleteProtected, false),
    eq(schema.responseCache.normalizedQuery, args.normalizedQuery),
    ...(args.roleKey !== undefined
      ? [eq(schema.responseCache.roleKey, args.roleKey)]
      : []),
    ...(args.dictionaryId !== undefined
      ? [eq(schema.responseCache.dictionaryId, args.dictionaryId)]
      : []),
  );

  const [countResult] = await db
    .select({ count: sql<number>`count(*)::int` })
    .from(schema.responseCache)
    .where(conditions);

  const targetCount = countResult?.count ?? 0;

  if (targetCount > maxRows) {
    throw new Error(
      `Cache refresh would delete ${targetCount} rows, exceeds limit of ${maxRows}`,
    );
  }

  if (targetCount === 0) {
    return { deleted_count: 0 };
  }

  const deleted = await db
    .delete(schema.responseCache)
    .where(conditions)
    .returning({ id: schema.responseCache.id });

  return { deleted_count: deleted.length };
}

async function executeUserUsageReset(
  args: UserUsageResetArgs,
): Promise<Record<string, unknown>> {
  if (!args.guildId) {
    throw new Error("guildId is required for user_usage_reset");
  }

  const conditions = and(
    eq(schema.userUsage.userId, args.userId),
    eq(schema.userUsage.guildId, args.guildId),
    ...(args.usageDate !== undefined
      ? [eq(schema.userUsage.usageDate, args.usageDate)]
      : []),
    // count > 0 のみ更新
    sql`${schema.userUsage.count} > 0`,
  );

  const updated = await db
    .update(schema.userUsage)
    .set({ count: 0 })
    .where(conditions)
    .returning({ id: schema.userUsage.id, count: schema.userUsage.count });

  return { reset_count: updated.length };
}

async function executeRateLimitChange(
  args: RateLimitChangeArgs,
): Promise<Record<string, unknown>> {
  if (args.dailyLimit < -1) {
    throw new Error(`Invalid dailyLimit: ${args.dailyLimit}`);
  }

  // before の値を取得
  const [existing] = await db
    .select()
    .from(schema.roleRateLimits)
    .where(eq(schema.roleRateLimits.discordRoleId, args.discordRoleId))
    .limit(1);

  const before = existing?.dailyLimit ?? null;

  // upsert
  await db
    .insert(schema.roleRateLimits)
    .values({
      discordRoleId: args.discordRoleId,
      dailyLimit: args.dailyLimit,
      roleLabel: args.roleLabel ?? existing?.roleLabel ?? null,
    })
    .onConflictDoUpdate({
      target: schema.roleRateLimits.discordRoleId,
      set: {
        dailyLimit: args.dailyLimit,
        roleLabel: args.roleLabel ?? existing?.roleLabel ?? null,
      },
    });

  return { before, after: args.dailyLimit };
}

async function executeToggleWipe(
  args: ToggleWipeArgs,
): Promise<Record<string, unknown>> {
  if (!args.guildId || !args.channelId) {
    throw new Error("guildId and channelId are required for toggle_wipe");
  }

  // before の値を取得
  const [existing] = await db
    .select()
    .from(schema.channelSettings)
    .where(eq(schema.channelSettings.channelId, args.channelId))
    .limit(1);

  const before = existing?.wipeEnabled ?? null;

  // upsert
  await db
    .insert(schema.channelSettings)
    .values({
      guildId: args.guildId,
      channelId: args.channelId,
      wipeEnabled: args.wipeEnabled,
    })
    .onConflictDoUpdate({
      target: schema.channelSettings.channelId,
      set: { wipeEnabled: args.wipeEnabled },
    });

  return {
    before,
    after: args.wipeEnabled,
    note: "Channel wipe setting updated. No immediate Discord API action.",
  };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
