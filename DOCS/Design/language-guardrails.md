# Language Guardrails

## 目的

LLM が辞書データから回答を生成したあと、Discord に送る前に出力言語・壊れた記号列・中身のない怠け出力を検査する。

狙いは「LLM を信用する」ことではない。  
辞書回答として出してよい文字だけを通し、韓国語・キリル文字・インド系文字・`@@@` 連発のような崩れた出力、または「形式に従いました」だけで辞書説明をしていない出力を ReAsk で作り直させる。

---

## 背景

実際の Discord 出力で、以下のような混入が確認された。

- `아니다` のような韓国語
- `глобус` のようなキリル文字
- `아니라`, `니다` などのハングル断片
- `@@@Kata Kerja@@@` のような壊れたセクション見出し
- `z...z` のような意味不明なローマ字断片
- インドネシア語 bucket なのに、許可していない第三言語が混ざる
- `The response adheres strictly to the specified format. \boxed{Completed}` のように、辞書説明をせず「完了」だけを自己申告する怠け出力

この問題は prompt だけでは止めきれない。  
生成後に validator を通し、違反したら cache 保存も Discord 返信もせず、ReAsk で修正させる。

---

## 参考にした外部仕様

### Guardrails AI `on_fail="reask"`

Guardrails AI は validator が失敗した時に `reask` で LLM に作り直しを要求できる。

GRKD-Jisho では Python の Guardrails 本体は使わないが、次の考え方だけ採用する。

```txt
LLM output
  ↓
validator
  ├─ pass → validated output
  └─ fail → ReAsk prompt → LLM retry
```

### scb-10x/correct_language_validator

`correct_language_validator` は以下の流れで出力言語を検査する。

```txt
text
  ↓
fast-langdetect
  ↓
expected language と比較
  ↓
違反なら FailResult
```

ただし元実装は Python で、`torch` / `transformers` / `facebook/nllb-200-distilled-600M` に依存する。  
Kasou 上の Node.js Bot にそのまま載せるには重すぎるため、翻訳機能は移植しない。

GRKD-Jisho では「翻訳して直す」のではなく、「違反理由を付けて ReAsk する」方式にする。

---

## 採用方針

### やること

- TypeScript で軽量 validator を実装する
- bucket ごとに許可言語を変える
- 許可外 Unicode script を1文字でも検出したら fail にする
- `@@@` などの壊れた marker も fail にする
- 形式自己申告だけで辞書説明がない怠け出力も fail にする
- 辞書定義があるのに本文が極端に短い、または見出し以外の説明がない出力を fail にする
- fail 時は ReAsk 理由を LLM に渡して、同じ provider で最大2回まで作り直す
- 2回の ReAsk 後も fail なら fallback model に回す
- fallback model の出力も validator を通し、fail なら cache 保存も Discord 返信もしない
- 違反理由を `bot_events` に残す

### やらないこと

- Python Guardrails 本体を導入しない
- HuggingFace 翻訳モデルを Kasou Bot に載せない
- validator が勝手に翻訳して回答を直すことはしない
- 辞書にない意味を validator 側で補完しない

---

## Guard 対象と対象外

### 対象

Language guardrails は **LLM が生成した回答だけ** を検査する。

対象:

- Gemini の通常回答
- Gemini ReAsk 回答
- OpenRouter fallback 回答
- OpenRouter ReAsk 回答

### 対象外

`llm.service.ts` の insufficient-data fallback は guard 対象外にする。

理由:

- `source: null` の固定文言であり、LLM 生成物ではない
- 辞書情報不足時に Bot が自前で返す安全な短文である
- prompt-v2 の historical sample には Indonesian parenthetical が含まれるため、daily-japanese の language guard に通すと誤って fail する可能性がある

つまり、language guardrails は「LLM が勝手に混ぜた言語」を止めるためのもの。  
Bot が所有する固定エラー文や not-found 文を検査するものではない。

---

## Bucket 別ルール

| bucket | 判定方針 | 許可 | 禁止 |
|---|---|---|---|
| `indonesian` | 禁止スクリプト検出 + 英語ストップワード比率。英単語は出力全体の 10% 以内だけ許容する | 日本語スクリプト、Latin 文字全般（インドネシア語・英語）、数字、一般句読点、Markdown 記号 | ハングル/キリル/デーヴァナーガリー/タイ/アラビア文字など非Latin非日本語スクリプト1文字でも検出で fail、英語ストップワード 10% 超過、同一文字3連発ゴミ（Markdown正当3連発を除く） |
| `daily-japanese` | 禁止スクリプト検出のみ。Latin 文字は通す | 日本語スクリプト、Latin 文字全般、数字、一般句読点、Markdown 記号 | ハングル/キリル/デーヴァナーガリー/タイ/アラビア文字など非Latin非日本語スクリプト1文字でも検出で fail、同一文字3連発ゴミ（Markdown正当3連発を除く） |

