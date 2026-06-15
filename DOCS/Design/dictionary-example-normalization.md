# Dictionary Definition Transformation Design

> **Status:** Draft / pre-implementation  
> **Phase:** Phase 4 quality optimization — search/input quality follow-up  
> **Related:** `DOCS/Design/language-guardrails.md`, `DOCS/Prompts/prompt-v2.md`

## 目的

Yomitan 辞書の `definitions_json` を、DB に保存された生データは壊さず、LLM に渡す直前だけ読みやすい JSON へ変換する。

最初の本命は **辞書変換機能** として、Yomitan structured-content 内の見出し語代入記号だけを置換する。

```json
"content": "━"
```

を、当たった辞書見出し語である `dictionary_form` に変える。

```json
"content": "軟派"
```

ただし、これは **正しい見出し語代入 placeholder がある時だけ** 行う。辞書側の例文が既に完全な形で入っている場合、変換は no-op にする。

狙いは、小さい LLM に次のような辞書記号の解釈を任せないこと。

```txt
━の不良少年・━を張る〔＝軟派として行動する〕
```

この raw text をそのまま渡すと、LLM が `━` を検索語の代入記号だと理解できず、`・` を用例区切りではなく文章の一部として扱い、次のような存在しない例文を作ることがある。

```txt
不良少年とは異なり、軟派を張る若者
```

これは prompt の弱さというより、**LLM 入力用の辞書JSON変換不足**である。

---

## 採用方針

主対策は Bot 側処理、prompt は補助として扱う。

| 層 | 役割 | 理由 |
|---|---|---|
| Bot 側辞書変換 | 該当する `content: "━"` / `content: "―"` がある場合だけ `dictionary_form` へ置換する | LLM に見出し語代入記号の解釈を任せないため |
| Prompt | 変換後の `definition_json` を辞書の唯一ソースとして扱わせる | raw 記号を再解釈させないため |
| Output Quality Guard | raw 記号残りを ReAsk する | 最後の保険。主対策ではない |

プロンプトだけでは不十分。小さいモデルは「規則を読んだつもり」でも、raw 辞書文字列を自然文として混ぜることがある。

---

## 入力と出力

### 入力

```txt
dictionary_form: 軟派
raw definitions_json 内の一部:
{"tag":"span","data":{"name":"見出相当部"},"content":"━"}
```

### 出力

```json
{
  "tag": "span",
  "data": { "name": "見出相当部" },
  "content": "軟派"
}
```

LLM に渡すときは、DB の `definitions_json` を直接変えず、プロンプト投入直前の派生JSONだけを変換する。

該当 placeholder が無い辞書では、派生JSONは意味的に元の `definitions_json` と同じになる。

この時点では `・` 分割や `note` 化はしない。まずは `軟派の不良少年・軟派を張る〔＝軟派として行動する〕` まで読める状態にする。

---

## 正規化対象

### 1. 見出し語代入記号

辞書によって、見出し語の代わりに次の記号が使われる。

| 記号 | 意味 | 例 | 正規化 |
|---|---|---|---|
| `━` | 見出し語代入 | `━の不良少年` | `軟派の不良少年` |
| `―` | 見出し語代入 | `―を張る` | `軟派を張る` |

置換先は `query` ではなく、原則 `dictionary_form` を使う。

この方式の理由:
- `習いました` のような入力でも、辞書見出しは `習う`。
- 用例は辞書見出し語を基準に復元する方が自然。

### 2. 用例区切りの中点（第2段階候補）

第1段階では `・` を分割しない。

理由:
- `名・他サ` のような品詞表記も同じ記号を使う。
- `content: "━"` / `content: "―"` 置換だけなら、既存 JSON 構造をほぼ壊さない。
- 今回の事故の第一原因は、`━` が見出し語に戻っていないこと。

第2段階で必要になった場合だけ、用例フィールド内の `・` を複数用例の区切りとして扱う。

```txt
━の不良少年・━を張る〔＝軟派として行動する〕
```

正規化:

```txt
1. 軟派の不良少年
2. 軟派を張る
```

ただし、`・` を全 JSON に対してグローバル分割してはいけない。

壊してはいけない例:

```txt
名・他サ
自・他
語中に含まれる固有表記
```

分割対象は、**用例らしい文字列**に限定する。

### 3. 用例補足 note（第2段階候補）

第1段階では `〔＝...〕` も構造化しない。

第2段階で `examples_normalized` を導入する場合、`〔＝...〕` は直前の用例に付く補足説明として、同じ用例オブジェクトへ紐づける。

これは別用例として分離してはいけない。

```txt
━を張る〔＝軟派として行動する〕
```

正規化:

```json
{
  "text": "軟派を張る",
  "note": "軟派として行動する"
}
```

`note` は `軟派を張る` という用例の補足であり、独立した例文ではない。LLM は意味・ニュアンス説明の補助にだけ使う。

