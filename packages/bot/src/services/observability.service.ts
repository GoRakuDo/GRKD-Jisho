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
    console.error("[Observability] Failed to record event:", err);
  }
}

export async function recordHeartbeat(
  serviceName: string,
  instanceId: string,
  status: "ok" | "degraded" | "down",
  metadata?: Record<string, unknown>,
): Promise<void> {
  try {
    await db
      .insert(schema.botHeartbeats)
      .values({
        serviceName,
        instanceId,
        status,
        lastSeenAt: new Date(),
        metadataJson: metadata ?? {},
      })
      .onConflictDoUpdate({
        target: [
          schema.botHeartbeats.serviceName,
          schema.botHeartbeats.instanceId,
        ],
        set: {
          status,
          lastSeenAt: new Date(),
          metadataJson: metadata ?? {},
        },
      });
  } catch (err) {
    console.error("[Observability] Failed to record heartbeat:", err);
  }
}
