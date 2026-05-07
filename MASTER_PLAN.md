# GRKD-Jisho — Master Plan

> **Version:** 1.0  
> **Date:** 2026-05-03  
> **Author:** Product Design Session  
> **Status:** Draft

---

## 1. Product Vision

GRKD-Jisho は、インドネシア語話者の日本語学習者が集まる Discord サーバー向けの **辞書 Bot + 管理 Web UI** システムです。

ユーザーが Bot をメンションして単語を検索すると、Bot はユーザーの Discord ロール（学習レベル）を判定し、Yomitan 形式の辞書データを元に LLM が最適な難易度で説明を生成・返答します。

### Core Value

```
辞書 = 根拠となる情報源 (Yomitan DB)
LLM  = ロール別に説明を整形する係 (Gemini / OpenRouter)
Cache = 生成済み回答の再利用 (Response-DB)
WebUI = 管理・品質改善の拠点
```

---

## 2. Technology Stack

| Layer | Technology | Rationale |
|-------|-----------|-----------|
| Bot Runtime | Node.js 20 LTS + tsx | 成熟したエコシステム、migration が最も簡単 |
| Discord Library | discord.js v14 | 業界標準、Slash Command対応が充実 |
| Primary LLM | Google Gemini (gemini-2.0-flash) | コスト効率、日本語・インドネシア語の精度 |
| Fallback LLM | OpenRouter (Claude / GPT-4o) | Gemini 障害時の自動フォールバック |
| Database | PostgreSQL 16 | JSONB 対応、全文検索、信頼性 |
| ORM | Drizzle ORM | TypeSafe、軽量、migration が明確 |
| Web UI | Astro 5 SSR + React 19 + Tailwind v4 + @astrojs/node v9 | 管理画面に適したSSRと最小限のReact islands |
| Agent Control Plane | MCP Server (Node.js + TypeScript) | 外側AIエージェントが安全に監視・診断・限定操作するため |
| Monorepo | pnpm workspaces | bot / web / db 共通パッケージの共有 |
| Containerize | Docker + docker-compose | ローカル → クラウドのmigration が容易 |
| Cloud Deploy | Railway (推奨) or Fly.io | Dockerfile ベースでそのまま移行可 |

---

## 3. System Architecture

```
Discord Guild
  │
  │  @grkd-jisho 単語
  ▼
┌─────────────────────────────────────────────────┐
│  Bot Service  (packages/bot)                    │
│                                                 │
│  messageCreate → extract query                  │
│  └→ channel guard (許可チャンネルのみ)           │
│  └→ DictionaryService.lookup(query)             │
│       └→ dict_1 → dict_2 → dict_3 フォールバック│
│  └→ RoleMapper.resolve(member.roles)            │
│  └→ ResponseCacheService.get(cacheKey)          │
│       ├─ Hit  → Discord に送信                  │
│       └─ Miss → LLMService.generate(...)        │
│                   └→ Gemini → (fallback) OpenRouter│
│                   └→ ResponseCacheService.save()│
│                   └→ Discord に送信              │
│  Slash Commands (/search-jisho, /edit-jisho...) │
└────────────────┬────────────────────────────────┘
                 │ Drizzle ORM
                 ▼
┌─────────────────────────────────────────────────┐
│  PostgreSQL                                     │
│  ├ dictionaries          (辞書メタ情報)          │
│  ├ dictionary_entries    (Yomitan 元データ)      │
│  ├ response_cache        (LLM生成済み回答)       │
│  ├ response_edits        (編集履歴)              │
│  ├ lookup_logs           (検索ログ)              │
│  ├ role_rate_limits      (ロール別上限)          │
│  ├ user_usage            (ユーザー別使用量)      │
│  ├ channel_settings      (wipe対象チャンネル)    │
│  ├ bot_events            (trace / debug events) │
│  ├ bot_heartbeats        (service liveness)     │
│  ├ ops_jobs              (safe operation queue) │
│  └ mcp_audit_logs        (agent operation audit)│
└───────┬───────────────────────────────┬─────────┘
        │                               │
        │                               ▼
        │                 ┌─────────────────────────────────┐
        │                 │ MCP Server (packages/mcp)       │
        │                 │ read-only tools first            │
        │                 │ dry-run before write             │
        │                 │ no direct Discord token access   │
        │                 └───────────────┬─────────────────┘
        │                                 │ MCP
        │                                 ▼
        │                 ┌─────────────────────────────────┐
        │                 │ External AI Agent               │
        │                 │ monitoring / diagnosis / ops    │
        │                 └─────────────────────────────────┘
        │
                 ▼
┌─────────────────────────────────────────────────┐
│  Web UI  (packages/web)  — Astro 5 SSR + React  │
│  ├ /admin                (Dashboard)             │
│  ├ /admin/responses      (回答検索・編集)        │
│  ├ /admin/dictionaries   (辞書管理・優先順位)    │
│  ├ /admin/cache          (キャッシュ削除)        │
│  ├ /admin/logs           (検索ログ・統計)        │
│  ├ /admin/traces         (Trace Viewer)           │
│  └ /admin/ops-jobs       (Agent Ops 承認)         │
└─────────────────────────────────────────────────┘
```

> **DB table phase note:** Phase 0 で実装済み・完了基準に含めるのは `dictionaries`, `dictionary_entries`, `response_cache`, `response_edits`, `lookup_logs`, `role_rate_limits`, `user_usage`, `channel_settings` の8テーブル。`bot_events`, `bot_heartbeats`, `ops_jobs`, `mcp_audit_logs` は Phase 1〜2 の Observability / MCP Control Plane で追加する。

