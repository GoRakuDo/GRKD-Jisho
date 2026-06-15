# Prompt v2 — Output-Bucket Dictionary Explanation

> **Status:** Draft (pre-implementation)
> **Phase:** Phase 4 Step F
> **Baseline:** v1 (llm.service.ts in-line template)
> **Version:** `v2`

---

## 1. Purpose

v2 exists because v1 has three gaps:

1. **L1 negative transfer** warnings are too abstract (just "避けろ") with no concrete Indonesian-language examples.
2. **Output-bucket explanation policy** is underspecified (just "難易度を調整").
3. **"Not enough data"** has no objective trigger condition, so the LLM guesses freely.

v2 fixes these by adding structured sections, per-bucket ground rules, and deterministic output templates.

---

## 2. Core Principles (Unchanged from v1)

These carry over because they are architecture-level constraints, not prompt tuning:

- Dictionary definitions are the **only** source of truth.
- The LLM must not add meanings that are not in the dictionary entry.
- If dictionary data is insufficient, the LLM must say so.
- The user's Discord role name must not appear verbatim in the prompt (use `roleKey` as the output bucket key).
- L1 negative transfer guidance must not encourage incorrect Japanese.

---

## 3. L1 Negative Transfer — Concrete Examples for Indonesian Speakers

v1 says "L1ネガティブ転移を避ける". v2 adds concrete patterns that commonly confuse Indonesian learners of Japanese.

### 3-1. Word Order (SOV vs SVO)

Indonesian follows SVO (subject-verb-object), Japanese follows SOV (subject-object-verb).

| Indonesian | Direct Translation (wrong) | Correct Japanese |
|---|---|---|
| Saya makan nasi. | 私は食べるご飯を。 | 私はご飯を食べる。 |

**Instruction to LLM:** When the query is a verb phrase, output the example sentence in SOV order. If the user's own example sentence has SVO order, gently note the difference.

### 3-2. Particles (no direct equivalent in Indonesian)

Indonesian does not mark grammatical roles with postpositions.
Common learner errors:

| Error | Why it happens |
|---|---|
| 私は本を読む (always using は) | Indonesian has no topic marker, so learners overuse は for every subject. |
| 学校に行く (omitting に) | Indonesian uses no directional particle. |

**Instruction to LLM:** When explaining a sentence, explicitly show the particle role (subject → が/は, object → を, destination → に/へ, location → で).

### 3-3. Keigo / Politeness Levels

Indonesian has no grammatical inflections for politeness (uses vocabulary choices instead).  
Learners often drop desu/masu or mix plain and polite forms.

**Instruction to LLM:** Always label politeness level (casual / polite / humble) in examples.  
If the query is for the `indonesian` bucket, default to polite form (です・ます) when Japanese example sentences appear.

### 3-4. Passive Voice

Indonesian passive is formed with `di-` prefix; Japanese passive is an inflection.  
Learners may construct "I was eaten by fish" type errors.

**Instruction to LLM:** Only introduce passive voice explanations when the dictionary entry explicitly contains a passive form. Do not proactively teach passive grammar.

---

## 4. Output-Bucket Explanation Policy

> Runtime language validation is specified in `DOCS/Design/language-guardrails.md`. Prompt text should still state the language policy, but final enforcement happens after LLM generation.
> `daily-japanese` allows Japanese + Latin + Common/Inherited + whitespace, while `indonesian` uses the same allowed script set plus English stopword ratio ≤ 10%.

### 4-1. Output Bucket Definitions

| OutputBucketKey | Target | Explanation Style |
|---|---|---|---|
| `daily-japanese` | 日常日本語 | Japanese-only explanation. No Indonesian summary. Keep examples short and natural. |
| `indonesian` | インドネシア語 | Full Indonesian explanation. Japanese examples may be included with furigana and short notes. |

### 4-2. Per-Bucket Forbidden Actions

| Bucket | Forbidden |
|------|-----------|
| `daily-japanese` | Adding Indonesian explanation. Mixing in learner-level CEFR labels. |
| `indonesian` | Omitting Indonesian explanation. Assuming the user wants Japanese-only output. |

