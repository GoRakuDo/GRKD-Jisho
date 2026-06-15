/**
 * Dictionary Definition Transformer
 *
 * LLM に渡す直前の `definitionsJson` を変換する。
 * DB の生データは変更せず、派生オブジェクトだけを返す。
 *
 * 置換ルール:
 * 1. `content: "━"` / `content: "―"` の完全一致ノード → `dictionaryForm` に置換
 * 2. `content` 文字列内の `「…━…」` / `「…―…」` → `dictionaryForm` に置換
 *    （辞書の例文で headword が `━` / `―` で代用されているケース）
 * - 該当 placeholder が無い辞書は no-op（元のオブジェクトをそのまま返す）。
 * - `dictionaryForm` が空なら置換しない。
 * - 元オブジェクトを直接 mutate しない。
 */

/**
 * LLM プロンプト用に辞書 JSON を変換する。
 *
 * @param definitionJson - DB から取得した生の `definitionsJson`
 * @param dictionaryForm - 辞書の見出し語（例: `軟派`）
 * @returns 変換後の派生オブジェクト（`definitionJson` と同じ型）
 */
export function transformDefinitionForPrompt<T>(definitionJson: T, dictionaryForm: string): T {
  if (!dictionaryForm) {
    return definitionJson;
  }

  return replaceHeadwordMarks(definitionJson, dictionaryForm) as T;
}

/**
 * 再帰走査で辞書 JSON を変換する。
 *
 * - `content` 値の完全一致: `"━"` / `"―"` → `dictionaryForm`
 * - `content` 文字列内の `「…━…」` / `「…―…」` → `dictionaryForm` に置換
 * - `dictionaryForm` が空なら no-op。
 */
function replaceHeadwordMarks(value: unknown, dictionaryForm: string): unknown {
  if (Array.isArray(value)) {
    const mapped = value.map((item) => replaceHeadwordMarks(item, dictionaryForm));
    return mapped.every((item, i) => item === value[i]) ? value : mapped;
  }

  if (value && typeof value === "object") {
    const entries = Object.entries(value as Record<string, unknown>);
    const newEntries: [string, unknown][] = [];
    let changed = false;

    for (const [key, child] of entries) {
      if (key === "content") {
        // 完全一致: "━" / "―" → dictionaryForm
        if (child === "━" || child === "―") {
          changed = true;
          newEntries.push([key, dictionaryForm]);
          continue;
        }
        // 配列要素内の文字列にも「」置換を適用
        if (Array.isArray(child)) {
          const newChild = child.map((item) =>
            typeof item === "string" ? replaceHeadwordInBrackets(item, dictionaryForm) : replaceHeadwordMarks(item, dictionaryForm),
          );
          if (newChild.some((item, i) => item !== child[i])) {
            changed = true;
            newEntries.push([key, newChild]);
          } else {
            newEntries.push([key, child]);
          }
          continue;
        }
        // 単一文字列: 「」内マーク置換
        if (typeof child === "string") {
          const replaced = replaceHeadwordInBrackets(child, dictionaryForm);
          if (replaced !== child) {
            changed = true;
            newEntries.push([key, replaced]);
            continue;
          }
        }
      }
      const newChild = replaceHeadwordMarks(child, dictionaryForm);
      if (newChild !== child) {
        changed = true;
      }
      newEntries.push([key, newChild]);
    }

    return changed ? Object.fromEntries(newEntries) : value;
  }

  return value;
}

/**
 * 文字列内の `「…━…」` / `「…―…」` を `「…dictionaryForm…」` に置換する。
 * 「」の中に `━` か `―` が1文字でも含まれていれば置換対象。
 * 「」外の `━` / `―` は触らない。
 */
function replaceHeadwordInBrackets(text: string, dictionaryForm: string): string {
  return text.replace(/「([^」]*[━―][^」]*)」/g, (_match, inner: string) => {
    return `「${inner.replace(/[━―]/g, dictionaryForm)}」`;
  });
}