---

## 4. Monorepo Structure

```
grkd-jisho/
├── packages/
│   ├── bot/              # Discord Bot (Node.js + discord.js)
│   │   ├── src/
│   │   │   ├── commands/      # /search-jisho, /edit-jisho etc.
│   │   │   ├── events/        # messageCreate, ready, interactionCreate
│   │   │   ├── services/
│   │   │   │   ├── dictionary.service.ts
│   │   │   │   ├── llm.service.ts
│   │   │   │   ├── response-cache.service.ts
│   │   │   │   ├── role-mapper.service.ts
│   │   │   │   ├── lookup-log.service.ts
│   │   │   │   ├── rate-limit.service.ts
│   │   │   │   └── channel-wipe.service.ts
│   │   │   ├── config/        # 環境変数スキーマ (zod)
│   │   │   └── index.ts
│   │   ├── Dockerfile
│   │   └── package.json
│   │
│   ├── web/              # Admin Web UI (Astro)
│   │   ├── src/
│   │   │   ├── pages/
│   │   │   │   └── admin/
│   │   │   │       ├── responses.astro
│   │   │   │       ├── dictionaries.astro
│   │   │   │       └── logs.astro
│   │   │   └── components/    # React islands
│   │   ├── Dockerfile
│   │   └── package.json
│   │
│   └── db/               # 共有 DB スキーマ + Drizzle config
│       ├── src/
│       │   ├── schema/
│       │   │   ├── dictionaries.ts
│       │   │   ├── dictionary-entries.ts
│       │   │   ├── response-cache.ts
│       │   │   ├── response-edits.ts
│       │   │   ├── lookup-logs.ts
│       │   │   ├── role-rate-limits.ts
│       │   │   ├── user-usage.ts
│       │   │   └── channel-settings.ts
│       │   └── index.ts
│       ├── drizzle.config.ts
│       └── package.json
│
│   └── mcp/              # AI Agent Control Plane (Phase 2以降)
│       ├── src/
│       │   ├── tools/          # grkd-jisho.health, grkd-jisho.get_trace 等
│       │   ├── services/       # MCP用の読み取り・ops job発行
│       │   └── index.ts
│       └── package.json
│
├── docker-compose.yml
├── .env.example
├── pnpm-workspace.yaml
└── package.json
```

---

## 5. Database Schema

### 5-1. `dictionaries` — 辞書メタ情報

```sql
CREATE TABLE dictionaries (
  id          SERIAL PRIMARY KEY,
  name        TEXT NOT NULL UNIQUE,     -- "JMdict", "大辞泉"
  slug        TEXT NOT NULL UNIQUE,     -- "jmdict", "daijisen"
  priority    INTEGER NOT NULL DEFAULT 0, -- 小さい数字が高優先
  enabled     BOOLEAN NOT NULL DEFAULT true,
  created_at  TIMESTAMPTZ DEFAULT now()
);
```

> **設計ポイント:** `priority` フィールドで辞書の順序を DB から動的に変更できる。dict_1/dict_2/dict_3 はコードに埋め込まず、この DB から読む。

---

### 5-2. `dictionary_entries` — Yomitan 元データ

```sql
CREATE TABLE dictionary_entries (
  id              BIGSERIAL PRIMARY KEY,
  dictionary_id   INTEGER REFERENCES dictionaries(id),
  term            TEXT NOT NULL,
  reading         TEXT,
  definitions_json JSONB NOT NULL,
  tags_json       JSONB DEFAULT '[]',
  raw_json        JSONB NOT NULL,
  created_at      TIMESTAMPTZ DEFAULT now()
);

CREATE INDEX idx_dict_entries_term ON dictionary_entries (term);
CREATE INDEX idx_dict_entries_reading ON dictionary_entries (reading);
```

---

### 5-3. `response_cache` — LLM生成済み回答

```sql
CREATE TABLE response_cache (
  id                   BIGSERIAL PRIMARY KEY,
  query                TEXT NOT NULL,
  normalized_query     TEXT NOT NULL,          -- ひらがな正規化後
  dictionary_id        INTEGER REFERENCES dictionaries(id),
  dictionary_entry_id  BIGINT REFERENCES dictionary_entries(id),
  role_key             TEXT NOT NULL,           -- pemula / pemula-atas / menengah / mahir
  prompt_version       TEXT NOT NULL,           -- "v1", "v2"
  model_name           TEXT NOT NULL,           -- "gemini-2.0-flash"
  response_text        TEXT NOT NULL,
  is_manual_override   BOOLEAN DEFAULT false,   -- 管理者手動編集フラグ
  created_at           TIMESTAMPTZ DEFAULT now(),
  updated_at           TIMESTAMPTZ DEFAULT now(),

  UNIQUE (normalized_query, dictionary_id, dictionary_entry_id, role_key, prompt_version, model_name)
);
```

> **設計ポイント:** `is_manual_override = true` は LLM 回答より必ず優先。`UNIQUE` 制約でキャッシュの重複を DB レベルで防ぐ。

---

### 5-4. `response_edits` — 編集履歴

