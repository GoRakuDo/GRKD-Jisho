import { eq, desc, sql } from "drizzle-orm";
import { db } from "../../index";
import * as schema from "../../schema";

export interface TraceEventRow {
  id: string;
  traceId: string;
  eventType: string;
  level: string;
  createdAt: Date | null;
  payloadJson: Record<string, unknown>;
}

export async function getTraceById(
  traceId: string,
): Promise<TraceEventRow[]> {
  const rows = await db
    .select()
    .from(schema.botEvents)
    .where(eq(schema.botEvents.traceId, traceId))
    .orderBy(desc(schema.botEvents.createdAt))
    .limit(100);

  return rows.map((r) => ({
    ...r,
    id: String(r.id),
    payloadJson: r.payloadJson as Record<string, unknown>,
  }));
}

export async function getRecentErrors(
  limit = 20,
): Promise<TraceEventRow[]> {
  const rows = await db
    .select()
    .from(schema.botEvents)
    .where(eq(schema.botEvents.level, "error"))
    .orderBy(desc(schema.botEvents.createdAt))
    .limit(limit);

  return rows.map((r) => ({
    ...r,
    id: String(r.id),
    payloadJson: r.payloadJson as Record<string, unknown>,
  }));
}

export async function getEventsByType(
  eventType: string,
  limit = 50,
): Promise<TraceEventRow[]> {
  const rows = await db
    .select()
    .from(schema.botEvents)
    .where(eq(schema.botEvents.eventType, eventType))
    .orderBy(desc(schema.botEvents.createdAt))
    .limit(limit);

  return rows.map((r) => ({
    ...r,
    id: String(r.id),
    payloadJson: r.payloadJson as Record<string, unknown>,
  }));
}
