# GRKD-Jisho — Roadmap

> **Version:** 1.0  
> **Date:** 2026-05-03  
> **Status:** Active

---

## Overview

```
Phase 0: 環境構築とDB基盤             ~1週間
Phase 1: MVP — Bot コア機能           ~2週間
Phase 2: 管理コマンド + Read-only MCP ~1週間
Phase 3: Web Admin UI + Agent Ops     ~2週間
Phase 4: 品質改善・最適化             ongoing
```

---

## Phase 0 — Foundation (Week 1)

**目的:** 開発環境とデータ基盤を整える

### Tasks

- [ ] **0-1** monorepo セットアップ
  - `pnpm-workspace.yaml` 作成
  - `packages/bot`, `packages/web`, `packages/db` 作成
  - 共通 `tsconfig.base.json` 設定

- [ ] **0-2** Docker 環境構築
  - `docker-compose.yml` に PostgreSQL 16 追加
  - `.env.example` 作成
  - `docker compose up -d` でローカル DB 起動確認

- [ ] **0-3** Drizzle ORM セットアップ (`packages/db`)
  - `drizzle.config.ts` 設定
  - スキーマ定義:
    - `dictionaries`
    - `dictionary_entries`
    - `response_cache`
    - `response_edits`
    - `lookup_logs`
  - `drizzle-kit generate` + `drizzle-kit migrate` 動作確認

- [ ] **0-4** Yomitan インポーター CLI (`packages/db/scripts/import-yomitan.ts`)
  - `.zip` 展開 → `term_bank_*.json` パース
  - `dictionary_entries` に bulk UPSERT
  - 1冊目の辞書をインポートして DB に入ることを確認

- [ ] **0-5** 環境変数スキーマ定義 (zod)
  - `packages/bot/src/config/env.ts`
  - 必須変数が未設定の場合に起動エラーにする

- [ ] **0-6** Rate Limit + Channel Wipe スキーマ追加
  - `role_rate_limits` テーブル（ロール別上限設定）
  - `user_usage` テーブル（ユーザー別当日使用量）
  - `channel_settings` テーブル（wipe_enabled 設定）
  - `scripts/seed-defaults.ts` でデフォルト上限（10回/日）投入

**完了基準:**  
`docker compose up` で PostgreSQL が起動し、辞書データが `dictionary_entries` にインポートされ、全8テーブル（`dictionaries`, `dictionary_entries`, `response_cache`, `response_edits`, `lookup_logs`, `role_rate_limits`, `user_usage`, `channel_settings`）が存在する状態

---

## Phase 1 — MVP Bot (Week 2-3)

**目的:** `@grkd-jisho 単語` に正しく返答できる最小 Bot を作る

### Tasks

- [ ] **1-1** Bot エントリーポイント (`packages/bot/src/index.ts`)
  - discord.js Client 初期化
  - `ready` イベントで起動ログ
  - `DISCORD_TOKEN` で login

- [ ] **1-2** `messageCreate` イベントハンドラー
  - Bot メンション検出
  - 許可チャンネルガード (`DISCORD_ALLOWED_CHANNELS`)
  - クエリ抽出（メンション部分を除いた文字列）
  - 空クエリのバリデーション

- [ ] **1-3** `DictionaryService.lookup(query)` 実装
  - `dictionaries` テーブルから `enabled=true` を `priority ASC` で取得
  - 順番に `dictionary_entries` を検索
  - 最初にヒットした辞書のエントリを返す
  - 全辞書でヒットしない場合は `null` を返す

- [ ] **1-4** `RoleMapperService.resolve(memberRoles)` 実装
  - Discord ロール名 → `role_key` 変換
  - マッチしない場合はデフォルト `pemula` を返す
  - ロールマッピングを環境変数または DB で設定可能にする（将来の拡張）

- [ ] **1-5** `ResponseCacheService` 実装
  - `get(params)`: `response_cache` から完全一致検索
    - `is_manual_override = true` を優先
  - `save(params, responseText)`: 新規 INSERT
  - `buildCacheKey(params)`: キー文字列生成

- [ ] **1-6** `LLMService` 実装
  - `generate(params)`: Gemini API 呼び出し
  - Gemini 失敗時に OpenRouter へ自動フォールバック
  - プロンプトテンプレート `v1` 適用
  - `model_name` と `prompt_version` をレスポンスに付与

