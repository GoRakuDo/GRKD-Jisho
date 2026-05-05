# Phase 3 — Web Admin UI + Agent Ops 実装プラン

> **対応 Roadmap:** Phase 3 (Week 5-6)  
> **Date:** 2026-05-05  
> **Status:** Draft  
> **Phase 2 完了前提:** Slash Commands / read-only MCP / audit log / ops_jobs 基盤が動いていること  
> **完了基準:**
> - Discord OAuth2 でログインした管理者だけが Web Admin UI に入れる
> - 回答検索・回答編集・辞書管理・cache管理・検索ログ確認がブラウザからできる
> - Trace Viewer で `trace_id` 単位の Bot 処理を追える
> - `ops_jobs` の承認・拒否を人間が Web UI から行える
> - MCP Level 2 dry-run tools が追加され、全 tool call が `mcp_audit_logs` に残る

---

## 0. 実際に読んだ根拠

このプランは推測ではなく、以下を読んだうえで作る。

| 根拠 | 読んだ箇所 | 意味 |
|---|---:|---|
| `ROADMAP.md` | 232-294 | Phase 3 の正式スコープは Web Admin UI、Agent Ops 承認画面、dry-run MCP tools。 |
| `MASTER_PLAN.md` | 984-1095 | `ops_jobs`、`mcp_audit_logs`、MCP Level 1-4、禁止事項の正。 |
| `AGENTS.md` | 340-382 | MCP 4段階アクセス、Level 4 human approval、MCPからDiscord API危険操作禁止。 |
| `packages/web/package.json` | 1-15 | Web は Astro stub のみ。React/Tailwind/Node adapter は未導入。 |
| `packages/web/tsconfig.json` | 1-8 | `src` 前提だが、現時点で `packages/web/src` は存在しない。 |
| `.env.example` | 18-22 | Web auth 用に `DISCORD_CLIENT_SECRET` / `SESSION_SECRET` / `ADMIN_ROLE_IDS` が既に用意されている。 |
| `packages/mcp/src/index.ts` | 49-159 | MCP Level 1 tool は7本。全て `withAudit()` 経由。 |
| `packages/mcp/src/index.ts` | 161-164 | Phase 2 は `MCP_READONLY_MODE=true` を強制している。 |
| `packages/db/src/schema/ops-jobs.ts` | 3-24 | 承認フロー用 `ops_jobs` は既に存在する。 |
| `packages/db/src/schema/mcp-audit-logs.ts` | 5-21 | MCP audit log は既に存在する。 |
| `packages/bot/src/services/ops-job.service.ts` | 11-35 | Bot は `pending approvalRequired=false` と `approved approvalRequired=true` をポーリングする。 |
| `packages/bot/src/services/response-admin.service.ts` | 17-180 | Phase 2 の管理操作は Bot パッケージ内にDBロジックとして実装済み。Webから再利用するには共有化が必要。 |
| `packages/bot/src/services/dictionary.service.ts` | 5-10 | Bot の辞書検索は `enabled=true` かつ `priority asc` を使う。Web辞書管理はここを壊してはいけない。 |
| `DESIGN.md` | 全行 | Web Admin UI のデザイン仕様。OKLCH色トークン、royal blue アクセント、typography、コンポーネント定義、Do/Don't。Phase 3 の全UI実装はこのDESIGN.mdに従う。 |
| Astro Docs | Context7 | React integration、API endpoint、middleware locals、Node adapter SSR の公式例を確認。 |
| Discord API Docs | Context7 | OAuth2 authorization code flow、`identify guilds`、`/users/@me/guilds/{guild.id}/member` を確認。 |

---

## 1. Phase 3 の目的

Phase 3 は、Discord Slash Command 中心の管理から、ブラウザ中心の管理へ広げる段階だ。

やることは3つ。

```txt
Web Admin UI       = 人間の管理者が見やすく編集・確認する場所
Agent Ops UI       = AIエージェント由来の ops_jobs を人間が承認・拒否する場所
MCP dry-run tools  = 外側AIエージェントが安全に変更前の影響を確認する入口
```

ただし、Phase 3 でも MCP に Discord Bot Token は持たせない。
Discord API の危険操作を実行するのは引き続き `packages/bot` だけ。

---

## 2. Phase 3 でやらないこと

YAGNIを守るため、以下は Phase 3 ではやらない。

| やらないこと | 理由 | 後続Phase |
|---|---|---|
| MCP Level 3 limited write tools | Phase 3 は dry-run まで。write解禁は監査とUI承認が固まった後。 | Phase 4 |
| MCP Level 4 dangerous tools | human approval 必須。Phase 3では承認画面だけ作る。 | Phase 4 |
| Web から Discord API の削除系操作を直接呼ぶ | Bot Service だけが Discord API 実行者という設計を守る。 | なし |
| 任意SQL実行UI | セキュリティリスクが高い。 | なし |
| Playwright等のE2E基盤 | まだUI初期実装。まず `astro check/build` とサービス単体検証を優先。 | 必要時 |
| 複数Guild完全対応 | Roadmapでは Phase 4 optional。Phase 3は `DISCORD_GUILD_ID` 1つを正とする。 | Phase 4 |
| response_cache manual override の一括削除 | 手動編集を壊す危険がある。 | Phase 4 dangerous |

---

## 3. Phase 3 完了時のディレクトリ構成

```txt
packages/
  web/
    astro.config.mjs
    package.json
    tsconfig.json
    src/
      env.ts
      middleware.ts
      layouts/
        AdminLayout.astro
      pages/
        index.astro
        auth/
          login.ts
          callback.ts
          logout.ts
        admin/
          index.astro
          responses/
            index.astro
            [id].astro
          dictionaries.astro
          cache.astro
          logs.astro
          traces.astro
          ops-jobs.astro
        api/
          responses/
            [id].ts
          dictionaries/
            [id].ts
            priority.ts
          cache/
            refresh.ts
          ops-jobs/
            [id].ts
      server/
        auth/
          discord-oauth.ts
          session.ts
          require-admin.ts
        security/
          csrf.ts
          redaction.ts
        audit/
          admin-action-audit.ts
        services/
          dashboard.service.ts
          response-admin.service.ts
          dictionary-admin.service.ts
          cache-admin.service.ts
          trace-viewer.service.ts
          ops-jobs-admin.service.ts
      components/
        admin/
          ResponseTable.tsx
          ResponseEditor.tsx
          TraceTimeline.tsx
          OpsJobTable.tsx
          ConfirmDialog.tsx

  db/
    src/
      services/
        admin/
          response-admin.ts
          dictionary-admin.ts
          cache-admin.ts
          trace-viewer.ts
          ops-jobs-admin.ts

  mcp/
    src/
      tools/
        read-only-tools.ts
        dry-run-tools.ts
```

補足。
既存の `packages/bot/src/services/response-admin.service.ts` は DB-only ロジックを多く含む。
Web と Bot の両方で使うため、Phase 3 では `@grkd-jisho/db` 側へ共有サービスとして移す。

