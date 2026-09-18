import { createHash, randomUUID } from "node:crypto";
import { type Message } from "discord.js";
import { getActivePromptForScope, type PromptScopeKey } from "@grkd-jisho/db";
import { env } from "../config/env.js";
import { renderMessage } from "../config/messages.js";
import { extractFirstTerm } from "../services/extract-first-term.js";
import { resolveOutputBucketKey } from "../services/role-mapper.service.js";
import { getCachedResponse, saveResponse } from "../services/response-cache.service.js";
import { generateFreeWithLanguageGuardrails, generateWithLanguageGuardrails, LanguageGuardError, normalizePromptTemplate } from "../services/llm.service.js";
import { recordLookup } from "../services/lookup-log.service.js";
import {
  checkRateLimit,
  commitFreePoolReservation,
  incrementUsage,
  releaseFreePoolReservation,
  reserveFreePool,
  type FreePoolReservation,
} from "../services/rate-limit.service.js";
import {
  formatFreeModelError,
  formatFreeModelErrorForMember,
  formatFreePoolExhausted,
  formatMemberPoolExhausted,
  formatRateLimitExceeded,
  formatReply,
  formatNotFound,
  formatError,
} from "../services/reply-formatter.js";
import { traceEvent } from "../services/observability.service.js";
import { sanitizeLookupQuery } from "@grkd-jisho/db";
import { transformDefinitionForPrompt } from "../services/dictionary-definition-transformer.service.js";

const TYPING_REFRESH_INTERVAL_MS = 8_000;

type DiscordErrorLike = {
  code?: unknown;
  message?: unknown;
};

type MessageReplyPayload = Parameters<Message["reply"]>[0];

function isDeletedReplyReferenceError(err: unknown): boolean {
  if (typeof err !== "object" || err === null) {
    return false;
  }

  const discordError = err as DiscordErrorLike;
  return discordError.code === 10008
    || (discordError.code === 50035
      && typeof discordError.message === "string"
      && discordError.message.includes("MESSAGE_REFERENCE_UNKNOWN_MESSAGE"));
}

/**
 * 返信先が wipe で削除された場合だけ、ユーザータグ付きの通常送信へ切り替える。
 * それ以外の Discord エラーは従来どおり呼び出し元へ返す。
 */
async function replyToMessage(message: Message, payload: MessageReplyPayload): Promise<void> {
  try {
    await message.reply(payload);
    return;
  } catch (err) {
    if (!isDeletedReplyReferenceError(err)) {
      throw err;
    }

    const mention = `<@${message.author.id}>`;

    // PartialGroupDMChannel など send を持たないチャンネルでは元の例外を再送出する
    const channel = message.channel;
    if (!("send" in channel)) {
      throw err;
    }

    console.warn(`[Lookup] reply target unavailable: ${message.id} → Send a channel message mentioning the user`);

    if (typeof payload === "string") {
      await channel.send(`${mention} ${payload}`);
      return;
    }

    if ("embeds" in payload) {
      const content = "content" in payload && typeof payload.content === "string" ? payload.content : "";
      await channel.send({
        content: [mention, content].filter(Boolean).join(" "),
        embeds: payload.embeds,
      });
      return;
    }

    await channel.send(mention);
  }
}

/**
 * DB の生 definitionsJson を LLM プロンプト用に変換して文字列化する。
 * guild path と DM owner path の両方で同じ処理を使う。
 */
function buildDefinitionJsonForPrompt(entry: { definitionsJson: unknown; term: string }): string {
  return JSON.stringify(transformDefinitionForPrompt(entry.definitionsJson, entry.term));
}

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
    responseCacheId: bigint | null;
    cacheHit: boolean;
    outputBucketKey: string;
    llmSource?: string | null;
    normalizedQueryOverride?: string;
    guildIdOverride?: string;
    incrementPersonalUsage?: boolean;
  },
): Promise<void> {
  const guildId = params.guildIdOverride ?? message.guildId ?? "";
  await recordLookup({
    guildId,
    channelId: message.channelId,
    messageId: message.id,
    userId: message.author.id,
    userRolesJson: params.roleIds,
    query: params.query,
    normalizedQuery: params.normalizedQueryOverride ?? params.query,
    dictionaryIdUsed: params.dictionaryIdUsed,
    responseCacheId: params.responseCacheId,
    cacheHit: params.cacheHit,
    outputBucketKey: params.outputBucketKey,
    llmSource: params.llmSource ?? null,
  });
  if (params.incrementPersonalUsage !== false) {
    await incrementUsage({ userId: message.author.id, guildId });
  }
}