```sql
CREATE TABLE response_edits (
  id                BIGSERIAL PRIMARY KEY,
  response_cache_id BIGINT REFERENCES response_cache(id),
  editor_discord_id TEXT NOT NULL,
  before_text       TEXT NOT NULL,
  after_text        TEXT NOT NULL,
  reason            TEXT,
  created_at        TIMESTAMPTZ DEFAULT now()
);
```

---

### 5-5. `lookup_logs` — 検索ログ

```sql
CREATE TABLE lookup_logs (
  id                  BIGSERIAL PRIMARY KEY,
  guild_id            TEXT NOT NULL,
  channel_id          TEXT NOT NULL,
  message_id          TEXT NOT NULL,
  user_id             TEXT NOT NULL,
  user_roles_json     JSONB DEFAULT '[]',
  query               TEXT NOT NULL,
  normalized_query    TEXT NOT NULL,
  dictionary_id_used  INTEGER REFERENCES dictionaries(id),
  response_cache_id   BIGINT REFERENCES response_cache(id),
  cache_hit           BOOLEAN NOT NULL DEFAULT false,
  created_at          TIMESTAMPTZ DEFAULT now()
);
```

---

## 6. Role Mapping

Discord ロールを内部 `role_key` に変換することで、Discord 側の変更がプロンプトに直接影響しない設計にします。

```typescript
// packages/bot/src/services/role-mapper.service.ts

const ROLE_MAP: Record<string, RoleKey> = {
  "1段": "pemula",
  "2段": "pemula-atas",
  "3段": "menengah",
  "4段": "mahir",
};

export type RoleKey = "pemula" | "pemula-atas" | "menengah" | "mahir";

export function resolveRoleKey(memberRoles: string[]): RoleKey {
  for (const [roleName, roleKey] of Object.entries(ROLE_MAP)) {
    if (memberRoles.includes(roleName)) return roleKey;
  }
  return "pemula"; // デフォルト: 最初のレベル
}
```

### ロール別説明方針

| role_key | 返答スタイル | 使用言語 |
|----------|------------|---------|
| `pemula` | 超シンプルな説明 | インドネシア語メイン |
| `pemula-atas` | 基礎的な説明 | やさしい日本語 + インドネシア語補足 |
| `menengah` | 日常的な解説 | 日本語 |
| `mahir` | ありのままの辞書定義 | 日本語（難読さそのまま） |

---

## 7. Dictionary Lookup Logic

```typescript
// packages/bot/src/services/dictionary.service.ts

export async function lookupWord(query: string): Promise<LookupResult | null> {
  const dictionaries = await db
    .select()
    .from(schema.dictionaries)
    .where(eq(schema.dictionaries.enabled, true))
    .orderBy(asc(schema.dictionaries.priority));

  for (const dict of dictionaries) {
    const entry = await db
      .select()
      .from(schema.dictionaryEntries)
      .where(
        and(
          eq(schema.dictionaryEntries.dictionaryId, dict.id),
          eq(schema.dictionaryEntries.term, query)
        )
      )
      .limit(1);

    if (entry.length > 0) {
      return { dictionary: dict, entry: entry[0] };
    }
  }

  return null; // 全辞典に見つからない
}
```

> **設計ポイント:** 辞書の優先順位は `dictionaries.priority` が決定する。辞書の追加・削除・入れ替えはレコード更新だけで完結し、コード変更が不要。

---

## 8. Cache Key Design

```typescript
function buildCacheKey(params: {
  normalizedQuery: string;
  dictionaryId: number;
  entryId: bigint;
  roleKey: RoleKey;
  promptVersion: string;
  modelName: string;
}): string {
  return [
    params.normalizedQuery,
    params.dictionaryId,
    params.entryId.toString(),
    params.roleKey,
    params.promptVersion,
    params.modelName,
  ].join("|");
}
```

キャッシュの優先順位:

```
1. is_manual_override = true の回答が存在 → 即座に使用
2. キャッシュヒット (normalized_query + dict + role + version + model 全一致) → 使用
3. キャッシュミス → LLM 生成 → 保存
```

---

## 9. LLM Service Design

### Gemini → OpenRouter フォールバック

```typescript
// packages/bot/src/services/llm.service.ts

export async function generate(params: GenerateParams): Promise<string> {
  try {
    return await callGemini(params);
  } catch (err) {
    console.warn("Gemini failed, falling back to OpenRouter:", err);
    return await callOpenRouter(params);
  }
}
```

### プロンプトテンプレート (v1)

```
あなたは日本語学習者向けの辞書アシスタントです。

主な目的:
Discordユーザーの日本語レベルに合わせて、辞書定義をわかりやすく説明し、
L1（インドネシア語）のネガティブ転移を避けるサポートをすること。

重要ルール:
- 与えられた辞書データだけを根拠にしてください
- 辞書にない意味を追加しないでください
- 不明な場合は「辞書情報が不足しています」と言ってください
- Discord で読みやすい短い回答にしてください
- ユーザーロールに合わせて難易度を調整してください

ユーザーロール: {{role_key}}
検索語: {{query}}
辞書ソース: {{dictionary_name}}
辞書定義: {{definition_json}}

出力形式:
【{{query}}】
意味:
わかりやすい説明:
ニュアンス:
```

---

## 10. Discord Commands (Slash Commands)