### 補足

- 両 bucket 共通：禁止スクリプト（ハングル等）が **1文字でも** 入ったら即 ReAsk。辞書・word list による判定は不要。
- `indonesian` bucket では、日本語の見出し・例文・辞書形は許可する。
- `indonesian` bucket では、英語ストップワーク（`the / is / are / a / an / of / in / and / to / that` 等）のトークン数 ÷ 全 Latin トークン数が 10% を超えたら fail。
- `daily-japanese` bucket では Latin 文字（ローマ字・インドネシア語・英語）は通す。禁止スクリプトとゴミマーカーのみで判定。
- Markdown の `#`, `-`, `*`, `>`, `` ` `` は言語ではないので許可する。
- Markdown 正当3連発（` ``` ` / `---` / `***` / `===` / `...`）はゴミマーカーから除外する。
- それ以外の同一文字3連発（`aaa` / `"""` / `///` / `!!!` 等）はゴミマーカーとして fail。

---

## 検出カテゴリ

### 1. Foreign Script Guard

Unicode script 単位で許可外文字を検出する。

| Script | 例 | 判定 |
|---|---|---|
| Hangul | `아니다`, `니다` | fail |
| Cyrillic | `глобус` | fail |
| Devanagari | `नमस्ते` | fail |
| Thai | `ภาษาไทย` | fail |
| Arabic | `مرحبا` | fail |
| Hebrew | `שלום` | fail |
| Greek | `γεια σας` | fail |

> **注意**: 中国語（簡体字・繁体字）は Script=Han で日本語漢字と区別できない。既知の盲点として許容する（「リスクと対策」参照）。

実装の該当箇所:

```ts
const FORBIDDEN_NON_ALLOWED_SCRIPT_PATTERN = /[^\p{Script=Latin}\p{Script=Common}\p{Script=Inherited}\p{Script=Hiragana}\p{Script=Katakana}\p{Script=Han}\p{White_Space}]/u;

const KNOWN_FORBIDDEN_SCRIPT_PATTERNS = [
  { label: "Hangul", pattern: /\p{Script=Hangul}/u },
  { label: "Cyrillic", pattern: /\p{Script=Cyrillic}/u },
  { label: "Devanagari", pattern: /\p{Script=Devanagari}/u },
  { label: "Thai", pattern: /\p{Script=Thai}/u },
  { label: "Arabic", pattern: /\p{Script=Arabic}/u },
  { label: "Hebrew", pattern: /\p{Script=Hebrew}/u },
  { label: "Greek", pattern: /\p{Script=Greek}/u },
];
```

### 2. Garbage Marker Guard

言語ではなく、壊れた出力の形を検出する。

| Pattern | 例 | 判定 |
|---|---|---|
| `@{2,}` | `@@@`, `@@@Kata Kerja@@@` | fail |
| provider/source 混入 | `Amb sources:` など（観測された既知パターン。同種が増えたら別リストで管理） | fail |
| 同一文字/記号4連発以上 | `aaaa`, `""""`, `////`, `!!!!` | fail |
| 同一文字3連発（Markdown除外後） | `aaa`, `"""`, `///`, `!!!` — Markdown正当3連発を除外した上で残るもの | fail |

Markdown の正当な3連発は除外する（完全一致のものだけを除外する）：

| 正当3連発 | 用途 |
|---|---|
| ` ``` ` | コードブロック |
| `---` | 水平線 |
| `***` | 太字区切り |
| `===` | 見出し |
| `...` | 省略 |

> **実装注意**: `www.example.com` のように URL 内に `www` が含まれる場合は URL トークンを事前に除去してから検査する。判定は「同一文字が3文字以上連続」の regex（`/([^\s])\1{2,}/u`）を使い、結果が Markdown 正当3連発（` ``` ` / `---` / `***` / `===` / `...`）に完全一致するものだけを除外する。

### 3. Bucket Language Guard

**新設計（2026-05-27 更新）：スクリプト検出ベース**

