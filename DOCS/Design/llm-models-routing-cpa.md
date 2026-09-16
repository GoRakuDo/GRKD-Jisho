# LLM models.json × CPA ルーティング設計

> **Status:** 設計・実装済み（2026-09-16）。
> **関連:** AGENTS.md §2 / §7、MASTER_PLAN.md §2 / §9、`DOCS/Design/cache-key-prompt-version-only.md`

---

## 1. 目的

LLM 呼び出しを「プロバイダ個別実装（Gemini REST / OpenRouter 直呼び）」から
**OpenAI 互換 `/v1/chat/completions` 1 本に統一**する。

モデル設定は `models.json` で宣言的に管理し、Kasou ミニPC上の
**CLI Proxy API（以下 CPA）** へルーティングする。

```txt
bot (llm.service.ts)
  -> models.json を priority 昇順に試行
  -> POST {baseUrl}/chat/completions （OpenAI 互換）
  -> 失敗したら次の priority へフォールバック
```

---

## 2. CPA（CLI Proxy API）の現状

Kasou で稼働済み（2026-08-26 確認）。

| 項目 | 値 |
|---|---|
| バイナリ | `/usr/local/bin/cli-proxy-api` |
| 設定 | `~/.cli-proxy-api/config.yaml` |
| エンドポイント | `http://127.0.0.1:8317/v1` |
| 認証 | APIキー方式（`.env` の `CPA_API_KEY` で管理） |
| バックエンド | Antigravity アカウント x4 |

公開モデル（`GET /v1/models` 結果、2026-08-26 時点）:

| 系統 | モデル |
|---|---|
| OpenRouter / Gemma | `openreouter-grkd-jisho-gemma-4-31b-it`（gemma-4-31b-it:free, reasoning high） |
| Google1 / Gemma | `google1-grkd-jisho-gemma-4-31b-it`（reasoning high） |
| Google1 / Gemini flash | `google1-grkd-jisho-gemini-3.1-flash-lite`（reasoning high）, `google1-grkd-jisho-gemini-3.5-flash-lite`（reasoning high） |
| Google / Gemini flash | `google-grkd-jisho-gemini-flash-lite`（flash-lite-latest, reasoning high） |
| Gemini pro | `gemini-3.1-pro-low`, `gemini-pro-agent` |
| Claude | `claude-opus-4-6-thinking`, `claude-sonnet-4-6` |
| その他 | `gpt-oss-120b-medium`, `gemini-3.1-flash-image` |

---

## 3. models.json スキーマ

配置: `packages/bot/src/config/models.json`

```json
{
  "models": [
    { "id": "openreouter-grkd-jisho-gemma-4-31b-it", "priority": 0, "baseUrl": "http://127.0.0.1:8317/v1", "apiKeyEnv": "CPA_API_KEY", "timeoutMs": 60000, "maxAttempts": 1, "reasoningEffort": "high" },
    { "id": "google1-grkd-jisho-gemma-4-31b-it", "priority": 1, "baseUrl": "http://127.0.0.1:8317/v1", "apiKeyEnv": "CPA_API_KEY", "timeoutMs": 60000, "maxAttempts": 1, "reasoningEffort": "high" },
    { "id": "google1-grkd-jisho-gemini-3.1-flash-lite", "priority": 2, "baseUrl": "http://127.0.0.1:8317/v1", "apiKeyEnv": "CPA_API_KEY", "timeoutMs": 60000, "maxAttempts": 1, "reasoningEffort": "high" },
    { "id": "google1-grkd-jisho-gemini-3.5-flash-lite", "priority": 3, "baseUrl": "http://127.0.0.1:8317/v1", "apiKeyEnv": "CPA_API_KEY", "timeoutMs": 60000, "maxAttempts": 1, "reasoningEffort": "high" },
    { "id": "google-grkd-jisho-gemini-flash-lite", "priority": 4, "baseUrl": "http://127.0.0.1:8317/v1", "apiKeyEnv": "CPA_API_KEY", "timeoutMs": 60000, "maxAttempts": 1, "reasoningEffort": "high" }
  ]
}
```