| コマンド | 説明 |
|---------|------|
| `/search-jisho <word>` | Response-DB を検索して回答を表示 |
| `/edit-jisho <response_id>` | 指定 ID の回答をモーダルで編集 |
| `/refresh-jisho <word> [role]` | `is_manual_override = true` を除外してキャッシュを削除し、次回検索で再生成 |
| `/source-jisho <word>` | どの辞典から取得したかを表示 |
| `/priority-jisho` | 辞書の優先順位一覧を表示 |
| `/override-jisho <response_id>` | 手動回答を設定 (is_manual_override) |

> **権限設計:** 管理コマンドは `MANAGE_GUILD` 権限を持つロールのみ実行可。一般メンバーはメンション検索のみ。

---

## 11. Web UI — Admin Panel

Astro 5 SSR + React 19 + Tailwind v4 で構築。SSR は `@astrojs/node` v9 を使う。
React islands は編集フォーム、確認ダイアログ、Trace Timeline など状態が必要な部分に絞る。
認証は Discord OAuth2 を使用する。

### ページ構成

```
/admin
  /admin                  — Dashboard・主要メトリクス
  /admin/responses        — 回答一覧・検索・編集
  /admin/dictionaries     — 辞書一覧・優先順位変更・有効/無効切替
  /admin/cache            — キャッシュ一括削除・再生成トリガー
  /admin/logs             — 検索ログ・人気単語ランキング・キャッシュヒット率
  /admin/traces           — trace_id 検索・イベントタイムライン
  /admin/ops-jobs         — ops_jobs 承認・拒否・result/audit 表示
```

### 認証フロー

```
Discord OAuth2
  → /auth/callback
  → セッション検証 (guild 所属確認 + 管理ロール確認)
  → HMAC-SHA256 署名付き Cookie セッション発行 (8時間TTL)
  → 非GETの /admin/* と /api/* は CSRF token 必須
```

---

## 12. Environment Variables

```env
# Discord
DISCORD_TOKEN=
DISCORD_CLIENT_ID=
DISCORD_GUILD_ID=
DISCORD_ALLOWED_CHANNELS=channel_id_1,channel_id_2

# Database
DATABASE_URL=postgresql://user:pass@localhost:5432/grkd_jisho

# LLM
GEMINI_API_KEY=
OPENROUTER_API_KEY=

# Prompt
PROMPT_VERSION=v1

# Web UI Auth
DISCORD_CLIENT_SECRET=
SESSION_SECRET=
WEB_BASE_URL=
ADMIN_ROLE_IDS=role_id_1,role_id_2
```

---

## 13. Docker / Local Dev Setup

```yaml
# docker-compose.yml
services:
  postgres:
    image: postgres:16-alpine
    environment:
      POSTGRES_DB: grkd_jisho
      POSTGRES_USER: grkd
      POSTGRES_PASSWORD: grkd_dev
    ports:
      - "5432:5432"
    volumes:
      - pg_data:/var/lib/postgresql/data

  bot:
    build: ./packages/bot
    depends_on: [postgres]
    env_file: .env
    volumes:
      - ./packages/bot:/app
      - /app/node_modules

  web:
    build: ./packages/web
    depends_on: [postgres]
    ports:
      - "4321:4321"
    env_file: .env

volumes:
  pg_data:
```

### 13-1. Cross-platform install scripts (Phase 4 H.5)

Step H の Docker / env / deploy docs に続けて、Windows と Linux の初回セットアップを軽くするスクリプトを追加する。

対象は2系統に分ける。

```txt
scripts/install-dev.ps1        # Windows PowerShell 7+ 用
scripts/install-dev.sh         # Linux/macOS Bash 用
scripts/deploy-precheck.ps1    # Windows PowerShell 7+ 用
scripts/deploy-precheck.sh     # Linux/macOS Bash 用
```

`install-dev` はローカル開発の初回セットアップ用。

```txt
Node.js / pnpm / Docker の存在確認
-> .env がなければ .env.example から作成
-> pnpm install
-> docker compose up -d postgres
-> pnpm db:migrate
-> pnpm db:seed
-> db / bot / web / mcp の最低限チェック
-> 次に実行する dev コマンドを表示
```

`deploy-precheck` は本番デプロイ前の安全確認用。

```txt
必須 env の存在確認
-> bot / web Docker build
-> migration 実行前チェック
-> MCP_READONLY_MODE / MCP_ENABLE_LIMITED_WRITE の安全確認
-> wipe_enabled 運用注意の表示
-> 手動確認が必要な項目を最後に一覧表示
```

危険操作は自動化しない。
本番DB migration、wipe有効化、MCP Level 3有効化、外部API課金に関わる操作は、スクリプト内で実行せず確認メッセージに留める。

---

## 14. Yomitan Dictionary Import

Yomitan `.zip` ファイルを `dictionary_entries` にインポートするための CLI スクリプトを `packages/db/scripts/import-yomitan.ts` に実装します。

```
実行方法:
pnpm --filter db import-yomitan --file ./dicts/jmdict.zip --name "JMdict" --priority 1
```

処理フロー:
1. `.zip` を展開
2. `index.json` からメタ情報を読む
3. `term_bank_*.json` を順にパース
4. `dictionaries` にレコードが無ければ INSERT
5. `dictionary_entries` に bulk INSERT（重複は UPSERT）

---

## 15. Non-Functional Requirements

| 項目 | 目標値 |
|------|--------|
| 応答時間（キャッシュヒット） | 500ms 以内 |
| 応答時間（LLM 生成） | 5秒 以内 |
| 辞書検索（DB） | 100ms 以内 |
| 稼働率 | 99% 以上 |
| LLM フォールバック | Gemini 失敗から 3秒以内に OpenRouter へ切替 |
| データ保持 | lookup_logs は 90日、response_cache は無期限 |

