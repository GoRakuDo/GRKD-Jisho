/**
 * 文の先頭から最長一致で辞書語を抽出する（Greedy Longest-Match Scan）。
 *
 * 使用例:
 *   const found = await extractFirstTerm("今日は天気がいいですね")
 *   // found === { term: "今日", result: LookupResult }
 *
 * Yomitan の _textParseScanning() から「最初の1件のみ抽出」に特化したもの。
 * 全文スキャンはせず、最初に辞書ヒットした部分文字列で止める。
 */

import { parseLookupQuery } from "@grkd-jisho/db";
import type { LookupResult } from "../types.js";
import { lookupWord } from "./dictionary.service.js";

/** 1回のスキャンでチェックする最大長さ */
const MAX_SCAN_LENGTH = 20;

/** 最小長さ */
const MIN_SCAN_LENGTH = 1;

/** extractFirstTerm の戻り値 */
export interface ExtractedTerm {
  /** 辞書にヒットした部分文字列（ユーザー入力の一部） */
  term: string;
  /** lookupWord の結果（deinflect 済みの場合もある） */
  result: LookupResult;
}

/**
 * 文の先頭から greedy longest-match scan を行い、
 * 最初に辞書にヒットした部分文字列とその結果を返す。
 *
 * ユーザーが `漢字[よみ]` / `漢字［よみ］` 形式で明示 reading を指定した場合、
 * greedy scan をスキップして指定 term + 指定 reading で lookup する
 * （Frequency ranker も bypass）。
 *
 * @param rawText メンション除去後のユーザーメッセージ
 * @returns ヒットした最初の term + result。見つからなければ null
 */
export async function extractFirstTerm(rawText: string): Promise<ExtractedTerm | null> {
  const text = rawText.trim();
  if (!text) return null;

  // 1. 明示 reading 指定をチェック（Frequency ranker バイパス）
  const parsed = parseLookupQuery(text);
  if (parsed.explicitReading) {
    const result = await lookupWord(parsed.term, parsed.explicitReading);
    if (result) {
      return { term: parsed.term, result };
    }
    return null;
  }

  // 2. greedy longest-match scan
  const maxLen = Math.min(text.length, MAX_SCAN_LENGTH);

  for (let len = maxLen; len >= MIN_SCAN_LENGTH; len--) {
    const candidate = text.substring(0, len);
    const result = await lookupWord(candidate);
    if (result !== null) {
      return { term: candidate, result };
    }
  }

  return null;
}