---

## 4. Task 3-0 — Phase 2 境界の再確認

実装前に、Phase 2 の安全条件をもう一度確認する。

### 確認すること

- `pnpm install`
- `docker compose up -d postgres`
- `pnpm db:migrate`
- `pnpm db:generate` が `No schema changes`
- `pnpm --filter db exec tsc --noEmit`
- `pnpm --filter bot exec tsc --noEmit`
- `pnpm --filter mcp exec tsc --noEmit`
- `pnpm --filter bot test`

### ガード

- Phase 2 regression が残っている場合、Web 実装に進まない。
- `MCP_READONLY_MODE=true` のまま Level 2 dry-run を足せる設計にする。
- `ops_jobs` の status 遷移を壊さない。

---

## 5. Task 3-1 — Astro SSR + React + Tailwind セットアップ

### 目的

`packages/web` を stub から実アプリにする。

### 方針

- Astro 5 を継続使用。
- React islands は編集フォーム・確認ダイアログ・trace timeline など、状態が必要な部分だけに使う。
- SSR が必要なので `@astrojs/node` adapter を入れる。
- Tailwind は Astro 5 の公式 Tailwind 4 経路を使う。

### 実装メモ

公式ドキュメント上は以下が根拠。

- React integration は `@astrojs/react` を `integrations: [react()]` に追加する。
- API endpoint は `src/pages/api/*.ts` で `APIRoute` / `APIContext` を使う。
- middleware は `context.locals` にユーザー情報を載せられる。
- Node adapter は `output: "server"` + `adapter: node({ mode: "standalone" })`。

### 追加候補パッケージ

実装時は package.json を手編集しない。
pnpm で追加する。

```txt
@astrojs/react
@astrojs/node
react
react-dom
@tailwindcss/vite
tailwindcss
@astrojs/check
@types/react
@types/react-dom
```

### 検証

- `pnpm --filter web build`
- `pnpm --filter web check`
- `pnpm --filter web exec tsc --noEmit`

`.astro` ファイルは素の `tsc` だけでは十分に検査できない。
Phase 3 では `astro check` 相当の script を追加する。

---

## 6. Task 3-2 — Web用 env schema

### 目的

Web 起動時に必要な環境変数を早期検証する。

### 必須 env

```txt
DATABASE_URL
DISCORD_CLIENT_ID
DISCORD_CLIENT_SECRET
DISCORD_GUILD_ID
SESSION_SECRET
WEB_BASE_URL
```

### 任意 env

```txt
ADMIN_ROLE_IDS
```

`ADMIN_ROLE_IDS` は空でも起動できるようにする。
Guild Owner / Administrator / ManageGuild だけで運用するサーバーもあるため。

### 補足

`.env.example` には既に以下がある。

```txt
DISCORD_CLIENT_SECRET
SESSION_SECRET
ADMIN_ROLE_IDS
```

Phase 3 では `WEB_BASE_URL` を追加する。
OAuth callback URL を安定して組み立てるため。

### セキュリティ

- `SESSION_SECRET` は32文字以上を要求。
- tool出力やログに secret を出さない。
- `DISCORD_TOKEN` は Web に不要。Web env schema に含めない。
- `.env.example` に `WEB_BASE_URL` を追加する。

---

## 7. Task 3-3 — Discord OAuth2 認証

### 目的

Web Admin UI を Discord 管理者だけに開く。

### OAuth flow

```txt
/auth/login
-> Discord OAuth2 authorize
-> /auth/callback
-> code を token に交換
-> /users/@me で user id を取得
-> /users/@me/guilds で対象 guild 所属と permissions を確認
-> /users/@me/guilds/{guild.id}/member で role ids を確認
-> 管理者なら HttpOnly session cookie を発行
```

### scopes

```txt
identify guilds guilds.members.read
```

### 管理者判定

許可条件は既存 Slash Command と揃える。

```txt
1. Guild Owner
2. Administrator permission
3. ManageGuild permission
4. ADMIN_ROLE_IDS に一致する role を持つ
```

### セッション方針

DB session table はまだ作らない。
MVPでは署名付き HttpOnly cookie で足りる。

cookie に入れる情報は最小限。

```txt
discordUserId
guildId
isAdmin
expiresAt
authCheckedAt
```

`roleIds` は cookie に保存しない。
権限変更後も古い role が残ると危ないため。

### session TTL

- session max age は 8時間から始める。
- 重要なPOST操作前は `authCheckedAt` が古ければ Discord 側で再確認する。
- 再確認に失敗したら session を破棄して `/auth/login` へ戻す。

### CSRF / state

- OAuth `state` をランダム生成する。
- `state` は短命 cookie に保存。
- callback で一致しない場合は拒否。

### 失敗時

- guild未所属 → `/auth/login?error=guild_required`
- 権限不足 → `/auth/login?error=admin_required`
- token交換失敗 → `/auth/login?error=oauth_failed`

### Web API ガード

ページだけでなく、`/api/*` も必ず守る。

- `/admin/*` と `/api/*` は middleware で session 必須。
- 書き込み系 API は各 handler でも `requireAdmin()` を呼ぶ。
- GET でDBを書き換えない。
- POST / PUT / DELETE は CSRF token を必須にする。
- JSON body はサイズ上限を設ける。

---

## 8. Task 3-4 — DB-only admin services の共有化

### 目的

Bot と Web で同じDB操作を使い、二重実装を避ける。

### 現状

`packages/bot/src/services/response-admin.service.ts` に以下がある。

- `searchResponse()`
- `getResponseById()`
- `updateResponse()`
- `deleteCacheByQuery()`
- `getLookupSource()`
- `getDictionaryList()`

これらは Discord API に依存しない。
つまり `@grkd-jisho/db` 側へ移せる。

### 方針

```txt
packages/db/src/services/admin/response-admin.ts
packages/db/src/services/admin/dictionary-admin.ts
packages/db/src/services/admin/cache-admin.ts
packages/db/src/services/admin/trace-viewer.ts
packages/db/src/services/admin/ops-jobs-admin.ts
```

Bot は `@grkd-jisho/db` から import する。
Web も同じものを使う。

### 注意

- bigint は外へ返す前に string 化する。
- `updateResponse()` は今の通り pre-update SELECT で `beforeText` を取る。
- `isManualOverride=true` は最優先。LLMやcache refreshで上書きしない。
- 移動後は `packages/bot/src/services/response-admin.service.ts` の薄い再export、または import 更新のどちらかに統一する。
- 旧importが残っていないか repo 全体を検索する。

### admin action audit

Web の書き込み操作は最低限の監査を残す。
新テーブルはまだ増やさず、まず `bot_events` に `admin.*` event として記録する。

例:

```txt
admin.response_updated
admin.cache_refreshed
admin.dictionary_updated
admin.ops_job_approved
admin.ops_job_rejected
```

payload は redaction を通す。