---

## 16. Security Considerations

- Bot Token は環境変数のみ、コードに直書き禁止
- WebUI 管理者アクセスは Discord OAuth2 + Guild ロール確認必須
- Slash Command 管理操作は Discord 権限チェック必須
- MCP Server は原則 read-only から開始し、書き込み系 tool は audit log と dry-run を必須にする
- MCP Server に Discord Bot Token を渡さない。Discord 実操作は Bot Service だけが実行する
- MCP tool から生SQLを実行できる汎用DB操作口を公開しない
- DB は外部公開しない（Docker network 内部のみ）
- LLM へ送信する辞書定義は `definitions_json` のみ（個人情報を送らない）
- `lookup_logs` の `user_id` は Discord ID のみ（DM や個人情報は保存しない）

---

## 17. Rate Limiting (ユーザー別レート制限)

### 17-1. 設計方針

```
Owner / Administrator → 無制限
特定ロール           → ロール別の上限値 (DB で管理)
ロール未設定の一般   → デフォルト上限値 (DB で管理)
```

リセット単位は **1日ごと（毎日 00:00 GMT+7）**。  
上限超過時は **Ephemeral メッセージ** で本人だけに通知。

### 17-2. DB スキーマ追加

#### `role_rate_limits` — ロール別上限設定

```sql
CREATE TABLE role_rate_limits (
  id               SERIAL PRIMARY KEY,
  discord_role_id  TEXT NOT NULL UNIQUE,   -- Discord の Role ID (Snowflake)
  role_label       TEXT,                   -- 管理用ラベル "pemula" 等
  daily_limit      INTEGER NOT NULL,       -- 1日あたりの上限回数 (-1 = 無制限)
  created_at       TIMESTAMPTZ DEFAULT now(),
  updated_at       TIMESTAMPTZ DEFAULT now()
);
```

#### `user_usage` — ユーザー別の当日使用量

```sql
CREATE TABLE user_usage (
  id            BIGSERIAL PRIMARY KEY,
  user_id       TEXT NOT NULL,            -- Discord User ID
  guild_id      TEXT NOT NULL,
  usage_date    DATE NOT NULL,            -- 当日の日付 (GMT+7 基準)
  count         INTEGER NOT NULL DEFAULT 0,
  created_at    TIMESTAMPTZ DEFAULT now(),
  updated_at    TIMESTAMPTZ DEFAULT now(),

  UNIQUE (user_id, guild_id, usage_date)
);

CREATE INDEX idx_user_usage_date ON user_usage (usage_date);
```

> **設計ポイント:** `UNIQUE (user_id, guild_id, usage_date)` により、1日1行が保証される。カウントは `INSERT ... ON CONFLICT DO UPDATE SET count = count + 1` でアトミックにインクリメントできる。

### 17-3. 優先順位ロジック

```
1. Guild Owner か Administrator 権限を持つ → 無制限（DB 参照不要）
2. member.roles に role_rate_limits のレコードが一致するものがある
   → その中で最も daily_limit が大きい値を採用（最も緩い制限を使う）
3. どのロールも一致しない → DEFAULT_DAILY_LIMIT を使用（DB の設定値）
```

```typescript
// packages/bot/src/services/rate-limit.service.ts

export async function checkRateLimit(params: {
  userId: string;
  guildId: string;
  memberRoles: string[];
  isOwner: boolean;
  hasAdminPermission: boolean;
}): Promise<RateLimitResult> {
  // Step 1: Owner / Admin は無制限
  if (params.isOwner || params.hasAdminPermission) {
    return { allowed: true, remaining: Infinity, limit: Infinity };
  }

  // Step 2: ロール別上限を取得（最も大きい値 = 最も緩い制限を採用）
  const roleLimits = await db
    .select()
    .from(schema.roleRateLimits)
    .where(inArray(schema.roleRateLimits.discordRoleId, params.memberRoles));

  const limit = roleLimits.length > 0
    ? Math.max(...roleLimits.map((r) => r.dailyLimit))
    : await getDefaultDailyLimit();

  // -1 は無制限
  if (limit === -1) {
    return { allowed: true, remaining: Infinity, limit: -1 };
  }

  // Step 3: 当日の使用量を取得
  const today = toGMT7Date(new Date());
  const [usage] = await db
    .select()
    .from(schema.userUsage)
    .where(
      and(
        eq(schema.userUsage.userId, params.userId),
        eq(schema.userUsage.guildId, params.guildId),
        eq(schema.userUsage.usageDate, today)
      )
    );

  const currentCount = usage?.count ?? 0;
  const allowed = currentCount < limit;

  return {
    allowed,
    remaining: Math.max(0, limit - currentCount),
    limit,
  };
}

export async function incrementUsage(params: {
  userId: string;
  guildId: string;
}): Promise<void> {
  const today = toGMT7Date(new Date());
  await db
    .insert(schema.userUsage)
    .values({
      userId: params.userId,
      guildId: params.guildId,
      usageDate: today,
      count: 1,
    })
    .onConflictDoUpdate({
      target: [schema.userUsage.userId, schema.userUsage.guildId, schema.userUsage.usageDate],
      set: { count: sql`${schema.userUsage.count} + 1`, updatedAt: new Date() },
    });
}

// GMT+7 の日付文字列を返す (YYYY-MM-DD)
function toGMT7Date(date: Date): string {
  return new Intl.DateTimeFormat("id-ID", {
    timeZone: "Asia/Jakarta",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(date).replace(/\//g, "-");
}
```

