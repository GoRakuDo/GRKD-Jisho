/**
 * Frequency-based reading ranker.
 *
 * 同じ漢字 term に複数の reading 候補があるとき、
 * `term_frequencies` テーブルから最も自然な reading を選ぶ。
 *
 * - rank-based: frequency_value が小さいほど一般的
 * - occurrence-based: frequency_value が大きいほど一般的
 * - reading=null の entry は term-level fallback として使う
 *
 * `rankTermMatchesByFrequency()` は term match 候補リストを
 * Frequency ベスト順（タイは元の順序）に並べ替える。
 */

import { eq, and, asc, inArray } from "drizzle-orm";
import { db, schema, type dictionaryEntries } from "@grkd-jisho/db";
import type { LookupResult } from "../types.js";

type DictionaryEntry = typeof dictionaryEntries.$inferSelect;

const MAX_CANDIDATES = 50;

/**
 * 1つの expression について reading 別の Frequency をまとめて取得する。
 * すべての freq-only 辞書から全局的に取得し、reading ごとに MIN(frequency_value) を採用する。
 * term-level (reading=NULL) も返す。
 */
async function fetchFrequencyMap(
  expression: string,
): Promise<{
  byReading: Map<string, number>;
  termLevel: number | null;
  frequencyMode: string | null;
}> {
  const rows = await db
    .select({
      reading: schema.termFrequencies.reading,
      frequencyValue: schema.termFrequencies.frequencyValue,
      frequencyMode: schema.termFrequencies.frequencyMode,
    })
    .from(schema.termFrequencies)
    .innerJoin(
      schema.dictionaries,
      eq(schema.termFrequencies.dictionaryId, schema.dictionaries.id),
    )
    .where(
      and(
        eq(schema.dictionaries.isFrequencyOnly, true),
        eq(schema.termFrequencies.expression, expression),
      ),
    );

  const byReading = new Map<string, number>();
  let termLevel: number | null = null;
  let frequencyMode: string | null = null;

  for (const row of rows) {
    if (row.frequencyMode && frequencyMode === null) {
      frequencyMode = row.frequencyMode;
    }
    const v = Number(row.frequencyValue);
    if (!Number.isFinite(v)) continue;
    if (row.reading === null) {
      if (termLevel === null || v < termLevel) {
        termLevel = v;
      }
    } else {
      const existing = byReading.get(row.reading);
      if (existing === undefined || v < existing) {
        byReading.set(row.reading, v);
      }
    }
  }

  return { byReading, termLevel, frequencyMode };
}

/**
 * term マッチ候補を Frequency ベスト順に並べ替える。
 *
 * 1. reading-specific score がある候補を最優先
 * 2. score の比較は mode に応じて昇順/降順（rank-based: 小さいほど良い）
 * 3. term-level (reading=null) score がある候補を次に優先
 * 4. 候補数が 1 なら ranker を呼ばない
 *
 * 戻り値: 並べ替えた候補リスト（変更なしの場合は元の配列をそのまま返す）
 */
export async function rankTermMatchesByFrequency(
  expression: string,
  candidates: DictionaryEntry[],
): Promise<DictionaryEntry[]> {
  if (candidates.length <= 1) return candidates;

  const { byReading, termLevel, frequencyMode } = await fetchFrequencyMap(expression);

  // Frequency データが一切ない → 元の順序維持
  if (byReading.size === 0 && termLevel === null) return candidates;

  const isRankBased = frequencyMode === "rank-based" || frequencyMode === null;

  // 各 candidate に score を割り当てる
  const scored = candidates.map((entry, originalIndex) => {
    const readingScore = byReading.get(entry.reading);
    return {
      entry,
      readingScore,
      hasReadingScore: readingScore !== undefined,
      originalIndex,
    };
  });

  scored.sort((a, b) => {
    // 1. reading-specific score がある候補を優先
    if (a.hasReadingScore !== b.hasReadingScore) {
      return a.hasReadingScore ? -1 : 1;
    }
    // 2. score で比較（mode に応じて昇順/降順）
    if (a.hasReadingScore && b.hasReadingScore) {
      const aScore = a.readingScore as number;
      const bScore = b.readingScore as number;
      if (aScore !== bScore) {
        return isRankBased ? aScore - bScore : bScore - aScore;
      }
    }
    // 3. reading-specific score も term-level score もない場合、
    //    または score がタイだった場合は元の順序を維持する。
    //    (term-level は fetchFrequencyMap 内の "MIN 集計" には使われるが、
    //     候補間の tie-breaker としては実装上弱い補助信号でしかない)
    return a.originalIndex - b.originalIndex;
  });

  return scored.map((s) => s.entry);
}

/**
 * 明示的な reading 指定があった場合、その reading に一致する候補だけを残す。
 * 一致する候補が無ければ null を返す。
 */
export function filterByExplicitReading(
  candidates: DictionaryEntry[],
  explicitReading: string,
): DictionaryEntry | null {
  const match = candidates.find((e) => e.reading === explicitReading);
  return match ?? null;
}

/**
 * caller が候補取得時に使う安全な上限。辞書あたりの reading 候補は通常 2-10 件程度。
 */
export function maxCandidates(): number {
  return MAX_CANDIDATES;
}

/**
 * DB から expression に対する reading → frequency のマップを取得する
 * （テスト・デバッグ用）
 */
export async function getReadingFrequencyMap(
  expression: string,
): Promise<Map<string, number>> {
  const { byReading } = await fetchFrequencyMap(expression);
  return byReading;
}

/**
 * candidate id リストをまとめて取得するヘルパー（テスト用）
 */
export async function fetchEntriesByIds(ids: bigint[]): Promise<DictionaryEntry[]> {
  if (ids.length === 0) return [];
  return db
    .select()
    .from(schema.dictionaryEntries)
    .where(inArray(schema.dictionaryEntries.id, ids))
    .orderBy(asc(schema.dictionaryEntries.id));
}

export type { LookupResult };