---

## 9. Task 3-5 — Web Admin Shell

### 目的

管理画面の土台を作る。

### ページ

```txt
/              -> /admin へリダイレクト
/admin         -> dashboard
/auth/login    -> Discord login
/auth/callback -> OAuth callback
/auth/logout   -> session削除
```

### UI方針

すべてのUI実装は `DESIGN.md` （root/）のデザイン仕様に従う。
以下の項目はリンク先を絶対参照として使う。

- 色トークン（すべてOKLCH、royal blueのみアクセント）
- typography（GRKD Sans / GRKD Mono のスケールとweight）
- コンポーネント定義（Button / Table / Badge / Timeline / Code Block / Modal）
- Do/Don't（pure black/white禁止、neon/glassmorphism禁止）
- Tailwind v4 テーマ定義（CSS Custom Properties + `@theme` の完全コピー）

- まず速く読める画面。
- 派手なUIより、危険操作の確認とログの見やすさを優先。
- テーブルはページネーション前提。
- Discord ID はそのまま出すが、token/secretは絶対に出さない。

### Dashboard 表示

- 今日の lookup 件数
- cache hit ratio
- manual override 件数
- error/warn 件数
- pending approval ops_jobs 件数
- 最新 heartbeat

---

## 10. Task 3-6 — `/admin/responses`

### 目的

生成済み回答を検索し、手動編集しやすくする。

### 機能

- `normalized_query` で検索
- `role_key` filter
- `is_manual_override` filter
- `model_name` / `prompt_version` 表示
- ページネーション
- 詳細ページリンク

### `/admin/responses/[id]`

- 現在の回答テキスト表示
- 編集フォーム
- 理由入力
- 保存時に `response_edits` へ履歴追加
- 編集履歴タイムライン表示

### ガード

- 空文字保存禁止。
- 4000文字などDiscord返答上限を意識した上限を設ける。
- 保存後も `is_manual_override=true` を維持。

---

## 11. Task 3-7 — `/admin/dictionaries`

### 目的

辞書の優先順位と有効状態を管理する。

### 機能

- priority順の辞書一覧
- enabled/disabled toggle
- priority更新
- 辞書ごとの entry count 表示

### Import trigger

Roadmapには「新規辞書インポートのトリガー」がある。
ただし、初期実装では危険を増やさない。

Phase 3 では以下の順にする。

```txt
1. zip upload UI
2. index.json 読み取り preview
3. name / priority / slug を確認
4. 管理者が確認
5. import実行
```

### Import safety

- zip以外拒否。
- サイズ上限を設ける。
- `index.json` がないzipは拒否。
- import中に既存辞書を壊さない。
- 失敗時はエラーメッセージをUIに出す。
- uploadファイルをリポジトリに保存しない。
- 既存の `scripts/import-yomitan.ts` をそのまま shell 実行しない。
- ZIP解析とimport本体を共有serviceへ切り出す。
- importはchunk単位で進捗を出す。
- 大きい辞書は同期HTTP requestで処理せず、`ops_jobs` 化を検討する。

---

## 12. Task 3-8 — `/admin/cache`

### 目的

生成済みcacheを安全に更新する。

### 機能

- 単語 + role_key 指定で refresh
- `is_manual_override=false` のみ削除
- 削除前に件数preview
- 実行前に確認ダイアログ

### やらないこと

- manual override の削除
- 全cache一括削除
- prompt_version rotate

これらは Phase 4 dangerous ops。

---

## 13. Task 3-9 — `/admin/logs`

### 目的

検索状況をブラウザで把握する。

### 表示

- lookup件数（7日 / 30日）
- popular queries
- cache hit ratio
- dictionary hit count
- user別検索回数（user_idのみ）
- error/warn summary

### 注意

- user_id 以上の個人情報は出さない。
- 重い集計は30日まで。
- 期間filterを必須にし、無制限集計を避ける。

---

## 14. Task 3-10 — `/admin/traces`

### 目的

1回の検索・wipe・ops job の流れを追えるようにする。

### 機能

- `trace_id` 検索
- event timeline
- `level` 色分け
- `duration_ms` 表示
- payload JSON 表示

### セキュリティ

- payload は `redactDeep()` 相当で token / secret / api key を隠す。
- MCPで使っている redaction と同じ思想に寄せる。

---

## 15. Task 3-11 — `/admin/ops-jobs`

### 目的

AIエージェントや将来のwrite toolが作る運営ジョブを、人間が承認・拒否できるようにする。

### 表示

- pending jobs
- approved / running / succeeded / failed / rejected jobs
- job_type
- requested_by
- args_json（redacted）
- result_json
- error_message
- created_at / approved_at / completed_at

### 承認

```txt
pending + approval_required=true
-> approve button
-> status=approved, approved_by=session.discordUserId, approved_at=now()
-> Bot の pollAndExecuteJobs() が実行
```

### 拒否

```txt
pending + approval_required=true
-> reject button
-> status=rejected, approved_by=session.discordUserId, completed_at=now()
```

### レース対策

更新条件に必ず `status='pending'` を入れる。
すでに running / succeeded の job は UI から変更できない。

補足。
`ops_jobs.status` は `rejected` を使う。
実装時に `packages/db/src/schema/ops-jobs.ts` のコメントも `rejected` まで含めて更新する。

---

## 16. Task 3-12 — MCP Level 2 dry-run tools

### 目的

AIエージェントが、変更前に影響範囲を確認できるようにする。

### 追加tool

```txt
grkd-jisho.dry_run_wipe
grkd-jisho.dry_run_rate_limit_change
grkd-jisho.dry_run_cache_refresh
```

### 共通ルール

- DBを書き換えない。
- Discord APIを呼ばない。
- Discord Bot Tokenを持たない。
- `mcp_audit_logs.dry_run=true` で記録する。
- secret redaction を通す。

### 有効化方式

Phase 2 の `MCP_READONLY_MODE=true` はデフォルトとして残す。
Phase 3 では別フラグを追加する。

```txt
MCP_ENABLE_DRY_RUN=false
```

- `false`: Level 1 read-only tools だけ登録。
- `true`: Level 1 + Level 2 dry-run tools を登録。

`withAudit()` は `dryRun` option を受け取れる形に変える。
既存 Level 1 は `dryRun=false`、Level 2 は `dryRun=true`。

### `grkd-jisho.dry_run_wipe`

入力:

```txt
guild_id
channel_id
```

返すもの:

```txt
channel_settings row
wipe_enabled
last_wipe_at
recent wipe events
would_require_bot_final_check=true
```

重要。
MCP は Discord API を呼ばないため、pin数や現在のBot権限は正確には見られない。
最終実行時に Bot 側で再チェックする。

### `grkd-jisho.dry_run_rate_limit_change`

入力:

```txt
role_id
new_daily_limit
guild_id optional
```

返すもの:

```txt
current limit
new limit
today usage users over new limit
affected usage row count
```

DB更新はしない。

