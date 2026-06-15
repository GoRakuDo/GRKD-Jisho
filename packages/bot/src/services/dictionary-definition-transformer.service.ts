/**
 * Dictionary Definition Transformer
 *
 * LLM に渡す直前の `definitionsJson` を変換する。
 * DB の生データは変更せず、派生オブジェクトだけを返す。
 *
 * 第1段階: `content: "━"` / `content: "―"` を `dictionaryForm` に置換する。
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
 * `content` キーの値が完全一致で `"━"` または `"―"` の場合だけ
 * `dictionaryForm` に置換する再帰走査。
 *
 * - `"━の不良少年"` のような文字列全体置換は第1段階ではしない。
 * - `data.name === "見出相当部"` かどうかにかかわらず、
 *   `content` が完全一致 `"━"` / `"―"` の時だけ置換する。
 */
function replaceHeadwordMarks(value: unknown, dictionaryForm: string): unknown {
  if (Array.isArray(value)) {
    const mapped = value.map((item) => replaceHeadwordMarks(item, dictionaryForm));
    // 参照が全て同一なら変更なし → 元配列を返す
    return mapped.every((item, i) => item === value[i]) ? value : mapped;
  }

  if (value && typeof value === "object") {
    const entries = Object.entries(value as Record<string, unknown>);
    const newEntries: [string, unknown][] = [];
    let changed = false;

    for (const [key, child] of entries) {
      if (key === "content" && (child === "━" || child === "―")) {
        changed = true;
        newEntries.push([key, dictionaryForm]);
        continue;
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
