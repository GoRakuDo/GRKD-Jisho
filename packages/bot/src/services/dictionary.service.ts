import { eq, asc, and, or, type AnyColumn } from "drizzle-orm";
import { db, schema } from "@grkd-jisho/db";
import type { LookupResult } from "../types.js";
import { normalizeQuery } from "./normalize-query.js";
import { deinflect } from "./deinflect.js";

/** カラム検索条件: 元クエリと正規化クエリが同じなら1つ、違うならOR */
function matchColumn(column: AnyColumn, original: string, normalized: string) {
  return original !== normalized
    ? or(eq(column, original), eq(column, normalized))
    : eq(column, normalized);
}

/**
 * 1辞書に対して term / reading の完全一致検索を行う内部ヘルパー。
 */
async function findExactInDictionary(
  dict: typeof schema.dictionaries.$inferSelect,
  originalQuery: string,
  normalizedQuery: string,
): Promise<LookupResult | null> {
  // term match
  const [termEntry] = await db
    .select()
    .from(schema.dictionaryEntries)
    .where(
      and(
        eq(schema.dictionaryEntries.dictionaryId, dict.id),
        matchColumn(schema.dictionaryEntries.term, originalQuery, normalizedQuery),
      ),
    )
    .limit(1);

  if (termEntry) {
    return {
      dictionary: dict,
      entry: termEntry,
      matchedBy: "term",
      normalizedQuery,
    };
  }

  // reading match
  const [readingEntry] = await db
    .select()
    .from(schema.dictionaryEntries)
    .where(
      and(
        eq(schema.dictionaryEntries.dictionaryId, dict.id),
        matchColumn(schema.dictionaryEntries.reading, originalQuery, normalizedQuery),
      ),
    )
    .limit(1);

  if (readingEntry) {
    return {
      dictionary: dict,
      entry: readingEntry,
      matchedBy: "reading",
      normalizedQuery,
    };
  }

  return null;
}

export async function lookupWord(rawQuery: string): Promise<LookupResult | null> {
  const query = normalizeQuery(rawQuery);
  const originalQuery = rawQuery.trim();

  const dictionaries = await db
    .select()
    .from(schema.dictionaries)
    .where(eq(schema.dictionaries.enabled, true))
    .orderBy(asc(schema.dictionaries.priority));

  // deinflect は純関数なので辞書ループの前に1回だけ実行
  const deinflectCandidates = deinflect(originalQuery);

  for (const dict of dictionaries) {
    // 1. 完全一致チェック（term / reading）
    const exact = await findExactInDictionary(dict, originalQuery, query);
    if (exact) return exact;

    // 2. deinflect 変換 → 各候補で検索（NEW）
    for (const { text: deinflectedText } of deinflectCandidates) {
      const deinfQuery = normalizeQuery(deinflectedText);
      const deinfResult = await findExactInDictionary(dict, deinflectedText, deinfQuery);
      if (deinfResult) {
        return {
          ...deinfResult,
          matchedBy: "deinflected",
          originalInflected: originalQuery,
          deinflectedFrom: deinflectedText,
        };
      }
    }
  }

  return null;
}