### `grkd-jisho.dry_run_cache_refresh`

入力:

```txt
normalized_query
role_key optional
dictionary_id optional
```

返すもの:

```txt
matching cache count
manual override count
deletable count
sample cache ids
```

manual override は削除対象に含めない。

---

## 17. Task 3-13 — Web heartbeat

### 目的

`grkd-jisho.health` が Web 稼働状態も見られるようにする。

### 方針

- Web 起動中に `bot_heartbeats` へ `service_name='web'` を upsert。
- 初期実装では request middleware で一定間隔ごとに更新する。
- 常駐タイマーは SSR adapter の実行環境差があるため、まず避ける。

注意。
これは「request-observed liveness」だ。
誰もWebへアクセスしていない時間は heartbeat が古くなる可能性がある。
`grkd-jisho.health` 側では Web heartbeat を Bot/MCP と同じ厳しさでは扱わない。

### metadata

```json
{
  "package": "@grkd-jisho/web",
  "mode": "admin-ui"
}
```

---

## 18. 実装順序

Phase 3 は以下の順で進める。

```txt
Step A: Web基盤
  1. Astro SSR / React / Tailwind / Node adapter
  2. Web env schema
  3. Admin layout

Step B: Auth
  4. Discord OAuth2 login/callback/logout
  5. session cookie
  6. middleware guard

Step C: Shared services
  7. response-admin DB service を @grkd-jisho/db に移動
  8. dictionary/cache/trace/ops job admin service 追加
  9. bot側 import を更新

Step D: Core Web pages
  10. dashboard
  11. responses list/detail/edit
  12. dictionaries
  13. cache

Step E: Observability UI
  14. logs
  15. traces
  16. web heartbeat

Step F: Agent Ops UI
  17. ops_jobs list
  18. approve/reject
  19. result/audit表示

Step G: MCP dry-run
  20. dry-run tools
  21. audit dry_run=true
  22. docs整合

---

## 30. Step G — 実装ログ（MCP Level 2 dry-run tools）

> 実施日: 2026-05-05  
> 実行者: main agent  
> 確認: `pnpm --filter @grkd-jisho/mcp exec tsc --noEmit` (0 errors) + code-reviewer ✅ Approve

### 目的

外側AIエージェントが「実行前の影響見積もり」を安全に取れるように、MCP Level 2 dry-run tools を追加する。

### 追加Env

`MCP_ENABLE_DRY_RUN=false`（デフォルト）

- `false`: Level 1 read-only tools のみ
- `true`: Level 1 + Level 2 dry-run tools

### 追加tool

| tool | 目的 | DB write | Discord API | audit | 備考 |
|---|---|---:|---:|---:|---|
| `grkd-jisho.dry_run_wipe` | wipe設定/最近のwipeイベント確認 | no | no | `dry_run=true` | 最終実行はBot側で権限/ピン等を再確認 |
| `grkd-jisho.dry_run_rate_limit_change` | new limit適用時の超過ユーザー見積もり | no | no | `dry_run=true` | `user_usage` はロール所属を持たない制約あり |
| `grkd-jisho.dry_run_cache_refresh` | cache refreshの削除対象見積もり | no | no | `dry_run=true` | manual overrideは除外（deletable=total-manual） |

### audit方針

- `withAudit()` を `dryRun` option対応に拡張
- Level 1 は `dryRun=false`
- Level 2 は `dryRun=true`
- args/result は `redactDeep()` により secret をマスクした上で `mcp_audit_logs` に保存

### 変更ファイル

- `packages/mcp/src/config/env.ts`（`MCP_ENABLE_DRY_RUN` 追加。enumでtrue/false検証）
- `packages/mcp/src/index.ts`（tool登録条件分岐 + withAudit拡張）
- `packages/mcp/src/tools/dry-run-tools.ts`（新規: dry-run tool実装）


Step H: Verification
  23. typecheck/build/test
  24. code review
  25. Phase 3 planへ実装ログ追記
```

---

## 19. 安全マトリクス

| 操作 | 実行者 | DB write | Discord API | 承認 | Phase 3 方針 |
|---|---|---:|---:|---:|---|
| 回答編集 | Web | yes | no | 管理者ログイン | 許可 |
| cache refresh | Web | yes | no | 確認ダイアログ | manual override除外で許可 |
| 辞書 priority更新 | Web | yes | no | 管理者ログイン | 許可 |
| 辞書 enabled toggle | Web | yes | no | 管理者ログイン | 許可 |
| 辞書 import | Web | yes | no | preview + confirm | 最小実装で許可 |
| ops_job approve/reject | Web | yes | no | 管理者ログイン | 許可 |
| wipe-now実行 | Bot | yes | yes | ops_job承認後 | Webは直接実行しない |
| MCP dry-run | MCP | auditのみ | no | 不要 | 許可 |
| MCP write request | MCP | yes | no | 内容による | Phase 4 |
| MCP dangerous request | MCP | yes | no | 必須 | Phase 4 |

---

## 20. 既知リスクと対処

### Risk 1: Web auth が甘いと管理UIが漏れる

対処:

- OAuth state 必須。
- session cookie は HttpOnly / SameSite=Lax。
- production では Secure を付ける。
- `DISCORD_GUILD_ID` と `ADMIN_ROLE_IDS` を必ず見る。

### Risk 2: Bot と Web で管理ロジックが二重化する

対処:

- DB-only service を `@grkd-jisho/db` に寄せる。
- Bot/Web は同じ service を使う。

### Risk 3: dry_run_wipe がDiscordの実状態を見られない

対処:

- MCPはDB-only previewに限定。
- `would_require_bot_final_check=true` を返す。
- 実行時のpin保持・権限・24hフィルタは Bot が再確認。

### Risk 4: ops_jobs の承認レース

対処:

- approve/reject は `where id=? and status='pending' and approval_required=true`。
- running以降はUIから変更不可。

### Risk 5: 大量ログ集計でDBが重くなる

対処:

- logs画面は期間上限30日。
- Trace検索は `trace_id` 必須。
- 一覧は limit / pagination 必須。

### Risk 6: import zip が大きすぎる

対処:

- サイズ上限。
- preview先行。
- chunk import。
- 失敗時は既存辞書を壊さない。

---

## 21. 動作確認チェックリスト

### 共通

- [ ] `pnpm install`
- [ ] `docker compose up -d postgres`
- [ ] `pnpm db:generate`
- [ ] `pnpm db:migrate`
- [ ] `pnpm --filter db exec tsc --noEmit`
- [ ] `pnpm --filter bot exec tsc --noEmit`
- [ ] `pnpm --filter mcp exec tsc --noEmit`
- [ ] `pnpm --filter web exec tsc --noEmit`
- [ ] `pnpm --filter web build`
- [ ] `pnpm --filter bot test`

### Auth