type ActivePromptContext = {
  promptVersion: string;
  promptTemplate: string;
  promptContentHash: string;
};

async function loadActivePromptContext(message: Message, traceId: string, scopeKey: PromptScopeKey): Promise<ActivePromptContext | null> {
  const activePrompt = await getActivePromptForScope(scopeKey);

  if (!activePrompt) {
    await traceEvent(traceId, "llm.error", "error", { error: "Active prompt missing" });
    console.error(`[Lookup] trace=${traceId} active prompt missing → Check prompts table and set one row active`);
    await replyToMessage(message, formatError(renderMessage("promptMissing")));
    return null;
  }

  if (activePrompt.content.trim().length === 0) {
    await traceEvent(traceId, "llm.error", "error", { error: `Active prompt empty: ${activePrompt.version}` });
    console.error(`[Lookup] trace=${traceId} active prompt empty → Check prompts.content for version=${activePrompt.version}`);
    await replyToMessage(message, formatError(renderMessage("promptEmpty")));
    return null;
  }

  const promptTemplate = normalizePromptTemplate(activePrompt.content);
  const promptContentHash = createHash("sha256").update(promptTemplate, "utf8").digest("hex");
  console.log(`[Lookup] trace=${traceId} active prompt loaded → version=${activePrompt.version} hash=${promptContentHash.slice(0, 8)}`);
  return {
    promptVersion: activePrompt.version,
    promptTemplate,
    promptContentHash,
  };
}

async function startTypingIndicator(message: Message): Promise<() => void> {
  const channel = message.channel;
  if (!("sendTyping" in channel)) {
    return () => undefined;
  }

  await channel.sendTyping().catch(() => undefined);

  const typingTimer = setInterval(() => {
    void channel.sendTyping().catch(() => undefined);
  }, TYPING_REFRESH_INTERVAL_MS);

  return () => {
    clearInterval(typingTimer);
  };
}

async function withTypingIndicator<T>(message: Message, task: () => Promise<T>): Promise<T> {
  const stopTyping = await startTypingIndicator(message);

  try {
    return await task();
  } finally {
    stopTyping();
  }
}

export const messageCreateHandler = async (message: Message): Promise<void> => {
  try {
    await handleMessage(message);
  } catch (err) {
    const traceId = `lookup_unhandled_${message.id}_${Date.now()}`;
    await traceEvent(traceId, "reply.error", "error", {
      guildId: message.guildId,
      channelId: message.channelId,
      userId: message.author?.id,
      error: String(err),
    });
    const reason = err instanceof Error ? err.message : String(err);
    console.error(`[messageCreate] Unhandled error (trace_id=${traceId}): ${reason} → Check LLM/Dict config or DB`);
    try {
      await replyToMessage(message, renderMessage("unexpectedError"));
    } catch {
      // reply 自体が失敗しても握りつぶす
    }
  }
};