`daily-japanese` bucket：
- 日本語スクリプト（漢字/ひらがな/カタカナ） + Latin + Common/Inherited + 空白 以外が1文字でも入ったら fail
- Latin 文字はすべて通す（ローマ字/英語/インドネシア語 どれも OK）
- 85% 日本語確信度チェックは廃止

`indonesian` bucket：
- 日本語スクリプト（漢字/ひらがな/カタカナ） + Latin + Common/Inherited + 空白 以外が1文字でも入ったら fail
- Latin 文字はすべて通す
- 英語ストップワード（`the / is / are / a / an / of / in / and / to / that / this / with / was / were` 等）のトークン数 ÷ 全 Latin トークン数 > 10% → fail

```txt
OK: GRKD-Jisho, Markdown, URL, 数字, ローマ字, 英語, インドネシア語
NG（全bucket）: ハングル1文字でも検出, キリル1文字でも検出, デーヴァナーガリー1文字でも検出など
NG（indonesian のみ）: 英語ストップワード 10% 超過
```

---

## Detection Approach

**2026-05-27 設計変更：辞書ベース → スクリプト検出ベース**

### 変更の背景

旧実装は `@zxcvbn-ts/language-id` / `nspell` / `tinyld` などの外部辞書ライブラリを使い、  
「インドネシア語として認識できる語か？」を単語単位で証明する方式だった。

問題：
- 口語・スラング・文法用語・料理名など、辞書カバレッジ外の語が LLM 出力に多数出現する
- 外部辞書に無い語 → unknown Latin token → fail が止まらず、corpus allowlist が際限なく膨らむ

**新方針：LLM のハルシネーション特性から逆算する**

ハルシネーションが起きるとき、LLM は ABC（Latin）以外のスクリプト（ハングル・キリル・デーヴァナーガリー・アラビア文字等）を混入させる。  
正常な出力は「日本語スクリプト + Latin + 数字/記号」だけで構成される。

よって：

```
禁止スクリプトが1文字でも入った → ハルシネーション → ReAsk
なければ → 通過
```

これで外部辞書・手動 allowlist が一切不要になる。

---

### Output Quality Guard: 怠け出力を落とす

Language Guard は「文字種」と「壊れた記号列」を見る。  
ただし、LLM は文字種としては正しくても、辞書説明をせずに「指定形式に従った」「完了した」とだけ返すことがある。

例:

```txt
## 【利益（りえき）— 日本語の感覚】

The response adheres strictly to the specified format. \boxed{Completed}
```

これは Latin 文字だけなので daily-japanese の Language Guard だけでは通ってしまう。  
しかし辞書 Bot の回答としては中身がないため、別の **Output Quality Guard** で fail にする。

#### 判定対象

Output Quality Guard は Language Guard を通過した LLM output に対して、cache 保存と Discord reply の前に実行する。

```txt
LLM output
  ↓
Language Guard
  ↓ pass
Output Quality Guard
  ├─ pass → cache保存 → Discord reply
  └─ fail → ReAsk
```

#### Fail 条件

| Category | 例 | 判定 |
|---|---|---|
| format-compliance self report | `The response adheres strictly to the specified format`, `I followed the instructions`, `specified format` | fail |
| safety self report | `User Safety: safe`, `Safety: safe` | fail |
| broken dictionary card shape | code block wrapper, Romaji section, sample translation, custom message, generic numbered template headings | fail |
| completion-only marker | `Completed`, `\boxed{Completed}`, `Task completed` | fail |
| assistant refusal / meta response | `As an AI`, `I cannot`, `I can't provide` | fail |
| body missing | 見出しはあるが、見出し以外の説明本文がない | fail |
| too short with dictionary data | 辞書定義が存在するのに本文が短すぎる（見出し/ラベル除去後の本文が250文字未満） | fail |

#### 検出方式の初期方針

`format-compliance self report` は固定 phrase + 軽い regex で検出する。

固定 phrase:

```txt
the response adheres strictly to the specified format
i followed the instructions
specified format
task completed
\boxed{completed}
```

補助 regex:

```txt
/(?:adhere[sd]?|compl(?:y|ied)|conform|follow(?:ed|s)?|meet(?:s|ing)?)\s+(?:strictly\s+)?(?:to\s+)?(?:the\s+)?(?:specified|required|given)\s+format/i
```

MVPでは fuzzy matching は入れない。  
誤検出・取りこぼしが実データで見えた場合に phrase / regex を調整する。