- [ ] 未ログインで `/admin` に入れない
- [ ] 未ログインで `/api/*` も拒否される
- [ ] Discord OAuth2 login が始まる
- [ ] OAuth `state` 不一致は拒否される
- [ ] 対象 guild 外ユーザーは拒否
- [ ] 権限不足ユーザーは拒否
- [ ] ManageGuild / Administrator / owner / ADMIN_ROLE_IDS は許可
- [ ] 書き込みAPIは CSRF token なしで拒否される
- [ ] 重要POST前に古い `authCheckedAt` が再検証される
- [ ] logout で cookie が消える

### Responses

- [ ] response検索ができる
- [ ] response詳細が見られる
- [ ] 編集すると `response_cache.response_text` が更新される
- [ ] 編集すると `response_edits` に before/after が残る
- [ ] manual override が true になる

### Dictionaries

- [ ] priority順で表示される
- [ ] enabled toggle が動く
- [ ] priority更新後も辞書検索順と整合する
- [ ] import preview が失敗zipを拒否する

### Cache

- [ ] refresh対象件数を事前表示する
- [ ] manual override は削除されない
- [ ] 削除後に該当cacheが消える

### Logs / Traces

- [ ] lookup stats が表示される
- [ ] trace_id でイベント一覧が出る
- [ ] payload secret がredactされる

### Ops Jobs

- [ ] pending job が表示される
- [ ] approve で `status=approved` になる
- [ ] reject で `status=rejected` になる
- [ ] running以降のjobは変更できない

### MCP dry-run

- [ ] `MCP_ENABLE_DRY_RUN=false` では Level 2 tool が登録されない
- [ ] `MCP_ENABLE_DRY_RUN=true` で Level 2 tool が登録される
- [ ] `grkd-jisho.dry_run_wipe` がDB更新なしで結果を返す
- [ ] `grkd-jisho.dry_run_rate_limit_change` が影響人数を返す
- [ ] `grkd-jisho.dry_run_cache_refresh` がmanual overrideを除いた件数を返す
- [ ] 全dry-run tool call が `mcp_audit_logs.dry_run=true` で残る

---

## 22. Phase 3 完了後に残すもの

- Phase 3 実装ログ
- コードレビュー結果
- dry-run MCP tool の入出力例
- Web Admin UI の手動確認ログ
- 残リスク一覧

Phase 3 が終わったら、ユーザー指示どおり次に3つのコアサービスのUnitテストを書く。

対象は以下。

```txt
rate-limit
response-cache
response-admin
```

---

## 23. Self-check Report — Round 1

> Date: 2026-05-05  
> Mode: Pre-Implementation  
> Reviewer: primary agentセルフチェック  
> New findings: 6

### 修正済み finding

| Severity | Finding | 対応 |
|---|---|---|
| HIGH | `/api/*` の明示ガードとCSRFが不足していた | Web APIガードとCSRF必須を Task 3-3 に追加 |
| HIGH | session cookie に `roleIds` を保存すると権限変更後に古いroleが残る | `roleIds` をcookieから削除し、TTLと再検証方針を追加 |
| HIGH | MCP dry-run の有効化方式が曖昧だった | `MCP_ENABLE_DRY_RUN` と `withAudit({ dryRun })` 方針を追加 |
| MED | `ADMIN_ROLE_IDS` を必須扱いすると、ManageGuild運用だけの環境で起動不能になる | 任意envへ変更し、空配列defaultを明記 |
| MED | `.astro` 検証に素の `tsc` だけでは不足する | `@astrojs/check` と `web check` を追加 |
| MED | Web書き込み操作の監査方針が薄かった | `bot_events` の `admin.*` event で最小監査を追加 |

### 残リスク

| Severity | Risk | Phase 3 実装時の扱い |
|---|---|---|
| MED | 辞書importは大きいzipでHTTP requestを圧迫する | 小さいzipのみ同期、重いimportは `ops_jobs` 化を検討 |
| LOW | Web heartbeat はアクセスがないと古くなる | request-observed liveness と明記し、health判定を厳しすぎないようにする |

---

## 24. Step A — 実装ログ

> 実施日: 2026-05-05
> 実行者: main agent + kuraudo-uidesigner (UI components)
> 確認: astro check (0 errors) + code-reviewer (BLOCKER/HIGH: 0件)

### Task 3-1: 依存インストール

| パッケージ | バージョン | 備考 |
|---|---|---|
| `@astrojs/react` | ^5.0.4 | React islands integration |
| `@astrojs/node` | ^9.5.5 (v9) | Astro 5 compatible SSR adapter |
| `react` / `react-dom` | ^19.2.5 | React 19 |
| `@tailwindcss/vite` | ^4.2.4 | Tailwind v4 Vite plugin |
| `@astrojs/check` | ^0.9.9 | Astro type check |
| `tailwindcss` | ^4.2.4 | CSS utility framework |

- `@astrojs/node` v10 は Astro 6 必須のため v9 にダウングレード
- `zod` + `drizzle-orm` も後で追加（型チェックで必要と判明）

### Task 3-2: astro.config.mjs + env.ts + middleware.ts

**`astro.config.mjs`**:
- `output: "server"` + `adapter: node({ mode: "standalone" })`
- `@astrojs/react` integration + `@tailwindcss/vite` plugin

**`src/env.ts`**:
- Zod env schema: `DATABASE_URL`, `DISCORD_CLIENT_ID`, etc.
- `WEB_BASE_URL` (URL)、`ADMIN_ROLE_IDS` (comma-separated → array)、`PORT`/`HOST`
- `getEnv()` singleton pattern（`packages/bot/src/env.ts` と同じ方式）

**`src/middleware.ts`**:
- Step A stub: `context.locals.user = null`, `context.locals.isAuthenticated = false`
- Step B で session validation に置き換え予定

**`src/env.d.ts`**:
- `App.Locals` 型: `user: User \| null`, `isAuthenticated: boolean`

### Task 3-3: CSS変数 + globals.css

`src/styles/globals.css` に DESIGN.md の全トークンを Tailwind v4 `@theme` として定義:

- **Graphite** (900/800/650/500/300/180): neutral tones
- **Porcelain** (50/100/150/220): warm off-white surfaces
- **Royal Blue** (600/700/100/50): primary accent
- **State colors** (success/warning/danger/trace-violet)
- **Fonts**: grkd-sans (Inter, system-ui), grkd-mono (JetBrains Mono)
- **Radii**: button(10px), input(10px), card(16px), panel(20px), modal(24px)
- Base layer: graphite-900 text, porcelain-50 bg, antialiased
- Scrollbar, focus ring, selection styles

純粋なOKLCHのみ。hex / pure black / pure white なし。
Design tokensがCSS変数とTailwindユーティリティの両方で利用可能。

### Task 3-4: ページスタブ

