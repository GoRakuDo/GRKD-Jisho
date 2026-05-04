import { db, schema } from "@grkd-jisho/db";
import type { NewLookupLog } from "@grkd-jisho/db";

export async function recordLookup(params: NewLookupLog): Promise<void> {
  await db.insert(schema.lookupLogs).values(params);
}