- `priority`: 小さいほど先に試行（0 = 第一候補）。起動時に zod 検証して昇順ソート。
- `baseUrl` / `apiKeyEnv` を entry ごとに持つため、**OpenRouter 追加は entry 追加だけで対応**できる
  （例: `"baseUrl": "https://openrouter.ai/api/v1", "apiKeyEnv": "OPENROUTER_API_KEY"`）。
- `timeoutMs` / `maxAttempts` は entry ごとの任意フィールド。未指定時のデフォルトは
  `timeoutMs=150000` / `maxAttempts=2`（現行 OpenRouter 相当）。`maxAttempts` は transport の
  タイムアウト・レスポンス parse failure の同一モデル内リトライ回数を制御する。
  フェイルオーバー時間の予算を短くしたい場合は、entry に明示的な `timeoutMs`
  （例: 30000〜60000ms）と `maxAttempts` を設定できる。
  **→ 現行5 entry は `timeoutMs: 60000` / `maxAttempts: 1` を設定済み**。
- `temperature`（0〜2）/ `topP`（0〜1）は entry ごとの任意フィールド。未指定時は共通デフォルト
  `temperature=0.70` / `top_p=0.8` を継承する。
- `guardReaskMax` は entry ごとの任意フィールド（0以上の整数、未指定時2）。初回出力が language/output-quality guard に不合格だった場合の同一モデル ReAsk 回数を制御し、`maxAttempts` とは独立する。
- `reasoningEffort` は entry ごとの任意フィールド（`"low" | "medium" | "high"`）。
  指定時はリクエストボディに `reasoning_effort` を付与し、未指定時は省略する。
- sampling パラメータは未指定時に共通デフォルト `temperature=0.70`, `top_p=0.8` を継承する。entry に指定した場合はモデル単位の値を使う。

## 4. 現行優先順（確定）

| priority | モデル | 役割 | 備考 |
|---|---|---|---|
| 0 | `openreouter-grkd-jisho-gemma-4-31b-it` | 第一候補（最優先の辞書説明生成） | CPA経由、reasoningEffort: high、maxAttempts: 1 |
| 1 | `google1-grkd-jisho-gemma-4-31b-it` | 第二候補 | CPA経由、reasoningEffort: high、maxAttempts: 1 |
| 2 | `google1-grkd-jisho-gemini-3.1-flash-lite` | 第三候補 | CPA経由、reasoningEffort: high、maxAttempts: 1 |
| 3 | `google1-grkd-jisho-gemini-3.5-flash-lite` | 第四候補 | CPA経由、reasoningEffort: high、maxAttempts: 1 |
| 4 | `google-grkd-jisho-gemini-flash-lite` | 最終手段（有料） | CPA経由、reasoningEffort: high、maxAttempts: 1 |

新しいモデルは、同じ models.json の entry 追加で優先順リストへ組み込める。

---

## 5. llm.service.ts の統合方針

- `callGemini()`（Gemini ネイティブ REST）/ `callOpenRouter()`（OpenRouter 専用）を廃止し、
  `callChatCompletions(modelEntry, prompt)` 1 本に統一する。
- reasoning 制御: OpenRouter 固有のレガシー `reasoning.exclude` は送らない。
  CPA 経由の thinking 制御には標準パラメータ `reasoning_effort` を使用し、
  各モデルの `reasoningEffort` 設定（例: `"high"`）に応じてリクエストボディに付与する。
  CPA 経由の応答は `message.content` のみを採用し、壊れた出力は既存の
  Output Quality Guard が検知する。
- Guardrail 挙動: language guard / output quality guard → entry の `guardReaskMax` 回まで同一モデルで ReAsk
  （未指定時は最大2回）→ 不合格なら次 priority のモデルへ。`guardReaskMax: 0` なら ReAsk せず即座に次 priority へ進む。
- `maxAttempts` は transport retry、`guardReaskMax` は guard ReAsk を制御し、両者は独立している。
- `GenerateResult.source` は `"gemini" | "openrouter"` 型から `string`（model id）へ変更。
  `LanguageGuardError.source` も同様。
- 保存先への影響なし: `lookup_logs.llm_source` / `response_cache.model_name` は text カラムなので
  model id 文字列をそのまま保存する（schema 変更不要）。

