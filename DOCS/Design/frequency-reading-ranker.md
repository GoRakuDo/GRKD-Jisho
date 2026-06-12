# Frequency Reading Ranker Design

## 目的

漢字だけの query に複数の読みがある場合、Bot が辞書に先に入っている候補を機械的に選ばないようにする。

```txt
人間
  NG: じんかん が先に出たから採用
  OK: Frequency で一般的な にんげん を優先

間
  NG: あい が先に出たから採用
  OK: Frequency で一般的な あいだ / ま を優先
```

単語ごとの例外リストは作らない。日本語の多読みに対して、人力で「人間=にんげん」「間=あいだ」を増やしていく運用はすぐ破綻する。

---

## 現状の問題

現在の `lookupWord()` は、辞書ごとに `dictionary_entries.term` を検索し、最初の1件を返す。

```txt
lookupWord("人間")
  -> 三省堂の最初の term match
  -> reading = じんかん
  -> LLM へ 人間 / じんかん を渡す
```

これは LLM の問題ではない。LLM に渡す前の辞書エントリ選択がすでにズレている。

---

## 根拠

### 1. GRKD-Jisho importer は Frequency をまだ読んでいない

`packages/db/src/services/admin/yomitan-import.ts` は `term_bank_*.json` だけを読む。

```txt
term_bank_*.json -> dictionary_entries
term_meta_bank_*.json -> 未対応
```

つまり、Yomitan Frequency 辞書を置いても、現状のDBには読み候補ランキング用データが入らない。

### 2. Yomitan の Frequency は `term_meta_bank_*.json` に入る

`A:\yomitan\ext\data\schemas\dictionary-term-meta-bank-v3-schema.json` では、Frequency entry は次の形を取る。

```json
["人間", "freq", 123]
```

または読み付き:

```json
[
  "人間",
  "freq",
  {
    "reading": "にんげん",
    "frequency": 123
  }
]
```

読み付きなら `人間/にんげん` と `人間/じんかん` を区別できる。読みなしなら表記単位の頻度なので、多読み解決には弱い。

### 3. Yomitan 本体も term + reading のペアで Frequency を扱う

`A:\yomitan\ext\js\language\translator.js` の `getTermFrequencies()` は `{term, reading}` のペアを受け取り、Frequency data に `reading` がある場合は reading が一致する候補だけを残す。

GRKD-Jisho でも同じ考え方を採用する。

---

## 方針

### 通常検索（実装後の目標動作）

ユーザーが漢字だけを送った場合は、Bot が Frequency を使って自然な読みを選ぶ。

現行実装はまだこの挙動ではない。現行は `term` 完全一致の最初の1件を返すだけなので、この章は実装後の目標動作を示す。

```txt
@bot 人間
  -> 候補: じんかん / にんげん
  -> Frequency で にんげん を優先

@bot 間
  -> 候補: あい / あいだ / ま / かん / けん / はざま
  -> Frequency で一般的な読みを優先
```

### 明示的な特殊読み

ユーザーが特殊読みを意図している場合は、読みを明示できるようにする。

推奨 syntax:

```txt
@bot 人間[じんかん]
@bot 間[あい]
@bot 間[かん]
```

全角も受ける。

```txt
@bot 人間［じんかん］
```

意味はシンプル。

```txt
漢字[よみ]
  -> term = 漢字
  -> reading = よみ
  -> Frequency ranking を飛ばして、その読みの候補を優先
```

この syntax は、ユーザーにとって「この漢字をこの読みで調べたい」とそのまま読める。`人間/じんかん` よりも query と reading の境界が見えやすい。

### かな query

ユーザーがかなだけで送った場合は、今まで通り reading 検索を優先する。

```txt
@bot じんかん
  -> reading = じんかん の候補を探す
```

ただし、かなだけでは同音異義語が多い。特定の漢字に絞りたい場合は `漢字[よみ]` を使う。

---

## Frequency辞書の扱い

### デフォルト候補

最初のデフォルト候補は次にする。

```txt
[Freq] JPDB (Recommended).zip
```

理由:

- 一般用途に寄りやすい
- Anime / Narou / VN / YouTube より偏りが小さい
- Bot の主目的である学習者向け説明に合いやすい
- Step 1 検査の結果、shape が純粋（全部 reading 付き）で parser がシンプル

### 他Frequency辞書の位置づけ