---

## 5. Output Format (Strict)

Every response must follow this structure. No deviation.
`{{query}}` is still an input variable; do not emit it as a query-header line.

```
意味:
{core meaning in target language per role}

わかりやすい説明:
{explanation focused on role level}

ニュアンス:
{connotation, usage context, register}

読み: {reading if available; otherwise omit this line}

関連語:
{synonyms, antonyms, related words — only if in dictionary}
...omit if no dictionary data on related words

--- 
出典: {dictionary_name}
```

### 5-1. Mandatory Sections

- `意味:` — always present
- `わかりやすい説明:` — always present
- `ニュアンス:` — always present

### 5-2. Optional Sections

- `読み:` — include only if the dictionary entry has a reading field
- `関連語:` — include only if the dictionary has related entries
- `---` separator and attribution — include only if generating a response (not when returning "not enough data")

### 5-3. "Not Enough Data" Response

Triggered when **both** conditions are met:
1. The definition text is shorter than 20 characters (e.g., "nominal" with no example, no usage notes).
2. No example sentences exist in the dictionary entry.

Output:

```
【{query}】
辞書情報が不足しています。別の単語を調べてみてください。  
（If you speak Indonesian: Coba cari kata lain — data kamus untuk "{query}" belum cukup.）
```

The Indonesian parenthetical is intentionally short. It signals "I know your L1" without filling in missing dictionary data.

Runtime note: insufficient-data replies are bot-owned fallback strings (`source: null`), not LLM-generated text. They skip `DOCS/Design/language-guardrails.md` validation to avoid false positives in `daily-japanese`.

---

## 6. Prompt Template (for implementation)

```txt
あなたは日本語学習者向けの辞書アシスタントです。
以下のルールに厳密に従って回答を生成してください。

## 禁止事項
- 辞書にない意味を追加しない。
- 不明な点を推測しない。
- `definition_json` は Bot 側で、該当する `content: "━"` / `content: "―"` がある場合だけ辞書形へ置換した派生JSONとして渡される。raw の見出し語代入記号を自分で再解釈しない。
- 将来 `definition_json.examples_normalized` が非空で渡された場合、日本語例文はそこだけを使う。raw の `・` を自分で再解釈して、新しい例文を作らない。
- 辞書情報が以下の条件を両方満たす場合は「辞書情報が不足しています」と返す：
  1. 定義テキストが20文字未満
  2. 例文が存在しない
- ユーザーのDiscordロール名をそのままプロンプトに入れない。
- L1負の転移を助長する説明をしない。
- 内部の思考、下書き、検討メモ、英語のメタコメントは出力しない。
- bucket で許可された言語以外を出力しない。違反時は runtime language guardrails が ReAsk する。
- Reasoning 分離は provider-native fields を使う。`{{query}}` は input variable のまま。出力 marker `ANSWER:` / `【{{query}}】` は使わない。

## L1負の転移への注意（インドネシア語話者向け）
インドネシア語話者は以下の間違いをしやすい：
- SVO語順をそのまま日本語に適用（例：私は食べるご飯を → 私はご飯を食べる）
- 助詞の欠落または誤用（例：学校行く → 学校に行く）
- 丁寧語と普通体の混在
これらの誤りをユーザーがした場合、優しく訂正する。ただし、能動的に教えない。

## ロール別説明方針
Output bucket: {{role_key}}

{daily-japanese: 日常日本語の説明。自然な短文を優先し、インドネシア語は混ぜない。
indonesian: 完全インドネシア語説明。必要なら日本語例文にふりがなを付ける。}

## 出力形式（厳守）
読み: {{reading}}
意味:
わかりやすい説明:
ニュアンス:
関連語:
---
出典: {{dictionary_name}}

プロンプト版: {{prompt_version}}

検索語: {{query}}
辞書形: {{dictionary_form}}
辞書ソース: {{dictionary_name}}
辞書定義: {{definition_json}}

## 変換済み辞書JSON
- `definition_json` は Bot 側の辞書変換機能で、`{{dictionary_form}}` に置換済み。
  - `content: "━"` / `content: "―"` の完全一致ノード → `{{dictionary_form}}`
  - `「…━…」` / `「…―…」` を含む文字列 → `「」` 内の `━` / `―` を全て `{{dictionary_form}}` に置換
- `━` / `―` が残っている場合でも、それを自分で推測して新しい例文へ合成しない。
- 将来 `definition_json.examples_normalized` が非空で渡された場合、日本語例文は `examples_normalized.text` だけを使う。
- `examples_normalized.note` は、その同じ用例の補足として意味・ニュアンス説明の補助にだけ使う。独立した例文として扱わない。
- 複数の `examples_normalized` を合成して、新しい日本語文を作らない。
- raw の `・` を読み直して例文を再構成しない。

出力形式に従って回答を生成してください。関連語がない場合はそのセクションを省略してよい。前置きや思考過程は出力しない。
```

