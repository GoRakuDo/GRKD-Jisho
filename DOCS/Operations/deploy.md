# GRKD-Jisho Deploy Guide

## アーキテクチャ概要

```
┌──────────────┐     ┌──────────────────┐     ┌──────────────┐
│  PostgreSQL  │◄────│  grkd-jisho-bot  │     │  External AI │
│   (DB)       │     │  (Discord Bot)   │     │  Agent (MCP) │
│              │◄────│                  │     │              │
│              │     │  grkd-jisho-web  │◄────│  (stdio)     │
│              │     │  (Admin UI)      │     │              │
└──────────────┘     └──────────────────┘     └──────────────┘
```

- Bot, Web, MCP は同じ DB を参照する
- MCP は常に `grkd-jisho-bot` コンテナ内で stdio プロセスとして動作する
- 外部 AI エージェントは MCP stdio 越しにのみ Bot とやり取りする

---

## 1. 前提条件

- Docker / Docker Compose
- Discord Application（Bot + OAuth2）の登録済み
- Gemini API Key（OpenRouter は fallback）
- Node.js 20 LTS（ローカル開発のみ）

---

## 2. ローカル開発環境（Docker Compose）

### 2-1. 初回起動

```bash
# .env を作成
cp .env.example .env
# .env を編集して必要な値を入力（DISCORD_TOKEN, GEMINI_API_KEY など）

# DB を起動
docker compose up -d postgres

# 依存関係インストール
pnpm install

# DB migration
pnpm db:migrate

# デフォルトデータ投入（rate limit など）
pnpm db:seed

# Bot 起動（dev mode）
pnpm bot:dev

# Web UI 起動（別 terminal）
pnpm web:dev
```

### 2-2. 環境変数

詳細は `.env.example` を参照。必須なのは以下のみ：

| 変数 | 必須 | 説明 |
|------|------|------|
| `DISCORD_TOKEN` | ✅ | Discord Bot Token |
| `DISCORD_CLIENT_ID` | ✅ | Discord Application ID |
| `DISCORD_GUILD_ID` | ✅ | 管理する Discord Server ID |
| `DISCORD_ALLOWED_CHANNELS` | ✅ | Bot が応答するチャンネルID（カンマ区切り） |
| `DATABASE_URL` | ✅ | PostgreSQL接続文字列 |
| `GEMINI_API_KEY` | ✅ | Gemini LLM API Key |
| `DISCORD_CLIENT_SECRET` | Web UI使用時 | Discord OAuth2 Client Secret |
| `SESSION_SECRET` | Web UI使用時 | 32文字以上のセッション秘密鍵 |
| `WEB_BASE_URL` | Web UI使用時 | OAuth callback の公開URL |

### 2-3. 便利なコマンド

```bash
pnpm db:generate   # schema 変更後に migration ファイル生成
pnpm db:migrate    # migration を DB に適用
pnpm db:seed       # デフォルトデータ（rate limit等）を投入
pnpm bot:register  # Discord Slash Command を登録
pnpm bot:dev       # Bot を開発モードで起動（hot-reload）
pnpm web:dev       # Web UI を開発モードで起動
pnpm test          # 全テスト実行
```

---

## 3. 本番環境（Docker / Railway / Fly.io）

### 3-1. Docker Image ビルド

```bash
# Bot
docker build -f packages/bot/Dockerfile -t grkd-jisho-bot:latest .

# Web UI
docker build -f packages/web/Dockerfile -t grkd-jisho-web:latest .
```

### 3-2. Railway デプロイ

1. **New Project** → **Deploy from GitHub**
2. リポジトリ: `GoRakuDo/GRKD-Jisho`
3. 以下の **Root Directory** 指定は不要（monorepo 全体を clone し、Dockerfile のパスを指定）

サービス構成:

| Service | Build Command | Start Command | Dockerfile Path |
|---------|--------------|---------------|-----------------|
| `postgres` | — | — | Railway PostgreSQL plugin |
| `grkd-jisho-bot` | `docker build -f packages/bot/Dockerfile .` | — | `packages/bot/Dockerfile` |
| `grkd-jisho-web` | `docker build -f packages/web/Dockerfile .` | — | `packages/web/Dockerfile` |

**注意:**
- Railway の `DATABASE_URL` は Railway PostgreSQL plugin が自動設定する
- `WEB_BASE_URL` は Railway の Web UI 公開 URL に設定（例: `https://grkd-jisho-web.up.railway.app`）
- `SESSION_SECRET` は必ず十分な長さ（32文字以上）のランダム文字列を設定
- `DISCORD_CLIENT_SECRET` は Discord Developer Portal で OAuth2 callback URL を Railway の URL に設定してから取得

### 3-3. Discord OAuth2 callback URL 設定

Discord Developer Portal → OAuth2 → Redirects:

```
https://<your-railway-domain>/api/auth/callback
```

---

## 4. DB Migration

### 4-1. 初回デプロイ時