| 辞書 | 位置づけ |
|---|---|
| **JPDB Recommended** | **デフォルト import 対象** |
| BCCWJ | term-only（reading情報なし）。多読み解決不能。コードは対応するが import 対象外 |
| CC100 | reading 付き + reading-less 混在 shape。JPDB と同じ順位結果 |
| Anime / J-drama | 会話・作品寄り。通常読みには便利だが偏る可能性あり |
| Aozora / Novels / Narou | 文学・小説寄り |
| Wikipedia | 固有名詞や百科語に強い可能性あり |
| YouTube / Discord Ranks | ネット会話寄り。学習辞書の基本読みにはやや危険 |
| Innocent Corpus | occurrence count 系として検証用に有用 |

Phase 4 の最小実装では、Frequency辞書を**schema / importer は複数対応**、**import は1つだけ**にする。  
ランタイム ranker は `term_frequencies` テーブルの `dictionary_id` に対して平等に動作するため、後で辞書を追加しても ranker 修正不要。

---

## Step 1 検査結果（2026-06-12 実データ）

`A:\` 配下の `[Freq] *.zip` 3つを PowerShell + System.IO.Compression で直接検査した。

### entry shape

| 辞書 | エントリ数 | entry shape | 人間 entries | 間 entries |
|---|---:|---|---|---|
| **BCCWJ** | 811,357 | `["term","freq",number]` | `["人間","freq",178]` 1件 | `["間","freq",150]` 1件 |
| **CC100** | 160,836 | `["term","freq",{reading,frequency}]` + reading-less | `にんげん=294` + reading-less 141642 | `あいだ=298, かん=1309, ま=1396, けん=27117, はざま=124982` + reading-less 89553 |
| **JPDB** | 515,231 | `["term","freq",{reading,frequency:{value,displayValue}}]` 全部 reading 付き | `にんげん=158` (primary) + `にんげん=37433㋕` (secondary) | `あいだ=308, かん=1639, ...` |

### index.json

```json
BCCWJ:   {"title":"BCCWJ","format":3,"revision":"bccwj.frequency1"}
CC100:   {"title":"CC100","format":3,"revision":"1","sequenced":false,"author":"xydustc","description":"Sudachipy Mode B & fugashi parsed CC100 datasaet, filtered by dictionaries","weight":4}
JPDB:    {"title":"JPDB","format":3,"revision":"JPDB_by-frequency-global_2022-05-10T03:27:02.930Z","frequencyMode":"rank-based","author":"jpdb, Marv","url":"https://jpdb.io","description":"Generated via userscript: https://github.com/MarvNC/jpdb-freq-list\n    ㋕ is used to indicate a frequency for a hiragana reading.\n    ❌ is used to indicate that a term does not appear in the JPDB corpus."}
```

JPDB のみ `frequencyMode: "rank-based"` 明示。  
BCCWJ / CC100 は最初の3エントリ（の=1, は=2, を=3 など）が rank-based と同じ挙動。

### rank方向

3つとも **小さい値ほど一般的**。  
JPDB 公式 description と整合。

### BCCWJ が multi-reading 解決に使えない理由

`人間` の候補が 1件のみ:

```json
["人間","freq",178]
```

reading情報がないため、`じんかん` と `にんげん` を区別できない。  
つまり現状の「`term` 完全一致の最初の1件」問題と同じ壁にぶつかる。  
schema には対応するが、BCCWJ は import 対象外（ranker が候補を選べない）。

### 人間 / 間 の順位結果

| query | BCCWJ | CC100 | JPDB |
|---|---|---|---|
| `人間` | (1件のみ) | `にんげん=294` | `にんげん=158` |
| `間` | (1件のみ) | `あいだ=298, かん=1309, ま=1396, けん=27117, はざま=124982` | `あいだ=308, かん=1639, ...` |

CC100 と JPDB は同じ順位（`人間`→`にんげん`、`間`→`あいだ`）。  
JPDB を採用する根拠は **shape 純粋性** + **entry size 515k**（CC100 は 160k）。

### JPDB `㋕` マーカー

```txt
"㋕" is used to indicate a frequency for a hiragana reading.
```

つまり：

- `人間/にんげん=158` (no ㋕) → その語彙の主要frequency
- `人間/にんげん=37433㋕` → 同じ reading だが、文脈的に補足的なfrequency

rank 最小値採用で自然順序が出るので、**初回実装は `㋕` を区別せず最小値採用**で十分。  
`㋕` を残しておくと displayValue 文字列で「`人間/にんげん`」と「`人間/にんげん（補足）`」が区別できるが、ranking ロジックには影響しない。

### import対象決定

```txt
import対象: [Freq] JPDB (Recommended).zip
BCCWJ / CC100: schema / parser は対応するが import は走らせない
```

---

## DB設計案

新規テーブルを追加する。

```txt
term_frequencies
  id bigserial primary key
  dictionary_id integer references dictionaries(id)
  expression text not null
  reading text null
  frequency_value numeric not null
  display_value text null
  display_value_parsed boolean not null default false
  frequency_mode text not null -- rank-based | occurrence-based
  raw_json jsonb not null
  created_at timestamptz default now()
