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
