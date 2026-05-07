import { eq, asc, and, or } from "drizzle-orm";
import { db, schema } from "@grkd-jisho/db";
import type { LookupResult } from "../types.js";
import { normalizeQuery } from "./normalize-query.js";

export async function lookupWord(rawQuery: string): Promise<LookupResult | null> {
  const query = normalizeQuery(rawQuery);
  const originalQuery = rawQuery.trim();

  const dictionaries = await db
    .select()
    .from(schema.dictionaries)
    .where(eq(schema.dictionaries.enabled, true))
    .orderBy(asc(schema.dictionaries.priority));

  for (const dict of dictionaries) {
    // 1. term match — 元クエリ（そのまま）と正規化クエリ（ひらがな化）の両方を OR 検索
    const [termEntry] = await db
      .select()
      .from(schema.dictionaryEntries)
      .where(
        and(
          eq(schema.dictionaryEntries.dictionaryId, dict.id),
          or(
            eq(schema.dictionaryEntries.term, originalQuery),
            eq(schema.dictionaryEntries.term, query),
          ),
        ),
      )
      .limit(1);

    if (termEntry) {
      return {
        dictionary: dict,
        entry: termEntry,
        matchedBy: "term",
        normalizedQuery: query,
      };
    }

    // 2. reading match — 同上（reading がカタカナで保存されていてもひらがな検索が効く）
    const [readingEntry] = await db
      .select()
      .from(schema.dictionaryEntries)
      .where(
        and(
          eq(schema.dictionaryEntries.dictionaryId, dict.id),
          or(
            eq(schema.dictionaryEntries.reading, originalQuery),
            eq(schema.dictionaryEntries.reading, query),
          ),
        ),
      )
      .limit(1);

    if (readingEntry) {
      return {
        dictionary: dict,
        entry: readingEntry,
        matchedBy: "reading",
        normalizedQuery: query,
      };
    }
  }

  return null;
}