#### body missing / too short の判定

本文判定は `##` 見出しだけに依存しない。  
現在の prompt は `読み:` / `意味:` / `わかりやすい説明:` / `ニュアンス:` / `関連語:` のような plain label 形式も使うため、次の順で見る。

1. code block / URL を除去する
2. `{{dictionary_form}}` / `{{reading}}` を含む先頭見出し行を除去する
3. `読み:` / `意味:` / `わかりやすい説明:` / `ニュアンス:` / `関連語:` などの label 行だけを除去する
4. 残りの本文が250文字未満なら `too-short`
5. 残り本文に日本語文、または Indonesian bucket では Latin 説明文が1文も無いなら `body-missing`

短い辞書語（例: 助詞「は」）でも、辞書説明としては最低限の本文量が必要になる。`User Safety: safe` のような安全判定だけの短文を cache に保存しないため、最低本文長は250文字にする。

#### Output Shape Guard: 辞書カードの形崩れを落とす

2026-06-05 の実 cache で、`query=表` に対して長文ではあるが、本文が `「それ」` の説明、`Romaji:`、`sample translation`、`カスタムメッセージ`、コードブロックを含む壊れた回答が保存された。これは本文長だけでは検出できない。

正常な Indonesian bucket の出力は、次の形を守る。

```txt
## 【半信半疑（はんしんはんぎ）ー Dalam Nuansa Bahasa Indonesia】

**〘名詞〙 Kata Benda**
**Intuisi Inti: ...**

1. **辞書語の意味** ...
   - 例文...
```

つまり、正常な辞書カードは以下の性質を持つ。

- 見出しと本文の主役が検索語・辞書語からズレない
- Indonesian bucket ではインドネシア語の説明文が中心
- 日本語は検索語、読み、品詞、例文、辞書語の引用に限定
- Romaji は出さない
- `sample translation` や `カスタムメッセージ` のような補助セクションを出さない
- ` ```markdown ` のようなコードブロック wrapper を出さない
- `### 1. 主なポイント` / `### 2. 例文と説明` のような汎用テンプレ見出しを出さない

初期実装では、意味ズレの完全判定までは行わず、まず観測済みの壊れ形を fail にする。

Fail marker:

~~~txt
```markdown
Romaji:
sample translation
カスタムメッセージ
### 1. 主なポイント
### 2. 例文と説明
### 3. 語義・ニュアンス
Aturan keseluru:
~~~

さらに、検索語と違う日本語代名詞が本文の主役として繰り返される場合も疑う。初期ルールでは `query` / `dictionary_form` が `これ` / `それ` / `あれ` ではないのに、本文に `「それ」` / `「これ」` / `「あれ」` が3回以上出た場合を fail にする。太字付き引用（例: `**「それ」**`）は二重カウントしない。

この guard は完全な意味理解ではない。目的は、正常な辞書カードの形から大きく外れた出力を cache 保存前に止め、ReAsk へ戻すこと。

#### Bucket 別の最低品質

`daily-japanese` bucket:

- 見出し以外の本文に、日本語の説明文が少なくとも1つ必要
- Latin は Language Guard では通すが、本文が英語の自己申告だけなら fail
- `{{dictionary_form}}` / `{{reading}}` だけを見出しに出して本文が空のものは fail

`indonesian` bucket:

- 見出し以外の本文に、インドネシア語または日本語の説明文が少なくとも1つ必要
- 英語ストップワード比率が 10% 以下でも、format-compliance self report だけなら fail

#### ReAsk 理由

Output Quality Guard の ReAsk は Language Guard と同じ provider retry に乗せる。  
違反理由は「言語違反」ではなく「回答内容不足」として渡す。

例:

```txt
前回の出力は output quality guard に失敗しました。

理由:
- 辞書説明をせず、形式遵守の自己申告だけを返しています。
- 見出し以外の本文に、辞書定義に基づく説明がありません。

辞書データにない意味を追加しないでください。
検索語・読み・辞書定義を使い、最終回答だけを作り直してください。
```

---

### Daily Japanese: 許可スクリプト以外を検出したら fail

```txt
if 許可スクリプト（日本語 + Latin + Common/Inherited + 空白）以外が1文字でも検出 → fail
if 同一文字3連発ゴミ → fail
else → pass
```

85% 日本語確信度チェックは廃止。  
Latin 文字（英語・インドネシア語・ローマ字）はすべて通す。

### Indonesian: 許可スクリプト + 英語ストップワード比率

```txt
if 許可スクリプト以外が1文字でも検出 → fail
if 同一文字3連発ゴミ → fail