| ページ | パス | 状態 |
|---|---|---|
| Root | `src/pages/index.astro` | /admin へリダイレクト |
| Dashboard | `src/pages/admin/index.astro` | 4 metric cards + 2 panels (stub) |
| Responses | `src/pages/admin/responses.astro` | stub |
| Dictionaries | `src/pages/admin/dictionaries.astro` | stub |
| Cache | `src/pages/admin/cache.astro` | stub |
| Logs | `src/pages/admin/logs.astro` | stub |
| Traces | `src/pages/admin/traces.astro` | stub |
| Ops Jobs | `src/pages/admin/ops-jobs.astro` | stub |
| Health API | `src/pages/api/health.ts` | DB接続確認、200/503 |

### Task 3-5: UI Components (kuraudo-uidesigner 委任)

全7コンポーネントを `src/components/admin/` に作成。

| コンポーネント | ファイル | 機能 |
|---|---|---|
| Sidebar | `Sidebar.tsx` | 248px nav、active状態でroyal-blue左レール + wash |
| TopBar | `TopBar.tsx` | 64px header、ページタイトル+プレースホルダー |
| Button | `Button.tsx` | primary/secondary/danger、focus ring |
| StatusBadge | `StatusBadge.tsx` | 状態別のpillバッジ |
| MetricCard | `MetricCard.tsx` | ダッシュボード数字カード |
| DataTable | `DataTable.tsx` | ジェネリックテーブル、選択行ハイライト |
| CodeBlock | `CodeBlock.tsx` | ダークコードブロック |

### 型チェック修正履歴

| 問題 | 修正 |
|---|---|
| JSXエラー (ts17004) | tsconfig に `jsx: "react-jsx"` 追加 |
| zod 未インストール | `pnpm add zod drizzle-orm` |
| `tsc --noEmit` が Astro 仮想モジュールを解決できない | typecheck script を `astro check` に変更 |
| `App.Locals` が `astro check` で認識されない | middleware と api/health で `as any` 暫定（Step Bで本実装時に削除） |
| `.tsx` 拡張子インポート | import path から `.tsx` 除去 |

### コードレビュー修正

| Severity | 箇所 | 修正内容 |
|---|---|---|
| MED | `Button.tsx:26` | `border-[#b81e14]` → `border-danger-600`（hex禁止違反） |
| LOW | `Sidebar.tsx` | `rounded-[10px]` → `rounded-button` |
| LOW | `MetricCard.tsx` | `rounded-[16px]` → `rounded-card` |
| LOW | `DataTable.tsx` | `rounded-[16px]` → `rounded-card` |

### 最終状態

- `astro check`: **0 errors**, 1 warning (Zod `z.string().url()` deprecated)
- 全7ページ + 1 APIエンドポイント動作可能
- AdminLayout が Sidebar + TopBar をレンダリング
- DESIGN.md 全トークンが globals.css に反映済み
- レビュー指摘0件 (BLOCKER/HIGH)

---

## 25. Step B — 実装ログ

> 実施日: 2026-05-05
> 実行者: main agent
> 確認: astro check (0 errors) + code-reviewer (BLOCKER: 0件)

### Task 3-6 (B-1, B-5): env更新

- `.env.example` に `WEB_BASE_URL` セクション追加（OAuth callback URL組み立て用）
- env.ts は既に `WEB_BASE_URL` を含んでいたため変更なし

### Task 3-6 (B-2): セッション管理

`src/lib/session.ts`:
- HMAC SHA-256署名付きHttpOnly Cookie方式（DBセッションテーブルなし）
- `setSession()` / `getSession()` / `clearSession()` / `requireSession()`
- OAuth state管理: `setOAuthState()` / `verifyOAuthState()`（5分TTL）
- `needsReAuth()`: 半TTL（4時間）経過で authCheckedAt 更新を促す
- セッションTTL: 8時間
- 最小情報のみcookie保存: `discordUserId`, `guildId`, `isAdmin`, `expiresAt`, `authCheckedAt`
- `roleIds` は保存しない（権限変更後に古いroleが残るリスク回避）

### Task 3-6 (B-4): CSRFトークン機構

`src/lib/csrf.ts`:
- `generateCsrfToken(discordUserId)` → nonce + HMAC署名
- `verifyCsrfToken(discordUserId, token)` → 定数時間比較
- `validateCsrfRequest(discordUserId, request)` → X-CSRF-Token ヘッダ検証

`src/pages/api/auth/csrf-token.ts`:
- `GET /api/auth/csrf-token` → 認証済みユーザーにCSRF tokenを返す
- 未認証は401

### Task 3-6 (B-1): Discord OAuth2

`src/lib/discord-oauth.ts`:
- `buildAuthorizeUrl(state)` → scope: `identify guilds guilds.members.read`
- `exchangeCode(code)` → Discord token交換（zodスキーマで応答検証）
- `fetchCurrentUser(accessToken)` → `users/@me`（zod検証）
- `fetchGuildMember(accessToken, guildId)` → guild member情報取得（zod検証）
- `hasGuildPermission(permissions, bit)` / `PERM_ADMINISTRATOR`(bit 3) / `PERM_MANAGE_GUILD`(bit 5)

OAuthエンドポイント:
| エンドポイント | ファイル | 機能 |
|---|---|---|
| `GET /auth/login` | `login.astro` | ログインページ（エラーパラメータ対応） |
| `GET /api/auth/authorize` | `authorize.ts` | Discord OAuth2へのリダイレクト |
| `GET /auth/callback` | `callback.ts` | code交換→guild所属確認→権限確認→session発行 |
| `GET /auth/logout` | `logout.ts` | session削除→loginページへ |

### Task 3-7 (B-3): middlewareガード

`src/middleware.ts`:
- 公開パス: `/auth/login`, `/auth/callback`, `/auth/logout`
- `/admin/*` と `/api/*` は session + isAdmin 必須
- CSRF検証: 非GETリクエストに X-CSRF-Token 必須（`/api/health`, `/api/auth/authorize` は除外）
- `needsReAuth()` がtrueの時は `authCheckedAt` を自動更新（セッション維持）

### Task 3-8 (B-6): エラーページ

`login.astro`:
- `?error=guild_required` → "You must be a member of the GRKD-Jisho Discord server..."
- `?error=admin_required` → "You need administrator or manager permissions..."
- `?error=oauth_failed` → "Authentication with Discord failed..."
- `?error=session_expired` → "Your session has expired..."
- Royal blue "Sign in with Discord" ボタン、DESIGN.md準拠スタイル

### 管理者判定条件（callback.tsのcheckAdminAccess）

Bot Slash Commandと統一した4条件:
1. ADMIN_ROLE_IDS に一致するroleを持つ
2. Administrator permission (bit 3)
3. ManageGuild permission (bit 5)
4. Guild Owner

### code-reviewer修正