---

## データモデル

DB schema は増やさない。`definition_json` を LLM に渡す直前に、Bot 側で派生データを作る。

第1段階の型は、既存 JSON を保ったまま `content` 文字列だけ置き換えるため、新しい公開データ構造を増やさない。

```ts
export function transformDefinitionForPrompt(params: {
  definitionJson: unknown;
  dictionaryForm: string;
}): unknown;
```

将来 `・` 分割や `note` 化が必要になった場合だけ、次の派生構造を追加する。

```ts
type NormalizedDictionaryExample = {
  text: string;
  note: string | null;
  source: "dictionary";
};

type EnrichedDefinitionJson = {
  raw: unknown;
  examples_normalized?: NormalizedDictionaryExample[];
};
```

`examples_normalized` を導入する場合は **1件以上ある時だけ** 付ける。

runtime enrichment を選ぶ理由:
- 現行 `llm.service.ts` の `hasExampleSentences()` は key 名に `/example/i` が含まれるだけでも「例文あり」と見なす。
- 空配列の `examples_normalized: []` を常に付けると、短い辞書定義でも insufficient-data fallback が効かなくなる。
- そのため、正規化済み用例が無い場合は key 自体を出さず、既存の不足判定を壊さない。

理由:
- importer 段階で全辞書形式を完全分類するより、LLM 入力直前で必要最小限に整える方が KISS。
- 既存 `dictionary_entries.definitions_json` / `raw_json` を破壊しない。
- 手動再importなしで改善を反映できる。

### Yomitan structured content について

Yomitan v3 には `{"type":"text","text":"..."}` や `{"type":"example","text":"..."}` のような structured content がある。

この設計では、まず再帰走査で文字列ノードだけを見る。structured content を完全解釈する parser は作らない。

`━` / `―` を含む plain text だけを正規化対象にするため、structured content のうち既に example node として分かれているものは、基本的にこの正規化の対象外でよい。

---

## 実装プラン

### Step 1 — 辞書変換ユーティリティを作る

候補ファイル:

```txt
packages/bot/src/services/dictionary-definition-transformer.service.ts
```

公開関数:

```ts
export function transformDefinitionForPrompt(params: {
  definitionJson: unknown;
  dictionaryForm: string;
}): unknown;
```

最小ルール:

```ts
function replaceHeadwordMarks(value: unknown, dictionaryForm: string): unknown
```

1. `definitionJson` を再帰的に走査する。
2. `key === "content"` かつ value が完全一致で `"━"` または `"―"` の時だけ `dictionaryForm` に置換する。
3. `"━の不良少年"` のような文字列全体置換は第1段階ではしない。Kasou の実データでは `content: "━"` が独立 node として入っているため、ここだけを安全に変える。
4. 該当 placeholder が無い辞書は no-op。既に完全な例文を持つ辞書を変換しない。
5. 元の `definitionJson` オブジェクトを直接 mutate しない。新しい派生オブジェクトを返す。
6. `dictionaryForm` が空なら置換しない。

### Step 2 — LLM 入力だけ差し替える

現在 `messageCreate.ts` は次の形で raw `definitionsJson` を渡している。

```ts
definitionJson: JSON.stringify(result.entry.definitionsJson)
```

これを次のようにする。

```ts
const transformedDefinitionJson = transformDefinitionForPrompt({
  definitionJson: result.entry.definitionsJson,
  dictionaryForm: result.entry.term,
});

definitionJson: JSON.stringify(transformedDefinitionJson)
```

DM owner path と guild path の両方を同じ helper に寄せる。

実装時は `JSON.stringify(transformedDefinitionJson)` も小さな helper に寄せ、DM owner path と guild path で同じ処理を2回書かない。

### Step 2.5 — insufficient-data fallback を壊さない

実装時の必須確認:

```txt
definitionJson が短い
かつ raw 側に例文が無い
かつ examples_normalized が無い
→ 既存通り insufficient-data fallback
```

第1段階では key を増やさず、`content` の値だけを置換する。そのため既存 `hasExampleSentences()` を壊す可能性は低い。

第2段階で `examples_normalized` を追加する場合は、非空の時だけ追加する。

もし将来 `examples_normalized: []` を常時出す設計へ変える場合は、`hasExampleSentences()` を `raw` フィールド優先で見るように先に修正する。

### Step 3 — prompt に補助ルールを追加する

第1段階では、prompt には「`definition_json` は Bot 側で該当する見出し語代入記号がある場合だけ置換済み」と明記する。

第2段階で `examples_normalized` を導入する場合は、正規化済み用例を優先するルールを足す。

```md
## 正規化済み辞書用例

- `definition_json.examples_normalized` が非空の場合、日本語例文はそこだけを使う。
- `examples_normalized.text` は表示してよい最終用例。
- `examples_normalized.note` は、その同じ用例の補足として意味・ニュアンス説明の補助にだけ使う。
- raw の `━` / `―` / `・` を自分で再解釈しない。
- 複数の `examples_normalized` を合成して、新しい日本語文を作らない。
```