### 17-4. messageCreate への組み込み

```
@grkd-jisho 単語 を受信
  ↓
checkRateLimit(userId, guildId, memberRoles, isOwner, isAdmin)
  ├─ allowed: false → Ephemeral で「本日の上限（N回）に達しました」通知 → 終了
  └─ allowed: true  → 辞書検索 → LLM → 返答
                        ↓
                      incrementUsage(userId, guildId)
```

### 17-5. 管理コマンド追加

| コマンド | 説明 |
|---------|------|
| `/ratelimit-set <role> <limit>` | ロールの1日上限を設定（-1で無制限） |
| `/ratelimit-list` | ロール別上限の一覧表示 |
| `/ratelimit-reset <user>` | 特定ユーザーの当日カウントをリセット |
| `/ratelimit-status <user>` | 特定ユーザーの当日使用量を確認 |

### 17-6. デフォルト上限の管理

デフォルト値は `role_rate_limits` に `discord_role_id = '__default__'` という特殊レコードとして保存する。

```sql
INSERT INTO role_rate_limits (discord_role_id, role_label, daily_limit)
VALUES ('__default__', 'Default (all users)', 10)
ON CONFLICT DO NOTHING;
```

これにより、デフォルト値も Slash Command や WebUI から変更可能になる。

### 17-7. Channel Wipe-out（チャンネル自動消去）

毎日 00:00 GMT+7 のリセット時刻に、設定されたチャンネルを完全に空にする。

**Wipe 対象範囲:** 毎日 00:00 GMT+7 に cron が発火するため、対象となるメッセージは最大でも **直近24時間以内** のもの。1日分のメッセージが全て削除される。

**要件:**
- 全メッセージを1つ残らず削除（14日制限なし）
- **固定メッセージ（ピン留め）のみ保持**
- ON/OFF をチャンネル別に設定可能

#### DB スキーマ

```sql
CREATE TABLE channel_settings (
  id               SERIAL PRIMARY KEY,
  guild_id         TEXT NOT NULL,
  channel_id       TEXT NOT NULL UNIQUE,   -- Discord Channel ID
  wipe_enabled     BOOLEAN NOT NULL DEFAULT false,
  last_wipe_at     TIMESTAMPTZ,           -- 最終消去日時
  created_at       TIMESTAMPTZ DEFAULT now(),
  updated_at       TIMESTAMPTZ DEFAULT now()
);

CREATE INDEX idx_channel_settings_wipe ON channel_settings (wipe_enabled)
  WHERE wipe_enabled = true;
```

#### 実装方針: bulkDelete 方式

毎日 00:00 GMT+7 に動くため、削除対象は全メッセージが24時間以内。14日制限（`bulkDelete`）に引っかからないため、クローン方式は不要。

```typescript
import cron from "node-cron";

export async function wipeChannel(discordChannel: import("discord.js").TextChannel): Promise<{
  deletedCount: number;
}> {
  const TWENTY_FOUR_HOURS_MS = 24 * 60 * 60 * 1000;

  // Step 1: ピン留めIDを取得（除外対象）
  const pins = await discordChannel.messages.fetchPinned();
  const pinnedIds = new Set(pins.map((p) => p.id));
  const cutoff = Date.now() - TWENTY_FOUR_HOURS_MS;

  // Step 2: バルク削除可能なメッセージを100件ずつバッチ処理
  let lastId: string | undefined;
  let totalDeleted = 0;

  while (true) {
    const messages = lastId
      ? await discordChannel.messages.fetch({ limit: 100, cache: false, before: lastId })
      : await discordChannel.messages.fetch({ limit: 100, cache: false });
    if (messages.size === 0) break;

    // 24時間以内 かつ ピン留め以外 を抽出
    const toDelete = messages.filter(
      (m) => !pinnedIds.has(m.id) && m.createdTimestamp >= cutoff,
    );
    if (toDelete.size > 0) {
      if (toDelete.size === 1) {
        await toDelete.first()!.delete();
      } else {
        await discordChannel.bulkDelete(toDelete, true);
      }
      totalDeleted += toDelete.size;
    }

    if (messages.size < 100) break;
    lastId = messages.last()!.id;
  }

  // Step 3: DB の lastWipeAt を更新（channel_id は変わらない）
  // await db.update(schema.channelSettings)...

  return { deletedCount: totalDeleted };
}
```

#### cron スケジューラ + channel_id 自動更新

```typescript
// ready イベント内で起動
cron.schedule("0 0 * * *", async () => {
  const enabledChannels = await db
    .select()
    .from(schema.channelSettings)
    .where(eq(schema.channelSettings.wipeEnabled, true));

  for (const setting of enabledChannels) {
    const discordChannel = client.channels.cache.get(setting.channelId);
    if (!discordChannel?.isTextBased()) continue;
    if (!(discordChannel instanceof TextChannel)) continue;

    try {
      const { deletedCount } = await wipeChannel(discordChannel);

      // lastWipeAt のみ更新（channel_id は変わらない）
      await db
        .update(schema.channelSettings)
        .set({ lastWipeAt: new Date() })
        .where(eq(schema.channelSettings.id, setting.id));

      console.log(`[Wipe] ${setting.channelId}: ${deletedCount} messages deleted`);
    } catch (err) {
      console.error(`[Wipe] Failed channel ${setting.channelId}:`, err);
    }
  }
}, {
  timezone: "Asia/Jakarta",
});
```

