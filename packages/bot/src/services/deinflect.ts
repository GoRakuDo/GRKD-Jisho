/**
 * 日本語活用逆変換エンジン（Deinflector）
 *
 * Yomitan の LanguageTransformer から日本語活用ルールのみを抽出し、
 * Bot 用に KISS で再実装したもの。
 *
 * Yomitan からの主な削減点:
 * - 多言語ルールを削除
 * - ビットマスク条件 → ルールの順序と BFS depth limit で代用
 * - サイクル検出 → maximum depth 5 + seen set で対応
 * - MeCab 連携を削除
 *
 * 動作:
 *   BFS で全ルールを depth 5 まで繰り返し適用。
 *   ルールにチェーン可否はなく、全部 depth limit で打ち切られる。
 */

/** deinflect の戻り値 1 件 */
export interface DeinflectResult {
  /** 逆変換後のテキスト */
  text: string;
  /** 適用したルールの深さ（1=1段階、2=2段階チェーン） */
  depth: number;
}

/** 最大チェーン深度（これを超えると打ち切り） */
const MAX_DEPTH = 5;

interface Rule {
  suffix: string;
  replacement: string;
}

/**
 * 全ルール。
 *
 * 原則として longest-suffix-first に並べる。
 * 短い suffix（「て→る」）が長い suffix（「って→う」）より
 * 前に書かれないよう注意。
 */
const RULES: Rule[] = [
  // ── てしまう / でしまう ──
  { suffix: "てしまう", replacement: "て" },
  { suffix: "でしまう", replacement: "で" },
  { suffix: "ちまう", replacement: "て" },
  { suffix: "じまう", replacement: "で" },
  { suffix: "ちゃう", replacement: "て" },
  { suffix: "じゃう", replacement: "で" },
  // ── ている / でいる ──
  { suffix: "ている", replacement: "て" },
  { suffix: "でいる", replacement: "で" },
  { suffix: "てる", replacement: "て" },
  { suffix: "でる", replacement: "で" },
  // ── た形（過去）→ て形 ──
  { suffix: "ったら", replacement: "って" },
  { suffix: "いたら", replacement: "いて" },
  { suffix: "いだら", replacement: "いで" },
  { suffix: "したら", replacement: "して" },
  { suffix: "んだら", replacement: "んで" },
  { suffix: "たら", replacement: "て" },
  { suffix: "だら", replacement: "で" },
  { suffix: "ったり", replacement: "って" },
  { suffix: "いたり", replacement: "いて" },
  { suffix: "いだり", replacement: "いで" },
  { suffix: "したり", replacement: "して" },
  { suffix: "んだり", replacement: "んで" },
  { suffix: "たり", replacement: "て" },
  { suffix: "だり", replacement: "で" },
  { suffix: "った", replacement: "って" },
  { suffix: "いた", replacement: "いて" },
  { suffix: "いだ", replacement: "いで" },
  { suffix: "した", replacement: "して" },
  { suffix: "んだ", replacement: "んで" },
  { suffix: "た", replacement: "て" },
  { suffix: "だ", replacement: "で" },
  // ── ます形（丁寧）──
  // サ変: 勉強します→勉強する
  { suffix: "します", replacement: "する" },
  // くる: 来ます→来る
  { suffix: "来ます", replacement: "来る" },
  // 五段す: 話します→話す（上記のサ変とは別。両方生成し DB でフィルタ）
  { suffix: "します", replacement: "す" },
  // 五段: います→う, きます→く, etc.
  { suffix: "います", replacement: "う" },
  { suffix: "きます", replacement: "く" },
  { suffix: "ぎます", replacement: "ぐ" },
  { suffix: "ちます", replacement: "つ" },
  { suffix: "にます", replacement: "ぬ" },
  { suffix: "びます", replacement: "ぶ" },
  { suffix: "みます", replacement: "む" },
  { suffix: "ります", replacement: "る" },
  // 一般 ます→る（一段、上記に当てはまらない場合のデフォルト）
  { suffix: "ます", replacement: "る" },
  // ません → ます（丁寧否定 → 丁寧形 → さらに辞書形へチェーン）
  { suffix: "ません", replacement: "ます" },
  // ── たい（希望）──
  { suffix: "たい", replacement: "る" },
  // ── ない形（否定）──
  { suffix: "しない", replacement: "する" },
  { suffix: "しない", replacement: "為る" },
  { suffix: "来ない", replacement: "来る" },
  { suffix: "かない", replacement: "く" },
  { suffix: "がない", replacement: "ぐ" },
  { suffix: "さない", replacement: "す" },
  { suffix: "たない", replacement: "つ" },
  { suffix: "なない", replacement: "ぬ" },
  { suffix: "ばない", replacement: "ぶ" },
  { suffix: "まない", replacement: "む" },
  { suffix: "らない", replacement: "る" },
  { suffix: "わない", replacement: "う" },
  // 一段動詞の ない（「食べない」→「食べる」）
  { suffix: "ない", replacement: "る" },
  // ── う（意志形）──
  { suffix: "おう", replacement: "う" },
  // ── そう（様態）──
  { suffix: "そう", replacement: "る" },
  // ── すぎる（過剰）──
  { suffix: "すぎる", replacement: "る" },
  // ── なさい ──
  { suffix: "なさい", replacement: "る" },
  // ── れる（受身・可能）──
  { suffix: "られる", replacement: "る" },
  { suffix: "れる", replacement: "る" },
  // ── せる / させる（使役）──
  { suffix: "させる", replacement: "る" },
  { suffix: "せる", replacement: "る" },
  // ── ば（条件形）──
  { suffix: "えば", replacement: "う" },
  { suffix: "けば", replacement: "く" },
  { suffix: "げば", replacement: "ぐ" },
  { suffix: "せば", replacement: "す" },
  { suffix: "てば", replacement: "つ" },
  { suffix: "ねば", replacement: "ぬ" },
  { suffix: "べば", replacement: "ぶ" },
  { suffix: "めば", replacement: "む" },
  { suffix: "れば", replacement: "る" },
  // ── て形 → 辞書形 ──
  { suffix: "行って", replacement: "行く" },
  { suffix: "って", replacement: "う" },
  { suffix: "って", replacement: "つ" },
  { suffix: "って", replacement: "る" },
  { suffix: "いて", replacement: "く" },
  { suffix: "いで", replacement: "ぐ" },
  { suffix: "して", replacement: "す" },
  { suffix: "んで", replacement: "ぬ" },
  { suffix: "んで", replacement: "ぶ" },
  { suffix: "んで", replacement: "む" },
  // 一段 て形 → 辞書形
  { suffix: "て", replacement: "る" },
  { suffix: "で", replacement: "る" },
  // する / くる 特殊て形
  { suffix: "して", replacement: "する" },
  { suffix: "して", replacement: "為る" },
  { suffix: "来て", replacement: "来る" },
  // 形容詞
  { suffix: "くて", replacement: "い" },
  { suffix: "かった", replacement: "い" },
  // 文語・古語形容詞の限定対応: 止事無き→止事無い、やんごとなき→やんごとない
  { suffix: "無き", replacement: "無い" },
  { suffix: "なき", replacement: "ない" },
  { suffix: "く", replacement: "い" },
];

