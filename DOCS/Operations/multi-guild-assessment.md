# Multi-Guild 対応 影響評価レポート

**目的:** 複数 Discord Guild 対応の実装コストと影響範囲を、コードベースの実調査に基づいて評価する。
**フェーズ:** Phase 4 では一気に完全対応しない。調査のみ行い Phase 5 へ委ねる判断基準を提供する。

---

## 1. 評価サマリー

| 観点 | 評価 |
|------|------|
| DB schema 対応 | ✅ `channel_settings` / `user_usage` / `lookup_logs` / `bot_events` に `guild_id` あり。`role_rate_limits` と `ops_jobs` にはなし（グローバル設定）。 |
| Bot サービス層 | ✅ guild 固有サービス（rate-limit / user-usage / channel-settings / ops-job）は `guildId` パラメータ対応済み。dictionary / LLM / response-cache は guild-agnostic のため不要。 |
| Slash Command 層 | ✅ `interaction.guildId` を利用している。変更不要。 |
| **環境変数** | ❌ `DISCORD_GUILD_ID` が単一値。配列化が必要。 |
| **Command 登録** | ❌ `register-commands.ts` が単一 guild にのみ登録。 |
| **Web OAuth2** | ❌ ハードコードされた `DISCORD_GUILD_ID` で guild 所属確認。 |
| **MCP stats tools** | ❌ guild filter がない。全 guild のデータが混在。 |
| **DM 対応** | ⚠ 部分的に対応済み（`messageCreate.ts` L90 で `member` が null なら早期 return）。明示的な guild 分散は不要。 |

**総合判定:** 中規模変更。Phase 5 に送っても問題ない。
**推奨: Phase 5 に送る。**

理由:
- DB と service 層の guild 固有処理は既に multi-guild 対応済み。修正範囲は env / register / OAuth / MCP の4領域。
- 既存 single guild 運用を壊さずに段階的に導入可能。
- コアロジック（dictionary lookup / LLM / cache）は guild に依存しない。変更不要。

---

## 2. 調査詳細

### 2-1. `DISCORD_GUILD_ID` 単一前提の箇所

**発見数: 17箇所**（コード7箇所 + ドキュメント10箇所）

| ファイル | 行 | 問題 |
|---|---|---|
| `packages/bot/src/config/env.ts` | L7 | `DISCORD_GUILD_ID: z.string().min(1)` — 単一文字列 |
| `packages/bot/src/scripts/register-commands.ts` | L9, L15 | `Routes.applicationGuildCommands(CLIENT_ID, GUILD_ID)` — 1 guild のみ |
| `packages/web/src/env.ts` | L7 | `DISCORD_GUILD_ID: z.string().min(1)` — 単一文字列 |
| `packages/web/src/pages/auth/callback.ts` | L40, L48, L59 | `fetchGuildMember(token, DISCORD_GUILD_ID)` — ハードコード |
| `packages/web/src/middleware.ts` | L54 | session.guildId を locals に設定。単一値が渡される。 |
| `.env.example` | L4 | 単一値の例 |

**修正案（後方互換維持）:**
```ts
// env.ts: カンマ区切りで配列解釈に拡張（キー名は維持）
DISCORD_GUILD_ID: z
  .string()
  .min(1)
  .transform((s) => s.split(",").map((id) => id.trim())),
```

```ts
// register-commands.ts: 全 guild に登録
for (const guildId of env.DISCORD_GUILD_ID) {
  await rest.put(Routes.applicationGuildCommands(CLIENT_ID, guildId), ...);
}
```

env キー名は `DISCORD_GUILD_ID` のまま変更しない。
zod の `.transform()` でカンマ区切りを配列に変換するだけで、既存の single guild `.env` はそのまま動く。

**影響範囲:** bot env / web env / register-commands / docs
**難易度:** 低（1日）

---

### 2-2. Web OAuth2 の guild 判定

**現状:**
- `auth/callback.ts` L40: `fetchGuildMember(accessToken, env.DISCORD_GUILD_ID)` で単一 guild の所属確認
- Session は `guildId` を保持
- ログイン時に guild 選択画面がない

**multi-guild 移行案:**

```txt
Phase 1（最小変更）:
  - Guild ID array をループ。最初に見つかった guild で認証。
  - 既存 single guild と同じ動作。

Phase 2（完全対応）:
  - ログインフローに guild 選択画面を追加
  - 選択された guild の admin 権限を確認
  - Session に guildId を保存
```

**修正案（guild_id 変更要）:**
Web OAuth でも配列ループ:

**影響範囲:** web/src/pages/auth/callback.ts
**難易度:** 中（ログインフローの変更必要）

---

### 2-3. `DISCORD_ALLOWED_CHANNELS` の扱い