## 6. キャッシュ互換性

キャッシュキーに `model_name` / プロバイダは含まれない（2026-07-04 変更済み、
`cache-key-prompt-version-only.md` 参照）。
したがって **本ルーティング切り替えでキャッシュが無効化されることはない**。
`model_name` は audit 用メタ情報として生成モデルの id を記録するだけ。

---

## 7. env 変更

| 変数 | 変更 |
|---|---|
| `CPA_API_KEY` | **新規（required）**。CPA の api-keys と一致させる値を Kasou `.env` に設定 |
| `GEMINI_API_KEY` | **削除**（Gemini 直呼び廃止） |
| `OPENROUTER_API_KEY` | required → **optional**（将来の OpenRouter entry 追加用に残す） |

---

## 8. /definisi スラッシュコマンド

一般ユーザー向けの辞書検索入口。メンション経由と同じパイプラインを共有する。

| 項目 | 仕様 |
|---|---|
| コマンド名 | `/definisi` |
| オプション | `word`（string, required） |
| 対象 | 一般ユーザー（`requiresAdmin: false`）、guild のみ（DM 不可） |
| チャンネル制限 | `DISCORD_ALLOWED_CHANNELS` 内のみ（メンション経由と同一） |
| 返信 | 公開返信（`deferReply` → `editReply`）。Embed 上限対策は既存 truncate 流用 |
| Rate limit | メンション経由と **共有**（`user_usage` に両方カウント）。Owner / Administrator 無制限ポリシー踏襲 |
| ログ | `trace_id` 発行、`finalizeLookup`（lookup_logs + incrementUsage）をメンション経由と同様に実施 |
| 応答フロー | rate limit check → dictionary lookup → bucket resolve → cache check → LLM generate if miss → save cache / log → reply |

既存 admin コマンド（`commands/index.ts` の register 基盤）に同じフローで登録する。

---

## 9. メンション経由の返信ガード

Discord の Reply 機能で Bot メッセージに返信すると、明示的な `@bot` 入力がなくても
`message.mentions` に Bot が含まれるため誤発火していた。

- **Bot メッセージへの Reply（`message.reference` あり + 返信先が Bot）は無視する。**
- 明示的に `@bot` タグを打ったメンションは従来どおり反応する（タグ形式保持）。
- `@here` / `@everyone` 単独では Bot は反応しない（trigger は `mentions.has(botId)` のみ）。
  メンション付き本文中の `@here` / `@everyone` トークンは query 抽出時に sanitize して除外する。

---

## 10. 実装チェックリスト（後続作業）

- [x] `models.json` + zod ローダ実装（priority 昇順ソート）
- [x] `llm.service.ts` 統一（`callChatCompletions` 化、guard 対応、source 型変更）
- [x] `config/llm-model.ts` の廃止（sampling defaults・timeout/attempt 定数はローダ側へ移行し二重化を防ぐ）
- [x] `env.ts` 更新（`CPA_API_KEY` 追加、`GEMINI_API_KEY` 削除、`OPENROUTER_API_KEY` 任意化）
- [x] `/definisi` コマンド追加 + `commands/index.ts` 登録
- [x] messageCreate 返信ガード（Bot への Reply を無視）
- [ ] Kasou `.env` へ `CPA_API_KEY` 設定
- [x] DOCS/Operations 配下の env 記載を `CPA_API_KEY` に更新（deploy.md / deploy-kasou.md / setup-full-design.md。deploy-improvements.md は歴史記録のため対象外）
- [ ] 実装時に MASTER_PLAN の性能目標「応答時間（LLM 生成）5秒以内」と timeout 設定の整合を見直す（暫定 `timeoutMs=60000` 設定済み、Kasou 実測後に確定）
- [ ] Discord 実機確認（mention path・/definisi・cache hit・fallback 切替・rate limit）

> **対象外:** `DOCS/Roadmap_Implement/phase-*.md` の旧 provider 名・env 記載は Phase 完了済みの実装記録（歴史文書）であり、本設計の更新対象外とする。
> **実装記録:** phase-1-bot-mvp.md §26 を参照。