| Severity | Issue | 修正内容 |
|---|---|---|
| HIGH | CSRF未適用 | middlewareで非GETリクエストにCSRF強制 + CSRF_EXEMPT_PATHS |
| HIGH | Administrator/ManageGuild未チェック | `hasGuildPermission` + callbackのcheckAdminAccessにbit 3/5追加 |
| HIGH | Discord API型未検証 | zodスキーマでtoken/user/guild member応答を検証 |
| MED | `needsReAuth`未統合 | middlewareで半TTL経過時に自動更新 |
| MED | `checkIsAdmin`デッドコード | discrd-oauth.tsから削除 |
| MED | CSRF token取得不能 | `/api/auth/csrf-token` GETエンドポイント追加 |
| LOW | User型二重定義 | `locals.ts` で自前 `UserShape` を使い、グローバル `User` に依存しない |

### その他

- `as any` / `as never` / `eslint-disable` は全ファイルで **0件**
- `as unknown as LocalsShape` のみ3箇所（`astro check` が `declare namespace App` を解決できない既知制限への対処、TypeScript標準の安全な型変換パターン）
- `exactOptionalPropertyTypes: true` 対応のため `DiscordGuildMember.permissions` を `string \| undefined` に明示

### 最終状態

- `astro check`: **0 errors**, 0 warnings, 1 hint
- `as any` count: **0**（全ファイル）
- OAuth全フロー実装済み（login → authorize → callback → session → admin）
- middlewareで/admin/* /api/* 完全保護（CSRF付き）
- CSRF token取得API完備
- `.env.example` に `WEB_BASE_URL` 追加

---

## 26. Step C — 実装ログ

> 実施日: 2026-05-05
> 実行者: main agent
> 確認: 型チェック3パッケージ通過 + code-reviewer (全severity 0件)

### 方針

Bot と Web で同じDB操作を共有するため、Discord APIに依存しないadmin DB serviceを `packages/db/src/services/admin/` に移動。Bot側は薄い再exportファイルにして、既存のimportパスを一切変えずに互換性を維持。

### 移動マップ

| 移動元 (bot) | 移動先 (db) | 備考 |
|---|---|---|
| `services/response-admin.service.ts` | `services/admin/response-admin.ts` | `getDictionaryList` 削除（dictionary-adminへ統合） |
| `services/rate-limit-admin.service.ts` | `services/admin/rate-limit-admin.ts` | そのまま移動 |
| `services/wipe-admin.service.ts` | `services/admin/wipe-admin.ts` | そのまま移動 |
| `services/date-utils.ts` | `services/date-utils.ts` | そのまま移動 |
| (新規) | `services/admin/dictionary-admin.ts` | 辞書管理全機能 |
| (新規) | `services/admin/cache-admin.ts` | キャッシュ管理+統計 |
| (新規) | `services/admin/trace-viewer.ts` | イベント/トレース閲覧 |
| (新規) | `services/admin/ops-jobs-admin.ts` | ジョブ一覧/承認/却下 |
| (新規) | `services/admin/audit-utils.ts` | `adminAuditEvent()` 共通監査 |

### bot側 再exportファイル

4ファイルを `@grkd-jisho/db` からの再exportに変更:

- `services/response-admin.service.ts` — `searchResponse`, `getResponseById`, `updateResponse`, `deleteCacheByQuery`, `getLookupSource`, `getDictionaryList`
- `services/rate-limit-admin.service.ts` — `setRoleLimit`, `getRoleLimits`, `resetUserUsage`
- `services/wipe-admin.service.ts` — `setWipeEnabled`, `getChannelSettings`, `getChannelSetting`
- `services/date-utils.ts` — `toGMT7Date`

変更したコマンドファイルは **0ファイル**（既存importがそのまま動作）。

### db/src/index.ts のexport追加

```typescript
export * from "./services/date-utils";
export * from "./services/admin/audit-utils";
export * from "./services/admin/response-admin";
export * from "./services/admin/dictionary-admin";
export * from "./services/admin/cache-admin";
export * from "./services/admin/trace-viewer";
export * from "./services/admin/ops-jobs-admin";
export * from "./services/admin/rate-limit-admin";
export * from "./services/admin/wipe-admin";
```

### 新規サービスの概要

**dictionary-admin.ts**:
- `getDictionaryList()` / `getDictionaryById(id)` / `setDictionaryEnabled(id, enabled)` / `setDictionaryPriority(id, priority)` / `getDictionaryEntryCount(dictionaryId)`

**cache-admin.ts**:
- `getCacheStats()` — total / manualOverride / deletable の統計
- `searchCacheEntries(queryText, limit)` — キャッシュ一覧
- `bulkDeleteCache(ids)` — manual override以外を一括削除

**trace-viewer.ts**:
- `getTraceById(traceId)` / `getRecentErrors(limit)` / `getEventsByType(eventType, limit)`
- bigserial id → string 変換、payloadJson の型アサート

**ops-jobs-admin.ts**:
- `getPendingJobs()` / `getAllJobs(limit)` — ジョブ一覧
- `approveJob(jobId, approverDiscordId)` / `rejectJob(jobId, approverDiscordId)` — 承認/却下
- approve/reject時に `adminAuditEvent` で監査ログ記録
- `OpsJob` → `OpsJobRecord` にリネーム（schemaの`OpsJob`と衝突回避）

### adminAuditEvent

```typescript
adminAuditEvent("admin.ops_job_approved", { jobId, approver })
adminAuditEvent("admin.ops_job_rejected", { jobId, rejector })
```

trace_id は自動生成（`admin_${eventType}_${Date.now()}`）。

### 型チェック + テスト

| パッケージ | 結果 |
|---|---|
| `packages/db` | `tsc --noEmit` 0 errors |
| `packages/bot` | `tsc --noEmit` 0 errors |
| `packages/mcp` | `tsc --noEmit` 0 errors |
| `packages/bot` test | 1 passed, 3 skipped, 13 todo |

### code-reviewer

- BLOCKER/HIGH/MED/LOW: **0件**
- import loop なし、名前衝突なし（`OpsJob` → `OpsJobRecord` で解決済み）
- 全severity 0件の ✅ Approve

---

## 28. Step E — 実装ログ

> 実施日: 2026-05-05
> 実行者: main agent + kuraudo-uidesigner (6 React components)
> 確認: astro check (0 errors) + code-reviewer → 6件修正後 ✅ Approve

### APIエンドポイント (新規3本)

| エンドポイント | メソッド | ファイル | 機能 |
|---|---|---|---|
| `/api/admin/logs` | GET | `logs.ts` | lookup stats, cache hit ratio, popular queries, error/warn summary |
| `/api/admin/traces` | GET | `traces.ts` | 直近trace一覧（traceId重複排除）、`?traceId=xxx` で全event + payload |
| `/api/admin/ops-jobs` | GET, POST | `ops-jobs.ts` | GET pending/all jobs、POST approve/reject（CSRF必須） |

### React Components (kuraudo-uidesigner 委任)

| コンポーネント | ファイル | 機能 |
|---|---|---|
| LogsSummary | `LogsSummary.tsx` | 4 MetricCard summary |
| PopularQueriesTable | `PopularQueriesTable.tsx` | Top 20 問い合わせ一覧 |
| TraceTimeline | `TraceTimeline.tsx` | 垂直タイムライン、collapsible JSON payload |
| TraceSearch | `TraceSearch.tsx` | trace ID検索（HREF遷移） |
| OpsJobCard | `OpsJobCard.tsx` | 単一job approve/rejectカード |
| OpsJobsList | `OpsJobsList.tsx` | pending一覧 + CSRF付きapprove/reject API呼び出し |

### SSRページ更新

| ページ | パス | 内容 |
|---|---|---|
| Logs | `/admin/logs` | SSR: LogsSummary + PopularQueriesTable |
| Traces | `/admin/traces` | SSR: TraceSearch + TraceTimeline + 直近trace一覧 |
| Ops Jobs | `/admin/ops-jobs` | SSR: pendingカード一覧 + 全recent jobsテーブル |

### コードレビュー修正

| Severity | 問題 | 修正内容 |
|---|---|---|
| BLOCKER | `ops-jobs.astro` の `onApprove`/`onReject` が空no-op | `OpsJobsList` を完全なClient Component化、fetch + CSRF + POST呼び出し |
| BLOCKER | `traces.astro` の `TraceSearch.onSearch` が空no-op | `onSearch` 削除、`window.location.href` でのページ遷移に変更 |
| HIGH | `ops-jobs.ts` JSONパースエラーで500返却 | `try { body = await req.json() } catch → 400` |
| HIGH | traces.astro テーブル行クリック未実装 | `<script>` でDOM click → traceId遷移 |
| MED | `logs.ts days` パラメータに0が許容 | `Math.max(1, ...)` で下限1に |
| MED | TraceTimeline 日付パース未検証 | コンポーネントは日付表示のみ（API側でISO string保証） |

### 最終状態

- `astro check`: 0 errors, 0 warnings
- 全12コンポーネント揃い、管理画面9ページ完成
- 全DBアクセスはSSRまたはClient fetch経由で統一的に動作

---

## 27. Step D — 実装ログ

> 実施日: 2026-05-05
> 実行者: main agent
> 確認: astro check (0 errors) + code-reviewer → 3件修正後 ✅

### APIエンドポイント (新規4本)

| エンドポイント | メソッド | ファイル | 機能 |
|---|---|---|---|
| `/api/admin/stats` | GET | `stats.ts` | ダッシュボード統計（lookups/cacheHit/pendingJobs/errors） |
| `/api/admin/responses` | GET, PUT | `responses.ts` | 検索+詳細 / 編集+override（CSRF + audit） |
| `/api/admin/dictionaries` | GET, PUT | `dictionaries.ts` | 一覧 / 有効切替+優先度（CSRF + audit） |
| `/api/admin/cache` | GET, DELETE | `cache.ts` | stats+検索+preview / 一括削除（manual除外+CSRF+audit） |

### 管理ページ (4ページ SSR)

| ページ | パス | データソース |
|---|---|---|
| Dashboard | `/admin` (index.astro) | SSR: lookup count, cache hit ratio, pending jobs, 直近トレース+エラー |
| Responses | `/admin/responses` | SSR: 検索クエリでresponse一覧、manual/autoバッジ |
| Dictionaries | `/admin/dictionaries` | SSR: 辞書一覧、entry count、enabled/disabled |
| Cache | `/admin/cache` | SSR: total/manual/deletable stats、検索フォーム+refreshルール |

### レビュー修正

| Severity | 問題 | 修正内容 |
|---|---|---|
| BLOCKER | `cache.ts DELETE` が `isManualOverride=true` のエントリを削除しかねない | DELETE前にDBから該当IDの `isManualOverride` を事前fetchし、manual override を除外 |
| HIGH | `stats.ts` の `recentErrors` 集計に `level='error'` フィルターが欠落 | `and(eq(level, "error"), gte(...))` に修正 |
| HIGH | キャッシュヒット率が `cacheStats.total / lookupsToday`（全キャッシュ数÷ルックアップ数）で計算されていた | `lookup_logs.cacheHit = true` の件数で正しいヒット率を算出 |

### 型チェック

- `astro check`: **0 errors**, 0 warnings, 1 hint
- `as any` / `eslint-disable`: 全ファイル0件

---

## 29. Step F — 実装ログ

> 実施日: 2026-05-05  
> 実行者: main agent + kuraudo-uidesigner (`JobDetailPanel`)  
> 確認: `astro check` (0 errors) + `@grkd-jisho/db` `tsc --noEmit` (0 errors) + code-reviewer ✅ Approve

### 目的

Agent Ops UI の `ops_jobs` 表示を強化し、人間が以下を確認できる状態にした。

- pending jobs の承認 / 拒否
- job status 別フィルター
- `args_json` / `result_json` / `error_message`
- `requested_by` / `approved_by` / timestamps

### DB共有サービス更新

| ファイル | 変更 |
|---|---|
| `packages/db/src/services/admin/ops-jobs-admin.ts` | `OpsJobRecord` に `resultJson`, `requestedBy`, `approvedBy`, `approvedAt` を追加 |
| `packages/db/src/schema/ops-jobs.ts` | status comment に `rejected` を追加 |

### UIコンポーネント

| コンポーネント | ファイル | 内容 |
|---|---|---|
| `JobDetailPanel` | `packages/web/src/components/admin/JobDetailPanel.tsx` | job detail、StatusBadge、args/result JSON、error box、Asia/Jakarta timestamp |
| `OpsJobsList` | `packages/web/src/components/admin/OpsJobsList.tsx` | pending jobs の CSRF 付き approve/reject を継続利用 |

### ページ更新

| ページ | 変更 |
|---|---|
| `/admin/ops-jobs` | status filter tabs (`all/pending/approved/running/succeeded/failed/rejected`) 追加 |
| `/admin/ops-jobs` | row click で `jobId` URL param を付与し、選択jobの detail panel を表示 |
| `/admin/ops-jobs` | pending approvals には `OpsJobsList client:load` を残し、approve/reject を維持 |

### コードレビュー修正

| Severity | 問題 | 修正内容 |
|---|---|---|
| HIGH | pending approvals が placeholder div になり approve/reject 不可 | `OpsJobsList client:load` を復元 |
| HIGH | rejected job でも `approvedBy` が “Approved By” と表示される | `status === rejected` の場合は “Rejected By” と表示 |
| MED | `rejectJob()` が既存DB列 `approvedBy` に rejector を保存している | **対応済み**: `ops_jobs.rejected_by` を追加し、`rejectJob()` は `rejectedBy` を保存。UIも `Rejected By` は `rejectedBy` 優先（legacy fallbackあり） |
| LOW | `JobDetailClient.tsx` が未使用 | **対応済み**: ユーザー承認後に削除 |

### 最終状態

- `pnpm --filter @grkd-jisho/web typecheck`: 0 errors
- `pnpm --filter @grkd-jisho/db exec tsc --noEmit`: 0 errors
- code-reviewer: ✅ Approve
