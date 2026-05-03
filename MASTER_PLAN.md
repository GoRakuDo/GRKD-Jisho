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
| Web UI | Astro 4 + React islands | 静的優先、管理画面に適したSSR |
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
│  └ channel_settings      (wipe対象チャンネル)    │
└────────────────┬────────────────────────────────┘
                 │
                 ▼
┌─────────────────────────────────────────────────┐
│  Web UI  (packages/web)  — Astro + React        │
│  ├ /admin/responses      (回答検索・編集)        │
│  ├ /admin/dictionaries   (辞書管理・優先順位)    │
│  ├ /admin/logs           (検索ログ・統計)        │
│  └ /admin/cache          (キャッシュ削除)        │
└─────────────────────────────────────────────────┘
```

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
| `/refresh-jisho <word> [role]` | キャッシュを削除して再生成 |
| `/source-jisho <word>` | どの辞典から取得したかを表示 |
| `/priority-jisho` | 辞書の優先順位一覧を表示 |
| `/override-jisho <response_id>` | 手動回答を設定 (is_manual_override) |

> **権限設計:** 管理コマンドは `MANAGE_GUILD` 権限を持つロールのみ実行可。一般メンバーはメンション検索のみ。

---

## 11. Web UI — Admin Panel

Astro + React islands で構築。認証は Discord OAuth2 を使用。

### ページ構成

```
/admin
  /admin/responses        — 回答一覧・検索・編集
  /admin/responses/[id]   — 回答詳細・編集履歴
  /admin/dictionaries     — 辞書一覧・優先順位変更・有効/無効切替
  /admin/cache            — キャッシュ一括削除・再生成トリガー
  /admin/logs             — 検索ログ・人気単語ランキング・キャッシュヒット率
```

### 認証フロー

```
Discord OAuth2
  → /auth/callback
  → セッション検証 (guild 所属確認 + 管理ロール確認)
  → Cookie セッション発行
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
    timeZone: "Asia/Bangkok",
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

#### 実装方針: チャンネルクローン方式

`bulkDelete` は14日制限がある。個別 `delete()` は全てのメッセージを消せるが、1件あたり200〜800msの遅延が必要で数百件あると非現実的。

そこで **チャンネルをクローンして差し替える** 方式を採用する。

```typescript
import cron from "node-cron";

export async function wipeChannel(discordChannel: import("discord.js").TextChannel): Promise<{
  newChannelId: string;
  deletedCount: number;
}> {
  // Step 1: 固定メッセージ（ピン留め）を退避
  const pins = await discordChannel.messages.fetchPinned();
  const pinContents = pins.map((msg) => ({
    content: msg.content,
    attachments: msg.attachments.map((a) => a.url),
    createdAt: msg.createdAt,
  }));

  // Step 2: チャンネルをクローン（名前・トピック・権限・位置を全てコピー）
  const newChannel = await discordChannel.clone({
    reason: `Daily wipe @ ${new Date().toISOString()}`,
  });

  // Step 3: 古いチャンネルを削除（これで全てのメッセージが消える）
  const oldChannelId = discordChannel.id;
  await discordChannel.delete("Daily wipe: old channel");

  // Step 4: 固定メッセージを新しいチャンネルに復元
  for (const pin of pinContents) {
    try {
      const reposted = await newChannel.send(
        pin.attachments.length > 0
          ? `${pin.content}\n\n*(Archived attachment: ${pin.attachments.join(", ")})*`
          : pin.content
      );
      await reposted.pin();
    } catch {
      // 空メッセージや無効な添付はスキップ
    }
  }

  // Step 5: 新しいチャンネルが Bot のキャッシュに入るのを待つ
  await new Promise((resolve) => setTimeout(resolve, 1000));

  return {
    newChannelId: newChannel.id,
    deletedCount: pinContents.length, // ピン以外は全て消えた
  };
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
      const { newChannelId } = await wipeChannel(discordChannel);

      // DB の channel_id を新しい ID に更新
      await db
        .update(schema.channelSettings)
        .set({
          channelId: newChannelId,
          lastWipeAt: new Date(),
        })
        .where(eq(schema.channelSettings.id, setting.id));

      console.log(`[Wipe] ${setting.channelId} → ${newChannelId}: wiped`);
    } catch (err) {
      console.error(`[Wipe] Failed channel ${setting.channelId}:`, err);
    }
  }
}, {
  timezone: "Asia/Bangkok",
});
```

> **必要な権限:**
> - `MANAGE_CHANNELS` — チャンネルの作成・削除（クローンに必須）
> - `MANAGE_MESSAGES` — ピン留めの復元
> - `SEND_MESSAGES` — 固定メッセージの再送信

#### 管理コマンド

| コマンド | 説明 |
|---------|------|
| `/wipe-channel <channel> <on|off>` | チャンネルの自動消去を ON/OFF |
| `/wipe-status` | 全チャンネルの wipe 設定・最終消去日時・チャンネルIDを表示 |
| `/wipe-now <channel>` | スケジュールを待たずに即時消去（クローン方式） |

#### ユーザーリミットリセットとの同時性

```
00:00 GMT+7 に cron 発火
  ├─ Rate limits のリセット
  │   → usage_date が変わるだけ。古いレコードは自然に使われなくなる
  └─ Channel wipe-out（クローン方式）
      → wipe_enabled = true の全チャンネルを clone + delete
      → channel_settings.channel_id を自動更新
```

両者は独立した処理であり、片方が失敗してももう片方には影響しない。

---

## 18. Open Questions (Flag for Later)

- [ ] 辞書インポート時に `reading` が空の場合、どう全文検索するか（`pg_trgm` or `tsvector` 検討）
- [ ] WebUI の認証に Bearer Token か Cookie セッションどちらを使うか
- [ ] LLM の `prompt_version` を変えたとき、古いキャッシュをどう扱うか（自動無効化 vs 手動 refresh）
- [ ] クローン後のチャンネルが Discord クライアントのキャッシュに反映されるまでラグがある。Bot 再起動をトリガーするか検討
- [ ] `lookup_logs` の 90日パージをどのタイミングで実行するか（pg_cron or Bot の定期タスク）
- [ ] 将来的に複数 Guild に対応するか（現時点はシングル Guild 前提）
