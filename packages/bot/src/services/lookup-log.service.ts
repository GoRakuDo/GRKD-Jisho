import { eq } from "drizzle-orm";
import { db, schema } from "@grkd-jisho/db";
import type { NewLookupLog } from "@grkd-jisho/db";

export async function recordLookup(params: NewLookupLog): Promise<void> {
  await db.insert(schema.lookupLogs).values(params);
}

export async function hasLookupLogForMessage(messageId: string): Promise<boolean> {
  const [row] = await db
    .select({ id: schema.lookupLogs.id })
    .from(schema.lookupLogs)
    .where(eq(schema.lookupLogs.messageId, messageId))
    .limit(1);

  return Boolean(row);
}