```bash
# ローカルから Railway DB へ migration（要 DATABASE_URL の設定）
pnpm db:migrate

# デフォルトデータ投入
pnpm db:seed
```

**重要:** Railway ではビルドプロセス内で migration を自動実行しない。別途手動実行か release command で実行する。

### 4-2. Railway Release Command（推奨）

Railway の Release Command に以下を設定:

```bash
pnpm --filter @grkd-jisho/db run migrate
```

これにより新しいバージョンがデプロイされる直前に migration が実行される。

### 4-3. Rollback

Drizzle Kit は `drizzle-kit drop` と `drizzle-kit generate` の再実行でロールバックする。手順:

```bash
# 1. migration ファイルを元に戻す（git revert または手動削除）
git revert HEAD --no-commit
# 2. 新しい migration を生成
pnpm db:generate
# 3. 適用
pnpm db:migrate
```

---

## 5. Bot Token / 環境変数

### 5-1. Discord Bot Token の取得

1. [Discord Developer Portal](https://discord.com/developers/applications) で Application を作成
2. Bot → Token → Reset Token でコピー
3. Railway Variables に `DISCORD_TOKEN` として設定

### 5-2. 必要な Bot Intents

Discord Developer Portal → Bot → Privileged Gateway Intents:

- ✅ **MESSAGE CONTENT INTENT**（メッセージ内容の読み取りに必須）
- ✅ **SERVER MEMBERS INTENT**（ロール解決に必須）

### 5-3. OAuth2 Scope

Bot invite URL 生成時:

- **Scopes:** `bot`, `applications.commands`
- **Bot Permissions:**
  - `Send Messages`
  - `Read Message History`
  - `Manage Messages`（wipe機能に必須）
  - `Use Slash Commands`

---

## 6. Wipe 運用

### 6-1. 本番で有効にする前の確認

```bash
# 1. テスト用サーバーで wipe が正しく動作することを確認
# 2. wipenable を false（デフォルト）でデプロイ
# 3. 1週間以上運用ログを確認してから有効化
```

### 6-2. Wipe 有効化手順

1. Discord の `/wipe-channel` Slash Command で対象チャンネルの wipe を有効化
2. 毎日 00:00 (Asia/Jakarta) に自動実行される
3. 固定メッセージ（ピン留め）は削除されない

### 6-3. Wipe 緊急停止

```bash
# DB 直接更新（緊急時）
UPDATE channel_settings SET wipe_enabled = false WHERE channel_id = '<channel_id>';
```

または `/wipe-channel` の Slash Command を使う。

---

## 7. MCP Control Plane

MCP は stdio トランスポートで動く。Docker 実行時は `grkd-jisho-bot` コンテナ内で起動する。

### 7-1. アクセスレベル

| Level | 説明 | 環境変数 |
|-------|------|----------|
| 1 | Read-only（デフォルト） | `MCP_READONLY_MODE=true` |
| 2 | Level 1 + dry-run | `MCP_READONLY_MODE=false` + `MCP_ENABLE_DRY_RUN=true` |
| 3 | Level 1 + limited write | `MCP_READONLY_MODE=false` + `MCP_ENABLE_LIMITED_WRITE=true` |

Level 3 を使用するには `MCP_READONLY_MODE=false` かつ `MCP_ENABLE_LIMITED_WRITE=true` の両方が必要。

### 7-2. 外部 AI Agent 接続

外部 AI エージェントは以下のように MCP server に接続する:

```json
{
  "mcpServers": {
    "grkd-jisho": {
      "command": "node",
      "args": ["packages/mcp/dist/index.js"],
      "env": {
        "DATABASE_URL": "postgresql://...",
        "MCP_AGENT_ID": "my-agent",
        "MCP_READONLY_MODE": "true"
      }
    }
  }
}
```

---

## 8. トラブルシューティング

| 症状 | 原因 | 対処 |
|------|------|------|
| Bot が応答しない | 許可チャンネル外 | `DISCORD_ALLOWED_CHANNELS` を確認 |
| `/` コマンドが表示されない | コマンド未登録 | `pnpm bot:register` を実行 |
| OAuth2 ログイン時に redirect エラー | callback URL 不一致 | Discord Developer Portal と `WEB_BASE_URL` を一致させる |
| Docker build で `node_modules` エラー | `.dockerignore` 不足 | `.dockerignore` に `node_modules` が含まれているか確認 |
| DB migration 失敗 | スキーマ不一致 | `pnpm db:generate` で再生成後に migrate |
| MCP 接続できない | `DATABASE_URL` 不足 | MCP の環境変数に `DATABASE_URL` が設定されているか確認 |

---

## 9. 参考リンク

- [Discord Developer Portal](https://discord.com/developers/applications)
- [Railway Documentation](https://docs.railway.app/)
- [Fly.io Documentation](https://fly.io/docs/)
- [Gemini API](https://ai.google.dev/gemini-api/docs)
