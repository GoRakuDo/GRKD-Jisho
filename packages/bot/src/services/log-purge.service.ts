import { lt, sql } from "drizzle-orm";
import { db, schema } from "@grkd-jisho/db";

/**
 * 保持期間を超えた lookup_logs と bot_events を削除する。
 * 削除件数を bot_events に記録する。
 *
 * @param retentionDays 保持する日数（デフォルト 90）
 * @returns 削除された lookup_logs の件数と bot_events の件数
 */
export async function purgeOldLogs(
  retentionDays = 90,
): Promise<{ lookupLogsDeleted: number; botEventsDeleted: number }> {
  const cutoff = sql`now() - interval '1 day' * ${retentionDays}`;

  const deletedLookups = await db
    .delete(schema.lookupLogs)
    .where(lt(schema.lookupLogs.createdAt, cutoff))
    .returning({ id: schema.lookupLogs.id });

  const deletedEvents = await db
    .delete(schema.botEvents)
    .where(lt(schema.botEvents.createdAt, cutoff))
    .returning({ id: schema.botEvents.id });

  const result = {
    lookupLogsDeleted: deletedLookups.length,
    botEventsDeleted: deletedEvents.length,
  };

  // 削除結果を bot_events に記録
  const traceId = `log_purge_${Date.now()}`;
  try {
    await db.insert(schema.botEvents).values({
      traceId,
      level: "info",
      eventType: "log_purge.completed",
      payloadJson: { ...result, retentionDays },
    });
  } catch (err) {
    const reason = err instanceof Error ? err.message : String(err);
    console.error(`[LogPurge] Failed to record purge event: ${reason} → Check DB connection`);
  }

  return result;
}
