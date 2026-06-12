const DISCORD_MENTION_MARKUP = /<@!?\d+>|<@&\d+>|<#\d+>/g;

const BRACKET_PAIRS = new Map<string, string>([
  ["[", "]"],
  ["【", "】"],
  ["(", ")"],
  ["（", "）"],
]);

function stripLeadingNoiseToken(text: string): string {
  let s = text;

  for (;;) {
    const before = s;

    const trimmed = s.replace(/^\s+/, "");
    if (trimmed.startsWith("#")) {
      const issue = /^#\d+\s*/.exec(trimmed);
      if (issue) {
        s = trimmed.slice(issue[0].length);
        continue;
      }
    }

    const open = trimmed.slice(0, 1);
    const close = BRACKET_PAIRS.get(open);
    if (close) {
      const closeIndex = trimmed.indexOf(close, 1);
      if (closeIndex >= 0 && closeIndex <= 80) {
        s = trimmed.slice(closeIndex + 1).replace(/^\s+/, "");
        continue;
      }
    }

    if (s === before) break;
  }

  return s;
}

/**
 * ルックアップ前の検索文から、Discord mention や装飾タグを取り除く。
 *
 * 既存の lookup_logs には古い raw query が残っているため、
 * analytics 側でも防御的に再利用する。
 */
export function sanitizeLookupQuery(input: string): string {
  const withoutMentions = input.replace(DISCORD_MENTION_MARKUP, " ");
  const stripped = stripLeadingNoiseToken(withoutMentions);
  return stripped.replace(/\s+/g, " ").trim();
}

export function mergePopularQueries(
  rows: Array<{ query: string; count: number | string | bigint }>,
  limit: number,
): Array<{ query: string; count: number }> {
  const counts = new Map<string, number>();

  for (const row of rows) {
    const query = sanitizeLookupQuery(row.query);
    if (!query) continue;
    counts.set(query, (counts.get(query) ?? 0) + Number(row.count));
  }

  return Array.from(counts.entries())
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0], "ja"))
    .slice(0, limit)
    .map(([query, count]) => ({ query, count }));
}

/**
 * 明示的な reading 指定の解析結果。
 *
 * ユーザーが `漢字[よみ]` / `漢字［よみ］` 形式でクエリを送った場合に
 * 抽出する。Frequency ranker をスキップして、指定された reading を最優先で
 * dictionary 検索する用途を想定。
 */
export type ParsedLookupQuery = {
  /** 辞書検索に掛ける term。漢字だけの query なら term と一致。 */
  term: string;
  /** ユーザーが明示した reading。指定なしなら null。 */
  explicitReading: string | null;
  /** 元の入力。parse に失敗した場合はそのまま返す。 */
  rawInput: string;
};

/**
 * `漢字[よみ]` / `漢字［よみ］` 形式を解析する。
 *
 * ルール:
 * - 入力全体が `term[reading]` 形式（間に空白許容、前後に空白許容）のときだけ
 *   explicit reading 指定として扱う
 * - 入力の前後や bracket の前後に**余計なテキスト**がある場合は explicit reading なし
 *   （デフォルトの greedy scan にフォールバック）
 * - bracket 内が空、または bracket 同士が不一致なら explicit reading なし
 *
 * 注意: `【...】` はプロンプトの heading で使うので対象外。
 *
 * 例:
 *   人間[にんげん]   -> { term: "人間", explicitReading: "にんげん" }
 *   人間[  たべる  ] -> { term: "人間", explicitReading: "たべる" }   (内側空白は trim)
 *   人間             -> { term: "人間", explicitReading: null }
 *   今日は人間ですね -> { term: "今日は人間ですね", explicitReading: null }
 *   人間【じんかん】 -> { term: "人間【じんかん】", explicitReading: null } (【】は対象外)
 *   []               -> { term: "[]", explicitReading: null } (term が無い)
 *   人間[]           -> { term: "人間[]", explicitReading: null } (reading が無い)
 */
export function parseLookupQuery(input: string): ParsedLookupQuery {
  const trimmed = input.trim();
  if (!trimmed) {
    return { term: trimmed, explicitReading: null, rawInput: input };
  }

  // 入力全体が `term[reading]` 形式かを判定する。
  // 角括弧は ASCII `[]` または全角 `［］` を受け付ける。
  const match = /^(\S+?)\s*[\[［]\s*(\S+?)\s*[\]］]\s*$/.exec(trimmed);
  if (!match) {
    return { term: trimmed, explicitReading: null, rawInput: input };
  }
  const term = match[1] ?? "";
  const reading = (match[2] ?? "").trim();
  if (!term || !reading) {
    return { term: trimmed, explicitReading: null, rawInput: input };
  }
  return { term, explicitReading: reading, rawInput: input };
}