- [ ] **1-7** `LookupLogService.record(params)` 実装
  - `lookup_logs` に INSERT
  - `cache_hit` フラグ設定

- [ ] **1-8** Bot の返答フォーマット
  - Discord Embed または コードブロック形式
  - 「見つかりませんでした」メッセージ
  - エラー時のフォールバックメッセージ

- [ ] **1-9** 結合テスト (手動)
  - Discord 開発サーバーで `@grkd-jisho 可憐` を送信
  - キャッシュ Miss → LLM 生成 → 返答 を確認
  - 同じ単語を再送信 → キャッシュ Hit → 返答 を確認

- [ ] **1-10** Rate Limit サービス実装
  - `packages/bot/src/services/rate-limit.service.ts`
  - `checkRateLimit()`: ロール別上限 → DB 使用量 → 許可/拒否判断
  - `incrementUsage()`: `INSERT ... ON CONFLICT DO UPDATE SET count = count + 1`
  - Owner / Administrator は無制限（DB 参照省略）
  - 上限超過時は Ephemeral メッセージ送信

- [ ] **1-11** Channel Wipe-out スケジューラ実装
  - `node-cron` で `0 0 * * * Asia/Bangkok` スケジュール
  - `channel_settings` から `wipe_enabled = true` のチャンネルを取得
  - 対象は毎日 00:00 GMT+7 時点の直近24時間以内メッセージ
  - 固定メッセージ（ピン留め）のみ保持
  - bulkDelete 方式で `messages.fetch({ limit: 100 })` をバッチループ → ピン以外を `bulkDelete()`
  - Bot 起動時（`ready`）にスケジューラを起動

- [ ] **1-12** Observability 基盤
  - 全リクエストに `trace_id` を付与
  - `bot_events` テーブルに処理イベントを記録
  - `bot_heartbeats` テーブルに Bot 稼働状態を定期記録
  - `messageCreate` の各段階（query抽出、rate limit、辞書hit、cache hit/miss、LLM生成、reply）を trace 可能にする
  - ログに token / API key / secret / DM本文 を出さない

- [ ] **1-13** Safe Ops Job 基盤
  - `ops_jobs` テーブルを追加
  - Bot が `pending / approved` job を読み、安全条件を満たすものだけ実行する worker を作る
  - dangerous job（wipe-now、bulk delete、prompt rotate）は human approval 必須
  - 実行結果を `result_json` と `bot_events` に残す

**完了基準:**  
`@grkd-jisho 単語` に対してロール別で回答が返り、2回目以降はキャッシュが使われること。毎日 00:00 GMT+7 に `wipe_enabled = true` の設定チャンネルだけが bulkDelete 方式で自動消去され、固定メッセージのみ保持されること。さらに、検索1回ごとの `trace_id` から処理全体を追えること。

---

## Phase 2 — Admin Commands (Week 4)

**目的:** 管理者が Discord から回答を検索・編集・更新でき、外側AIエージェントが read-only MCP で監視できるようにする

### Tasks

- [ ] **2-1** Slash Command 基盤セットアップ
  - `interactionCreate` イベントハンドラー
  - Command Registry パターン
  - `DISCORD_GUILD_ID` への Command 登録スクリプト

- [ ] **2-2** `/search-jisho <word>` 実装
  - `response_cache` から `query` で検索
  - 全 `role_key` の回答一覧を Embed で表示
  - `is_manual_override` フラグの表示

- [ ] **2-3** `/edit-jisho <response_id>` 実装
  - Discord Modal でテキスト入力
  - `response_cache` を更新（`is_manual_override = true`）
  - `response_edits` に編集履歴 INSERT

- [ ] **2-4** `/refresh-jisho <word> [role]` 実装
  - 指定クエリ（+ ロール）のキャッシュを削除
  - 再生成は次の検索時に自動で行う
  - 管理者確認プロンプト（Ephemeral メッセージ）

- [ ] **2-5** `/source-jisho <word>` 実装
  - `lookup_logs` から直近の `dictionary_id_used` を表示
  - どの辞典から取得されたか + entry ID を表示

- [ ] **2-6** `/priority-jisho` 実装
  - `dictionaries` テーブルから全辞書を `priority ASC` で表示
  - `enabled` 状態も表示