englishStopwordCount = 英語ストップワード（the/is/are/a/an/of/in/and/to/that等）の出現数
totalLatinTokenCount = 全 Latin トークン数（Markdown記号・数字・URL を除く）

// ゼロ除算ガード: Latin トークンが0件なら英語なし → pass
if totalLatinTokenCount === 0 → englishRatio = 0

englishRatio = englishStopwordCount / totalLatinTokenCount

if englishRatio > 0.10 → fail / ReAsk
else → pass
```

**トークン化仕様:**
- 空白で分割する
- 各トークンの先頭・末尾の非英数字（`'` アポストロフィ除く）を剥ぎ取る（`it's` → `it's`、`word.` → `word`）
- Markdown コードブロック（` ``` ` ～ ` ``` ` 内）・URL（`https?://...`）・純粋な数字トークンは Latin トークン数から除外する
- ストップワードの照合はケース非依存（`The` も `the` と同一視する）

英語ストップワード一覧（固定）：

```txt
the, is, are, was, were, a, an, of, in, and, to, that, this, with, without,
it, its, for, on, at, by, from, be, been, being, have, has, had, do, does,
did, as, or, not, because, if, then, when, where, why, how, what, can, could,
should, would, may, must, yes, no
```

インドネシア語・日本語文中にこれらが自然に現れることはほぼない。  
追加ライブラリ不要・判定基準が明確。

---

### 廃止したもの

| 廃止対象 | 理由 |
|---|---|
| `@zxcvbn-ts/language-id` | 辞書カバレッジ外の口語が多く、corpus allowlist が無限に増える |
| `nspell + dictionary-en` | スクリプト検出方式では不要 |
| `tinyld` | スクリプト検出方式では不要 |
| `INDONESIAN_COMMON_WORDS`（手動） | 不要 |
| `INDONESIAN_CACHE_CORPUS_WORDS`（corpus allowlist） | 不要 |
| `ENGLISH_MARKERS / INDONESIAN_MARKERS` | ストップワード方式に統合 |
| 日本語85%確信度チェック | 廃止。禁止スクリプト検出のみで十分 |
| Latin run 長さ判定 | 廃止。Latin は全部通す |

---

## Runtime フロー

```txt
messageCreate / messageUpdate
  ↓
dictionary lookup
  ↓
cache lookup
  ├─ cache hit → 既存 cache をそのまま返す
  └─ cache miss
       ↓
     LLM generate
       ↓
     validateOutputLanguage(text, outputBucketKey)
        ├─ pass
        │    ↓
        │  validateOutputQuality(text, outputBucketKey, query, dictionaryForm, definitionJson)
        │    ├─ pass → save cache → reply
        │    └─ fail → ReAsk prompt を追加して同じ provider で LLM retry（最大2回）
        │
        └─ fail
            ↓
          traceEvent("llm.language_guard.failed")
            ↓
          ReAsk prompt を追加して同じ provider で LLM retry（最大2回）
            ↓
          validate again
            ├─ pass → save cache → reply
            └─ fail after 2 ReAsk
                 ↓
               fallback model へ回す
                 ↓
               validate fallback output
                 ├─ pass → save cache → reply
                 └─ fail → cache保存なし → ユーザーへ短いエラー返信
```

### Transport failure と validation failure の分離

LLM 呼び出し後の失敗には3種類ある。

| 種類 | 例 | 扱い |
|---|---|---|
| transport failure | timeout, 429, 5xx, API key error | provider 呼び出しそのものの失敗 |
| validation failure | 未許可スクリプト混入、`@@@`、english-ratio 超過 | provider は返したが内容が不正 |
| quality failure | 形式遵守の自己申告、`Completed` だけ、本文なし | provider は返したが辞書回答として中身がない |

Language guardrails は validation failure と quality failure を扱う。  
transport failure は既存の provider fallback / timeout retry 方針と混ぜすぎない。

実装時の決定表:

