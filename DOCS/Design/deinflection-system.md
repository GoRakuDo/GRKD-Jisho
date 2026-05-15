# Deinflection System Design

## 目的

GRKD-Jisho Bot がユーザーから文（文章）を受け取った時、**先頭から辞書に載っている見出し語を自動抽出**する。
これにより:

- `@bot 今日は天気がいいですね` → `query = "今日"`
- `@bot 思ってたから` → `query = "思って"` → deinflect → `"思う"` で辞書ヒット
- `@bot 食べ過ぎた` → `query = "食べ"` → deinflect → `"食べる"` で辞書ヒット

## なぜ必要か

現状の `lookupWord()` は **完全一致検索** のみ。

```typescript
// lookupWord("思ってたから") → DB に "思ってたから" なんてエントリは無い → null
```

Yomitan は **deinflection engine** で活用形から辞書形を逆引きしている。

```
"思ってた" → [past: た→連用] → "思って" → [te-form: て→終止] → "思う" ✅
```

## アーキテクチャ

```
messageCreate.ts
  │
  ├─ extractFirstTerm()     ← NEW: 先頭から greedy scan
  │    └─ lookupWord()       ← 既存: DB 辞書検索
  │         └─ deinflect()   ← NEW: 活用形→辞書形 逆変換
  │
  └─ (以降は既存フロー)
       lookupWord → cache → LLM → reply
```

## 2 つのコンポーネント

### A. extractFirstTerm() — Greedy Scan

```typescript
function extractFirstTerm(text: string): Promise<ExtractedTerm | null>
```

```typescript
interface ExtractedTerm {
  term: string;          // 辞書にヒットした部分文字列
  result: LookupResult;  // lookupWord の結果（deinflect 済みの場合もある）
}
```

**アルゴリズム:**

1. メンション除去後のテキストを受け取る
2. 最長 20 文字から 1 文字までループ
3. 各部分文字列を `lookupWord()` に渡す
4. 最初にヒットした部分文字列を返す

**トレース例:**
```
入力: "今日は天気がいいですね"
len=20: "今日は天気がいいですね" → lookupWord() → null
len=19: "今日は天気がいいです"   → null
...
len=2:  "今日"                  → lookupWord() → ✅ term: "今日"
→ return "今日"
```

```
入力: "思ってたから"
len=20: "思ってたから" → null
len=19: "思ってたか"   → null
...
len=4:  "思ってた"     → deinflect("思ってた") → ["思う", "思って", ...] で検索 → "思う" ✅
→ return "思ってた"    ← 元の文字列を返す（deinflect は lookupWord 内部でやる）
```

### B. deinflect() — 活用逆変換エンジン

```typescript
function deinflect(text: string): DeinflectionResult[]
```

Yomitan の `LanguageTransformer` から **日本語活用ルールのみ** を抽出・簡略化。

#### ルールテーブル（抜粋）

各ルールは「末尾○○を△△に置き換える」と定義する。
結果に `conditions`（品詞フラグ）を持たせ、チェーン適用を制御する。

| 活用形 | 語尾パターン | 置換後 | 例 |
|---|---|---|---|
| 〜て形（五段） | って → る | 思って → 思う |
| 〜て形（五段） | いて → く | 書いて → 書く |
| 〜て形（五段） | いで → ぐ | 泳いで → 泳ぐ |
| 〜て形（五段） | して → す | 話して → 話す |
| 〜て形（五段） | って → つ | 待って → 待つ |
| 〜て形（五段） | んで → ぬ/ぶ/む | 死んで → 死ぬ |
| 〜て形（一段） | て → る | 食べて → 食べる |
| 〜た形（過去） | た → る / た → て | 思った → 思う / 思って |
| 〜ない（否定） | ない → る | 食べない → 食べる |
| 〜ます（丁寧） | ます → る | 食べます → 食べる |
| 〜たい（希望） | たい → る | 食べたい → 食べる |
| 〜れる（受身） | れる → る | 食べられる → 食べる |
| 〜せる（使役） | せる → る | 食べさせる → 食べる |
| 〜う（意志） | おう → う | 思おう → 思う |
| 〜ば（条件） | えば → う | 思えば → 思う |
| 〜そう（様態） | そう → る/い | 食べそう → 食べる |
| 〜てしまう | てしまう → て | 思ってしまう → 思って |
| 〜ている | ている → て | 思っている → 思って |