/**
 * 与えられたテキストを deinflect し、考えられる全逆変換候補を返す。
 *
 * BFS でルールをチェーン適用。
 * - 各ルールの結果は depth limit MAX_DEPTH までキューに入れて継続
 * - seen set で同一テキストの重複を排除（サイクル対策）
 * - 結果を depth → text 順でソートして返す
 *
 * @param text 活用形を含む可能性のある日本語テキスト
 * @returns 逆変換候補の配列（元のテキストは含まない）
 */
export function deinflect(text: string): DeinflectResult[] {
  if (!text || text.length < 2) return [];

  const results: DeinflectResult[] = [];
  const seen = new Set<string>();

  // BFS キュー: { text, depth, appliedRules? }
  const queue: Array<{ text: string; depth: number }> = [];

  // 初期キュー: 元テキストに直接適用できるルール
  for (const rule of RULES) {
    if (!text.endsWith(rule.suffix)) continue;
    const t = text.slice(0, -rule.suffix.length) + rule.replacement;
    if (t === text || seen.has(t)) continue;
    seen.add(t);
    queue.push({ text: t, depth: 1 });
  }

  while (queue.length > 0) {
    const { text: current, depth } = queue.shift()!;
    results.push({ text: current, depth });

    if (depth >= MAX_DEPTH) continue;

    for (const rule of RULES) {
      if (!current.endsWith(rule.suffix)) continue;
      const t = current.slice(0, -rule.suffix.length) + rule.replacement;
      if (t === current || seen.has(t)) continue;
      seen.add(t);
      queue.push({ text: t, depth: depth + 1 });
    }
  }

  // depth 昇順、text 昇順でソート
  results.sort((a, b) => {
    if (a.depth !== b.depth) return a.depth - b.depth;
    return a.text.localeCompare(b.text);
  });

  return results;
}