async function handleMessage(message: Message): Promise<void> {
  if (message.author.bot) return;

  const botId = message.client.user?.id;
  if (!botId) return;

  // Bot メッセージへの Reply（message.reference あり + 返信先が Bot）は無視する
  if (message.reference?.messageId && message.mentions.repliedUser?.id === botId) {
    return;
  }

  const isDm = message.guildId === null;
  const isDmOwner = isDm && message.author.id === env.DISCORD_DM_OWNER_USER_ID;
  if (isDm && !isDmOwner) {
    console.log(`[Lookup] blocked DM → author=${message.author.id}`);
    return;
  }
  if (!isDm && !message.mentions.has(botId)) return;

  const traceId = `lookup_${randomUUID()}_${message.id}`;
  console.log(`[Lookup] trace=${traceId} received → author=${message.author.id} channel=${message.channelId} guild=${message.guildId ?? "DM"}`);
  await traceEvent(traceId, "message.received", "info", {
    guildId: message.guildId,
    channelId: message.channelId,
    userId: message.author.id,
  });

  const allowedChannels = env.DISCORD_ALLOWED_CHANNELS;
  if (!isDm) {
    if (!allowedChannels.includes(message.channelId)) {
      console.log(`[Lookup] trace=${traceId} ignored channel=${message.channelId}`);
      return;
    }
    await traceEvent(traceId, "channel.allowed", "info", {});
  }

  await withTypingIndicator(message, async () => {
    const rawText = message.content.replace(/@(here|everyone)\b/g, " ").trim();
    const cleanedText = sanitizeLookupQuery(rawText);
    if (!cleanedText) {
      await replyToMessage(message, renderMessage("missingQueryMention"));
      return;
    }

    // 文の先頭から最長一致で辞書語を抽出
    const extracted = await extractFirstTerm(cleanedText);
    const query = extracted?.term ?? cleanedText;
    const result = extracted?.result ?? null;
    console.log(`[Lookup] trace=${traceId} raw="${rawText}" cleaned="${cleanedText}" query="${query}"`);
    await traceEvent(traceId, "query.extracted", "info", { raw: rawText, cleaned: cleanedText, query });

    const guildContextId = message.guildId ?? env.DISCORD_GUILD_ID;

    if (isDmOwner) {
      const outputBucketKey = await resolveOutputBucketKey([], guildContextId);
      console.log(`[Lookup] trace=${traceId} DM owner path → outputBucketKey=${outputBucketKey}`);

      if (!result) {
        console.log(`[Lookup] trace=${traceId} dictionary miss`);
        await replyToMessage(message, formatNotFound(query));
        await traceEvent(traceId, "dictionary.miss", "warn", { query });
        await finalizeLookup(message, traceId, {
          query,
          roleIds: [],
          dictionaryIdUsed: null,
          responseCacheId: null,
          cacheHit: false,
          outputBucketKey,
          guildIdOverride: guildContextId,
        });
        return;
      }

      console.log(`[Lookup] trace=${traceId} dictionary hit → ${result.dictionary.name}`);
      await traceEvent(traceId, "dictionary.hit", "info", {
        dict: result.dictionary.name,
        matchedBy: result.matchedBy,
        normalizedQuery: result.normalizedQuery,
      });

      const promptContext = await loadActivePromptContext(message, traceId, outputBucketKey);
      if (!promptContext) {
        return;
      }

      const cacheLookupKey = {
        normalizedQuery: result.normalizedQuery,
        dictionaryId: result.dictionary.id,
        entryId: result.entry.id,
        roleKey: outputBucketKey,
        promptVersion: promptContext.promptVersion,
      };

      const cached = await getCachedResponse(cacheLookupKey);
      if (cached) {
        console.log(`[Lookup] trace=${traceId} cache hit → cacheId=${cached.id.toString()}`);
        await replyToMessage(message, formatReply(cached.responseText));
        await traceEvent(traceId, "cache.hit", "info", { cacheId: cached.id.toString() });
        await finalizeLookup(message, traceId, {
          query,
          roleIds: [],
          dictionaryIdUsed: result.dictionary.id,
          responseCacheId: cached.id,
          cacheHit: true,
          outputBucketKey,
          normalizedQueryOverride: cacheLookupKey.normalizedQuery,
          guildIdOverride: guildContextId,
        });
        return;
      }

      console.log(`[Lookup] trace=${traceId} cache miss → version=${promptContext.promptVersion} hash=${promptContext.promptContentHash.slice(0, 8)}`);

      await traceEvent(traceId, "cache.miss", "info", {});
      await traceEvent(traceId, "llm.generate.started", "info", {
        promptVersion: promptContext.promptVersion,
        promptContentHash: promptContext.promptContentHash,
      });
      console.log(`[Lookup] trace=${traceId} llm.generate.started`);

      try {
        const { text: responseText, source: llmSource } = await generateWithLanguageGuardrails({
          roleKey: outputBucketKey,
          query,
          dictionaryForm: result.entry.term,
          reading: result.entry.reading,
          dictionaryName: result.dictionary.name,
          definitionJson: buildDefinitionJsonForPrompt(result.entry),
          promptTemplate: promptContext.promptTemplate,
          promptVersion: promptContext.promptVersion,
        });
        console.log(`[Lookup] trace=${traceId} llm.generate.success source=${llmSource ?? "fallback"}`);
        await traceEvent(traceId, "llm.generated", "info", {});

        const saved = await saveResponse({
          ...cacheLookupKey,
          promptContentHash: promptContext.promptContentHash,
          modelName: llmSource ?? "fallback",
          responseText,
        });
        if (!saved) {
          console.log(`[Lookup] trace=${traceId} cache save failed/skip`);
          await finalizeLookup(message, traceId, {
            query,
            roleIds: [],
            dictionaryIdUsed: result.dictionary.id,
            responseCacheId: null,
            cacheHit: false,
            outputBucketKey,
            llmSource,
            normalizedQueryOverride: cacheLookupKey.normalizedQuery,
            guildIdOverride: guildContextId,
          });
          await replyToMessage(message, formatReply(responseText));
          await traceEvent(traceId, "reply.sent", "info", {});
          console.log(`[Lookup] trace=${traceId} reply.sent (cache skipped)`);
          return;
        }

        await traceEvent(traceId, "cache.saved", "info", { cacheId: saved.id.toString() });
        console.log(`[Lookup] trace=${traceId} cache saved → cacheId=${saved.id.toString()}`);
        await replyToMessage(message, formatReply(responseText));
        await traceEvent(traceId, "reply.sent", "info", {});
        console.log(`[Lookup] trace=${traceId} reply.sent`);

        await finalizeLookup(message, traceId, {
          query,
          roleIds: [],
          dictionaryIdUsed: result.dictionary.id,
          responseCacheId: saved.id,
          cacheHit: false,
          outputBucketKey,
          llmSource,
          normalizedQueryOverride: cacheLookupKey.normalizedQuery,
          guildIdOverride: guildContextId,
        });
        console.log(`[Lookup] trace=${traceId} finalizeLookup done`);
      } catch (err) {
        if (err instanceof LanguageGuardError) {
          await traceEvent(traceId, "llm.language_guard.failed", "warn", {
            bucket: err.bucket,
            source: err.source,
            reaskAttempts: err.reaskAttempts,
            fallbackUsed: err.fallbackUsed,
            failureCategory: err.failureCategory ?? "language",
            violations: err.violations,
          });
          console.warn(`[Lookup] trace=${traceId} language guard failed → bucket=${err.bucket} source=${err.source} attempts=${err.reaskAttempts}`);
          await replyToMessage(message, formatError(renderMessage("languageGuardFailed")));
          return;
        }

        await traceEvent(traceId, "llm.error", "error", { error: String(err) });
        console.error(`[Lookup] trace=${traceId} failed: ${err instanceof Error ? err.message : String(err)} → Check CPA_API_KEY in .env or CPA availability`);
        await replyToMessage(message, formatError(renderMessage("llmGenerationError")));
      }

      return;
    }

    const member = message.member;
    if (!member) return;

    // GuildMembers intent に依存しない: roles.cache が不完全なら API fetch で補完
    // @everyone のみ（size=1）の場合に fetch を試み、失敗時は元の member を維持
    const safeMember = (member.roles.cache.size < 2 && message.guild)
      ? await message.guild.members.fetch(message.author.id).catch(() => member)
      : member;
    console.log(`[Lookup] trace=${traceId} guild path → member resolved`);

    const isOwner = message.guild?.ownerId === message.author.id;
    const hasAdmin = safeMember.permissions.has("Administrator");

    // ロールIDを取得して rate-limit と role mapping の両方へ渡す
    const roleIds = safeMember.roles.cache.map((r) => r.id);

    const {
      allowed,
      limit,
      freeUser = false,
      freePoolFallback = false,
    } = await checkRateLimit({
      userId: message.author.id,
      guildId: message.guildId ?? "",
      memberRoles: roleIds,
      isOwner,
      hasAdminPermission: hasAdmin,
      includeFreeUser: true,
    });
    const useFreeModel = freeUser || freePoolFallback;

    if (!allowed && !freePoolFallback) {
      console.log(`[Lookup] trace=${traceId} rate limit blocked → limit=${limit}`);
      await replyToMessage(message, formatRateLimitExceeded(limit));
      await traceEvent(traceId, "rate_limit.blocked", "warn", { limit });
      return;
    }
    await traceEvent(traceId, "rate_limit.checked", "info", {});
    console.log(`[Lookup] trace=${traceId} rate limit passed`);

    let freeReservation: FreePoolReservation | null = null;

    const outputBucketKey = await resolveOutputBucketKey(roleIds, guildContextId);
    console.log(`[Lookup] trace=${traceId} output bucket resolved → ${outputBucketKey}`);

    if (!result) {
      console.log(`[Lookup] trace=${traceId} dictionary miss`);
      if (freeReservation) {
        await releaseFreePoolReservation(freeReservation);
        freeReservation = null;
      }
      await replyToMessage(message, formatNotFound(query));
      await traceEvent(traceId, "dictionary.miss", "warn", { query });
      if (!useFreeModel) {
        await finalizeLookup(message, traceId, {
          query,
          roleIds,
          dictionaryIdUsed: null,
          responseCacheId: null,
          cacheHit: false,
          outputBucketKey,
          guildIdOverride: guildContextId,
        });
      }
      return;
    }
    console.log(`[Lookup] trace=${traceId} dictionary hit → ${result.dictionary.name}`);
    await traceEvent(traceId, "dictionary.hit", "info", {
      dict: result.dictionary.name,
      matchedBy: result.matchedBy,
      normalizedQuery: result.normalizedQuery,
    });

    const promptContext = await loadActivePromptContext(message, traceId, outputBucketKey);
    if (!promptContext) {
      if (freeReservation) {
        await releaseFreePoolReservation(freeReservation);
        freeReservation = null;
      }
      return;
    }

    const cacheLookupKey = {
      normalizedQuery: result.normalizedQuery,
      dictionaryId: result.dictionary.id,
      entryId: result.entry.id,
      roleKey: outputBucketKey,
      promptVersion: promptContext.promptVersion,
    };

    const cached = await getCachedResponse(cacheLookupKey);
    if (cached) {
      console.log(`[Lookup] trace=${traceId} cache hit → cacheId=${cached.id.toString()}`);
      await replyToMessage(message, formatReply(cached.responseText));
      await traceEvent(traceId, "cache.hit", "info", { cacheId: cached.id.toString() });
      await finalizeLookup(message, traceId, {
        query,
        roleIds,
        dictionaryIdUsed: result.dictionary.id,
        responseCacheId: cached.id,
        cacheHit: true,
        outputBucketKey,
        normalizedQueryOverride: cacheLookupKey.normalizedQuery,
        guildIdOverride: guildContextId,
        // キャッシュヒットは生成していないため、無料経路では個人使用量も共有枠も消費しない。
        // メンバー経路は従来どおり使用量を記録する。
        incrementPersonalUsage: !useFreeModel,
      });
      return;
    }
    console.log(`[Lookup] trace=${traceId} cache miss → version=${promptContext.promptVersion} hash=${promptContext.promptContentHash.slice(0, 8)}`);
    if (useFreeModel) {
      freeReservation = await reserveFreePool();
      if (!freeReservation) {
        console.log(`[Lookup] trace=${traceId} free pool blocked`);
        await replyToMessage(message, freeUser ? formatFreePoolExhausted() : formatMemberPoolExhausted(limit));
        await traceEvent(traceId, "rate_limit.blocked", "warn", { scope: "free_pool" });
        return;
      }
      await traceEvent(traceId, "rate_limit.checked", "info", { scope: "free_pool" });
    }
    await traceEvent(traceId, "cache.miss", "info", {});

    await traceEvent(traceId, "llm.generate.started", "info", {
      promptVersion: promptContext.promptVersion,
      promptContentHash: promptContext.promptContentHash,
    });
    console.log(`[Lookup] trace=${traceId} llm.generate.started`);
    try {
      const { text: responseText, source: llmSource } = await (useFreeModel
        ? generateFreeWithLanguageGuardrails
        : generateWithLanguageGuardrails)({
        roleKey: outputBucketKey,
        query,
        dictionaryForm: result.entry.term,
        reading: result.entry.reading,
        dictionaryName: result.dictionary.name,
        definitionJson: buildDefinitionJsonForPrompt(result.entry),
        promptTemplate: promptContext.promptTemplate,
        promptVersion: promptContext.promptVersion,
      });
      console.log(`[Lookup] trace=${traceId} llm.generate.success source=${llmSource ?? "fallback"}`);
      await traceEvent(traceId, "llm.generated", "info", {});

      const saved = await saveResponse({
        ...cacheLookupKey,
        promptContentHash: promptContext.promptContentHash,
        modelName: llmSource ?? "fallback",
        responseText,
      });
      if (!saved && !useFreeModel) {
        // save に失敗しても lookup ログと使用量カウントは残す
        console.log(`[Lookup] trace=${traceId} cache save failed/skip`);
        await finalizeLookup(message, traceId, {
          query,
          roleIds,
          dictionaryIdUsed: result.dictionary.id,
          responseCacheId: null,
          cacheHit: false,
          outputBucketKey,
          llmSource,
          normalizedQueryOverride: cacheLookupKey.normalizedQuery,
          guildIdOverride: guildContextId,
        });
        await replyToMessage(message, formatReply(responseText));
        await traceEvent(traceId, "reply.sent", "info", {});
        console.log(`[Lookup] trace=${traceId} reply.sent (cache skipped)`);
        return;
      }
      if (saved) {
        await traceEvent(traceId, "cache.saved", "info", { cacheId: saved.id.toString() });
        console.log(`[Lookup] trace=${traceId} cache saved → cacheId=${saved.id.toString()}`);
      }

      await replyToMessage(message, formatReply(responseText));
      await traceEvent(traceId, "reply.sent", "info", {});
      console.log(`[Lookup] trace=${traceId} reply.sent`);

      if (useFreeModel) {
        if (freeReservation) {
          await commitFreePoolReservation(freeReservation);
          freeReservation = null;
        }
        await finalizeLookup(message, traceId, {
          query,
          roleIds,
          dictionaryIdUsed: result.dictionary.id,
          responseCacheId: saved?.id ?? null,
          cacheHit: false,
          outputBucketKey,
          llmSource,
          normalizedQueryOverride: cacheLookupKey.normalizedQuery,
          guildIdOverride: guildContextId,
        });
      } else {
        await finalizeLookup(message, traceId, {
          query,
          roleIds,
          dictionaryIdUsed: result.dictionary.id,
          responseCacheId: saved!.id,
          cacheHit: false,
          outputBucketKey,
          llmSource,
          normalizedQueryOverride: cacheLookupKey.normalizedQuery,
          guildIdOverride: guildContextId,
        });
      }
      console.log(`[Lookup] trace=${traceId} finalizeLookup done`);
    } catch (err) {
      if (freeReservation) {
        await releaseFreePoolReservation(freeReservation);
        freeReservation = null;
      }
      if (err instanceof LanguageGuardError) {
        await traceEvent(traceId, "llm.language_guard.failed", "warn", {
          bucket: err.bucket,
          source: err.source,
          reaskAttempts: err.reaskAttempts,
          fallbackUsed: err.fallbackUsed,
          failureCategory: err.failureCategory ?? "language",
          violations: err.violations,
        });
        console.warn(`[Lookup] trace=${traceId} language guard failed → bucket=${err.bucket} source=${err.source} attempts=${err.reaskAttempts}`);
        await replyToMessage(message, useFreeModel
          ? (freePoolFallback ? formatFreeModelErrorForMember() : formatFreeModelError())
          : formatError(renderMessage("languageGuardFailed")));
        return;
      }

      await traceEvent(traceId, "llm.error", "error", { error: String(err) });
      console.error(`[Lookup] trace=${traceId} failed: ${err instanceof Error ? err.message : String(err)} → Check CPA_API_KEY in .env or CPA availability`);
      await replyToMessage(message, useFreeModel
        ? (freePoolFallback ? formatFreeModelErrorForMember() : formatFreeModelError())
        : formatError(renderMessage("llmGenerationError")));
    }
  });
};
