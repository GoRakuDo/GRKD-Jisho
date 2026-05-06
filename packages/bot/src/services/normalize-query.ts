/**
 * 検索クエリを正規化する。
 *
 * やること:
 * - trim
 * - Unicode NFKC（全角英数字→半角、半角カタカナ→全角カタカナ）
 * - 全角カタカナ→ひらがな
 *
 * やらないこと:
 * - 意味推測
 * - ローマ字変換
 * - 表記揺れのLLM補完
 */
export function normalizeQuery(input: string): string {
  let s = input.trim();

  // NFKC: 半角カタカナ→全角カタカナ、全角英数字→半角
  s = s.normalize("NFKC");

  // 全角カタカナ→ひらがな
  // 全角カタカナ（標準）: U+30A1–U+30F6
  // ひらがな（対応）:     U+3041–U+3096
  // 差: 0x60 (96)
  // 長音(ーU+30FC)・中点(・U+30FB)・繰り返し(ヽU+30FD ヾU+30FE)は変換しない
  // 清音・濁音・半濁音すべてのオフセット変換が正しく動作する:
  //   カ(U+30AB)→か(U+304B), ガ(U+30AC)→が(U+304C), パ(U+30D1)→ぱ(U+3071)
  //   ヴ(U+30F4)→ゔ(U+3094) も正しく変換される
  // 順序: trim → NFKC（半角カタカナ→全角カタカナ）→ 全角カタカナ→ひらがな
  s = s.replace(/[\u30a1-\u30f6]/g, (ch) =>
    String.fromCodePoint(ch.codePointAt(0)! - 0x60),
  );

  return s;
}
