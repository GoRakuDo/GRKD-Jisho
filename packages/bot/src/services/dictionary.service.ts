import { eq, asc, and, or, not, type AnyColumn } from "drizzle-orm";
import { db, schema } from "@grkd-jisho/db";
import type { LookupResult } from "../types.js";
import { normalizeQuery } from "./normalize-query.js";
import { deinflect } from "./deinflect.js";
import { rankTermMatchesByFrequency, maxCandidates } from "./reading-ranker.service.js";

/** カラム検索条件: 元クエリと正規化クエリが同じなら1つ、違うならOR */
function matchColumn(column: AnyColumn, original: string, normalized: string) {
  return original !== normalized
    ? or(eq(column, original), eq(column, normalized))
    : eq(column, normalized);
}

/**
 * 1辞書に対して term / reading の完全一致検索を行う内部ヘルパー。
 *
 * - `explicitReading` がある場合: その reading に完全一致する entry を返す
 * - 無い場合: term 候補を全件取得 → 候補が 2件以上なら Frequency ranker で並べ替え
 * - それでも候補が 0なら null
 */
async function findExactInDictionary(
  dict: typeof schema.dictionaries.$inferSelect,
  originalQuery: string,
  normalizedQuery: string,
  explicitReading: string | null,
): Promise<LookupResult | null> {
  // term match (limit is generous; ranker handles reordering)
  const termEntries = await db
    .select()
    .from(schema.dictionaryEntries)
    .where(
      and(
        eq(schema.dictionaryEntries.dictionaryId, dict.id),
        matchColumn(schema.dictionaryEntries.term, originalQuery, normalizedQuery),
      ),
    )
    .limit(maxCandidates());

  if (termEntries.length > 0) {
    if (explicitReading) {
      const match = termEntries.find((e) => e.reading === explicitReading);
      if (!match) return null;
      return {
        dictionary: dict,
        entry: match,
        matchedBy: "term",
        normalizedQuery,
      };
    }

    // 候補が 1件ならそのまま返す
    if (termEntries.length === 1) {
      return {
        dictionary: dict,
        entry: termEntries[0]!,
        matchedBy: "term",
        normalizedQuery,
      };
    }

    // 候補が 2件以上 → Frequency ranker で並べ替え
        const ranked = await rankTermMatchesByFrequency(normalizedQuery, termEntries);
    const best = ranked[0];
    if (best) {
      return {
        dictionary: dict,
        entry: best,
        matchedBy: "term",
        normalizedQuery,
      };
    }
  }

  // reading match — explicit reading 指定時は term match で見つかっているのでスキップ
  if (explicitReading) {
    return null;
  }

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

export async function lookupWord(
  rawQuery: string,
  explicitReading: string | null = null,
): Promise<LookupResult | null> {
  const query = normalizeQuery(rawQuery);
  const originalQuery = rawQuery.trim();

  const dictionaries = await db
    .select()
    .from(schema.dictionaries)
    .where(and(
      eq(schema.dictionaries.enabled, true),
      not(eq(schema.dictionaries.isFrequencyOnly, true)),
    ))
    .orderBy(asc(schema.dictionaries.priority));

  // deinflect は純関数なので辞書ループの前に1回だけ実行
  const deinflectCandidates = deinflect(originalQuery);

  for (const dict of dictionaries) {
    // 1. 完全一致チェック（term / reading + Frequency ranker）
    const exact = await findExactInDictionary(dict, originalQuery, query, explicitReading);
    if (exact) return exact;

    // 2. deinflect 変換 → 各候補で検索
    for (const { text: deinflectedText } of deinflectCandidates) {
      const deinfQuery = normalizeQuery(deinflectedText);
      const deinfResult = await findExactInDictionary(
        dict,
        deinflectedText,
        deinfQuery,
        explicitReading,
      );
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
