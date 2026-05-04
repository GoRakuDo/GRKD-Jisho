# Phase 2 — Admin Commands + Read-only MCP 実装プラン

> **対応 Roadmap:** Phase 2 (Week 4)  
> **Date:** 2026-05-04  
> **Status:** Draft  
> **Phase 1 完了前提:** Bot MVP / rate limit / bulkDelete wipe / observability / ops_jobs 基盤が動いていること  
> **完了基準:**
> - 管理者が Discord Slash Command で回答検索・編集・更新・出典確認を行える
> - Rate Limit と Channel Wipe の設定を Discord から安全に確認・変更できる
> - 外側AIエージェントが MCP 経由で health / errors / trace / stats を read-only で確認できる
> - 全 MCP tool call が `mcp_audit_logs` に残る
> - MCP は Discord Bot Token を持たず、Discord API を直接操作しない

---

## 目次

1. [Phase 2 の目的](#1-phase-2-の目的)
2. [実装前ガード — Phase 1 の残リスク整理](#2-実装前ガード--phase-1-の残リスク整理)
3. [Phase 2 完了時のディレクトリ構成](#3-phase-2-完了時のディレクトリ構成)
4. [Task 2-1 — Slash Command 基盤](#4-task-2-1--slash-command-基盤)
5. [Task 2-2 — `/search-jisho`](#5-task-2-2--search-jisho)
6. [Task 2-3 — `/edit-jisho`](#6-task-2-3--edit-jisho)
7. [Task 2-4 — `/refresh-jisho`](#7-task-2-4--refresh-jisho)
8. [Task 2-5 — `/source-jisho`](#8-task-2-5--source-jisho)
9. [Task 2-6 — `/priority-jisho`](#9-task-2-6--priority-jisho)
10. [Task 2-7 — `/override-jisho`](#10-task-2-7--override-jisho)
11. [Task 2-8 — 権限ガード](#11-task-2-8--権限ガード)
12. [Task 2-9 — Rate Limit 管理コマンド](#12-task-2-9--rate-limit-管理コマンド)
13. [Task 2-10 — Channel Wipe 管理コマンド](#13-task-2-10--channel-wipe-管理コマンド)
14. [Task 2-11 — MCP Server パッケージ](#14-task-2-11--mcp-server-パッケージ)
15. [Task 2-12 — Read-only MCP Tools](#15-task-2-12--read-only-mcp-tools)
16. [Task 2-13 — MCP Audit Log](#16-task-2-13--mcp-audit-log)
17. [実装順序](#17-実装順序)
18. [動作確認チェックリスト](#18-動作確認チェックリスト)
19. [既知リスクと判断](#19-既知リスクと判断)

---

## 1. Phase 2 の目的

Phase 2 は、Bot を「使える」状態から「運用できる」状態へ進める段階だ。

やることは2つ。

```txt
Discord Slash Command = 人間の管理者が回答・制限・wipe設定を扱う入口
Read-only MCP         = 外側AIエージェントが状態を見る入口
```

ただし、MCP は Control Plane であり、Discord Bot の代わりではない。
MCP には Discord Bot Token を持たせない。
MCP から Discord API の削除系操作を直接呼ばない。

---

## 2. 実装前ガード — Phase 1 の残リスク整理

Phase 2 に入る前に、Phase 1 の未修正リスクを先に潰す。
管理コマンドや MCP を足す前に、既存の lookup 経路が安全である必要があるため。

### 2-0-1. GuildMembers Intent の確認

**現状:** `packages/bot/src/index.ts` の Client intents は `Guilds`, `GuildMessages`, `MessageContent` のみ。

**リスク:** `message.member.roles.cache` が不完全な場合、role-based rate limit と role mapping が期待通りに動かない。

**対応方針:**

- `GatewayIntentBits.GuildMembers` の追加を検討する
- Discord Developer Portal 側の privileged intent 設定も手順に含める
- 追加しない場合は、`message.guild.members.fetch(message.author.id)` で必要時だけ取得する

MVPでは「必要時 fetch」のほうが安全。privileged intent の審査や設定に依存しないため。

### 2-0-2. `saveResponse()` の一意制約競合

**現状:** `response_cache` は複合 unique 制約を持つが、`saveResponse()` は通常 INSERT のみ。

**リスク:** 同じ単語を同時に検索した場合、片方の INSERT が unique violation で落ちる。

**対応方針:**

```txt
INSERT ... ON CONFLICT DO NOTHING RETURNING *
↓
保存できなかった場合は、同じ cache key で再取得
↓
それもなければ生成済みテキストをそのまま返信
```

手動上書き (`is_manual_override = true`) は絶対に LLM で上書きしない。

### 2-0-3. `messageCreateHandler` のトップレベル例外処理

**現状:** LLM 生成部分には try/catch があるが、全体を包むトップレベル catch はない。

**リスク:** DB 障害や Discord API 失敗で unhandled rejection が出る可能性がある。

**対応方針:**

- handler 全体を内部関数に分ける
- catch では `reply.error` と `bot_events` を残す
- ユーザーへは短いエラー文だけ返す

### 2-0-4. Step 0 実装ログ

以下は 2026-05-04 に実装した内容。

| # | 修正内容 | ファイル | 変更 |
|---|---------|---------|------|
| 1 | GuildMember force fetch | `packages/bot/src/events/messageCreate.ts` | `roles.cache.size < 2` の場合のみ `guild.members.fetch()` で補完。privileged intent に依存しない |
| 2 | `saveResponse()` 競合対応 | `packages/bot/src/services/response-cache.service.ts` | `INSERT ... ON CONFLICT DO NOTHING RETURNING *` に変更。競合時は `null` を返す |
| 3 | トップレベルエラーハンドラ | `packages/bot/src/events/messageCreate.ts` | `messageCreateHandler` を try/catch の外殻にし、内部ロジックを `handleMessage()` に分離。未使用の `Events` import を削除 |
| — | 型チェック | `pnpm --filter bot exec tsc --noEmit` | 通過。未使用 import の削除で警告なくなる |

`saveResponse()` が `null` を返した場合、呼び出し元（`handleMessage` 内の LLM 成功パス）は既に `responseText` を持っているので、そのまま返信に使える。次の検索で cache hit する。

**コードレビュー修正:**
- `response-cache.service.ts` から未使用の `sql` import を削除。型チェック通過。

### Step A 実装ログ

2026-05-04 に実装・レビュー・修正完了。

| タスク | ファイル | 説明 |
|--------|---------|------|
| types | `commands/types.ts` | `Command` interface（builder / execute / requiresAdmin） |
| registry | `commands/index.ts` | `Map<string, Command>` + register() / getCommand() / getAllCommands() |
| test cmd | `commands/ping.command.ts` | `/ping` — 動作確認用。`requiresAdmin: false` |
| interaction | `events/interactionCreate.ts` | ChatInputCommand のみ処理。unknown と権限不足は ephemeral error。try/catch で deferred/replied 両対応 |
| permission | `services/admin-permission.service.ts` | ManageGuild / Administrator / Guild Owner を許可。`typeof` ガードで `APIInteractionGuildMember.permissions`（文字列）に対応 |
| register | `scripts/register-commands.ts` | REST API v10 + `Routes.applicationGuildCommands` |
| index.ts | `index.ts` | `client.on(Events.InteractionCreate, interactionCreateHandler)` 追加 |
| package.json | `package.json` | `register-commands` script 追加 |

**コードレビュー修正（3件）:**
- 🟠 HIGH: `interactionCreate.ts` のエラー返信が `deferred` 状態を未考慮 → `interaction.replied || interaction.deferred` で分岐
- 🟡 MED: `interactionCreate.ts` の未使用 import（`Events`, `MessageFlags`）を削除
- 🟡 MED: `admin-permission.service.ts` の `as GuildMember` キャスト → `typeof` + `PermissionsBitField` で型安全に
- 🟡 MED: `commands/index.ts` の `register()` が重複を警告しない → `console.warn` 追加

**型チェック:** `pnpm --filter bot exec tsc --noEmit` ✅ 通過

### Step B 実装ログ

2026-05-04 に実装・レビュー・修正完了。

| タスク | ファイル | 説明 |
|--------|---------|------|
| service | `services/response-admin.service.ts` | search / getById / update(transaction) / deleteCache / lookupSource / dictionaryList |
| search | `commands/search-jisho.command.ts` | `/search-jisho word:` — response_cache 一覧表示（上位10件） |
| edit | `commands/edit-jisho.command.ts` | `/edit-jisho response-id:` → Modal 表示（本文 + 理由入力） |
| refresh | `commands/refresh-jisho.command.ts` | `/refresh-jisho word: [role:]` — isManualOverride=false のみ削除 |
| source | `commands/source-jisho.command.ts` | `/source-jisho word:` — lookup_logs + dictionaries JOIN |
| priority | `commands/priority-jisho.command.ts` | `/priority-jisho` — dictionaries 一覧 |
| override | `commands/override-jisho.command.ts` | `/override-jisho response-id: text:` — 即時上書き（4000文字制限） |
| modal | `events/interactionCreate.ts` | `isModalSubmit()` 対応追加。`edit_jisho_` prefix の modal 処理 |
| types | `commands/types.ts` | `CommandBuilder` 型追加（`SlashCommandBuilder \| SlashCommandOptionsOnlyBuilder`） |
| registry | `commands/index.ts` | 6コマンドを register |

**コードレビュー修正（4件）:**
- 🔴 BLOCKER: `response-admin.service.ts` の `Number(id)` が 2^53 超えで精度劣化 → `BigInt(id)` に変更
- 🟠 HIGH: `interactionCreate.ts` で `String(err)` をユーザーに露出 → 汎用メッセージに変更
- 🟠 HIGH: `updateResponse` の入力検証不足 → `/^\d+$/` テスト + トランザクション内で `update → returning` の構成に変更（get→update の競合除去）
- 🟡 MED: `/override-jisho` の `reason` 省略 → `"override-jisho command"` を既定値として渡す

**型チェック:** `pnpm --filter bot exec tsc --noEmit` ✅ 通過

### Step C 実装ログ

2026-05-04 に実装・レビュー・修正完了。

| タスク | ファイル | 説明 |
|--------|---------|------|
| date-utils | `services/date-utils.ts` | `toGMT7Date()` を抽出。`rate-limit.service.ts` から重複排除 |
| rate-limit admin | `services/rate-limit-admin.service.ts` | setRoleLimit(UPSERT) / getRoleLimits / resetUserUsage |
| wipe admin | `services/wipe-admin.service.ts` | setWipeEnabled(UPSERT) / getChannelSettings / getChannelSetting |
| ratelimit set | `commands/ratelimit-set.command.ts` | `/ratelimit-set role-id: limit:` — string option で `__default__` 対応 |
| ratelimit list | `commands/ratelimit-list.command.ts` | `/ratelimit-list` — 上限一覧 |
| ratelimit reset | `commands/ratelimit-reset.command.ts` | `/ratelimit-reset user:` — GMT+7 今日分のみ 0 |
| wipe channel | `commands/wipe-channel.command.ts` | `/wipe-channel channel: enabled:` — ChannelType.GuildText |
| wipe status | `commands/wipe-status.command.ts` | `/wipe-status` — 実行中ギルドの設定表示 |
| wipe now | `commands/wipe-now.command.ts` | `/wipe-now channel:` — 確認+キャンセルボタン。`wipe_enabled=true` のみ実行可 |
| button handler | `events/interactionCreate.ts` | `isButton()` 対応追加。`wipe_now_confirm_` / `wipe_now_cancel` を処理 |
| types | `types.ts` | `TraceEventType` に `wipe.command_executed` 追加 |
| registry | `commands/index.ts` | 6コマンドを register |

**コードレビュー修正（2件）:**
- 🟡 MED: `wipe-now.command.ts` に guild context チェックが欠落 → `interaction.guildId` の防御的チェックを追加
- 🟡 MED: `rate-limit.service.ts` の `export { toGMT7Date }` が未使用（date-utils.ts に移行済み） → 行を削除

**型チェック:** `pnpm --filter bot exec tsc --noEmit` ✅ 通過

### Step 0〜C 回帰検証ログ

2026-05-04 に全23ファイルの系统検証完了。

**発見バグ（2件）:**
- 🔴 HIGH: `updateResponse()` で `RETURNING` を使って旧テキストを取得していた。PostgreSQL の RETURNING は更新後の値を返すため、`beforeText` と `afterText` が常に同じ値になる。 → トランザクション内で `SELECT` を先に実行してから `UPDATE` する方式に修正
- 🔴 MED: `/wipe-now` 確認ボタンが3秒 timeout の可能性。`wipeChannel()` の bulkDelete が100件以上のメッセージで3秒を超える可能性がある。 → `interaction.deferUpdate()` を先に実行してから処理し、完了後に `interaction.editReply()` で更新

**再レビュー指摘修正（2件）:**
- 🟡 MED: `getResponseById()` に事前検証が不足（`updateResponse()` と一貫性がない） → `/^\d+$/` テストを追加
- 🟡 MED: `saveResponse()` のコメントが実装と乖離（"is_manual_override = true は上書きしない" → `ON CONFLICT DO NOTHING` は全レコードを保護） → コメントを修正

**Regression 確認:**
- `messageCreate` ↔ `interactionCreate`: 競合なし（別イベントで完全分離）
- `rate-limit.service` の抽出: 変更なし（date-utils.ts への切り出しのみ）
- `response-cache.service` ↔ `response-admin.service` の競合: なし（別テーブル/別操作）
- Cron wipe ↔ Button wipe の競合: なし（冪等）
- 全23ファイルの相互依存チェック: ✅

**型チェック:** `pnpm --filter bot exec tsc --noEmit` ✅ 通過

---

## 3. Phase 2 完了時のディレクトリ構成

```txt
packages/
  bot/
    src/
      commands/
        index.ts
        types.ts
        search-jisho.command.ts
        edit-jisho.command.ts
        refresh-jisho.command.ts
        source-jisho.command.ts
        priority-jisho.command.ts
        override-jisho.command.ts
        ratelimit-set.command.ts
        ratelimit-list.command.ts
        ratelimit-reset.command.ts
        wipe-channel.command.ts
        wipe-status.command.ts
        wipe-now.command.ts
      events/
        interactionCreate.ts
        messageCreate.ts
      scripts/
        register-commands.ts
      services/
        admin-permission.service.ts
        response-admin.service.ts
        rate-limit-admin.service.ts
        wipe-admin.service.ts
        ...Phase 1 services

  db/
    src/schema/
      mcp-audit-logs.ts
      index.ts

  mcp/
    package.json
    tsconfig.json
      src/
        index.ts
        config/env.ts
        tools/
          read-only-tools.ts
        services/
          audit.service.ts
        utils/
          redact.ts
```

---

## 4. Task 2-1 — Slash Command 基盤

### 目的

Discord の `interactionCreate` を使い、管理コマンドを Command Registry で扱う。

### 実装内容

1. `packages/bot/src/commands/types.ts`
   - command 名
   - command builder
   - execute handler
   - `requiresAdmin: boolean`

2. `packages/bot/src/commands/index.ts`
   - 全コマンドを配列で export
   - `Map<string, Command>` を作る

3. `packages/bot/src/events/interactionCreate.ts`
   - `interaction.isChatInputCommand()`
   - `interaction.isModalSubmit()`
   - `interaction.isButton()`
   - 未知 command は ephemeral error

4. `packages/bot/src/scripts/register-commands.ts`
   - `REST` + `Routes.applicationGuildCommands(clientId, guildId)` を使う
   - 開発中は guild command のみ登録
   - 本番 global command は Phase 4 以降で検討

5. `packages/bot/package.json`
   - `register-commands` script を追加

### 注意

discord.js v14 では ephemeral reply は `MessageFlags.Ephemeral` を使う。
通常の `message.reply()` には ephemeral はない。

---

## 5. Task 2-2 — `/search-jisho`

### 目的

管理者が Response-DB の生成済み回答を Discord から確認する。

### 入力

```txt
/search-jisho word:<string>
```

### 挙動

1. `word` を trim
2. `response_cache.normalized_query` で検索
3. `role_key`, `model_name`, `prompt_version`, `is_manual_override`, `updated_at` を表示
4. 回答本文は長いので 1件あたり短く切る
5. 結果が多い場合は上位10件まで

### 非ゴール

- cache miss 時に LLM 再生成しない
- 複数辞書の定義を混ぜない

---

## 6. Task 2-3 — `/edit-jisho`

### 目的

既存回答を Discord Modal で編集し、手動上書きとして保存する。

### 入力

```txt
/edit-jisho response_id:<string>
```

`bigserial` は bigint なので、Discord command では string として受け取る。

### 挙動

1. `response_id` を bigint に安全変換
2. `response_cache` の該当行を取得
3. Modal に現在の回答を入れる
4. submit 後に以下を同じ流れで実行
   - `response_cache.response_text` 更新
   - `is_manual_override = true`
   - `updated_at = now()`
   - `response_edits` に before / after / editor / reason を保存

### 安全条件

- 空文字保存は禁止
- 既存レコードがない場合は ephemeral error
- 編集履歴なしの上書きは禁止

---

## 7. Task 2-4 — `/refresh-jisho`

### 目的

LLM 生成済み回答を破棄し、次回検索時に再生成させる。

### 入力

```txt
/refresh-jisho word:<string> role:<optional string>
```

### 挙動

1. 対象 cache を検索
2. `is_manual_override = true` はデフォルトでは削除しない
3. 削除対象件数を ephemeral で確認表示
4. 確認ボタン後に削除
5. `bot_events` に `cache.refresh_requested` 相当のイベントを残す

### 判断

手動編集は人間の品質改善結果なので、通常 refresh で消してはいけない。
手動 override まで消す操作は Phase 3 の Web UI または Phase 4 の dangerous ops へ回す。

---

## 8. Task 2-5 — `/source-jisho`

### 目的

ある単語がどの辞書・どの entry から生成されたかを確認する。

### 入力

```txt
/source-jisho word:<string>
```

### 挙動

1. `lookup_logs.normalized_query` で直近ログを検索
2. `dictionary_id_used` から `dictionaries` を join
3. `response_cache_id` があれば response cache も表示
4. 直近5件まで表示

### 注意

検索ログがない単語は「まだ検索履歴なし」と返す。
その場で辞書検索や LLM 生成はしない。

---

## 9. Task 2-6 — `/priority-jisho`

### 目的

辞書 fallback 順を Discord から確認する。

### 入力

```txt
/priority-jisho
```

### 挙動

`dictionaries` を `priority ASC` で表示する。

表示項目:

- priority
- name
- slug
- enabled
- created_at

### 非ゴール

Phase 2 では priority の変更はしない。
辞書順変更は Web UI または明示的な管理コマンド追加時に扱う。

---

## 10. Task 2-7 — `/override-jisho`

### 目的

既存回答を短いテキストで即時上書きする。

長文編集は `/edit-jisho` の Modal を使う。

### 入力

```txt
/override-jisho response_id:<string> text:<string>
```

### 挙動

1. `response_id` を bigint 変換
2. 現在の回答を取得
3. `text` で上書き
4. `is_manual_override = true`
5. `response_edits` に履歴保存

### 注意

Discord の command option は長文編集に向かない。
本文が長い場合は `/edit-jisho` へ誘導する。

---

## 11. Task 2-8 — 権限ガード

### 目的

管理者以外に編集・削除・wipe・refresh を許可しない。

### 判定

基本は Discord の `ManageGuild` 権限。

Owner / Administrator は通す。

権限なしは ephemeral error。

### 二重ガード

1. command 定義で `setDefaultMemberPermissions(ManageGuild)`
2. 実行時に `admin-permission.service.ts` で再確認

Discord 側の UI 制御だけに頼らない。

---

## 12. Task 2-9 — Rate Limit 管理コマンド

### `/ratelimit-set`

```txt
/ratelimit-set role:<role> limit:<integer>
```

挙動:

- `role_rate_limits.discord_role_id` に role ID を保存
- `role_label` には表示名を保存
- `daily_limit = -1` は無制限
- `updated_at = now()`

### `/ratelimit-list`

```txt
/ratelimit-list
```

挙動:

- `role_rate_limits` を一覧表示
- `__default__` も表示

### `/ratelimit-reset`

```txt
/ratelimit-reset user:<user>
```

挙動:

- GMT+7 の今日の日付だけ `user_usage.count = 0`
- 全期間削除はしない

### 注意

Rate Limit は DB 基準。
メモリだけで管理しない。

---

## 13. Task 2-10 — Channel Wipe 管理コマンド

### `/wipe-channel`

```txt
/wipe-channel channel:<text_channel> enabled:<boolean>
```

挙動:

- `channel_settings` を upsert
- `wipe_enabled` を更新
- `guild_id`, `channel_id`, `updated_at` を保存

### `/wipe-status`

```txt
/wipe-status
```

挙動:

- 実行中 guild の `channel_settings` を表示
- `wipe_enabled`
- `last_wipe_at`
- channel ID

### `/wipe-now`

```txt
/wipe-now channel:<text_channel>
```

挙動:

1. 管理者権限を確認
2. 対象 channel の `wipe_enabled = true` を確認
3. Bot 権限 `MANAGE_MESSAGES`, `READ_MESSAGE_HISTORY`, `SEND_MESSAGES` を確認
4. ephemeral confirmation を出す
5. 確認後に `wipeChannel()` を実行
6. `deletedCount` を表示

### 安全条件

- `wipe_enabled = false` のチャンネルでは実行しない
- 対象は直近24時間以内
- ピン留めは削除しない
- チャンネルIDは変わらない

---

## 14. Task 2-11 — MCP Server パッケージ

### 目的

外側AIエージェントが DB 上の状態を read-only で確認できる MCP server を作る。

### パッケージ

```txt
packages/mcp
  name: @grkd-jisho/mcp
```

Phase 2 は stdio transport で始める。
HTTP transport は Phase 3 以降。

### 依存関係

実装時に package manager で追加する。
package.json を手で推測編集しない。

候補:

```txt
@modelcontextprotocol/server
@grkd-jisho/db workspace:*
drizzle-orm
zod
tsx / typescript / @types/node
```

Context7 の公式例では `McpServer`, `StdioServerTransport`, `server.registerTool()` を使う。
SDK のバージョンで import path と zod v3/v4 の扱いが変わるため、実装直前に再確認する。

### 禁止

- `DISCORD_TOKEN` を mcp env に追加しない
- Discord API を呼ばない
- 任意SQL tool を作らない
- `.env` や secret を tool 出力に含めない

---

## 15. Task 2-12 — Read-only MCP Tools

全 tool は `grkd-jisho.` prefix 固定。

全 tool call は audit log に残す。

### `grkd-jisho.health`

返すもの:

- DB 接続状態
- bot heartbeat
- mcp heartbeat
- 最新 error 数
- degraded 判定

### `grkd-jisho.recent_errors`

入力:

```txt
limit?: number default 20 max 100
level?: "warn" | "error"
```

返すもの:

- `bot_events` の warn/error
- trace_id
- event_type
- created_at
- redacted payload

### `grkd-jisho.get_trace`

入力:

```txt
trace_id: string
```

返すもの:

- 同じ trace_id の event 一覧
- 時系列
- duration_ms があれば表示

### `grkd-jisho.lookup_stats`

入力:

```txt
days?: number default 7 max 30
```

返すもの:

- lookup count
- unique users
- top queries
- dictionary hit count
- cache hit ratio

### `grkd-jisho.cache_stats`

返すもの:

- total response_cache
- manual override count
- prompt_version 別件数
- model_name 別件数
- recent cache created count

### `grkd-jisho.rate_limit_status`

入力:

```txt
user_id?: string
role_id?: string
```

返すもの:

- role_rate_limits
- user_usage の今日の count
- reset 基準は GMT+7

### `grkd-jisho.wipe_status`

返すもの:

- channel_settings
- wipe_enabled
- last_wipe_at
- 直近の wipe.started / wipe.completed / wipe.failed event

---

## 16. Task 2-13 — MCP Audit Log

### DB schema

`packages/db/src/schema/mcp-audit-logs.ts` を追加する。

```txt
mcp_audit_logs
  id                 bigserial primary key
  agent_id           text not null
  tool_name          text not null
  args_json_redacted jsonb default '{}'
  result_status      text not null  // success / error / rejected
  dry_run            boolean not null default false
  error_message      text
  created_at         timestamptz default now()
```

Index:

```txt
idx_mcp_audit_logs_agent
idx_mcp_audit_logs_tool
idx_mcp_audit_logs_created_at
```

### Redaction

以下の key は保存前に必ず `"[REDACTED]"` にする。

```txt
token
secret
api_key
apikey
password
authorization
cookie
```

大文字小文字は区別しない。
ネストした object も対象。

---

## 17. 実装順序

Phase 2 はこの順で進める。

```txt
Step 0: Phase 1 残リスク修正
  -> Guild member role 取得
  -> response_cache insert race
  -> messageCreate top-level catch

Step A: Slash Command 基盤
  -> command types / registry
  -> register script
  -> interactionCreate
  -> permission guard

Step B: Response 管理コマンド
  -> search / edit / refresh / source / priority / override
  -> response_edits 履歴

Step C: Ops 管理コマンド
  -> ratelimit set/list/reset
  -> wipe channel/status/now
  -> destructive confirm

Step D: MCP read-only 基盤
  -> packages/mcp
  -> stdio MCP server
  -> audit wrapper
  -> health / errors / trace

Step E: MCP stats tools
  -> lookup_stats
  -> cache_stats
  -> rate_limit_status
  -> wipe_status

Step F: 検証とレビュー
  -> tsc
  -> db generate/migrate
  -> slash command 手動確認
  -> MCP tool call 手動確認
  -> code-reviewer
```

Step A 以降に入る前に Step 0 を終わらせる。

---

## 18. 動作確認チェックリスト

### 型・DB

- [ ] `pnpm install`
- [ ] `pnpm db:generate`
- [ ] `pnpm db:migrate`
- [ ] `pnpm --filter db exec tsc --noEmit`
- [ ] `pnpm --filter bot exec tsc --noEmit`
- [ ] `pnpm --filter mcp exec tsc --noEmit`

### Slash Command

- [ ] `pnpm --filter bot register-commands`
- [ ] 権限なしユーザーは管理コマンドを実行できない
- [ ] `/search-jisho` で cache 一覧が見える
- [ ] `/edit-jisho` で modal 編集でき、`response_edits` に履歴が残る
- [ ] `/refresh-jisho` は manual override を消さない
- [ ] `/source-jisho` で辞書名と entry/cache ID が見える
- [ ] `/priority-jisho` で辞書順が見える
- [ ] `/ratelimit-set` 後、DB の `role_rate_limits` が更新される
- [ ] `/ratelimit-reset` 後、GMT+7 今日分だけ count が0になる
- [ ] `/wipe-channel` で `wipe_enabled` を切り替えられる
- [ ] `/wipe-now` は確認なしに実行されない
- [ ] `/wipe-now` はピン留めを削除しない

### MCP

- [ ] MCP server が stdio で起動する
- [ ] `grkd-jisho.health` が heartbeat を返す
- [ ] `grkd-jisho.recent_errors` が warn/error event を返す
- [ ] `grkd-jisho.get_trace` が trace 単位で event を返す
- [ ] `grkd-jisho.lookup_stats` が統計を返す
- [ ] `grkd-jisho.cache_stats` が cache 統計を返す
- [ ] `grkd-jisho.rate_limit_status` が rate limit 状態を返す
- [ ] `grkd-jisho.wipe_status` が wipe 状態を返す
- [ ] 全 tool call が `mcp_audit_logs` に残る
- [ ] tool 出力に `.env`, token, API key, secret が含まれない

---

## 19. 既知リスクと判断

| リスク | 判断 |
|---|---|
| Slash Command が増えて `interactionCreate.ts` が肥大化する | Command Registry で handler を分ける |
| `/override-jisho` の text が長すぎる | 長文は `/edit-jisho` modal へ誘導 |
| `/refresh-jisho` が手動編集を消す | manual override はデフォルト削除対象外 |
| `/wipe-now` が危険 | `wipe_enabled=true` + 権限確認 + 確認ボタン必須 |
| MCP から書き込みたくなる | Phase 2 は read-only 固定。write は Phase 3/4 |
| MCP SDK の import path が変わる | 実装直前に Context7 / 公式READMEを再確認 |
| zod v3/v4 の違い | `packages/mcp` 内だけで解決し、bot/web/db に不要な影響を出さない |

---

## 20. Phase 2 でやらないこと

- Web Admin UI
- Discord OAuth2
- MCP dry-run tools
- MCP limited write tools
- MCP dangerous tools
- MCP から Discord API 呼び出し
- 任意SQL実行 tool
- prompt_version rotate
- bulk cache delete

Phase 2 は「人間の管理者が Discord で管理できる」「AIエージェントが read-only で見える」まで。
それ以上は Phase 3 以降に回す。

---

## 21. 実装ログ（Step D: MCP read-only 基盤）

### 実装内容

- `packages/mcp` を新規作成（`@grkd-jisho/mcp`）
- stdio transport の MCP server を追加
- read-only tool を 3つ実装
  - `grkd-jisho.health`
  - `grkd-jisho.recent_errors`
  - `grkd-jisho.get_trace`
- `mcp_audit_logs` schema を追加し、全 tool call を audit 保存
- Phase 2 ガードとして `MCP_READONLY_MODE=true` を起動時に強制

### 追加/更新ファイル

- `packages/db/src/schema/mcp-audit-logs.ts` (new)
- `packages/db/src/schema/index.ts` (update)
- `packages/mcp/package.json` (new)
- `packages/mcp/tsconfig.json` (new)
- `packages/mcp/src/config/env.ts` (new)
- `packages/mcp/src/services/audit.service.ts` (new)
- `packages/mcp/src/tools/read-only-tools.ts` (new)
- `packages/mcp/src/index.ts` (new)
- `packages/mcp/src/utils/redact.ts` (new)

### code-reviewer 指摘と修正

- HIGH: `bot_events.payload_json` が tool 出力にそのまま出る可能性
  - 対応: `redactDeep()` を共通化し、`recent_errors/get_trace` 返却前に payload を再帰マスク
- MED: `recent_errors` の warn/error フィルタが raw SQL
  - 対応: `inArray()` に変更
- LOW: マスク対象キー不足
  - 対応: `api-key`, `client_secret`, `access_token`, `refresh_token` を追加

### 検証結果

- `pnpm install` ✅
- `pnpm db:generate` ✅（`mcp_audit_logs` 反映）
- `pnpm --filter mcp exec tsc --noEmit` ✅
- `pnpm --filter db exec tsc --noEmit` ✅
- `pnpm --filter bot exec tsc --noEmit` ✅

### 残タスク

- Step E: stats系 read-only tool を追加
  - `grkd-jisho.lookup_stats`
  - `grkd-jisho.cache_stats`
  - `grkd-jisho.rate_limit_status`
  - `grkd-jisho.wipe_status`

---

## 22. 実装ログ（Step E: MCP stats tools）

### 実装内容

- Step E の read-only stats tool を追加
  - `grkd-jisho.lookup_stats`
  - `grkd-jisho.cache_stats`
  - `grkd-jisho.rate_limit_status`
  - `grkd-jisho.wipe_status`
- すべて既存の `withAudit()` ラッパー経由で `mcp_audit_logs` 記録
- すべて `grkd-jisho.` prefix を維持

### 主なロジック

- `lookup_stats`
  - 期間（日数）内の lookup 件数
  - unique user 件数
  - top query（上位10件）
  - dictionary hit 件数
  - cache hit ratio
- `cache_stats`
  - `response_cache` 総件数
  - manual override 件数
  - prompt_version 別件数
  - model_name 別件数
  - 直近7日作成件数
- `rate_limit_status`
  - `role_rate_limits` 一覧（または role_id 絞り込み）
  - `user_usage` の当日使用量（GMT+7 = `Asia/Jakarta` 基準）
- `wipe_status`
  - `channel_settings` 一覧
  - `wipe.started / wipe.completed / wipe.failed` の直近イベント

### code-reviewer 指摘と修正

- MED: `usageDate` 比較に `eq(column, sqlExpr)` を使っていた
  - 対応: `where(sql\`${schema.userUsage.usageDate} = (now() at time zone 'Asia/Jakarta')::date\`)` へ修正
- MED: redact が厳密一致のみで漏れ余地あり
  - 対応: `token/secret/api[_-]?key/password/authorization/cookie` の部分一致パターンに変更

### 検証結果

- `pnpm --filter mcp exec tsc --noEmit` ✅
- `pnpm --filter db exec tsc --noEmit` ✅
- `pnpm --filter bot exec tsc --noEmit` ✅

### 次ステップ

- Step F: Phase 2 検証と最終レビュー

---

## 23. 実装ログ（Step F 前: Phase 2 回帰修正 + ドキュメント整合）

### 修正背景

Phase 3 移行前の全体検証で、Phase 2 の死角（interaction例外捕捉、権限ガード整合、wipe運用前提、ドキュメント構成ドリフト）を修正した。

### 実装内容

1. `interactionCreate.ts` の Button / Modal 分岐を個別 try/catch で保護。
   - 2次エラー（error reply 送信失敗）も catch して unhandled rejection を回避。
2. 管理コマンドの `setDefaultMemberPermissions(8)` を全件 `PermissionFlagsBits.ManageGuild` に統一。
3. `/wipe-now` に事前権限チェックを追加。
   - `ManageMessages` / `ReadMessageHistory` / `SendMessages` 不足時は実行前に中断。
   - 実行時の `TextChannel` 型ガードを追加。
4. `messageCreate.ts` のトップレベル catch で `traceEvent("reply.error")` を記録。
5. `/wipe-status` を guild スコープ化。
   - `getChannelSettings(guildId)` に変更し、実行中 guild の設定のみ表示。
6. `resetUserUsage()` の戻り値意味を修正。
   - 当日レコードなし、または `count <= 0` の場合は `0` を返す。
7. ドキュメントドリフト修正。
   - Phase 2 完了時構成から実在しないファイル記述を削除。
   - MCP 構成を実装実態（`read-only-tools.ts`, `audit.service.ts`, `redact.ts`）に同期。

### 更新ファイル

- `packages/bot/src/events/interactionCreate.ts`
- `packages/bot/src/events/messageCreate.ts`
- `packages/bot/src/commands/*.command.ts`（管理コマンド全12件）
- `packages/bot/src/services/wipe-admin.service.ts`
- `packages/bot/src/services/rate-limit-admin.service.ts`
- `DOCS/Roadmap_Implement/phase-2-admin-mcp.md`
- `MASTER_PLAN.md`
- `ROADMAP.md`

### 検証結果

- `pnpm --filter bot exec tsc --noEmit` ✅
- `pnpm --filter mcp exec tsc --noEmit` ✅
- `pnpm --filter db exec tsc --noEmit` ✅
- `pnpm --filter bot test` ✅（`1 passed / 3 skipped / 13 todo`）

### 補足

- `pnpm db:migrate` はローカル Docker daemon 未起動のため、このセッションでは再検証不可（`ECONNREFUSED`）。