```

index:

```txt
idx_term_freq_expression
idx_term_freq_expression_reading
idx_term_freq_dictionary_id
uq_term_freq_dict_expression_reading
```

`reading` は nullable にする。Yomitan Frequency には読み付きと読みなしの両方があるため。

---

## Importer設計

`importYomitanDictionaryFromBuffer()` を拡張し、`term_meta_bank_*.json` も読む。

処理:

```txt
index.json を読む
  -> frequencyMode を取得

term_bank_*.json
  -> dictionary_entries

term_meta_bank_*.json
  -> mode === "freq" だけ term_frequencies に保存
```

frequency value の扱い:

```txt
number -> そのまま frequency_value
string -> 数字へ変換できる場合は numeric、display_value に元文字列
{ value, displayValue } -> value を numeric、displayValue を display_value
{ reading, frequency } -> reading 付き frequency として保存
```

数値化できない `string` frequency は、初回実装では保存せず skip する。比較不能な値を `0` として保存すると「最頻出」と誤解される危険があるため、ranking対象から外す。

`frequencyMode` がない辞書は、Yomitan と同じく自動判定する余地を残す。ただし初回は `index.json.frequencyMode` がある辞書を優先して使う。

---

## Ranking設計

### 入力

```txt
query: 人間
candidates:
  - 人間 / じんかん
  - 人間 / にんげん
```

### 優先順位

1. 明示読み指定がある場合は、その reading に一致する候補を最優先
2. query がかなだけの場合は、reading match を最優先
3. Frequency に reading 付きデータがあれば、term + reading で採点
4. reading 付きがない場合は、term 単位 Frequency を弱い補助信号として使う
5. 辞書の重要語 marker を補助信号として使う
6. 参照だけの語義を下げる
7. 同点なら既存の辞書 priority と entry order に戻す

### Frequency mode

Yomitan schema は2種類の mode を持つ。

```txt
rank-based       -> 小さい値ほど一般的
occurrence-based -> 大きい値ほど一般的
```

GRKD-Jisho の内部 score は「大きいほど強い」に揃える。

```txt
rank-based:       score = 1 / (rank + 1)
occurrence-based: score = log(occurrence + 1)
```

この数式は厳密な統計モデルではなく、候補比較用の軽い正規化。KISS を優先する。

---

## Query parser設計

新しい内部型を追加する。

```typescript
type ParsedLookupQuery = {
  term: string;
  explicitReading: string | null;
  rawQuery: string;
};
```

例:

```txt
人間             -> { term: "人間", explicitReading: null }
人間[じんかん]   -> { term: "人間", explicitReading: "じんかん" }
人間［じんかん］ -> { term: "人間", explicitReading: "じんかん" }
```

`sanitizeLookupQuery()` の先頭ノイズ除去とは衝突しない。`[Pre-Release TEST] 食べる` のような先頭ラベルだけを削る設計で、`人間[じんかん]` のような term 後の bracket は残す。

---

## 実装ステップ案

### Step 1: Frequency zip検査

**✅ 2026-06-12 完了**。詳細は上の「Step 1 検査結果」セクション参照。

```txt
- term_meta_bank_*.json が存在するか           → 3つとも存在 ✅
- mode === "freq" が存在するか                → 確認 ✅
- data に reading が入っているか              → BCCWJ NG / CC100 OK / JPDB OK
- 人間 / 間 の実データがあるか                → 3つとも確認
- index.json.frequencyMode が rank-based / occurrence-based のどちらか
  → JPDB 明示 (`rank-based`)
  → BCCWJ / CC100 とも最初の3エントリが rank-based 挙動
