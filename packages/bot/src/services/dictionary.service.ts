import { eq, asc, and } from "drizzle-orm";
import { db, schema } from "@grkd-jisho/db";
import type { LookupResult } from "../types.js";

export async function lookupWord(query: string): Promise<LookupResult | null> {
  const dictionaries = await db
    .select()
    .from(schema.dictionaries)
    .where(eq(schema.dictionaries.enabled, true))
    .orderBy(asc(schema.dictionaries.priority));

  for (const dict of dictionaries) {
    const [entry] = await db
      .select()
      .from(schema.dictionaryEntries)
      .where(
        and(
          eq(schema.dictionaryEntries.dictionaryId, dict.id),
          eq(schema.dictionaryEntries.term, query),
        ),
      )
      .limit(1);

    if (entry) {
      return { dictionary: dict, entry };
    }
  }

  return null;
}