> **必要な権限:**
> - `MANAGE_MESSAGES` — bulkDelete に必須
> - `SEND_MESSAGES` — 通常動作に必須
> - `READ_MESSAGE_HISTORY` — messages.fetch() に必須
>
> **戻り値:** `deletedCount` のみ。チャンネルIDは変わらないため `newChannelId` は不要。

#### 管理コマンド

| コマンド | 説明 |
|---------|------|
| `/wipe-channel <channel> <on|off>` | チャンネルの自動消去を ON/OFF |
| `/wipe-status` | 実行中ギルドのチャンネル wipe 設定・最終消去日時・チャンネルIDを表示 |
| `/wipe-now <channel>` | スケジュールを待たずに即時消去（bulkDelete 方式、固定メッセージは保持） |

#### ユーザーリミットリセットとの同時性

```
00:00 GMT+7 に cron 発火
  ├─ Rate limits のリセット
  │   → usage_date が変わるだけ。古いレコードは自然に使われなくなる
  └─ Channel wipe-out（bulkDelete 方式）
      → wipe_enabled = true の全チャンネルのメッセージを bulkDelete
```

両者は独立した処理であり、片方が失敗してももう片方には影響しない。

---

## 18. AI Agent Operations / MCP Control Plane

GRKD-Jisho は、人間の管理画面だけでなく、外側のAIエージェントが MCP 経由で稼働監視・診断・限定的な運営操作を行える構造にする。

ただし、AIエージェントにDiscord Botを直接操作させない。
MCP Server は **Control Plane** として動き、Bot の状態を読み、必要ならDBに安全な運営ジョブを登録する。
Discord API の危険操作は Bot Service が権限・設定・承認状態を確認してから実行する。

### 18-1. 基本構造

```txt
External AI Agent
  ↓ MCP tools/list, tools/call
packages/mcp
  ↓ read status / write ops_jobs
PostgreSQL
  ↓ poll safe jobs / write events
packages/bot
  ↓ Discord API
Discord Guild
```

役割分担は固定する。

| コンポーネント | 役割 |
|---|---|
| External AI Agent | 監視・診断・提案・安全な運営操作の呼び出し |
| MCP Server | AI向けの操作窓口。tool schema、入力検証、権限、auditを担当 |
| PostgreSQL | 状態、trace、heartbeat、ops job、audit log の保存場所 |
| Bot Service | Discord API を実際に呼ぶ唯一の実行者 |
| Admin UI | 人間向けの確認・編集・承認画面 |

### 18-2. Observability: trace_id と bot_events

検索1回、wipe1回、LLM生成1回ごとに `trace_id` を作る。
同じ `trace_id` を全 service に渡し、処理の流れを `bot_events` に残す。

```txt
message.received
query.extracted
channel.allowed
rate_limit.checked
dictionary.lookup.started
dictionary.hit
cache.miss
llm.generate.started
llm.generated
cache.saved
reply.sent
```

```sql
CREATE TABLE bot_events (
  id           BIGSERIAL PRIMARY KEY,
  trace_id     TEXT NOT NULL,
  level        TEXT NOT NULL, -- info / warn / error
  event_type   TEXT NOT NULL,
  guild_id     TEXT,
  channel_id   TEXT,
  user_id      TEXT,
  payload_json JSONB DEFAULT '{}',
  duration_ms  INTEGER,
  created_at   TIMESTAMPTZ DEFAULT now()
);

CREATE INDEX idx_bot_events_trace_id ON bot_events (trace_id);
CREATE INDEX idx_bot_events_created_at ON bot_events (created_at);
CREATE INDEX idx_bot_events_level ON bot_events (level);
```

### 18-3. Liveness: bot_heartbeats

Bot と MCP Server は定期的に heartbeat をDBへ書く。
外側AIエージェントは `grkd-jisho.health` でこの情報を読み、停止・遅延・エラーを検知する。

```sql
CREATE TABLE bot_heartbeats (
  id            BIGSERIAL PRIMARY KEY,
  service_name  TEXT NOT NULL, -- bot / mcp / web
  instance_id   TEXT NOT NULL,
  status        TEXT NOT NULL, -- ok / degraded / down
  last_seen_at  TIMESTAMPTZ NOT NULL,
  metadata_json JSONB DEFAULT '{}',
  created_at    TIMESTAMPTZ DEFAULT now(),
  updated_at    TIMESTAMPTZ DEFAULT now(),

  UNIQUE (service_name, instance_id)
);
```

### 18-4. Safe Operations: ops_jobs

AIエージェントが危険操作を直接実行しないように、書き込み系操作は `ops_jobs` に登録する。
Bot Service はジョブを読み、安全条件を満たすものだけ実行する。

```sql
CREATE TABLE ops_jobs (
  id                BIGSERIAL PRIMARY KEY,
  job_type          TEXT NOT NULL,
  requested_by      TEXT NOT NULL, -- agent_id / admin_discord_id
  args_json         JSONB NOT NULL,
  status            TEXT NOT NULL DEFAULT 'pending', -- pending / approved / running / succeeded / failed / rejected
  approval_required BOOLEAN NOT NULL DEFAULT true,
  approved_by       TEXT,
  rejected_by       TEXT,
  result_json       JSONB DEFAULT '{}',
  error_message     TEXT,
  created_at        TIMESTAMPTZ DEFAULT now(),
  approved_at       TIMESTAMPTZ,
  completed_at      TIMESTAMPTZ
);

CREATE INDEX idx_ops_jobs_status ON ops_jobs (status);
CREATE INDEX idx_ops_jobs_type ON ops_jobs (job_type);
```