**現状:**
- `messageCreate.ts` L78: `allowedChannels.includes(message.channelId)` — 単なる channel ID の包含チェック
- Channel ID は Discord 全体で一意のため、guild をまたいでも重複は原理的に発生しない
- ただし `DISCORD_ALLOWED_CHANNELS` が全 guild の全チャンネルを含む巨大リストになる可能性

**multi-guild 移行案:**
```txt
維持: channel ID のフラットリストのままでも動作する。
改善案 (Phase 5):
  - DMG: channel_settings テーブルに is_bot_allowed カラムを追加
  - 管理画面からチャンネル単位で許可設定
  - env の DISCORD_ALLOWED_CHANNELS は廃止または fallback に
```

**影響範囲:** 変更不要（現状のままで multi-guild 対応可能）
**難易度:** なし（機能するが運用上は非効率になりうる）

---

### 2-4. `channel_settings.guild_id` の既存利用

**現状（`packages/db/src/services/admin/wipe-admin.ts`）:**
- Schema: `text("guild_id").notNull()` — ✅ 問題なし
- `getChannelSettings(guildId)` — ✅ guildId パラメータ対応済み
- `wipe-status.command.ts` — ✅ `interaction.guildId` で scope 済み
- `wipe-channel.command.ts` — ✅ guildId を渡している
- `ops-job.service.ts` — ✅ wipe setting は Web UI 管理。guildId スコープは DB 側で保持済み

**必要な変更:**
なし。DB schema と Bot コマンドは既に multi-guild 対応。

---

### 2-5. `/wipe-status` の guild scope

**現状:**
- `wipe-status.command.ts` L20: `getChannelSettings(interaction.guildId)` — ✅ 既に current guild に scope 済み
- MCP `grkd-jisho.wipe_status` — ❌ guild filter なし（全 guild のデータを返す）

**必要な変更（MCP のみ）:**
```ts
// read-only-tools.ts: オプショナル guild_id パラメータ追加
export async function getWipeStatus(guildId?: string) {
  const conditions = guildId
    ? eq(schema.channelSettings.guildId, guildId)
    : undefined;
  // ...
}
```

**影響範囲:** MCP read-only-tools のみ
**難易度:** 低（guild_id パラメータ追加のみ）

---

### 2-6. MCP stats tool の guild filter 有無

| ツール | guild filter | 問題 |
|---|---|---|
| `grkd-jisho.health` | — | guild 概念なし。問題なし。 |
| `grkd-jisho.recent_errors` | ❌ なし | 全 guild のエラーが混在。 |
| `grkd-jisho.get_trace` | ❌ なし | trace_id 単位。guild 関係なし。問題なし。 |
| `grkd-jisho.lookup_stats` | ❌ なし | 全 guild の統計が混在。 |
| `grkd-jisho.cache_stats` | ❌ なし | cache は guild に依存しない。問題なし。 |
| `grkd-jisho.rate_limit_status` | ❌ なし | 全 guild の role_rate_limits と user_usage が混在。 |
| `grkd-jisho.wipe_status` | ❌ なし | 全 guild の settings と events が混在。 |

**必要な変更（MCP 全般）:**
全 stats tool に `guild_id?: string` オプショナルパラメータを追加。
指定されれば WHERE guild_id = ? で絞り込み。未指定なら全 guild 返却（互換性維持）。

注意点:
- `rate_limit_status` は `role_rate_limits` に guild_id がないため、フィルタは `user_usage` データのみに適用される。グローバル設定の role rate limits は全 guild 表示となる。
- `recent_errors` で `bot_events` をフィルタする場合、guild_id が nullable のため null-guild イベント（DM関連など）は対象外になる。

**影響範囲:** MCP read-only-tools のみ（6ツール中4ツール）
**難易度:** 低（パラメータ追加 + WHERE 句追加のみ）

---

## 3. DB schema 変更の要否

**結論: 不要。**

| テーブル | guild_id カラム | 状態 |
|---|---|---|
| `channel_settings` | `text("guild_id").notNull()` | ✅ 既存 |
| `user_usage` | `text("guild_id").notNull()` | ✅ 既存（unique 制約にも含む） |
| `lookup_logs` | `text("guild_id").notNull()` | ✅ 既存 |
| `bot_events` | `text("guild_id")`（nullable） | ✅ 既存 |
| `dictionaries` | guild 概念なし | ✅ 問題なし |
| `dictionary_entries` | guild 概念なし | ✅ 問題なし |
| `response_cache` | guild 概念なし | ✅ 問題なし |
| `response_edits` | guild 概念なし | ✅ 問題なし |
| `role_rate_limits` | guild 概念なし（グローバル設定） | ✅ 問題なし |
| `ops_jobs` | guild 概念なし | ✅ 問題なし |
| `mcp_audit_logs` | guild 概念なし | ✅ 問題なし |
| `bot_heartbeats` | guild 概念なし | ✅ 問題なし |