- [ ] **2-7** `/override-jisho <response_id> <text>` 実装
  - 指定 ID の回答を手動テキストで上書き
  - `is_manual_override = true` で保存

- [ ] **2-8** 権限ガード
  - 全管理コマンドに `MANAGE_GUILD` 権限チェック
  - 権限なしの場合は Ephemeral エラーを返す

- [ ] **2-9** Rate Limit 管理コマンド
  - `/ratelimit-set <role> <limit>`: ロール別上限設定（-1 で無制限）
  - `/ratelimit-list`: ロール別上限の一覧表示
  - `/ratelimit-reset <user>`: 特定ユーザーの当日カウントリセット

- [ ] **2-10** Channel Wipe 管理コマンド
  - `/wipe-channel <channel> <on|off>`: チャンネル自動消去の ON/OFF
  - `/wipe-status`: 全チャンネルの wipe 設定・最終消去日時を表示
  - `/wipe-now <channel>`: スケジュールを待たずに即時消去

- [ ] **2-11** MCP Server パッケージ追加 (`packages/mcp`)
  - Node.js + TypeScript で MCP server を作成
  - `@grkd-jisho/db` 経由でDBを読む
  - Discord Bot Token は持たせない
  - MCP tool input は zod で検証

- [ ] **2-12** Read-only MCP tools
  - `grkd-jisho.health`: heartbeat / DB接続 / 最新errorを返す
  - `grkd-jisho.recent_errors`: 直近の warn/error event を返す
  - `grkd-jisho.get_trace`: `trace_id` 単位の処理履歴を返す
  - `grkd-jisho.lookup_stats`: 検索数・辞書hit・上位queryを返す
  - `grkd-jisho.cache_stats`: cache hit / miss を返す
  - `grkd-jisho.rate_limit_status`: role limit と user_usage を返す
  - `grkd-jisho.wipe_status`: wipe_enabled と last_wipe_at を返す

- [ ] **2-13** MCP Audit Log
  - `mcp_audit_logs` テーブルを追加
  - 全 MCP tool call を記録
  - args は secret / token / API key を redacted 保存
  - tool error も記録

**完了基準:**  
管理者が Discord 上から回答の確認・編集・キャッシュ更新ができること。チャンネル自動消去の ON/OFF 設定がコマンドで操作できること。外側AIエージェントが MCP 経由で health / errors / trace / stats を read-only で確認できること。

---

## Phase 3 — Web Admin UI (Week 5-6)

**目的:** ブラウザから快適に管理操作できる UI を作る

### Tasks

- [ ] **3-1** Astro プロジェクトセットアップ (`packages/web`)
  - `@astrojs/react` アダプター追加
  - Tailwind CSS 設定
  - `packages/db` を共有パッケージとして参照

- [ ] **3-2** Discord OAuth2 認証実装
  - `/auth/login` → Discord OAuth2 リダイレクト
  - `/auth/callback` → コード検証 → セッション発行
  - Guild 所属確認 + 管理ロール確認
  - 未認証は `/auth/login` にリダイレクト

- [ ] **3-3** `/admin/responses` — 回答一覧ページ
  - 単語・ロールでフィルター検索
  - `is_manual_override` フラグ表示
  - ページネーション
  - 各行から編集ページへリンク

- [ ] **3-4** `/admin/responses/[id]` — 回答詳細・編集ページ
  - 現在の回答テキスト表示
  - インライン編集フォーム
  - 保存時に `response_edits` に履歴記録
  - 編集履歴タイムライン表示

- [ ] **3-5** `/admin/dictionaries` — 辞書管理ページ
  - 辞書一覧（priority順）
  - ドラッグ＆ドロップで優先順位変更
  - enabled/disabled トグル
  - 新規辞書インポートのトリガー（アップロードフォーム）

- [ ] **3-6** `/admin/cache` — キャッシュ管理ページ
  - 単語・ロール指定でキャッシュ削除
  - 一括削除（辞書別 or 全削除）
  - 削除前に確認ダイアログ

- [ ] **3-7** `/admin/logs` — 検索ログ・統計ページ
  - 人気単語ランキング（過去7日・30日）
  - キャッシュヒット率グラフ
  - ユーザー別検索回数（user_id のみ表示）
  - 辞書別ヒット率