#### チェーン例

```
"思ってた"
  → apply [た→て]  → "思って"  (conditions: -て)
  → apply [て→る]  → "思う"    (conditions: 終止形) ✅
```

```
"食べ過ぎた"
  → lookupWord("食べ過ぎた")  → null
  → lookupWord("食べ過ぎ")     → null
  → lookupWord("食べ")         → deinflect("食べ")
    → apply [る→る]  → "食べる"   (nominal → dictionary)
```

#### 実装方針（KISS）

Yomitan の `LanguageTransformer` は汎用エンジンで 273行、日本語ルールが 1790行。
Bot 用に**必要なルールだけをハードコード**する。目安:

- ルール定義: ~200行
- エンジン: ~80行
- 合計: ~300行（Yomitan 比 15%）

**Yomitan から削るもの:**
- 多言語サポート（英語・スペイン語 etc）
- 条件フラグのビットマスク最適化（代わりに単純な string set で OK）
- サイクル検出の複雑なロジック（最大深度 5 で打ち切り）
- MeCab 連携

**Yomitan から維持するもの:**
- suffixInflection の概念（末尾置換）
- ルールチェーン
- 品詞条件によるチェーン制御

## lookupWord() への統合

`lookupWord()` を修正し、完全一致に加えて deinflect 結果でも検索する:

```typescript
export async function lookupWord(rawQuery: string): Promise<LookupResult | null> {
  // 1. 完全一致チェック（既存）
  const exact = await findExactMatch(rawQuery);
  if (exact) return exact;

  // 2. deinflect → 全候補で検索（NEW）
  const candidates = deinflect(rawQuery);
  for (const { text } of candidates) {
    const result = await findExactMatch(text);
    if (result) return {
      ...result,
      originalInflected: rawQuery, // 元の活用形
      deinflectedFrom: text,       // 見つかった辞書形
    };
  }

  return null;
}
```

## ファイル構成

```
packages/bot/src/services/
  ├── deinflect.ts             ← NEW: 活用逆変換エンジン + ルール定義
  ├── dictionary.service.ts    ← 修正: deinflect() を内部で呼ぶ
  └── extract-first-term.ts    ← NEW: greedy scan

packages/bot/src/types.ts      ← 修正: LookupResult に deinflection 情報を追加
```

## テスト方針

### deinflect.ts のテスト

| 入力 | 期待結果 |
|---|---|
| `思って` | `[{text: "思う", ...}]` |
| `思った` | `[{text: "思う", ...}, {text: "思って", ...}]` |
| `食べられる` | `[{text: "食べる", ...}]` |
| `食べさせられた` | `[{text: "食べる", ...}]` （3段階チェーン） |
| `今日` | `[]` （活用形ではないので候補なし） |
| `勉強します` | `[{text: "勉強する", ...}]` |

### extractFirstTerm.ts のテスト

| 入力 | 期待結果 |
|---|---|
| `今日は天気がいいですね` | `"今日"` |
| `思ってたから` | `"思ってた"` |
| `食べ過ぎた` | `"食べ"`（NOTE: Yomitan 辞書に「食べる」が入ってる前提） |
| `cat` | `null`（英語のみなので非対応） |

## ドキュメント更新

変更後、以下を更新する:

- `MASTER_PLAN.md` — deinflection 機能の記載を追加
- `ROADMAP.md` — 必要に応じて追記
- `DOCS/Design/deinflection-system.md` ← このファイル（維持）

## 非対応（Phase 5 以降）

- MeCab 連携（文節単位の分割）
- 複数単語の一括検索（「今日 天気」のように複数結果を返す）
- 漢字⇔仮名変換の曖昧検索（現在の normalizeQuery でカバー済み）
