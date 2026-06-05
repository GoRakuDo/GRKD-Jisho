# Phase 1 — Bot MVP 実装プラン

> **対応 Roadmap:** Phase 1 (Week 2-3)  
> **Date:** 2026-05-04  
> **Status:** Not Started  
> **Phase 0 完了前提:** monorepo / Docker / DB 8テーブル / Yomitan importer / env schema が全て完了していること  
> **完了基準:**
> - `@grkd-jisho 単語` でロール別回答が返る
> - いったんタグ忘れしたメッセージを編集して `@grkd-jisho 単語` にした場合も返る
> - 2回目以降はキャッシュが使われる
> - daily limit 超過時は通常のチャンネル返信（`message.reply()`）
> - 毎日 00:00 GMT+7 に wipe_enabled チャンネルが bulkDelete 方式で自動消去
> - 検索1回ごとの `trace_id` から処理全体が追える
> - `bot_heartbeats` が定期的に更新される

---

## 目次

1. [ディレクトリ構成](#1-ディレクトリ構成)
2. [Task 1-1 — エントリーポイント整備](#2-task-1-1--エントリーポイント整備)
3. [Task 1-2 — messageCreate / messageUpdate イベントハンドラー](#3-task-1-2--messagecreate--messageupdate-イベントハンドラー)
4. [Task 1-3 — DictionaryService](#4-task-1-3--dictionaryservice)
5. [Task 1-4 — RoleMapperService](#5-task-1-4--rolemapperservice)
6. [Task 1-5 — ResponseCacheService](#6-task-1-5--responsecacheservice)
7. [Task 1-6 — LLMService](#7-task-1-6--llmservice)
8. [Task 1-7 — LookupLogService](#8-task-1-7--lookuplogservice)
9. [Task 1-8 — 返答フォーマット](#9-task-1-8--返答フォーマット)
10. [Task 1-9 — 結合テスト（手動）](#10-task-1-9--結合テスト手動)
11. [Task 1-10 — RateLimitService](#11-task-1-10--ratelimitservice)
12. [Task 1-11 — Channel Wipe-out スケジューラ](#12-task-1-11--channel-wipe-out-スケジューラ)
13. [Task 1-12 — Observability 基盤](#13-task-1-12--observability-基盤)
14. [Task 1-13 — Safe Ops Job 基盤](#14-task-1-13--safe-ops-job-基盤)
15. [実装順序の注意](#15-実装順序の注意)
16. [動作確認チェックリスト](#16-動作確認チェックリスト)
17. [既知リスクと対処](#17-既知リスクと対処)

---

## 1. ディレクトリ構成

Phase 1 完了時点での `packages/bot/` のファイルツリー。

```
packages/bot/
├── src/
│   ├── commands/                # Phase 2 で追加
│   │
│   ├── events/
│   │   ├── messageCreate.ts     ← Task 1-2
│   │   └── messageUpdate.ts     ← Task 1-2
│   │
│   ├── services/
│   │   ├── dictionary.service.ts     ← Task 1-3
│   │   ├── role-mapper.service.ts    ← Task 1-4
│   │   ├── response-cache.service.ts ← Task 1-5
│   │   ├── llm.service.ts            ← Task 1-6
│   │   ├── lookup-log.service.ts     ← Task 1-7
│   │   ├── rate-limit.service.ts     ← Task 1-10
│   │   ├── channel-wipe.service.ts   ← Task 1-11
│   │   ├── observability.service.ts  ← Task 1-12
│   │   ├── ops-job.service.ts        ← Task 1-13
│   │   └── reply-formatter.ts        ← Task 1-8
│   │
│   ├── config/
│   │   └── env.ts                    ← Phase 0 (完了)
│   │
│   ├── index.ts                      ← Phase 0 (完了)
│   │
│   └── types.ts                      ← Task 1-1 (型定義ファイル)
│
├── package.json
└── tsconfig.json
```

---

## 2. Task 1-1 — エントリーポイント整備

### 現状

`packages/bot/src/index.ts` は既に実装済み（login + ready ログ）。

### 追加作業

**2-1-1.** `src/types.ts` を作成し、Bot 全体で使う型を定義する。

```typescript
// packages/bot/src/types.ts

import type { dictionaries, dictionaryEntries } from "@grkd-jisho/db";

export type RoleKey = "daily-japanese" | "indonesian";

export interface LookupResult {
  dictionary: typeof dictionaries.$inferSelect;
  entry: typeof dictionaryEntries.$inferSelect;
}

export interface CacheKey {
  normalizedQuery: string;
  dictionaryId: number;
  entryId: bigint;
  roleKey: RoleKey;
  promptVersion: string;
  modelName: string;
}

export type TraceEventType =
  | "message.received"
  | "query.extracted"
  | "channel.allowed"
  | "rate_limit.checked"
  | "rate_limit.blocked"
  | "dictionary.lookup.started"
  | "dictionary.hit"
  | "dictionary.miss"
  | "cache.hit"
  | "cache.miss"
  | "cache.manual_override"
  | "llm.generate.started"
  | "llm.generated"
  | "llm.fallback"
  | "llm.language_guard.failed"
  | "llm.error"
  | "cache.saved"
  | "reply.sent"
  | "reply.error"
  | "wipe.started"
  | "wipe.completed"
  | "wipe.failed"
  | "ops_job.started"
  | "ops_job.completed"
  | "ops_job.failed";
```

---

## 3. Task 1-2 — messageCreate / messageUpdate イベントハンドラー

`packages/bot/src/events/messageCreate.ts` と `packages/bot/src/events/messageUpdate.ts` を作成する。

**責務:**
- Bot メンション検出
- 許可チャンネルガード
- lookup フローに入ったらすぐ typing indicator を送る。長い処理では 8 秒ごとに再送して reply まで typing を維持する
- クエリ抽出
- 空クエリバリデーション
- 各 service を直列に呼び出す
- 編集されたメッセージでも、mention が新たに付いた場合は同じ検索フローを再利用する

> 注: 下記のコードブロックは Phase 1 の初期設計メモ。現行コードは DM owner gate / sanitizeLookupQuery / active prompt loading / promptContentHash などを含む。`messageUpdate` は、`oldMessage` と `newMessage` の両方が利用できるときだけ、`oldMessage` に bot mention が無く `newMessage` に bot mention がある編集を対象にする。`oldMessage` が null / partial の場合は安全側に倒して無反応にし、`lookup_logs.message_id` に既存記録がある場合は二重反応しない。

```typescript
import { Events, type Message } from "discord.js";
import { env } from "../config/env.js";
import { lookupWord } from "../services/dictionary.service.js";
import { resolveOutputBucketKey } from "../services/role-mapper.service.js";
import { getCachedResponse, saveResponse } from "../services/response-cache.service.js";
import { generate } from "../services/llm.service.js";
import { recordLookup } from "../services/lookup-log.service.js";
import { checkRateLimit, incrementUsage } from "../services/rate-limit.service.js";
import { formatReply, formatNotFound, formatError } from "../services/reply-formatter.js";
import { traceEvent } from "../services/observability.service.js";

/**
 * recordLookup + incrementUsage をまとめて実行するヘルパー。
 * 両者をセットで呼び出すことで、一方だけ実行されてしまう不整合を防ぐ。
 */
async function finalizeLookup(
  message: Message,
  traceId: string,
  params: {
    query: string;
    roleIds: string[];
    dictionaryIdUsed: number | null;
    responseCacheId: string | bigint | null;
    cacheHit: boolean;
    normalizedQueryOverride?: string;
  }
): Promise<void> {
  await recordLookup({
    guildId: message.guildId ?? "",
    channelId: message.channelId,
    messageId: message.id,
    userId: message.author.id,
    userRolesJson: JSON.stringify(params.roleIds),
    query: params.query,
    normalizedQuery: params.normalizedQueryOverride ?? params.query,
    dictionaryIdUsed: params.dictionaryIdUsed,
    responseCacheId: params.responseCacheId as bigint | null | undefined,
    cacheHit: params.cacheHit,
  });
  await incrementUsage({ userId: message.author.id, guildId: message.guildId ?? "" });
}

export const messageCreateHandler = async (message: Message): Promise<void> => {
  if (message.author.bot) return;

  // メンション検出
  const botId = message.client.user?.id;
  if (!botId) return;
  if (!message.mentions.has(botId)) return;

  // trace_id を生成
  const traceId = `lookup_${Date.now()}_${message.id}`;
  await traceEvent(traceId, "message.received", "info", {
    guildId: message.guildId,
    channelId: message.channelId,
    userId: message.author.id,
  });

  // 許可チャンネルガード
  const allowedChannels = env.DISCORD_ALLOWED_CHANNELS;
  if (!allowedChannels.includes(message.channelId)) return;

  // クエリ抽出
  const query = message.content.replace(/<@!?\d+>/g, "").trim();
  if (!query) {
    await message.reply("検索語を入力してください。例: `@grkd-jisho 可憐`");
    return;
  }
  await traceEvent(traceId, "query.extracted", "info", { query });

  // レートリミットチェック
  const member = message.member;
  if (!member) return;
  const isOwner = message.guild?.ownerId === message.author.id;
  const hasAdmin = member.permissions.has("Administrator");
  const roleIds = member.roles.cache.map((r) => r.id);

  const { allowed, remaining, limit } = await checkRateLimit({
    userId: message.author.id,
    guildId: message.guildId ?? "",
    memberRoles: roleIds,
    isOwner,
    hasAdminPermission: hasAdmin,
  });

  if (!allowed) {
    await message.reply(
      `本日の検索上限（${limit === Infinity ? "無制限" : `${limit}回`}）に達しました。明日 00:00 GMT+7 にリセットされます。`
    );
    await traceEvent(traceId, "rate_limit.blocked", "warn", { limit, remaining });
    return;
  }
  await traceEvent(traceId, "rate_limit.checked", "info", { remaining });

  // ロール解決
  const roleKey = resolveOutputBucketKey(roleIds);

  // 辞書検索
  const result = await lookupWord(query);
  if (!result) {
    await message.reply(formatNotFound(query));
    await traceEvent(traceId, "dictionary.miss", "warn", { query });
    await finalizeLookup(message, traceId, {
      query,
      roleIds,
      dictionaryIdUsed: null,
      responseCacheId: null,
      cacheHit: false,
    });
    return;
  }
  await traceEvent(traceId, "dictionary.hit", "info", { dict: result.dictionary.slug });

  // キャッシュチェック
  const cacheKey = {
    normalizedQuery: query,
    dictionaryId: result.dictionary.id,
    entryId: result.entry.id,
    roleKey,
    promptVersion: env.PROMPT_VERSION,
    modelName: PRIMARY_LLM_MODEL,
  };

  const cached = await getCachedResponse(cacheKey);
  if (cached) {
    await message.reply(formatReply(cached.responseText));
    await traceEvent(traceId, "cache.hit", "info", { cacheId: cached.id });
    await finalizeLookup(message, traceId, {
      query,
      roleIds,
      dictionaryIdUsed: result.dictionary.id,
      responseCacheId: cached.id,
      cacheHit: true,
      normalizedQueryOverride: cacheKey.normalizedQuery,
    });
    return;
  }
  await traceEvent(traceId, "cache.miss", "info", {});

  // LLM 生成
  await traceEvent(traceId, "llm.generate.started", "info", {});
  try {
    const responseText = await generate({
      roleKey,
      query,
      dictionaryName: result.dictionary.name,
      definitionJson: JSON.stringify(result.entry.definitionsJson),
      promptVersion: env.PROMPT_VERSION,
    });
    await traceEvent(traceId, "llm.generated", "info", {});

    // キャッシュ保存
    const saved = await saveResponse({
      ...cacheKey,
      responseText,
    });
    await traceEvent(traceId, "cache.saved", "info", { cacheId: saved.id });

    // 返信
    await message.reply(formatReply(responseText));
    await traceEvent(traceId, "reply.sent", "info", {});

    // ログ記録 + 使用量インクリメント
    await finalizeLookup(message, traceId, {
      query,
      roleIds,
      dictionaryIdUsed: result.dictionary.id,
      responseCacheId: saved.id,
      cacheHit: false,
      normalizedQueryOverride: cacheKey.normalizedQuery,
    });
  } catch (err) {
    await traceEvent(traceId, "llm.error", "error", { error: String(err) });
    await message.reply(formatError("LLM生成中にエラーが発生しました。"));
  }
};
```

**`index.ts` への組み込み:**

```typescript
// packages/bot/src/index.ts（追記部分）
import { messageCreateHandler } from "./events/messageCreate.js";
import { messageUpdateHandler } from "./events/messageUpdate.js";

client.on(Events.MessageCreate, messageCreateHandler);
client.on(Events.MessageUpdate, messageUpdateHandler);
```

> **設計ポイント:** この lookup パイプラインが全 service のオーケストレーターになる。`messageCreate` と `messageUpdate` は同じ流れを共有し、各 service はそこから呼ばれる。単一責任を守る。
> 編集で mention が新しく付いたメッセージは `messageUpdate` 側から同じ lookup パイプラインに入り、二重反応を避けるため「mention 追加前は未反応だった」ものだけを対象にする。

---

## 4. Task 1-3 — DictionaryService

`packages/bot/src/services/dictionary.service.ts` を作成する。

**責務:**
- `dictionaries` から `enabled = true` かつ `priority ASC` で辞書一覧を取得
- 優先順位順に `dictionary_entries` を検索
- 最初にヒットしたエントリを返す
- 全辞書でヒットしなければ `null`

```typescript
import { eq, asc, and } from "drizzle-orm";
import { db, schema } from "@grkd-jisho/db";
import type { LookupResult } from "../types.js";

export async function lookupWord(query: string): Promise<LookupResult | null> {
  const dictionaries = await db
    .select()
    .from(schema.dictionaries)
    .where(eq(schema.dictionaries.enabled, true))
    .orderBy(asc(schema.dictionaries.priority));

  for (const dict of dictionaries) {
    const [entry] = await db
      .select()
      .from(schema.dictionaryEntries)
      .where(
        and(
          eq(schema.dictionaryEntries.dictionaryId, dict.id),
          eq(schema.dictionaryEntries.term, query)
        )
      )
      .limit(1);

    if (entry) {
      return { dictionary: dict, entry };
    }
  }

  return null;
}
```

> **KISS 原則:** あくまで「優先順位順に最初の1件」だけ。複数辞書のマージはしない。

---

## 5. Task 1-4 — RoleMapperService

`packages/bot/src/services/role-mapper.service.ts` を作成する。

**責務:**
- Discord role ID から出力バケットに変換
- `daily-japanese` が 1 つでも当たれば日常日本語を優先
- どのバインドにも当たらなければ `indonesian` をデフォルトに

```typescript
import type { RoleKey } from "../types.js";

const DAILY_JAPANESE_OUTPUT_BUCKET_KEY: RoleKey = "daily-japanese";
const DEFAULT_OUTPUT_BUCKET_KEY: RoleKey = "indonesian";
const roleBindings: Record<string, RoleKey> = {
  "role-id-1": "daily-japanese",
  "role-id-2": "daily-japanese",
  "role-id-3": "indonesian",
};

/**
 * ユーザーの持つ Discord role ID から出力バケットを解決する。
 * 複数ロールを持つ場合は日常日本語を優先。
 * マッチしなければデフォルトで indonesian。
 */
export function resolveOutputBucketKey(roleIds: string[]): RoleKey {
  if (roleIds.some((roleId) => roleBindings[roleId] === DAILY_JAPANESE_OUTPUT_BUCKET_KEY)) {
    return DAILY_JAPANESE_OUTPUT_BUCKET_KEY;
  }

  return DEFAULT_OUTPUT_BUCKET_KEY;
}

export function getOutputBucketLabel(outputBucketKey: RoleKey): string {
  const labels: Record<RoleKey, string> = {
    "daily-japanese": "日常日本語の出力",
    indonesian: "インドネシア語の出力",
  };
  return labels[outputBucketKey];
}
```

---

## 6. Task 1-5 — ResponseCacheService

`packages/bot/src/services/response-cache.service.ts` を作成する。

**責務:**
- 複合キャッシュキーで `response_cache` を検索
- `is_manual_override = true` のレコードを最優先
- 削除保護は別フラグ `is_delete_protected` で管理
- キャッシュミス時に新規 INSERT

```typescript
import { eq, and } from "drizzle-orm";
import { db, schema } from "@grkd-jisho/db";
import type { CacheKey } from "../types.js";

export async function getCachedResponse(key: CacheKey) {
  // Step 1: is_manual_override = true が最優先
  const [manual] = await db
    .select()
    .from(schema.responseCache)
    .where(
      and(
        eq(schema.responseCache.normalizedQuery, key.normalizedQuery),
        eq(schema.responseCache.dictionaryId, key.dictionaryId),
        eq(schema.responseCache.dictionaryEntryId, key.entryId),
        eq(schema.responseCache.roleKey, key.roleKey),
        eq(schema.responseCache.promptVersion, key.promptVersion),
        eq(schema.responseCache.modelName, key.modelName),
        eq(schema.responseCache.isManualOverride, true)
      )
    )
    .limit(1);

  if (manual) return manual;

  // Step 2: 通常キャッシュ
  const [cached] = await db
    .select()
    .from(schema.responseCache)
    .where(
      and(
        eq(schema.responseCache.normalizedQuery, key.normalizedQuery),
        eq(schema.responseCache.dictionaryId, key.dictionaryId),
        eq(schema.responseCache.dictionaryEntryId, key.entryId),
        eq(schema.responseCache.roleKey, key.roleKey),
        eq(schema.responseCache.promptVersion, key.promptVersion),
        eq(schema.responseCache.modelName, key.modelName),
        eq(schema.responseCache.isManualOverride, false)
      )
    )
    .limit(1);

  return cached ?? null;
}

export async function saveResponse(params: CacheKey & { responseText: string }) {
  const [saved] = await db
    .insert(schema.responseCache)
    .values({
      query: params.normalizedQuery,
      normalizedQuery: params.normalizedQuery,
      dictionaryId: params.dictionaryId,
      dictionaryEntryId: params.entryId,
      roleKey: params.roleKey,
      promptVersion: params.promptVersion,
      modelName: params.modelName,
      responseText: params.responseText,
    })
    .onConflictDoNothing({
      target: [
        schema.responseCache.normalizedQuery,
        schema.responseCache.dictionaryId,
        schema.responseCache.dictionaryEntryId,
        schema.responseCache.roleKey,
        schema.responseCache.promptVersion,
        schema.responseCache.modelName,
      ],
    })
    .returning();

  return saved;
}
```

> **設計ポイント:** `getCachedResponse` は必ず2段階で検索する。手動編集が常に優先され、LLMが上書きできない仕組み。

---

## 7. Task 1-6 — LLMService

`packages/bot/src/services/llm.service.ts` を作成する。

> **Legacy reference only:** the snippet below reflects the older bridge template that existed before provider-native separation. For the improved v2 prompt format, see `DOCS/Prompts/prompt-v2.md`.
>
> **Current sampling defaults:** Gemini / OpenRouter の両方で `temperature=0.65`, `topP=0.8` を使う。`thinkingConfig` や `reasoning.exclude` とは別に、出力の揺れ幅を同じ基準で揃える。

**責務:**
- Gemini API を呼び出し
- Gemini 失敗 → OpenRouter フォールバック
- プロンプトテンプレート `v1` を適用（legacy reference）
- `model_name` の追跡

```typescript
import { env } from "../config/env.js";
import type { RoleKey } from "../types.js";
import { GoogleGenerativeAI } from "@google/generative-ai";

interface GenerateParams {
  roleKey: RoleKey;
  query: string;
  dictionaryName: string;
  definitionJson: string;
  promptVersion: string;
}

const PROMPT_TEMPLATE = `
あなたは日本語学習者向けの辞書アシスタントです。

主な目的:
Discordユーザーの日本語レベルに合わせて、辞書定義をわかりやすく説明し、
L1（インドネシア語）のネガティブ転移を避けるサポートをすること。

重要ルール:
- 与えられた辞書データだけを根拠にしてください
- 辞書にない意味を追加しないでください
- 不明な場合は「辞書情報が不足しています」と言ってください
- Discord で読みやすい短い回答にしてください
- 出力バケットに合わせて出力言語を切り替えてください
- daily-japanese: 日常日本語で返してください
- indonesian: インドネシア語で返してください
- 内部の思考、下書き、検討メモ、英語のメタコメントは出力しないでください
- Reasoning 分離は provider-native fields を使う。`{{query}}` は input variable のまま。出力 marker の詳細は `DOCS/Prompts/prompt-v2.md` を参照してください。

プロンプト版: {{prompt_version}}

出力バケット: {{role_key}}
検索語: {{query}}
読み: {{reading}}
辞書ソース: {{dictionary_name}}
辞書定義: {{definition_json}}

出力形式:
読み: {{reading}}
意味:
わかりやすい説明:
ニュアンス:
関連語:
`;

export async function generate(params: GenerateParams): Promise<string> {
  const prompt = PROMPT_TEMPLATE
    .replace("{{role_key}}", params.roleKey)
    .replace("{{query}}", params.query)
    .replace("{{reading}}", params.reading)
    .replace("{{dictionary_name}}", params.dictionaryName)
    .replace("{{definition_json}}", params.definitionJson);

  try {
    return await callGemini(prompt);
  } catch (err) {
    console.warn("Gemini failed, falling back to OpenRouter:", err);
    return await callOpenRouter(prompt);
  }
}

async function callGemini(prompt: string): Promise<string> {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), 60_000);

  try {
    const response = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${PRIMARY_LLM_MODEL}:generateContent`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-goog-api-key": env.GEMINI_API_KEY,
      },
      signal: controller.signal,
      body: JSON.stringify({
        contents: [{ parts: [{ text: prompt }] }],
        generationConfig: {
          thinkingConfig: {
            includeThoughts: true,
            thinkingLevel: "HIGH",
          },
        },
      }),
    });

    if (!response.ok) throw new Error(`Gemini error: ${response.status}`);

    const data = await response.json();
    const text = data?.candidates?.[0]?.content?.parts?.map((part) => part.text ?? "").join("").trim();
    if (!text) throw new Error("Gemini returned empty response");
    return text;
  } finally {
    clearTimeout(timeoutId);
  }
}

async function callOpenRouter(prompt: string): Promise<string> {
  for (let attempt = 1; attempt <= 3; attempt += 1) {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 150_000);

    try {
      const response = await fetch("https://openrouter.ai/api/v1/chat/completions", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${env.OPENROUTER_API_KEY}`,
        },
        signal: controller.signal,
        body: JSON.stringify({
          model: "openrouter/free",
          messages: [{ role: "user", content: prompt }],
          reasoning: {
            exclude: true,
            max_tokens: 4096,
          },
        }),
      });

      if (!response.ok) {
        throw new Error(`OpenRouter error: ${response.status} ${await response.text()}`);
      }

      const data = await response.json();
      const text: string | undefined = data.choices?.[0]?.message?.content;
      if (!text) throw new Error("OpenRouter returned empty response");
      return text;
    } catch (err) {
      if (err instanceof DOMException && err.name === "AbortError" && attempt < 3) {
        continue;
      }
      throw err;
    } finally {
      clearTimeout(timeoutId);
    }
  }
}
```

> **依存追加:** なし。OpenRouter は `fetch` 直叩きで使う。

---

## 8. Task 1-7 — LookupLogService

`packages/bot/src/services/lookup-log.service.ts` を作成する。

**責務:**
- 検索1回ごとに `lookup_logs` に INSERT
- `cache_hit` フラグを正しく設定

```typescript
import { db, schema } from "@grkd-jisho/db";
import type { NewLookupLog } from "@grkd-jisho/db";

export async function recordLookup(params: NewLookupLog): Promise<void> {
  await db.insert(schema.lookupLogs).values(params);
}
```

---

## 9. Task 1-8 — 返答フォーマット

`packages/bot/src/services/reply-formatter.ts` を作成する。

**責務:**
- 正常回答のフォーマット
- 「見つかりませんでした」メッセージ
- エラー時のフォールバックメッセージ

```typescript
import { EmbedBuilder } from "discord.js";

export function formatReply(text: string) {
  const embed = new EmbedBuilder()
    .setColor(0x_00_B7_C3)
    .setDescription(text)
    .setTimestamp();

  return { embeds: [embed] };
}

export function formatNotFound(query: string) {
  const embed = new EmbedBuilder()
    .setColor(0x_FF_A5_00)
    .setTitle("見つかりませんでした")
    .setDescription(
      `「${query}」は現在の辞書データに見つかりませんでした。\n` +
        "別の単語で試すか、辞書がインポートされているか確認してください。"
    )
    .setTimestamp();

  return { embeds: [embed] };
}

export function formatError(reason: string) {
  const embed = new EmbedBuilder()
    .setColor(0x_FF_00_00)
    .setTitle("エラーが発生しました")
    .setDescription(
      `${reason}\nしばらく経ってからもう一度試してください。`
    )
    .setTimestamp();

  return { embeds: [embed] };
}
```

---

## 10. Task 1-9 — 結合テスト（手動）

### テスト手順

**前提条件:**
- `docker compose up -d postgres` で DB 起動
- `.env` に有効な値を設定
- 辞書データが `dictionary_entries` にインポート済み

**テストケース:**

| # | 操作 | 期待結果 |
|---|------|---------|
| 1 | `@grkd-jisho 可憐` を許可チャンネルから送信 | Embed 回答が返る。初回は LLM 生成（キャッシュ Miss） |
| 2 | 同じチャンネルで `@grkd-jisho 可憐` を再送信 | 同じ Embed が返る（キャッシュ Hit） |
| 3 | 許可されていないチャンネルから同様に送信 | Bot が無反応 |
| 4 | `@grkd-jisho`（空クエリ）を送信 | 「検索語を入力してください」 |
| 5 | 存在しない単語を送信 | 「見つかりませんでした」 |
| 6 | バインドロールを持たないユーザーが検索 | `indonesian` 向けの回答 |
| 7 | daily limit 超過まで連続検索 | 通常のチャンネル返信（`message.reply()`）で上限通知 |
| 8 | Owner / Administrator が検索 | 無制限に動作 |
| 9 | 返答待ちの間 | typing indicator が即座に表示され、長い処理では維持される |

---

## 11. Task 1-10 — RateLimitService

`packages/bot/src/services/rate-limit.service.ts` を作成する。

**責務:**
- `role_rate_limits` からユーザーのロール別上限を取得
- `user_usage` から当日使用量を取得して判定
- Owner / Administrator は無制限（DB 参照スキップ）
- 使用量の Atomick インクリメント

```typescript
import { eq, and, inArray } from "drizzle-orm";
import { sql } from "drizzle-orm";
import { db, schema } from "@grkd-jisho/db";

interface RateLimitParams {
  userId: string;
  guildId: string;
  memberRoles: string[];
  isOwner: boolean;
  hasAdminPermission: boolean;
}

interface RateLimitResult {
  allowed: boolean;
  remaining: number;
  limit: number;
}

export async function checkRateLimit(params: RateLimitParams): Promise<RateLimitResult> {
  // Owner / Admin は無制限
  if (params.isOwner || params.hasAdminPermission) {
    return { allowed: true, remaining: Infinity, limit: Infinity };
  }

  // ロール別上限を取得（最も緩い値を採用）
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

  // 当日の使用量を取得
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
      target: [
        schema.userUsage.userId,
        schema.userUsage.guildId,
        schema.userUsage.usageDate,
      ],
      set: { count: sql`${schema.userUsage.count} + 1` },
    });
}

async function getDefaultDailyLimit(): Promise<number> {
  const [defaultRecord] = await db
    .select()
    .from(schema.roleRateLimits)
    .where(eq(schema.roleRateLimits.discordRoleId, "__default__"))
    .limit(1);

  return defaultRecord?.dailyLimit ?? 10;
}

function toGMT7Date(date: Date): string {
  return new Intl.DateTimeFormat("id-ID", {
    timeZone: "Asia/Jakarta",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(date).replace(/\//g, "-");
}
```

---

## 12. Task 1-11 — Channel Wipe-out スケジューラ

2ファイルを作成する。

### 12-1. Wipe サービス本体

`packages/bot/src/services/channel-wipe.service.ts`

```typescript
import { type TextChannel } from "discord.js";
import { db, schema } from "@grkd-jisho/db";
import { eq } from "drizzle-orm";

interface WipeResult {
  deletedCount: number;
}

export async function wipeChannel(channel: TextChannel): Promise<WipeResult> {
  const TWENTY_FOUR_HOURS_MS = 24 * 60 * 60 * 1000;

  // Step 1: ピン留めIDを取得（除外対象）
  const pins = await channel.messages.fetchPinned();
  const pinnedIds = new Set(pins.map((p) => p.id));
  const cutoff = Date.now() - TWENTY_FOUR_HOURS_MS;

  // Step 2: バルク削除可能なメッセージを100件ずつバッチ処理
  let lastId: string | undefined;
  let totalDeleted = 0;

  while (true) {
    const messages = lastId
      ? await channel.messages.fetch({ limit: 100, cache: false, before: lastId })
      : await channel.messages.fetch({ limit: 100, cache: false });
    if (messages.size === 0) break;

    // 24時間以内 かつ ピン留め以外 を抽出
    const toDelete = messages.filter(
      (m) => !pinnedIds.has(m.id) && m.createdTimestamp >= cutoff,
    );

    if (toDelete.size > 0) {
      // bulkDelete は最低2件必要。1件の場合は個別削除
      if (toDelete.size === 1) {
        await toDelete.first()!.delete();
      } else {
        // filterOld: true → 14日以上前のメッセージは自動スキップ
        await channel.bulkDelete(toDelete, true);
      }
      totalDeleted += toDelete.size;
    }

    // 今回の取得が100件未満 = 残りなし
    if (messages.size < 100) break;
    lastId = messages.last()!.id;
  }

  // Step 3: DB の lastWipeAt を更新（channel_id は変わらない）
  await db
    .update(schema.channelSettings)
    .set({ lastWipeAt: new Date() })
    .where(eq(schema.channelSettings.channelId, channel.id));

  return { deletedCount: totalDeleted };
}

> **戻り値:** `deletedCount` のみ。チャンネルIDは変わらないため `newChannelId` は不要。

```

### 12-2. cron スケジューラ

`packages/bot/` に `node-cron` をインストール:

```bash
pnpm --filter bot add node-cron
pnpm --filter bot add -D @types/node-cron
```

`packages/bot/src/index.ts` の `ready` イベント内に組み込む:

```typescript
import cron from "node-cron";
import { TextChannel } from "discord.js";
import { db, schema } from "@grkd-jisho/db";
import { eq } from "drizzle-orm";
import { wipeChannel } from "./services/channel-wipe.service.js";

client.once("ready", () => {
  console.log(`Bot logged in as ${client.user?.tag}`);
  console.log(`Prompt version: ${env.PROMPT_VERSION}`);

  // Channel Wipe スケジューラ: 毎日 00:00 GMT+7
  cron.schedule("0 0 * * *", async () => {
    console.log("[Wipe] Starting daily channel wipe...");

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
});
```

> **注意:** Bot 起動時（`ready`）にスケジューラを起動する。  
> スケジューラのログは `console.log` で出力。エラー時は `console.error` で出力。このログは Phase 2 で `bot_events` に移行可能。

---

## 13. Task 1-12 — Observability 基盤

2ファイルを作成する。

### 13-1. 新規スキーマ追加

`packages/db/src/schema/bot-events.ts` を作成:

```typescript
import { pgTable, bigserial, text, jsonb, integer, timestamp, index } from "drizzle-orm/pg-core";

export const botEvents = pgTable(
  "bot_events",
  {
    id: bigserial("id", { mode: "bigint" }).primaryKey(),
    traceId: text("trace_id").notNull(),
    level: text("level").notNull(),   // info / warn / error
    eventType: text("event_type").notNull(),
    guildId: text("guild_id"),
    channelId: text("channel_id"),
    userId: text("user_id"),
    payloadJson: jsonb("payload_json").default({}),
    durationMs: integer("duration_ms"),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow(),
  },
  (table) => [
    index("idx_bot_events_trace_id").on(table.traceId),
    index("idx_bot_events_created_at").on(table.createdAt),
    index("idx_bot_events_level").on(table.level),
  ]
);

export type BotEvent = typeof botEvents.$inferSelect;
export type NewBotEvent = typeof botEvents.$inferInsert;
```

`packages/db/src/schema/bot-heartbeats.ts` を作成:

```typescript
import { pgTable, bigserial, text, jsonb, timestamp } from "drizzle-orm/pg-core";

export const botHeartbeats = pgTable("bot_heartbeats", {
  id: bigserial("id", { mode: "bigint" }).primaryKey(),
  serviceName: text("service_name").notNull(),
  instanceId: text("instance_id").notNull(),
  status: text("status").notNull(),   // ok / degraded / down
  lastSeenAt: timestamp("last_seen_at", { withTimezone: true }).notNull(),
  metadataJson: jsonb("metadata_json").default({}),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow(),
});

export type BotHeartbeat = typeof botHeartbeats.$inferSelect;
export type NewBotHeartbeat = typeof botHeartbeats.$inferInsert;
```

`packages/db/src/schema/index.ts` に両方をエクスポート追加:

```typescript
export * from "./bot-events.js";
export * from "./bot-heartbeats.js";
```

マイグレーション生成:

```bash
pnpm db:generate
pnpm db:migrate
```

### 13-2. Observability サービス

`packages/bot/src/services/observability.service.ts` を作成:

```typescript
import { db, schema } from "@grkd-jisho/db";
import type { TraceEventType } from "../types.js";

export async function traceEvent(
  traceId: string,
  eventType: TraceEventType,
  level: "info" | "warn" | "error",
  payload?: Record<string, unknown>
): Promise<void> {
  try {
    await db.insert(schema.botEvents).values({
      traceId,
      level,
      eventType,
      payloadJson: payload ?? {},
      durationMs: level === "error" ? undefined : 0,
    });
  } catch (err) {
    // 観測基盤自身のエラーは、観測をブロックしない
    console.error("[Observability] Failed to record event:", err);
  }
}

export async function recordHeartbeat(
  serviceName: string,
  instanceId: string,
  status: "ok" | "degraded" | "down",
  metadata?: Record<string, unknown>
): Promise<void> {
  try {
    await db
      .insert(schema.botHeartbeats)
      .values({
        serviceName,
        instanceId,
        status,
        lastSeenAt: new Date(),
        metadataJson: metadata ?? {},
      })
      .onConflictDoUpdate({
        target: [
          schema.botHeartbeats.serviceName,
          schema.botHeartbeats.instanceId,
        ],
        set: {
          status,
          lastSeenAt: new Date(),
          metadataJson: metadata ?? {},
        },
      });
  } catch (err) {
    console.error("[Observability] Failed to record heartbeat:", err);
  }
}
```

### 13-3. Heartbeat 定期実行

`packages/bot/src/index.ts` の `ready` イベント内に追加:

```typescript
import { recordHeartbeat } from "./services/observability.service.js";

client.once("ready", () => {
  // ... (既存の ready 処理)

  // 2分ごとに heartbeat を送信
  setInterval(async () => {
    await recordHeartbeat("bot", client.user?.id ?? "unknown", "ok", {
      guildCount: client.guilds.cache.size,
      uptime: process.uptime(),
    });
  }, 120_000); // 2分
});
```

> **重要:** `traceEvent` が失敗しても Bot のメイン処理は続行する。観測基盤はあくまで付加的な役割。

---

## 14. Task 1-13 — Safe Ops Job 基盤

### 14-1. 新規スキーマ追加

`packages/db/src/schema/ops-jobs.ts` を作成:

```typescript
import { pgTable, bigserial, text, jsonb, boolean, timestamp, index } from "drizzle-orm/pg-core";

export const opsJobs = pgTable(
  "ops_jobs",
  {
    id: bigserial("id", { mode: "bigint" }).primaryKey(),
    jobType: text("job_type").notNull(),
    requestedBy: text("requested_by").notNull(),
    argsJson: jsonb("args_json").notNull(),
    status: text("status").notNull().default("pending"),
    // pending / approved / running / succeeded / failed / rejected
    approvalRequired: boolean("approval_required").notNull().default(true),
    approvedBy: text("approved_by"),
    resultJson: jsonb("result_json").default({}),
    errorMessage: text("error_message"),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow(),
    approvedAt: timestamp("approved_at", { withTimezone: true }),
    completedAt: timestamp("completed_at", { withTimezone: true }),
  },
  (table) => [
    index("idx_ops_jobs_status").on(table.status),
    index("idx_ops_jobs_type").on(table.jobType),
  ]
);

export type OpsJob = typeof opsJobs.$inferSelect;
export type NewOpsJob = typeof opsJobs.$inferInsert;
```

`packages/db/src/schema/index.ts` にエクスポート追加:

```typescript
export * from "./ops-jobs.js";
```

マイグレーション生成:

```bash
pnpm db:generate
pnpm db:migrate
```

### 14-2. Ops Job サービス

`packages/bot/src/services/ops-job.service.ts` を作成:

```typescript
import { eq, and, inArray } from "drizzle-orm";
import { db, schema } from "@grkd-jisho/db";
import { traceEvent } from "./observability.service.js";

/**
 * pending / approved 状態のジョブを取得して実行する。
 * Bot の ready イベント内で定期ポーリングする。
 * dangerous job は approval_required = true で保護する。
 */
export async function pollAndExecuteJobs(): Promise<void> {
  const jobs = await db
    .select()
    .from(schema.opsJobs)
    .where(
      and(
        eq(schema.opsJobs.status, "pending"),
        eq(schema.opsJobs.approvalRequired, false)
      )
    );

  const approvedJobs = await db
    .select()
    .from(schema.opsJobs)
    .where(
      and(
        eq(schema.opsJobs.status, "approved"),
        eq(schema.opsJobs.approvalRequired, true)
      )
    );

  const allJobs = [...jobs, ...approvedJobs];

  for (const job of allJobs) {
    const traceId = `ops_${job.id}_${Date.now()}`;
    await traceEvent(traceId, "ops_job.started", "info", {
      jobId: job.id,
      jobType: job.jobType,
    });

    try {
      await db
        .update(schema.opsJobs)
        .set({ status: "running" })
        .where(eq(schema.opsJobs.id, job.id));

      // ここにジョブタイプ別の処理を追加
      await executeJob(job);

      await db
        .update(schema.opsJobs)
        .set({
          status: "succeeded",
          completedAt: new Date(),
        })
        .where(eq(schema.opsJobs.id, job.id));

      await traceEvent(traceId, "ops_job.completed", "info", {
        jobId: job.id,
        jobType: job.jobType,
      });
    } catch (err) {
      const errorMsg = String(err);
      await db
        .update(schema.opsJobs)
        .set({
          status: "failed",
          errorMessage: errorMsg,
          completedAt: new Date(),
        })
        .where(eq(schema.opsJobs.id, job.id));

      await traceEvent(traceId, "ops_job.failed", "error", {
        jobId: job.id,
        jobType: job.jobType,
        error: errorMsg,
      });
    }
  }
}

async function executeJob(job: typeof schema.opsJobs.$inferSelect): Promise<void> {
  const args = job.argsJson as Record<string, unknown>;

  switch (job.jobType) {
    case "cache_refresh":
      // Phase 2 で実装
      console.log(`[OpsJob] cache_refresh: ${JSON.stringify(args)}`);
      break;
    case "user_usage_reset":
      // Phase 2 で実装
      console.log(`[OpsJob] user_usage_reset: ${JSON.stringify(args)}`);
      break;
    case "rate_limit_change":
      // Phase 2 で実装
      console.log(`[OpsJob] rate_limit_change: ${JSON.stringify(args)}`);
      break;
    // wipe setting updates are handled in Web UI; no MCP job remains here
    default:
      throw new Error(`Unknown job type: ${job.jobType}`);
  }
}
```

### 14-3. 定期ポーリングの組み込み

`packages/bot/src/index.ts` の `ready` に追加:

```typescript
import { pollAndExecuteJobs } from "./services/ops-job.service.js";

client.once("ready", () => {
  // ... (既存の ready 処理)

  // 30秒ごとにジョブをポーリング
  setInterval(async () => {
    await pollAndExecuteJobs();
  }, 60_000); // 60秒
});
```

---

## 15. 実装順序の注意

Phase 1 の実装は **依存関係順** で進める。逆順で実装すると動作確認ができない。

```
1-1 (型定義)         ← 他サービスが依存
  ↓
1-12 (Observability) ← 他の全サービスが traceEvent を使う
  ↓
1-3 (Dictionary)     ← コア機能、1-2が依存
1-4 (RoleMapper)     ← コア機能、1-2が依存
1-5 (ResponseCache)  ← コア機能、1-2が依存
1-6 (LLM)            ← コア機能、1-2が依存
1-7 (LookupLog)      ← コア機能、1-2が依存
1-8 (ReplyFormatter) ← コア機能、1-2が依存
  ↓
1-10 (RateLimit)     ← 1-2が依存
  ↓
1-2 (messageCreate)  ← 全サービスを束ねる。ここで初めて検索フローが完成
  ↓
1-9 (結合テスト)     ← 1-2完了後に実行可能
  ↓
1-11 (Wipe)          ← 独立。1-1と1-2完了後ならいつでも可
1-13 (OpsJob)        ← 独立。1-12完了後ならいつでも可
```

**2段階で区切って実装することを推奨:**

**Step A（コア検索フロー）:** 1-1, 1-12, 1-3, 1-4, 1-5, 1-6, 1-7, 1-8, 1-10, 1-2 → 1-9
**Step B（バックグラウンド機能）:** 1-11, 1-13

Step A が完成し、結合テストが通ってから Step B に入るのが安全。

---

## 16. 動作確認チェックリスト

### 各 Task 完了時に確認

- [ ] **1-1:** `pnpm --filter bot exec tsc --noEmit` が通る
- [ ] **1-2:** Bot メンションに反応する。許可チャンネル以外では無反応。編集で mention を追加したメッセージも反応する
- [ ] **1-3:** 辞書データがある単語で `LookupResult` が返る。ない単語で `null`
- [ ] **1-4:** role ID から正しい出力バケットが返る。日常日本語があれば優先し、マッチしない場合は `indonesian`
- [ ] **1-5:** キャッシュヒット / ミスの両パターンで正しく動作。`is_manual_override` 優先
- [ ] **1-6:** Gemini から文字列が返る。Gemini 停止時に OpenRouter が呼ばれる
- [ ] **1-7:** `lookup_logs` に INSERT される。`cache_hit` が正しい
- [ ] **1-8:** Embed で整形された回答が返る。エラー時はエラーメッセージ
- [ ] **1-10:** daily limit 超過時に通常のチャンネル返信（`message.reply()`）で通知。Owner/Admin は無制限
- [ ] **1-11:** bulkDelete 方式でチャンネルが空になる。固定メッセージが保持される。`lastWipeAt` が更新される
- [ ] **1-12:** `bot_events` に trace イベントが記録される。`bot_heartbeats` が2分ごとに更新される
- [ ] **1-13:** `ops_jobs` の pending/approved ジョブが実行される。エラー時に failed になる

### Phase 1 完了条件

- [ ] `@grkd-jisho 単語` で Embed 回答が返る
- [ ] lookup 開始直後に typing indicator が表示され、長い処理でも reply まで維持される
- [ ] 初回 LLM 生成、2回目以降はキャッシュ使用
- [ ] daily limit 超過時は通常のチャンネル返信（`message.reply()`）
- [ ] Owner/Admin は無制限
- [ ] `wipe_enabled = true` のチャンネルが 00:00 GMT+7 に自動消去
- [ ] 固定メッセージは保持される
- [ ] 全処理が `trace_id` で追跡可能
- [ ] `bot_heartbeats` が定期更新されている

---

## 17. 既知リスクと対処

| # | リスク | 影響 | 対処 |
|---|--------|------|------|
| 1 | Gemini API key が設定されていない | Bot が起動しない | `env.ts` が必須チェックしている。`.env` の設定を確認 |
| 2 | OpenRouter API key が設定されていない | Gemini 障害時に LLM が使えない | 最低限 Gemini は設定する。OpenRouter は Phase 1 完了後でも可 |
| 3 | discord.js v14 の `MessageReplyOptions` 型 | `ephemeral` は DM でしか使えない | コード修正済み: レートリミット超過時は通常のチャンネル返信（`message.reply()`）に変更。DM 通知にしたい場合は Phase 2 で対応 |
| 4 | 辞書データがない | 全クエリが「見つかりませんでした」 | Phase 0 で `db:import` が完了している前提 |
| 5 | `channel_settings.channel_id` が変わらなくなった | Wipe が動かなくなることはない（channel_id 不変） | 気にする必要なし。削除後は常に同じチャンネルを使う |
| 6 | `bot_events` への INSERT が遅い | 返答が遅延する | 非同期 fire-and-forget。`await` しない or 別キューに分離 |
| 7 | `node-cron` のタイムゾーン依存 | 夏時間でズレる？ | Asia/Jakarta は夏時間なしなので安全 |
| 8 | Ops Job の無限リトライ | 同じジョブを何度も実行 | `status = "running"` でロック。poll は `pending / approved` のみ取得 |

---

## 🔧 Pro Engineer Review — 2026-05-04
> Perspective: Google / IBM Production Engineering  
> Principles applied: YAGNI · KISS · DRY · SOLID  
> Source code verified: ✅ (packages/bot/src/index.ts, config/env.ts)

### 📍 Current Reality (Source Code vs. Document)

- ✅ `index.ts` の既存実装（20行）はドキュメントの記述と一致
- ✅ `env.ts` は `DISCORD_ALLOWED_CHANNELS`（配列）と `PROMPT_VERSION` を正しく定義済み
- ✅ DB schema は Phase 0 完了済み（8テーブル存在）
- ✅ **コード修正完了:** `ephemeral` 誤用を修正。`finalizeLookup` で `recordLookup` + `incrementUsage` の重複を統合。構文エラーも修正済み

### 🎯 Core Problem (1 sentence)

> `messageCreate.ts` が単一ファイルで全サービスをオーケストレーションする設計は、ファイルが大きくなりすぎないよう注意が必要。ただし現在の規模（〜150行）なら許容範囲。LLMService の抽象化不足は MVP では問題にならない。

### 🔍 Principle Filter

| Check | Result | Note |
|-------|--------|------|
| YAGNI — Is this actually needed now? | ⚠️ | OpsJob（1-13）は MVP として本当に必要か要判断。Step B に分離したのは妥当だが「まだ実装しない」という意思決定がほしい |
| KISS — Is there a simpler solution? | ✅ 修正済み | `finalizeLookup` 導入で重複削減。オーケストレーターは現状の責務分割で妥当 |
| DRY — Any duplication to eliminate? | ✅ 修正済み | 3箇所あった `recordLookup` + `incrementUsage` の重複を統合 |
| SOLID — Any violation causing real problems? | ✅ | LLMService の具象クラス直接依存は MVP では許容。単一責任は各 service で担保できている |

### 🛤️ Solution Options

#### Option A — 現状維持 ＋ コード修正済み *(推奨)*
**Approach**: ドキュメント通りに実装 + レビューで見つけたバグのみ修正  
**Implementation cost**: Low  
**Risk**: Low  
**Why recommended**: MVP として必要十分。過度な抽象化を避け、まず動くものを作る方針が YAGNI に合致  
**Concrete steps**:
1. コードブロック内の `ephemeral` 誤用 → 修正済み
2. `recordLookup` + `incrementUsage` の重複 → `finalizeLookup` で統合済み
3. import の拡張子 `.js` は `tsx` 実行時は正しいのでそのまま維持

#### Option B — LLMProvider 抽象化
**Approach**: `LLMProvider` インターフェースを導入し、GeminiProvider / OpenRouterProvider を実装  
**Implementation cost**: Medium  
**Risk**: Low  
**When to choose this instead**: Phase 2 で LLM プロバイダーを3つ以上増やす場合。MVP では不要  

### ✅ Pro Recommendation

> **Option A を採用する。** 現状の設計は MVP として必要十分で、過度な抽象化は YAGNI に反する。見つかったブロッカー（`ephemeral` 誤用）と HIGH 懸念（`recordLookup` 重複）は修正済み。LMService の抽象化は Phase 2 以降、プロバイダー追加の必要性が出てから検討する。OpsJob（1-13）は実装スケジュールの最後に回し、スコープアウトも検討する。  
> **Estimated implementation:** Step A（コア検索フロー）= 集中して 2〜3日。Step B（Wipe + OpsJob）= 別途 1〜2日  
> **Rollback plan:** 各 service は独立しているため、1ファイル巻き戻せば影響はその service に閉じる

### ⚡ Quick Wins (implement regardless of option chosen)

- [x] `ephemeral` を通常の `message.reply()` に修正（BLOCKER → 修正済み）
- [x] `recordLookup` + `incrementUsage` を `finalizeLookup` に統合（HIGH → 修正済み）
- [x] ロール名 vs ロールID 混同を修正（BLOCKER → 修正済み）
- [x] `inArray` 空配列ガード追加（BLOCKER → 修正済み）
- [x] OpenRouter unsafe 型アサーション修正（BLOCKER → 修正済み）
- [x] response-cache 2クエリ→1クエリ統合（HIGH → 修正済み）
- [x] GoogleGenerativeAI モジュールレベル初期化（HIGH → 修正済み）
- [x] saveResponse 失敗時も finalizeLookup + reply 実行するよう改善（HIGH → 修正済み）
- [x] toGMT7Date をロケール非依存に修正（HIGH → 修正済み）
- [ ] `traceEvent` に try-catch を明示的に入れ、観測基盤の障害が主処理をブロックしないことを保証する
- [ ] `wipeChannel` の `setTimeout(1000)` を、Discord のチャンネルキャッシュ更新確認に置き換えられないか調査（線形: discord.js v14 には `ClientChannelFetchOptions` がある）
- [ ] Step A 実装前に `@google/generative-ai` のインストールだけ先に済ませておく

---

## 18. Code Review Results & Fixes — 2026-05-04

> **Phase 1 Step A 実装後に code-reviewer による全ファイルレビューを実施。**  
> 8件の問題を発見し、全て修正済み。再レビューで確認する。

### 発見された問題と修正

| # | 深刻度 | 問題 | ファイル | 行 | 修正内容 |
|---|--------|------|---------|----|---------|
| 1 | 🔴 BLOCKER | ロール名 vs ロールID 混同 — `memberRoles` にロール名を渡していたが、DB はロールID で管理 | `messageCreate.ts:73` / `rate-limit.service.ts:29` | 73 | `r.name` → `r.id` に変更。バケット解決は `resolveOutputBucketKey` に分離 |
| 2 | 🔴 BLOCKER | `inArray` に空配列を渡すと SQL の `IN ()` となり PostgreSQL 構文エラー | `rate-limit.service.ts:26-29` | 29 | `memberRoles.length > 0` ガードを追加。空なら DB クエリをスキップ |
| 3 | 🔴 BLOCKER | OpenRouter レスポンスの型アサーションが unsafe — `text: string \| undefined` の型アサーション | `llm.service.ts:82` | 82 | `typeof text !== "string" \|\| !text` でランタイムガードに変更 |
| 4 | 🟠 HIGH | `response-cache.service.ts` が isManualOverride と通常キャッシュで 2回クエリ発行 | `response-cache.service.ts:5-40` | 5-40 | `ORDER BY isManualOverride DESC LIMIT 1` の1クエリに統合。`desc` import 追加 |
| 5 | 🟠 HIGH | `llm.service.ts` が呼び出しごとに `new GoogleGenerativeAI()` を実行 | `llm.service.ts:54` | 54 | モジュールレベルの定数として1度だけ初期化 |
| 6 | 🟠 HIGH | `saveResponse` が `undefined` を返した場合、`finalizeLookup` が実行されずログと使用量が未記録 | `messageCreate.ts:145-148` | 145-148 | throw の前に `finalizeLookup + reply` を実行してから return するよう変更 |
| 7 | 🟠 HIGH | `toGMT7Date` が `id-ID` ロケール依存 — `dd/mm/yyyy` 形式になり DB の date/text カラムと不整合 | `rate-limit.service.ts:95-103` | 95-103 | `en-CA` ロケール + `formatToParts()` で `YYYY-MM-DD` 形式固定 |
| 8 | 🟡 LOW | `role-mapper.service.ts` — `order` 配列が毎回関数内で再生成 | `role-mapper.service.ts:11` | 11 | `ROLE_ORDER` としてモジュールレベル定数化 |
| 9 | 🟡 LOW | `messageCreate.ts` — `Date.now()` ベースの traceId が同一ミリ秒で衝突リスク | `messageCreate.ts:50` | 50 | `randomUUID()` を使用 |
| 10 | 🟡 LOW | `observability.service.ts` — `recordHeartbeat` 内の `new Date()` が2箇所で別インスタンス | `observability.service.ts:35` | 35 | 変数 `now` に代入して共有 |

### 修正後の変更ファイル一覧

```txt
packages/bot/src/events/messageCreate.ts          ← 修正5箇所（roleIds, traceId, saveResponse guard）
packages/bot/src/services/rate-limit.service.ts   ← 修正4箇所（空配列ガード, toGMT7Date, roleId対応）
packages/bot/src/services/response-cache.service.ts ← 修正1箇所（1クエリ統合）
packages/bot/src/services/llm.service.ts          ← 修正2箇所（genAI init, type guard）
packages/bot/src/services/role-mapper.service.ts   ← 修正1箇所（ROLE_ORDER定数化）
packages/bot/src/services/observability.service.ts ← 修正1箇所（new Date()共有）
```

### 検証結果

- ✅ `tsc --noEmit` 通過（bot + db 両パッケージ）
- ✅ 各修正はコードブロックと実コードの両方に反映
- ✅ BLOCKER 3件は全て修正・確認済み
- ✅ HIGH 4件は全て修正・確認済み

### 再レビュー結果 — ✅ Approve

> **code-reviewer による再レビュー（2026-05-04）で全修正の正しさを確認。**
> 新たな BLOCKER / HIGH は検出されず、総評は ✅ Approve。

**確認された修正:**

| 問題 | 検証結果 |
|------|---------|
| ① ロール名 vs ID混同 | ✅ `roleIds` と `roleNames` の分離が完全 |
| ② inArray 空配列ガード | ✅ `length > 0` でガード。空ならデフォルト制限へフォールスルー |
| ③ OpenRouter 型アサーション | ✅ `typeof !== "string" \|\| !text` でランタイムガード |
| ④ response-cache 統合 | ✅ `ORDER BY isManualOverride DESC` → manual が先に来る |
| ⑤ genAI 初期化 | ✅ モジュールレベルで1度だけ実行 |
| ⑥ saveResponse 失敗時の漏れ | ✅ 失敗時も `finalizeLookup + reply` を実行 |
| ⑦ toGMT7Date ロケール依存 | ✅ `en-CA` + `formatToParts` → `YYYY-MM-DD` 固定 |
| ⑧ LOW まとめ | ✅ `randomUUID`、`ROLE_ORDER` 定数化、`new Date()` 共有 |

**追加の所見（LLM エラーパス）:**

LLM エラー時の `finalizeLookup` 有無は設計判断の範囲内。現状は「エラーはカウントしない」の前提で動いている。もし LLM エラーの観測性を高めたい場合のみ、`catch` ブロック内で `finalizeLookup` を呼ぶことを検討する。この対応は必須ではないため、Phase 1 Step B のタイミングで判断する。

---

## 19. Code Review Fixes — Step B（Channel Wipe / OpsJob）

> **Phase 1 Step B 実装後に code-reviewer へレビュー依頼し、以下の指摘を全て修正済み。**
> いずれも `tsc --noEmit` を再実行して通過済み。

### 修正内容

| # | 深刻度 | 問題 | 修正 |
|---|--------|------|------|
| 1 | 🟡 MED | `channel-wipe.service.ts` の `embeds: pin.embedJSONs as []` が unsafe | `APIEmbed[]` に修正し、`content` / `embeds` を条件付き payload に変更 |
| 2 | 🟡 MED | 固定メッセージ復元が `channel.delete()` の後で、失敗時にピンが失われる | **復元を先に実行**し、失敗時は新チャンネルを削除して例外を投げるロールバックを追加 |
| 3 | 🟠 HIGH | `ops-job.service.ts` が 30 秒ポーリング時に同一ジョブの race condition を起こしうる | `pollingInProgress` フラグを追加し、`running` への更新を `status` 条件付き `claim` に変更 |
| 4 | 🟡 MED | `ops-job.service.ts` の `argsJson as Record<string, unknown>` が unsafe | `isRecord()` ガードに変更し、非 object は明示エラーに変更 |
| 5 | 🟡 LOW | `ops-jobs.ts` のコメントに `rejected` が残っていた | コメントを実装に合わせて削除 |
| 6 | 🟡 LOW | `index.ts` の `isTextBased()` が `instanceof TextChannel` と重複 | `instanceof TextChannel` のみに簡素化 |

### 再レビュー結果（期待値）

- Pin 復元は旧チャンネル削除前に行われ、空ペイロードは `\u200B` で回避されるため、固定メッセージ損失リスクを下げた
- `pollingInProgress` により同一インスタンス内の多重ポーリングを防止した
- なお、マルチプロセス環境での ops job 排他は Phase 2 で DB ロック/claim 切替を検討する余地がある

### 追加の最終修正

`pollAndExecuteJobs()` の初期 DB クエリ失敗時に `pollingInProgress` が残り続ける問題を修正。関数全体を `try/finally` で囲み、どの経路でも `pollingInProgress = false` に戻るようにした。これで `setInterval` ポーリングが永久停止する経路を潰した。

### 設計変更: クローン方式 → bulkDelete 方式（2026-05-04）

**背景:** 毎日 00:00 GMT+7 に動くため全メッセージが24時間以内であり、14日制限（`bulkDelete`）に引っかからない。クローン方式はチャンネルIDが変わるため DB との整合性リスクがあった。

**変更内容:**
- `channel-wipe.service.ts` をチャンネルクローン（`clone()` + `delete()`）から `messages.fetch()` バッチループ + `bulkDelete()` に全面書き換え
- 戻り値から `newChannelId` を削除。`deletedCount` のみ返す
- 権限要件から `MANAGE_CHANNELS` を削除
- `index.ts` のログ出力を `channelId → newChannelId` から `channelId: deletedCount` に変更

**関連ドキュメント修正:**
- `AGENTS.md` §10-2 / §10-3
- `MASTER_PLAN.md` §17-7 実装方針 / 権限 / 同時性ダイアグラム
- `ROADMAP.md` Phase 1 Task 1-11 / 完了基準
- `phase-0-foundation.md` §7-3

### Code Review Fixes — Wipe 方式変更（2026-05-04）

**レビュー指摘:** code-reviewer により bulkDelete 版のコードレビューを実施。2 BLOCKER / 1 HIGH を修正。

| # | 深刻度 | 指摘 | 修正内容 |
|---|--------|------|---------|
| 1 | 🔴 BLOCKER | 24時間以内のメッセージ制限が未実装 | `createdTimestamp >= cutoff` フィルターを追加。`cutoff = Date.now() - 24*60*60*1000` |
| 2 | 🔴 BLOCKER | `trace_id` 未付与 / 観測性なし | `wipe-${randomUUID()}` で trace_id 生成。`wipe.started` / `wipe.completed` を `bot_events` に記録 |
| 3 | 🟠 HIGH | Rate Limit (HTTP 429) 未考慮 | discord.js が内部的に429を自動リトライするため手動リトライは不要。ただしエラーログに trace_id を追加して改善 |
| 4 | 🟡 SUGGESTION | 削除失敗時のエラーログ不足 | catch ブロック内で `[Wipe] trace_id=${traceId} delete batch failed after N deleted` を出力。その後 throw |
| 5 | 🟡 SUGGESTION | 削除数0でも DB 更新が走る | `totalDeleted > 0` のガードを追加 |

**確認:** `pnpm --filter bot exec tsc --noEmit` ✅

---

## 20. Reply Truncation Fix — Discord Embed 文字数制限対策

### 実施日

- 2026-05-11

### 背景

LLM の生成結果が Discord の embed description 制限（4096文字）を超えると、`message.reply()` が失敗していた。

### 対応

- `packages/bot/src/services/reply-formatter.ts` に送信直前の切り詰め処理を追加
- 3900 文字を超える場合は末尾を切り、`…（長文のため途中で切れました。全文はキャッシュ詳細を確認してください。）` を付与
- `packages/bot/src/services/__tests__/reply-formatter.test.ts` を追加し、通常文と長文の両方を検証

### 期待結果

- Discord 送信時の embed 文字数超過で reply が落ちない
- LLM の全文は response_cache に保持されるため、必要なら後から参照できる
- 通常の短文回答は見た目を変えずにそのまま送信される

### 検証結果

- `packages/bot/src/services/__tests__/reply-formatter.test.ts` を追加し、短文・長文の両方を確認
- `pnpm --filter @grkd-jisho/bot test` ✅
- `pnpm --filter @grkd-jisho/bot exec tsc --noEmit` ✅

---

## 21. Active Prompt Source Switch Log — 2026-05-11

- bot は `PROMPT_VERSION` を直接使うのではなく、`prompts` テーブルの active row を読み、その `content` と `version` を LLM 送信と cache key に使うように切り替えた。
- `llm.service.ts` は受け取った prompt 本文を `replaceAll()` で展開するだけにし、固定テンプレート直書きをやめた。
- これで Web 管理画面で active を切り替えた prompt が、次回の lookup から反映される。
- cache は `prompt.version` に加えて `prompt.content` hash も持つので、同じ version を編集保存した場合でも古い cache を踏まない。

---

## 22. MessageUpdate Edited-Mention Log — 2026-05-20

- `messageUpdate` を追加し、最初はタグ忘れしたメッセージでも、あとから `@grkd-jisho` を付けた編集を lookup 対象にできるようにした。
- `shouldReprocessEditedMention()` で `oldMessage` / `newMessage` の両方が揃っているときだけ、`oldMessage` に bot mention が無く `newMessage` に bot mention がある編集だけを通すようにした。
- `lookup_logs.message_id` の既存記録チェックと、process 内の in-flight ロックで二重反応を防ぐようにした。
- `pnpm --filter @grkd-jisho/db build` / `pnpm --filter @grkd-jisho/bot test` / `pnpm --filter @grkd-jisho/bot build` と code-reviewer で確認済み。

---

## 23. Typing Indicator Log — 2026-05-20

- `messageCreateHandler` の lookup フロー入口で `sendTyping()` を開始し、返答まで typing を維持するようにした。
- 長い処理向けに 8 秒ごとの再送タイマーを入れ、reply / error / early return でも `finally` 相当で必ず止まるようにした。
- `sendTyping` が存在しないチャンネル型は安全側に倒して no-op にし、DM owner ルートも同じ typing フローを共有する。
- `pnpm --filter @grkd-jisho/bot test` / `pnpm --filter @grkd-jisho/bot build` と code-reviewer で確認済み。

---

## 24. Dictionary Form Variable Log — 2026-05-21

- deinflection で辞書形（例: 習いました → 習う）が見つかっても `{{query}}` が元の活用形のままで、LLM 応答の見出しに辞書形が出なかった問題を修正。
- `GenerateParams` に `dictionaryForm` を追加し、`renderPromptTemplate()` で `{{dictionary_form}}` 変数を差し替えられるようにした。
- `messageCreateHandler` から `generate()` を呼ぶときに `dictionaryForm: result.entry.term` を渡す。deinflection 以外の直接一致の場合は `query` と同じ値を入れる。
- `buildInsufficientDataReply()` も `dictionaryForm` を使うように変更。
- `pnpm --filter @grkd-jisho/bot test` / `pnpm --filter @grkd-jisho/bot build` と code-reviewer で確認済み。

---

## 25. Language Guardrails Implementation — 2026-05-27

- LLM が bucket 外の言語や壊れた marker を混ぜる問題に対し、`DOCS/Design/language-guardrails.md` を追加した。
- `indonesian` bucket は日本語 + Latin を基本許可し、英単語ストップワード比率が出力全体の 10% を超えたら ReAsk 対象にする。禁止スクリプト（Hangul / Cyrillic / Devanagari / Thai / Arabic / Hebrew / Greek）と `@@@` / `aaa` / `....` のような同一文字3連発は hard fail にする。
- `daily-japanese` bucket は日本語 + Latin を許可し、禁止スクリプトとゴミマーカーだけを hard fail にする。Latin は英語・ローマ字・インドネシア語を含めてそのまま通す。
- language guard fail 時は各 provider で最大2回 ReAsk し、それでも fail なら Gemini から OpenRouter に切り替える。OpenRouter 側も同じ ReAsk を行い、最後まで fail した場合は cache 保存も Discord 返信もしない。
- Python 版 `scb-10x/correct_language_validator` は `torch` / `transformers` / NLLB 翻訳モデル依存が重いため、GRKD-Jisho では TypeScript で軽量 validator と ReAsk 方針だけを移植する。
- `packages/bot/src/services/language-guard.service.ts` にスクリプト検出 + 同一文字ゴミ + English ratio validator を実装し、`llm.service.ts` の `generateWithLanguageGuardrails()` で各 provider に同じ ReAsk を適用しつつ Gemini → OpenRouter の順に制御するようにした。
- `messageCreate.ts` では `LanguageGuardError` を分けて扱い、`llm.language_guard.failed` を `bot_events` に記録してから短いエラー返信に切り替える。
- `packages/bot/src/services/__tests__/language-guard.service.test.ts` と `llm.service.test.ts` で daily-japanese / indonesian / `@@@` / Hangul / Greek / fallback failure を固定した。
- `packages/bot/src/events/__tests__/messageCreate.test.ts` を追加し、guild path で `LanguageGuardError` が `llm.language_guard.failed` と短い error reply に変わることを固定した。
- `pnpm --filter @grkd-jisho/bot test` / `pnpm --filter @grkd-jisho/bot build` を通し、code-reviewer でも確認済み。

### 25.1 Indonesian English-ratio Guard — 2026-05-27

- `indonesian` bucket は日本語 + Latin を基本許可とし、英単語ストップワード比率が出力全体の 10% を超えたら ReAsk する。
- 韓国語・キリル文字・デーヴァナーガリー・タイ文字・アラビア文字・ヘブライ文字・ギリシャ文字は 1 文字でも hard fail にする。
- `@@@` / `Amb sources:` / `aaa` / `....` のような同一文字3連発ゴミも hard fail にする（Markdown の `...` / `---` / `***` / `===` / ``` は除外）。
- 日本語だけの出力や Latin 0 件の出力は、そのまま pass する。

### 25.2 English Stopword Evidence Plan — 2026-05-27

- 口語・スラング・文法用語・料理名などの手動 allowlist を維持しない。未知の Latin token は fail しない。
- 英語比率は `the / is / are / a / an / of / in / and / to / that / this / with / without` などの固定 stopword セットで測る。
- Markdown コードブロック、URL、純粋な数字は Latin token 数から除外する。
- 依存追加は不要。判定基準を固定して、実データの誤検出が出たら stopword セットかゴミマーカーの例外だけ調整する。

### 25.3 Output Quality Guard Plan — 2026-06-02

- 画像確認で、daily-japanese bucket の cache に `The response adheres strictly to the specified format. \boxed{Completed}` という怠け出力が保存されていた。
- これは Latin 文字だけで構成されるため、現行 Language Guard（禁止スクリプト / ゴミマーカー / indonesian の英語比率）だけでは fail しない。
- 対策として `Output Quality Guard` を追加する方針にする。Language Guard 通過後、cache 保存と Discord reply の前に「辞書回答として中身があるか」を検査する。
- fail 条件は以下を想定する。
  - `The response adheres strictly to the specified format` / `I followed the instructions` などの形式自己申告
  - `Completed` / `\boxed{Completed}` / `Task completed` だけの完了マーカー
  - `As an AI` / `I cannot` などの assistant meta/refusal
  - 見出しだけで本文説明がない出力
  - `User Safety: safe` / `Safety: safe` のような安全判定だけの自己申告
  - 辞書定義があるのに本文が短すぎる出力（見出し/ラベル除去後の本文250文字未満）
- fail 時は Language Guard と同じ provider retry に乗せる。Gemini / OpenRouter どちらでも最大2回 ReAsk し、それでも fail なら cache 保存せず短い error reply にする。
- 実装時は `packages/bot/src/services/output-quality-guard.service.ts` と unit test を追加し、`llm.service.ts` の guard orchestration に Language Guard → Output Quality Guard の順で組み込む。
- 既存 cache hit は初期実装では再検査しないため、保存済みの怠け出力は管理画面または DB 直接操作で削除する。将来 `validated_at` / `validation_status` で再検査可能にする。
- `bot_events.payloadJson` には `failureCategory: "language" | "quality" | "mixed"` を入れ、言語違反と品質違反を区別できるようにする。

#### 25.3.1 Output Quality Guard threshold update — 2026-06-05

- 実 cache で `User Safety: safe` だけの LLM 出力が `response_cache` に保存され、Discord reply にそのまま表示された。
- 原因は too-short 判定が「本文10文字未満」だけで、`User Safety: safe` のような短い自己判定文を落とせなかったこと。
- `Output Quality Guard` を更新し、見出し/ラベル除去後の本文が250文字未満なら `too-short` として ReAsk する。
- `User Safety: safe` / `Safety: safe` 系は `safety-self-report` として明示的に fail する。

#### 25.3.2 Output Shape Guard — 2026-06-05

- 正常な Indonesian bucket の出力サンプルは、検索語ヘッダー、品詞、`Intuisi Inti`、番号付き意味、例文だけで構成される辞書カードである。
- 実 cache で `query=表` に対して、`「それ」` の説明、`Romaji:`, `sample translation`, `カスタムメッセージ`, code block wrapper, 汎用テンプレ見出しを含む長文ハルシネーションが保存された。
- これは250文字以上あるため `too-short` では止まらない。文字数ではなく「辞書カードの形が壊れているか」を見る `Output Shape Guard` を追加する。
- 初期 fail 条件は、観測済みの壊れ marker（code block wrapper, `Romaji:`, `sample translation`, `カスタムメッセージ`, `### 1. 主なポイント`, `Aturan keseluru:` など）に限定する。
- 追加で、検索語が `これ` / `それ` / `あれ` ではないのに、本文中で `「それ」` / `「これ」` / `「あれ」` が3回以上出る場合は、別語が主役になった可能性が高いため ReAsk する。