### 18-5. MCP Audit Log

MCP tool 呼び出しは全て `mcp_audit_logs` に残す。
引数は token / secret / API key を必ずredactする。

```sql
CREATE TABLE mcp_audit_logs (
  id                 BIGSERIAL PRIMARY KEY,
  agent_id           TEXT NOT NULL,
  tool_name          TEXT NOT NULL,
  args_json_redacted JSONB DEFAULT '{}',
  result_status      TEXT NOT NULL, -- success / error / rejected
  dry_run            BOOLEAN NOT NULL DEFAULT false,
  error_message      TEXT,
  created_at         TIMESTAMPTZ DEFAULT now()
);

CREATE INDEX idx_mcp_audit_logs_agent ON mcp_audit_logs (agent_id);
CREATE INDEX idx_mcp_audit_logs_tool ON mcp_audit_logs (tool_name);
CREATE INDEX idx_mcp_audit_logs_created_at ON mcp_audit_logs (created_at);
```

### 18-6. MCP Tools

Phase 3 でも `MCP_READONLY_MODE=true` を維持する。
Level 2 dry-run tools は `MCP_ENABLE_DRY_RUN=true` の時だけ登録する。
書き込み系は dry-run と audit log が揃ってから解禁する。

#### Level 1: Read-only tools

| Tool | 説明 |
|---|---|
| `grkd-jisho.health` | Bot / MCP / DB の稼働状態を見る |
| `grkd-jisho.recent_errors` | 直近の error / warn event を見る |
| `grkd-jisho.get_trace` | `trace_id` 単位で処理全体を見る |
| `grkd-jisho.lookup_stats` | 検索数、辞書ヒット率、上位クエリを見る |
| `grkd-jisho.cache_stats` | cache hit / miss を見る |
| `grkd-jisho.rate_limit_status` | user_usage と role_rate_limits を見る |
| `grkd-jisho.wipe_status` | wipe_enabled、last_wipe_at、失敗履歴を見る |

#### Level 2: Dry-run tools

デフォルトでは無効。
有効化する場合は `MCP_ENABLE_DRY_RUN=true` を明示する。
全 tool call は `mcp_audit_logs.dry_run = true` で記録する。

| Tool | 説明 |
|---|---|
| `grkd-jisho.dry_run_wipe` | 対象チャンネル、pin数、必要権限を確認。削除はしない |
| `grkd-jisho.dry_run_rate_limit_change` | rate limit変更後の影響ユーザー数を確認 |
| `grkd-jisho.dry_run_cache_refresh` | cache refresh対象件数を確認 |

#### Level 3: Limited write tools

| Tool | 説明 | 承認 |
|---|---|---|
| `grkd-jisho.request_cache_refresh` | cache refresh job を作成 | 内容により不要 |
| `grkd-jisho.request_user_usage_reset` | user_usage reset job を作成 | 原則不要 |
| `grkd-jisho.request_rate_limit_change` | role_rate_limits変更 job を作成 | 必要 |
| `grkd-jisho.request_toggle_wipe` | wipe_enabled変更 job を作成 | 必要 |

#### Level 4: Dangerous tools

以下は自律実行禁止。必ず人間承認を挟む。

| Tool | 理由 |
|---|---|
| `grkd-jisho.request_wipe_now` | Discordチャンネル削除を伴う |
| `grkd-jisho.request_bulk_cache_delete` | 大量データ削除を伴う |
| `grkd-jisho.request_prompt_version_rotate` | 全回答品質に影響する |

### 18-7. Agent Runbook

外側AIエージェントは、定期監視で以下の順に確認する。

```txt
1. grkd-jisho.health
2. heartbeat が古い場合は grkd-jisho.recent_errors
3. trace failure がある場合は grkd-jisho.get_trace
4. LLMエラー増加なら fallback 状態を確認
5. wipe失敗なら grkd-jisho.wipe_status と dry_run_wipe
6. 危険操作が必要なら ops_jobs を作り、人間承認待ちにする
```

### 18-8. 禁止事項

- MCP Server に Discord Bot Token を持たせない
- MCP tool からDiscordチャンネルを直接削除しない
- MCP tool から任意SQLを実行できる口を作らない
- `.env`、API key、token、secret を MCP tool の出力に含めない
- Level 4 tool を人間承認なしに実行しない
- AIエージェントの判断だけで本番DBの削除・大量変更を行わない

---

## 19. Open Questions (Flag for Later)

- [ ] 辞書インポート時に `reading` が空の場合、どう全文検索するか（`pg_trgm` or `tsvector` 検討）
- [ ] WebUI の認証に Bearer Token か Cookie セッションどちらを使うか
- [ ] LLM の `prompt_version` を変えたとき、古いキャッシュをどう扱うか（自動無効化 vs 手動 refresh）
- [ ] `lookup_logs` の 90日パージをどのタイミングで実行するか（pg_cron or Bot の定期タスク）
- [ ] 将来的に複数 Guild に対応するか（現時点はシングル Guild 前提）