| Condition | Action | Provider |
|---|---|---|
| Gemini initial が transport failure | 既存 fallback と同じく OpenRouter へ回し、OpenRouter 出力を validation する。OpenRouter も同じ ReAsk を使う | OpenRouter |
| Gemini initial は成功したが validation/quality failure | Gemini に ReAsk #1 → #2 | Gemini |
| Gemini ReAsk #1 が validation/quality failure | Gemini に ReAsk #2 | Gemini |
| Gemini ReAsk 中に transport failure | その ReAsk は失敗扱い。残り ReAsk 枠があれば次へ進む | Gemini |
| Gemini initial + ReAsk 2回がすべて失敗 | OpenRouter fallback を呼び、OpenRouter でも同じ ReAsk を最大2回まで行う | OpenRouter |
| OpenRouter 全試行（初期 + ReAsk ×2）が validation/quality failure | cache 保存なし、短い error reply | none |

OpenRouter の transport timeout は既存どおり 150 秒 × 最大3回。  
language guard の ReAsk は provider 非依存で同じ扱いにし、OpenRouter でも最大2回まで作り直す。

Gemini initial が transport failure で OpenRouter へ回った場合でも、OpenRouter output が validation failure なら同じ OpenRouter ReAsk を最大2回まで行う。  
壊れた OpenRouter output も送らない。

### cache hit の扱い

初期実装では cache hit は再検査しない。  
理由は、古い cache を全件 runtime で検査すると lookup が遅くなるため。

ただし、管理画面から不正 cache を削除できる状態は維持する。

> **注意**: 本書執筆時点で cache に保存済みの怠け出力は、Output Quality Guard 実装後も runtime 再検査しない。  
> 必要なら管理画面、または運用者による DB 直接操作で該当 cache 行を削除する。  
> 既存 bad cache の自動再検査は、`validated_at` / `validation_status` を導入する将来改善として扱う。

将来必要なら、cache 保存時に `validated_at` / `validation_status` を追加する。

---

## ReAsk 設計

### ReAsk 回数

各 provider で最大2回。

理由:

- 1回だけだと偶発的な混入を直しきれないことがある
- 2回でも壊れる場合は、その provider の出力は採用しない
- Gemini が fail したら fallback model に切り替える
- fallback model の出力も同じ ReAsk を最大2回まで通す
- fallback model まで fail した場合は、壊れた回答を Discord に出さず、cache にも保存しない

### Provider 切り替え

```txt
Gemini initial
  ↓ fail
Gemini ReAsk #1
  ↓ fail
Gemini ReAsk #2
  ↓ fail
OpenRouter fallback initial
  ↓ fail
OpenRouter ReAsk #1
  ↓ fail
OpenRouter ReAsk #2
  ↓ validate
pass → reply/cache
fail → no cache + short error reply
```

OpenRouter 側で技術的 timeout が起きた場合は、既存の OpenRouter timeout retry 方針に従う。  
language guard の ReAsk は provider ごとに最大2回まで。

### ReAsk prompt 例: Indonesian bucket

ReAsk prompt は **元の rendered prompt に追記する**。  
置き換えではない。辞書定義・検索語・bucket・prompt version の文脈を失わないため。

構造:

```txt
{original rendered prompt}

---

前回の出力は language guard に失敗しました。
...
```

```txt
前回の出力は language guard に失敗しました。

bucket: indonesian
許可言語:
- インドネシア語
- 日本語
- 英語（出力全体の 10% 以内）

違反:
- Hangul: "아니다"
- Cyrillic: "глобус"
- Garbage marker: "@@@Kata Kerja@@@"

辞書データにない意味を追加しないでください。
許可言語だけを使い、正しい Markdown 形式で最終回答だけを作り直してください。
```

### ReAsk prompt 例: Daily Japanese bucket

```txt
前回の出力は language guard に失敗しました。

bucket: daily-japanese
許可言語:
- 日本語
- Latin 文字全般（英語・ローマ字・インドネシア語）

違反:
- Hangul: "아니다"
- Garbage marker: "@@@名詞@@@"

辞書データにない意味を追加しないでください。
禁止スクリプトを除去し、正しい Markdown 形式で最終回答だけを作り直してください。
```

> **注意**: `daily-japanese` bucket は Latin 文字（英語・ローマ字・インドネシア語）を通す。
> 「Latin違反」は発生しないため、ReAsk prompt に Latin を violation として記載しない。

---

## 実装対象ファイル案

```txt
packages/bot/src/services/language-guard.service.ts
packages/bot/src/services/output-quality-guard.service.ts
packages/bot/src/services/__tests__/language-guard.service.test.ts
packages/bot/src/services/__tests__/output-quality-guard.service.test.ts
packages/bot/src/services/llm.service.ts
packages/bot/src/events/messageCreate.ts
```