### Step 4 — Output Quality Guard に保険を足す（未実装）

主対策は正規化だが、最後の保険として以下を検出する。

| Guard | 例 | 判定 |
|---|---|---|
| raw substitution mark remains | `━の不良少年` / `―を張る` | ReAsk |
| suspicious merge phrase | `とは異なり`, `一方で`, `対照的に` | 第2段階で normalized example がある時だけ ReAsk 候補 |

注意:
- `とは異なり` などは普通の説明でも使えるため、常時禁止しない。
- `examples_normalized` を第2段階で導入した場合だけ、辞書用例が短い phrase 型なのに LLM が長い日本語文へ変換した時に強める。
- 現行 `output-quality-guard.service.ts` には `━` / `―` 検出や merge phrase 検出はまだ無い。本実装時に marker 追加と ReAsk 文言更新を行う。

### Step 5 — テスト

最低限のテスト:

```txt
content: "━"
→ content: "軟派"

content: "―"
→ content: "軟派"

content: "━の不良少年"
→ 第1段階では変えない

名・他サ
→ 分割しない

普通の定義文
→ 変化なし

既に完全な例文
→ 変化なし

短い定義 + 例文なし
→ insufficient-data fallback が既存通り動く

元オブジェクト
→ mutate されない

第2段階候補:
━の不良少年・━を張る〔＝軟派として行動する〕
→ [軟派の不良少年, 軟派を張る + note]
```

---

## 補足案

### A. 変換済み `definition_json` を cache key には入れない

この変換は `definition_json` と `dictionaryForm` から決定的に作れる派生データ。cache key に追加しない。

変換ロジックを変えた時に既存 cache を刷新したい場合は、既存の `prompt_content_hash` を使う。つまり prompt に「変換済み definition_json を前提にする」と明記すれば、hash が変わって自然に新規 cache になる。

### B. DB raw は残すが、LLM 入力は変換済みにする

DB の raw `definitions_json` を消すと監査性が落ちる。DB は raw のまま保持する。

LLM 入力だけ、該当する `content: "━"` / `content: "―"` がある場合に `dictionaryForm` へ置換した派生JSONにする。該当 placeholder が無い場合は no-op。

第2段階で `examples_normalized` を導入する場合のみ、prompt で「日本語例文生成の source は `examples_normalized` 優先」と明記する。

### C. importer での永続正規化は Phase 5 以降

将来的に Admin UI で「正規化済み用例」を表示したいなら、importer 側で保存する選択肢もある。

ただし今は Bot の LLM 入力安定化が目的なので、runtime enrichment の方が安全で小さい。

### D. 完全な辞書記号パーサーにはしない

Yomitan 辞書には辞書ごとの記号流儀がある。最初から全部対応すると壊れる。

Phase 4 の第1段階では以下だけ扱う。

```txt
該当する content: "━" / content: "―" の見出し語代入
```

第2段階で必要になった場合だけ以下を追加する。

```txt
・ 用例区切り（代入記号を含む用例候補内だけ）
〔＝...〕 note 紐づけ（直前用例から切り離さない）
```

これで今回の `軟派` 型の事故を、まず低リスクな置換で狙い撃ちする。

---

## リスクと対策

| リスク | 対策 |
|---|---|
| `・` を品詞表記まで分割する | 第1段階では `・` を分割しない |
| `query` が活用形のまま代入される | `dictionaryForm` を使う |
| 既に完全な例文まで変換してしまう | `content` が完全一致で `"━"` / `"―"` の時だけ置換し、それ以外は no-op |
| `〔＝...〕` 補足を独立用例として扱う | 第1段階では構造化しない。第2段階で扱う場合は同じ用例の `note` に紐づけ、直前用例から切り離さない |
| LLM が `・` 区切りをまだ合成する | まず置換だけで様子を見る。残る場合だけ第2段階で `examples_normalized` を入れる |
| 辞書ごとの差異を吸収しすぎる | Phase 4 第1段階は `content` 完全一致の2記号だけ |

---

## 完了条件

- `軟派` の `definitions_json` 内で `content: "━"` が `content: "軟派"` に置換されて LLM に渡る。
- `―` も同じく `dictionaryForm` に置換される。
- `content: "━"` / `content: "―"` が無い辞書は、LLM 入力上も意味的に変化しない。
- `軟派` を含む curated sample で、LLM 出力に `不良少年とは異なり...` のような合成用例が無いことを手動 spot-check する。
- `名・他サ` のような品詞表記は第1段階では一切触らない。
- `definition_json` の raw 情報は保持される。
- 既存 cache / schema / importer を壊さない。
- 短い定義 + 例文なしの entry で insufficient-data fallback が壊れない。