- 高頻度語の rank 方向確認                  → 3つとも小さい=一般的
- 数値化できない frequency string 数        → 3つとも int / object のみ。string 無し ✅
```

### Step 2: DB schema + importer

**✅ 2026-06-13 完了**。

- `term_frequencies` テーブル追加 (`packages/db/src/schema/term-frequencies.ts`)
- Migration `0017_icy_norrin_radd.sql` 生成・適用済み
- Yomitan importer (`yomitan-import.ts`) が `term_meta_bank_*.json` を読むように拡張
- 3フォーマット対応: BCCWJ (term-level) / CC100 (mixed) / JPDB (reading-specific)
- `ON CONFLICT DO UPDATE SET frequency_value = LEAST(...)` で複数エントリの MIN 値を保持

### Step 3: Rankerだけ追加

**✅ 2026-06-13 完了**。

- `reading-ranker.service.ts`: `rankTermMatchesByFrequency()` を追加
- `dictionary.service.ts`: 複数読み候補がある場合に ranker を呼び出し、最頻出 reading を選択
- `extract-first-term.ts`: `漢字[よみ]` / `漢字［よみ］` syntax 対応

### Step 4: Query parser

**✅ 2026-06-13 完了**。

- `packages/bot/src/utils/parse-lookup-query.ts`: `parseLookupQuery()` を追加
- `漢字[よみ]` / `漢字［よみ］` の両角 bracket に対応
- 明示読み時は ranker をスキップして直接 `(term, reading)` 検索

### Step 5: Tests

**✅ 2026-06-13 完了**。

- frequency-parser テスト: 15件 (3フォーマット x edge cases)
- reading-ranker テスト: 12件 (term-level only / reading-specific / mixed / rank-based / occurrence-based)
- parse-lookup-query テスト: 12件 (半角/全角 bracket / trailing punctuation / no-bracket)
- dictionary.service テスト: 4件 (multi-reading + ranker / explicit reading / no match / match preserved)
- 合計 178 bot tests pass

### Step 6: WebUI Frequency Import

**✅ 2026-06-13 完了**。

- `frequency-import.ts`: freq-only zip import service (DB client なしの pure parser を `frequency-parser.ts` に分離)
- `POST /api/admin/frequencies/preview` — zip プレビュー (auth + CSRF + isAdmin)
- `POST /api/admin/frequencies/import` — zip インポート (auth + CSRF + isAdmin)
- `dictionaries.astro`: Frequency Import セクション (zip upload → preview table → Import → Enable Now)
- `dictionaries.ts`: GET/PUT に isAdmin gate 追加 (pre-existing gap 修正)

### Step 7: isFrequencyOnly 分離

**✅ 2026-06-13 完了**。

- `dictionaries` テーブルに `is_frequency_only` カラム追加 (migration 0018)
- `importFrequencyZip`: freq-only zip インポート時に `isFrequencyOnly: true` を設定
- `getDictionaryList()`: `not(eq(isFrequencyOnly, true))` で freq-only を除外
- `getFrequencyDictionaries()`: freq-only 辞書のみ返す新関数
- `dictionary.service.ts`: Bot の `lookupWord()` ループで freq-only 辞書をスキップ（hot path の無駄なクエリ排除）
- `dictionaries.astro`: Frequency Data セクションに freq-only 辞書一覧を表示
- Kasou 既存 Freq JPDB: `UPDATE dictionaries SET is_frequency_only = true WHERE slug LIKE 'freq-%'` で手動フラグ更新

---

## 非対応

- 複数 Frequency 辞書の重み付き合成
- ユーザー別 Frequency profile
- 文脈から読みを推定する MeCab / 形態素解析
- LLM に読み選択を任せる方式
- 単語ごとの手動例外リスト

これらは複雑さが高い。最初は `JPDB Recommended` 1本 + 明示読み override で十分。

---

## 成功条件

```txt
@bot 人間
  -> にんげん が選ばれる

@bot 人間[じんかん]
  -> じんかん が選ばれる

@bot 間
  -> Frequency上の一般読みが選ばれる

@bot 間[あい]
  -> あい が選ばれる
```

この時点で「普通の読み」と「ユーザーが意図した特殊読み」の両方を扱える。
