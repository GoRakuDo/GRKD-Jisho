import { eq, and, or } from "drizzle-orm";
import { db, schema } from "@grkd-jisho/db";
import { traceEvent } from "./observability.service.js";

let pollingInProgress = false;

/**
 * pending（approval 不要）または approved（approval 済み）のジョブを取得して実行する。
 * Bot の ready イベントで定期ポーリングする。
 */
export async function pollAndExecuteJobs(): Promise<void> {
  if (pollingInProgress) return;
  pollingInProgress = true;
  try {
    const pending = await db
      .select()
      .from(schema.opsJobs)
      .where(
        and(
          eq(schema.opsJobs.status, "pending"),
          eq(schema.opsJobs.approvalRequired, false),
        ),
      );

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
        const claimed = await db
          .update(schema.opsJobs)
          .set({ status: "running" })
          .where(
            and(
              eq(schema.opsJobs.id, job.id),
              or(
                eq(schema.opsJobs.status, "pending"),
                eq(schema.opsJobs.status, "approved"),
              ),
            ),
          )
          .returning({ id: schema.opsJobs.id });

        if (claimed.length === 0) {
          continue;
        }

        await executeJob(job);

        await db
          .update(schema.opsJobs)
          .set({
            status: "succeeded",
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

async function executeJob(
  job: typeof schema.opsJobs.$inferSelect,
): Promise<void> {
  if (!isRecord(job.argsJson)) {
    throw new Error(`Invalid argsJson for job ${job.id.toString()}`);
  }

  const args = job.argsJson;

  switch (job.jobType) {
    case "cache_refresh":
      console.log(`[OpsJob] cache_refresh: ${JSON.stringify(args)}`);
      break;
    case "user_usage_reset":
      console.log(`[OpsJob] user_usage_reset: ${JSON.stringify(args)}`);
      break;
    case "rate_limit_change":
      console.log(`[OpsJob] rate_limit_change: ${JSON.stringify(args)}`);
      break;
    case "toggle_wipe":
      console.log(`[OpsJob] toggle_wipe: ${JSON.stringify(args)}`);
      break;
    default:
      throw new Error(`Unknown job type: ${job.jobType}`);
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
