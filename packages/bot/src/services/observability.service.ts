import { db, schema } from "@grkd-jisho/db";
import type { TraceEventType } from "../types.js";

export async function traceEvent(
  traceId: string,
  eventType: TraceEventType,
  level: "info" | "warn" | "error",
  payload?: Record<string, unknown>,
): Promise<void> {
  try {
    await db.insert(schema.botEvents).values({
      traceId,
      level,
      eventType,
      payloadJson: payload ?? {},
    });
  } catch (err) {
    const reason = err instanceof Error ? err.message : String(err);
    console.error(`[Observability] Event recording failed: ${reason} → Check DB connection`);
  }
}

export async function recordHeartbeat(
  serviceName: string,
  instanceId: string,
  status: "ok" | "degraded" | "down",
  metadata?: Record<string, unknown>,
): Promise<void> {
  try {
    const now = new Date();
    await db
      .insert(schema.botHeartbeats)
      .values({
        serviceName,
        instanceId,
        status,
        lastSeenAt: now,
        metadataJson: metadata ?? {},
      })
      .onConflictDoUpdate({
        target: [
          schema.botHeartbeats.serviceName,
          schema.botHeartbeats.instanceId,
        ],
        set: {
          status,
          lastSeenAt: now,
          metadataJson: metadata ?? {},
        },
      });
  } catch (err) {
    const reason = err instanceof Error ? err.message : String(err);
    console.error(`[Observability] Heartbeat recording failed: ${reason} → Check DB connection`);
  }
}