### `language-guard.service.ts`

候補 API:

```ts
type LanguageGuardBucket = "daily-japanese" | "indonesian";

type LanguageGuardViolation = {
  kind: "forbidden-script" | "garbage-marker" | "english-ratio";
  label: string;
  sample: string;
};

type LanguageGuardResult =
  | { ok: true }
  | { ok: false; violations: LanguageGuardViolation[]; reaskReason: string };

export function validateOutputLanguage(text: string, bucket: LanguageGuardBucket): LanguageGuardResult;
export function buildLanguageReaskPrompt(
  originalPrompt: string,
  bucket: LanguageGuardBucket,
  result: Exclude<LanguageGuardResult, { ok: true }>,
): string;
```

### `output-quality-guard.service.ts`

候補 API:

```ts
type OutputQualityViolationKind =
  | "format-self-report"
  | "completion-only"
  | "assistant-meta"
  | "body-missing"
  | "too-short";

type OutputQualityViolation = {
  kind: OutputQualityViolationKind;
  label: string;
  sample: string;
};

type OutputQualityResult =
  | { ok: true }
  | { ok: false; violations: OutputQualityViolation[]; reaskReason: string };

export function validateOutputQuality(params: {
  text: string;
  bucket: "daily-japanese" | "indonesian";
  query: string;
  dictionaryForm: string;
  definitionJson: string;
}): OutputQualityResult;

export function buildOutputQualityReaskPrompt(
  originalPrompt: string,
  result: Exclude<OutputQualityResult, { ok: true }>,
): string;
```

### `llm.service.ts`

`generate()` 直後ではなく、`generateWithLanguageGuardrails()` のような wrapper を追加する案が安全。

ただし、`generate()` が `source: null` を返した場合は insufficient-data fallback なので validation を完全に skip して、そのまま返す。これは Bot 所有の固定文言であり、LLM output ではない。

```txt
generate raw answer
  ↓
validate
  ↓
reask if needed
```

既存 `generate()` を直接大きく変えすぎない。

所有権は次のように分ける。

| 責務 | 所有 |
|---|---|
| provider 呼び出し | `llm.service.ts` |
| language / output quality validation と ReAsk orchestration | `llm.service.ts` の wrapper |
| cache 保存するかどうか | `messageCreate.ts` |
| Discord に何を返すか | `messageCreate.ts` |

候補戻り値:

```ts
type GuardedGenerateResult = {
  text: string;
  source: "gemini" | "openrouter" | null;
  reaskAttempts: number;
  fallbackUsed: boolean;
  languageGuardPassed: true;
};
```

最終的に Language Guard または Output Quality Guard が fail した場合は専用 Error を throw する。  
`messageCreate.ts` はそれを catch し、cache 保存も `finalizeLookup()` もせず、短い error reply を返す。

---

## Unit Test 方針

最低限、以下を固定する。

### Indonesian bucket

| input | expected |
|---|---|
| `Ini penjelasan. 例文: 食べる。` | pass |
| `Ini 아니다 penjelasan.` | fail: Hangul |
| `Ini глобус penjelasan.` | fail: Cyrillic |
| `@@@Kata Kerja@@@` | fail: garbage-marker |
| `นมัสเต` | fail: Devanagari/Thai |
| `This is a plain English explanation of the word.` | fail: english-ratio > 10% |
| `Artinya adalah kata kerja. OK.` | pass（英語 ストップワード比率低い） |

### Daily Japanese bucket

| input | expected |
|---|---|
| `これは自然な日本語の説明です。例: 食べる。` | pass |
| `Ini adalah penjelasan.` | pass（Latin は通す） |
| `Situasi: Dia mantap.` | pass（Latin は通す） |
| `아니다` | fail: Hangul |
| `@@@名詞@@@` | fail: garbage-marker |
| `aaa` | fail: garbage-marker（同一文字3連発） |

### ReAsk

| case | expected |
|---|---|
| first output fail, ReAsk #1 pass | ReAsk #1 answer is cached and replied |
| first output fail, ReAsk #1 fail, ReAsk #2 pass | ReAsk #2 answer is cached and replied |
| Gemini initial + 2 ReAsk all fail | fallback model is called |
| fallback output pass | fallback answer is cached and replied |
| fallback output fail | fallback ReAsk #1/#2 を経ても fail なら no cache save; short error reply |
| first output pass | no ReAsk and no fallback |

### Output Quality Guard