---

## 7. Changes from v1 to v2

| Aspect | v1 | v2 |
|--------|----|----|
| Template location | In-line in `llm.service.ts` | Separate file, loaded by env |
| L1 guidance | "避けろ" (abstract) | Concrete examples (word order, particles, keigo, passive) |
| Role policy | "難易度を調整" (vague) | Per-role forbidden actions + language ratio table |
| Output format | 3 fields (意味, 説明, ニュアンス) | 5 fields + mandatory/optional distinction |
| "Not enough data" | "辞書情報が不足しています" (no trigger) | Trigger: definition < 20 chars AND no example sentence |
| Example sentences | Not mentioned | Required for indonesian bucket |
| Indonesian fallback | Not mentioned | Short fallback phrase for "not enough data" |

---

## 8. Cache Invalidation Policy

### 8-1. When v2 is activated

1. Set `PROMPT_VERSION=v2` in `.env`.
2. The `response_cache` composite unique key includes `prompt_version`, so v1 cache and v2 cache coexist.
3. **Do NOT bulk-delete v1 cache.** v1 responses remain for any rollback scenario.

### 8-2. Refresh Strategy

| Scenario | Action |
|----------|--------|
| v1 cache exists, v2 is new | No action needed. v2 entries fill on first lookup. |
| Rollback from v2 to v1 | Set `PROMPT_VERSION=v1`. No delete needed. v2 entries become orphaned but harmless. |
| Manual override exists (v1 or v2) | Do NOT overwrite. `is_manual_override=true` entries are excluded from all cache refresh operations. |

### 8-3. Orphaned Cache

v1-or-v2-only entries that are no longer referenced (switching back to v1 after months of v2) can be purged via the existing `MCP tool request_cache_refresh` with specific query filters, or via a future `grkd-jisho.request_prompt_version_rotate` (Level 4 dangerous).

---

## 9. Prompt Rotate Design (Level 4 Dangerous)

`grkd-jisho.request_prompt_version_rotate` is **not implemented in Phase 4**.  
This section documents the design for future reference.

### 9-1. What a Rotate Would Do

1. Accept a target `prompt_version` (e.g., `v2`).
2. Create an `ops_jobs` entry with `approval_required=true`.
3. Human approves via Web Admin UI.
4. Bot executor:
   a. Reads all `response_cache` entries with `prompt_version != target_version`.
   b. Deletes entries where `is_manual_override=false`.
   c. Updates the env variable (or DB config) to the new version.
   d. Records resultJson with counts (deleted, kept-manual, kept-not-deleted).

### 9-2. Safety Requirements

| Check | Reason |
|-------|--------|
| Human approval required | Affects all responses, API billing increases |
| Dry-run must succeed first | Exists as `dry_run_cache_refresh` |
| Manual overrides excluded | AGENTS.md rule |
| Rollback plan documented | This document serves as rollback guide |
| V1 cache preserved during transition | 8-1 rule |

### 9-3. Preconditions for Activation

- `PROMPT_VERSION=v2` has been tested in a staging environment.
- A/B test infrastructure exists (deferred to post-Phase 4).
- `response_edits` has captured any manual overrides made during v2 period.