- [ ] **3-8** `/admin/traces` — Trace Viewer
  - `trace_id` で検索
  - Bot処理のイベントタイムライン表示
  - LLM error / DB error / Discord error を区別して表示

- [ ] **3-9** `/admin/ops-jobs` — Agent Ops 承認画面
  - AIエージェントが作成した `ops_jobs` を一覧表示
  - dangerous job は人間が approve / reject
  - job 実行結果と audit log を表示

- [ ] **3-10** Dry-run MCP tools
  - `grkd-jisho.dry_run_wipe`
  - `grkd-jisho.dry_run_rate_limit_change`
  - `grkd-jisho.dry_run_cache_refresh`

**完了基準:**  
ブラウザで Discord 認証後、回答の編集・辞書管理・ログ確認ができること。Trace Viewer で1回の検索フローを追え、AIエージェントが作成した運営ジョブを人間が承認・拒否できること。

---

## Phase 4 — Quality & Optimization (Ongoing)

**目的:** 品質向上・運用最適化

### Tasks (優先度順)

- [ ] **4-1** 全文検索改善
  - `pg_trgm` 拡張を有効化
  - `dictionary_entries.term` と `reading` に GIN インデックス追加
  - 表記揺れ（ひらがな・カタカナ・漢字）の正規化ロジック改善

- [ ] **4-2** `lookup_logs` 自動パージ
  - 90日以上古いレコードを削除するジョブ
  - pg_cron または Bot の定期タスク（`node-cron`）で実装

- [ ] **4-3** プロンプトバージョン管理
  - `v2` プロンプトの実験的導入
  - A/B テスト機能（guild 内一部ユーザーに新プロンプト適用）
  - 古いバージョンのキャッシュを段階的に無効化する仕組み

- [ ] **4-4** エラー監視
  - LLM API エラーのログ集計
  - 辞書未ヒット率の監視
  - Discord への通知（管理者チャンネルに週次レポート）

- [ ] **4-5** Railway / Fly.io デプロイ
  - `packages/bot/Dockerfile` 最適化（multi-stage build）
  - `packages/web/Dockerfile` 最適化
  - 環境変数を Railway / Fly.io の Secrets に移行
  - `DATABASE_URL` を managed PostgreSQL サービスに変更
  - デプロイ手順書作成

- [ ] **4-6** 読み仮名検索対応
  - `reading` フィールドで検索をフォールバックとして追加
  - 例: 「かれん」で検索 → `term` にない場合 `reading` から「可憐」を見つける

- [ ] **4-7** 複数 Guild 対応（Optional）
  - `lookup_logs` の `guild_id` を利用した Guild 別統計
  - Guild 別許可チャンネル設定の DB 管理

- [ ] **4-8** Limited write MCP tools
  - `grkd-jisho.request_cache_refresh`
  - `grkd-jisho.request_user_usage_reset`
  - `grkd-jisho.request_rate_limit_change`
  - `grkd-jisho.request_toggle_wipe`
  - 全て `ops_jobs` + `mcp_audit_logs` 経由に限定

- [ ] **4-9** Agent Runbook / 自律監視
  - 外側AIエージェント用 runbook を `DOCS/Operations/agent-runbook.md` に作成
  - `grkd-jisho.health` → `grkd-jisho.recent_errors` → `grkd-jisho.get_trace` の診断順を固定
  - dangerous operation は human approval 必須
  - ローカル / クラウド両方で監視できる設定例を用意

---

## Milestone Summary

| Milestone | Target | Deliverable |
|-----------|--------|-------------|
| M0 | Week 1 | DB + 辞書インポート完了 |
| M1 | Week 3 | Bot が @メンションに返答 |
| M2 | Week 4 | 管理 Slash Command + Read-only MCP 完動 |
| M3 | Week 6 | Web Admin UI + Agent Ops 承認画面 公開 |
| M4 | Ongoing | 本番デプロイ + AI Agent 自律監視 + 継続改善 |

---

## Definition of Done (各フェーズ共通)

- [ ] 変更が `packages/db` のスキーマと整合している
- [ ] 環境変数は `.env.example` に追記済み
- [ ] エラーケース（辞書未ヒット・LLM失敗）を必ず処理している
- [ ] `is_manual_override` の優先ロジックが崩れていない
- [ ] `lookup_logs` に記録されている
- [ ] 危険操作は `ops_jobs` / `mcp_audit_logs` / human approval と整合している