| input | expected |
|---|---|
| `The response adheres strictly to the specified format. \boxed{Completed}` | fail: format-self-report / completion-only |
| `As an AI, I cannot...` | fail: assistant-meta |
| `## 【利益（りえき）— 日本語の感覚】` のみ | fail: body-missing |
| 見出し + 1行の日本語説明 | pass |
| 見出し + Indonesian bucket の説明本文 | pass |

### Final failure

fallback model まで validation / quality failure した場合:

- cache 保存しない
- `lookup_logs` は保存しない
- `user_usage` は増やさない
- Discord には短く返す

候補文言:

```txt
出力が言語ルールを満たしませんでした。管理者にログ確認を依頼してください。
```

理由は、GRKD-Jisho では LLM errors do not increment user_usage or log lookup_logs という既存設計に合わせるため。  
壊れた回答を出せなかった lookup をユーザー消費として数えない。

---

## Observability

失敗時は `bot_events` に残す。

```txt
eventType: llm.language_guard.failed
payloadJson:
  failureCategory: "language" | "quality" | "mixed"
  bucket
  violations[]
  reaskAttempt
  provider
  fallbackUsed
  promptVersion
  promptContentHash
```

`packages/bot/src/types.ts` の `TraceEventType` に `llm.language_guard.failed` を追加済み。

console には短く出す。

```txt
[Lookup] trace={traceId} language guard failed → bucket={bucket} source={source} attempts={reaskAttempts}
[LLM] Gemini language reask failed → attempt=1/2, retrying
```

生の長文回答全文は console に出さない。  
必要なら `bot_events.payloadJson` に短い sample だけ保存する。

---

## リスクと対策

| リスク | 対策 |
|---|---|
| 固有名詞や URL を daily-japanese で誤検出 | URL は検査前に除去し、Latin は通す。残る誤検出は `aaa` / `....` などの同一文字ゴミだけを対象にする |
| Indonesian bucket の Latin script は英語比率だけでは厳密判定できない | 未知の Latin token は通し、英語ストップワード 10% 超だけを ReAsk に使う。必要なら stopword セットを微調整する |
| ReAsk で応答時間が伸びる | 各 provider は最大2回まで。Gemini が fail したら fallback model に切り替え、fallback 出力も fail なら送らない |
| 既存 cache に壊れた出力が残る | 初期実装では runtime 再検査しない。必要なら管理画面または DB 直接操作で削除。将来 `validated_at` / `validation_status` を追加して再検査可能にする |
| 形式遵守だけを自己申告する怠け出力が通る | Output Quality Guard で format-compliance self report / completion-only marker / body-missing を fail にする |
| validator が過剰に厳しい | violation を bot_events に残し、実データで allowlist を育てる |
| 中国語テキストが通過する | 中国語（簡体字・繁体字）は Script=Han で日本語漢字と同一 Unicode Script に属するため、禁止スクリプト検出では排除できない。現時点では許容する。実運用で問題が発生した場合は追加の文字範囲チェック（例: CJK Unified Ideographs Extension 判定）を検討する |
| `www` が URL 内でゴミマーカーに誤検出される | ゴミマーカー検査前に URL トークン（`https?://...`）を除去してから適用する |

---

## 完了基準

- 両 bucket で禁止スクリプト（ハングル/キリル/デーヴァナーガリー/タイ/アラビア等）が1文字でも入ったら ReAsk される
- 両 bucket で同一文字3連発ゴミ（Markdown 正当3連発を除く）が fail になる
- `indonesian` bucket で英語ストップワード比率が 10% を超えたら ReAsk される
- `daily-japanese` bucket では Latin 文字（英語・インドネシア語・ローマ字）は通る
- Language Guard 通過後に Output Quality Guard が実行され、怠け出力は cache 保存されない
- ReAsk 成功時だけ cache 保存される
- Gemini の ReAsk 2回が失敗したら fallback model に回る
- fallback model も ReAsk 2回まで試し、それでも fail した場合は cache 保存されない
- `bot_events` に違反理由が残る
- unit test で Hangul / Cyrillic / Devanagari / garbage marker / indonesian english-ratio 超過を固定する
- unit test で `The response adheres...Completed` / `As an AI` / body missing を固定する
- `pnpm --filter @grkd-jisho/bot test` が通る
- 外部ライブラリ（`@zxcvbn-ts/language-id` / `nspell` / `dictionary-en` / `tinyld`）への依存が消える