**重要な発見:** `role_rate_limits` は guild_id を持たない。現在はグローバル設定として全 guild で共有される。
multi-guild 対応時は guild_id カラムの追加 OR 「__global__ として扱う」のいずれかを選択する。

---

## 4. 既存 single guild 運用を壊さない移行案

### 4-1. 最小変更ルート（推奨）

変更を最小限に抑え、single guild と multi guild を共存させる。

```txt
Step 1: env.ts のみ変更
  DISCORD_GUILD_ID → DISCORD_GUILD_IDS（配列、互換性維持）
  single guild の .env は "guild_id_1" のまま動作

Step 2: register-commands.ts
  ループで全 guild にコマンド登録
  single guild なら1回だけループ

Step 3: Web OAuth2
  配列をループして最初に見つかった guild で認証
  single guild なら従来と同じ動作

Step 4: MCP stats tools
  guild_id オプショナルパラメータ追加（default: 全 guild）
  互換性を完全維持
```

各 Step は独立してリリース可能。従来の `DISCORD_GUILD_ID=guild_1` 環境では全く同じ動作。

### 4-2. 破壊的変更なし

- env キー名の変更なし（`DISCORD_GUILD_ID` を維持したまま配列解釈に拡張可能）
- DB migration 不要
- Bot のロジック変更不要（既に guildId パラメータ対応済み）

---

## 5. Phase 5 送り判定

### Phase 5 に送る理由

| 理由 | 説明 |
|------|------|
| Phase 4 の優先事項が他にある | Step K 調査 / パフォーマンス最適化 / Bug修正が先 |
| single guild で運用開始できる | 現状のコードで運用可能。multi-guild は optional。 |
| 実装コストに対して優先度が低い | 変更範囲は広いが、ユーザーへの直接価値は限定的。 |
| 依存関係が少ない | env / register / OAuth / MCP の4領域に閉じている。後回しにしても影響なし。 |

### Phase 5 に送らない理由

| 理由 | 説明 |
|------|------|
| MCP 利用者が混乱する | stats tools が全 guild のデータを返すため、運用者が誤認する可能性。 |
| OAuth2 の guild 固定が問題になる | 複数 guild を管理するオペレーターがログインできない。 |
| 実装コストが低い | env と register のみなら半日で完了。 |

### 判定

**→ Phase 5 に送る。**

ただし、以下の3点は Phase 4 完了前に軽微な修正を推奨:

| 修正 | 理由 | 工数 |
|------|------|------|
| `grkd-jisho.wipe_status` に guild_id オプショナル追加 | 既存 Bot コマンドと不整合 | 30分 |
| DOCS/Operations/deploy.md に multi-guild 非対応を明記 | 運用者が誤解しないように | 10分 |
| env.example にコメント追加 | DISCORD_GUILD_ID が単一前提であることを明記 | 5分 |

---

## 6. 添付: 変更が必要なファイル一覧

### Phase 5 で本格対応する場合の修正ファイル

| ファイル | 変更内容 | 重要度 |
|---|---|---|
| `packages/bot/src/config/env.ts` | `DISCORD_GUILD_ID` 配列化 | HIGH |
| `packages/web/src/env.ts` | `DISCORD_GUILD_ID` 配列化 | HIGH |
| `packages/bot/src/scripts/register-commands.ts` | ループ登録 | HIGH |
| `packages/web/src/pages/auth/callback.ts` | guild 選択 or ループ確認 | HIGH |
| `packages/mcp/src/tools/read-only-tools.ts` | `guild_id?` パラメータ追加 x4 | MED |
| `packages/mcp/src/index.ts` | MCP tool schema に guild_id 追加 x4 | MED |
| `packages/bot/src/events/messageCreate.ts` | DM (`guildId=null`) の扱い | LOW |
| `.env.example` | 複数 guild ID の例 | LOW |
| `DOCS/Operations/deploy.md` | multi-guild 手順追加 | LOW |
| `DOCS/Roadmap_Implement/*.md` | Phase 5 タスクとして記録 | LOW |

### 変更不要なファイル（既に multi-guild 対応済み）

- `packages/bot/src/services/rate-limit.service.ts` — guildId パラメータ対応済み
- `packages/bot/src/services/ops-job.service.ts` — guildId パラメータ対応済み
- `packages/db/src/services/admin/wipe-admin.ts` — guildId パラメータ対応済み
- `packages/db/src/services/admin/rate-limit-admin.ts` — guildId パラメータ対応済み
- `packages/db/src/schema/*.ts` — 全 guild 関連テーブルに guild_id カラムあり
- `packages/bot/src/commands/*.ts` — 全 command が `interaction.guildId` 利用済み

非 guild 依存サービス（dictionary / LLM / response-cache）は guild-agnostic のため修正対象外。
