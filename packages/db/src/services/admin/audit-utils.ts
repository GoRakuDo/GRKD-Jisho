import { sql } from "drizzle-orm";
import { db } from "../../index";
import * as schema from "../../schema";

const serviceName = "@grkd-jisho/db";

/**
 * Record an admin action audit event in bot_events.
 * Web・Bot 共通で使う。trace_id は自動生成。
 */
export async function adminAuditEvent(
  eventType: string,
  payload?: Record<string, unknown>,
): Promise<void> {
  try {
    await db.insert(schema.botEvents).values({
      traceId: `admin_${eventType}_${Date.now()}`,
      level: "info",
      eventType,
      payloadJson: payload ?? {},
    });
  } catch (err) {
    console.error(`[${serviceName}] Failed to record admin audit:`, err);
  }
}
