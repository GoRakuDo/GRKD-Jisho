import { randomUUID } from "node:crypto";
import { type Message } from "discord.js";
import { env } from "../config/env.js";
import { lookupWord } from "../services/dictionary.service.js";
import { resolveRoleKey } from "../services/role-mapper.service.js";
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
    responseCacheId: bigint | null;
    cacheHit: boolean;
    normalizedQueryOverride?: string;
    guildIdOverride?: string;
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
  });
  await incrementUsage({ userId: message.author.id, guildId });
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
      await message.reply("予期しないエラーが発生しました。");
    } catch {
      // reply 自体が失敗しても握りつぶす
    }
  }
};

async function handleMessage(message: Message): Promise<void> {
  if (message.author.bot) return;

  const botId = message.client.user?.id;
  if (!botId) return;

  const isDm = message.guildId === null;
  const isDmOwner = isDm && message.author.id === env.DISCORD_DM_OWNER_USER_ID;
  if (isDm && !isDmOwner) return;
  if (!isDm && !message.mentions.has(botId)) return;

  const traceId = `lookup_${randomUUID()}_${message.id}`;
  await traceEvent(traceId, "message.received", "info", {
    guildId: message.guildId,
    channelId: message.channelId,
    userId: message.author.id,
  });

  const allowedChannels = env.DISCORD_ALLOWED_CHANNELS;
  if (!isDm) {
    if (!allowedChannels.includes(message.channelId)) return;
    await traceEvent(traceId, "channel.allowed", "info", {});
  }

  const query = message.content.replace(/<@!?\d+>/g, "").trim();
  if (!query) {
    await message.reply("検索語を入力してください。例: `@grkd-jisho 可憐`");
    return;
  }
  await traceEvent(traceId, "query.extracted", "info", { query });

  const guildContextId = message.guildId ?? env.DISCORD_GUILD_ID;

  if (isDmOwner) {
    const roleKey = await resolveRoleKey([], guildContextId);

    const result = await lookupWord(query);
    if (!result) {
      await message.reply(formatNotFound(query));
      await traceEvent(traceId, "dictionary.miss", "warn", { query });
      await finalizeLookup(message, traceId, {
        query,
        roleIds: [],
        dictionaryIdUsed: null,
        responseCacheId: null,
        cacheHit: false,
        guildIdOverride: guildContextId,
      });
      return;
    }

    await traceEvent(traceId, "dictionary.hit", "info", {
      dict: result.dictionary.name,
      matchedBy: result.matchedBy,
      normalizedQuery: result.normalizedQuery,
    });

    const cacheKey = {
      normalizedQuery: result.normalizedQuery,
      dictionaryId: result.dictionary.id,
      entryId: result.entry.id,
      roleKey,
      promptVersion: env.PROMPT_VERSION,
      modelName: "gemini-2.0-flash",
    };

    const cached = await getCachedResponse(cacheKey);
    if (cached) {
      await message.reply(formatReply(cached.responseText));
      await traceEvent(traceId, "cache.hit", "info", { cacheId: cached.id.toString() });
      await finalizeLookup(message, traceId, {
        query,
        roleIds: [],
        dictionaryIdUsed: result.dictionary.id,
        responseCacheId: cached.id,
        cacheHit: true,
        normalizedQueryOverride: cacheKey.normalizedQuery,
        guildIdOverride: guildContextId,
      });
      return;
    }

    await traceEvent(traceId, "cache.miss", "info", {});
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

      const saved = await saveResponse({ ...cacheKey, responseText });
      if (!saved) {
        await finalizeLookup(message, traceId, {
          query,
          roleIds: [],
          dictionaryIdUsed: result.dictionary.id,
          responseCacheId: null,
          cacheHit: false,
          normalizedQueryOverride: cacheKey.normalizedQuery,
          guildIdOverride: guildContextId,
        });
        await message.reply(formatReply(responseText));
        await traceEvent(traceId, "reply.sent", "info", {});
        return;
      }

      await traceEvent(traceId, "cache.saved", "info", { cacheId: saved.id.toString() });
      await message.reply(formatReply(responseText));
      await traceEvent(traceId, "reply.sent", "info", {});

      await finalizeLookup(message, traceId, {
        query,
        roleIds: [],
        dictionaryIdUsed: result.dictionary.id,
        responseCacheId: saved.id,
        cacheHit: false,
        normalizedQueryOverride: cacheKey.normalizedQuery,
        guildIdOverride: guildContextId,
      });
    } catch (err) {
      await traceEvent(traceId, "llm.error", "error", { error: String(err) });
      await message.reply(formatError("LLM生成中にエラーが発生しました。"));
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

  const isOwner = message.guild?.ownerId === message.author.id;
  const hasAdmin = safeMember.permissions.has("Administrator");

  // ロールIDを取得して rate-limit と role mapping の両方へ渡す
  const roleIds = safeMember.roles.cache.map((r) => r.id);

  const { allowed, limit } = await checkRateLimit({
    userId: message.author.id,
    guildId: message.guildId ?? "",
    memberRoles: roleIds,
    isOwner,
    hasAdminPermission: hasAdmin,
  });

  if (!allowed) {
    await message.reply(
      `本日の検索上限（${limit === Infinity ? "無制限" : `${limit}回`}）に達しました。明日 00:00 GMT+7 にリセットされます。`,
    );
    await traceEvent(traceId, "rate_limit.blocked", "warn", { limit });
    return;
  }
  await traceEvent(traceId, "rate_limit.checked", "info", {});

  const roleKey = await resolveRoleKey(roleIds, guildContextId);

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
      guildIdOverride: guildContextId,
    });
    return;
  }
  await traceEvent(traceId, "dictionary.hit", "info", {
    dict: result.dictionary.name,
    matchedBy: result.matchedBy,
    normalizedQuery: result.normalizedQuery,
  });

  const cacheKey = {
    normalizedQuery: result.normalizedQuery,
    dictionaryId: result.dictionary.id,
    entryId: result.entry.id,
    roleKey,
    promptVersion: env.PROMPT_VERSION,
    modelName: "gemini-2.0-flash",
  };

  const cached = await getCachedResponse(cacheKey);
  if (cached) {
    await message.reply(formatReply(cached.responseText));
    await traceEvent(traceId, "cache.hit", "info", { cacheId: cached.id.toString() });
    await finalizeLookup(message, traceId, {
      query,
      roleIds,
      dictionaryIdUsed: result.dictionary.id,
      responseCacheId: cached.id,
      cacheHit: true,
      normalizedQueryOverride: cacheKey.normalizedQuery,
      guildIdOverride: guildContextId,
    });
    return;
  }
  await traceEvent(traceId, "cache.miss", "info", {});

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

    const saved = await saveResponse({ ...cacheKey, responseText });
    if (!saved) {
      // save に失敗しても lookup ログと使用量カウントは残す
      await finalizeLookup(message, traceId, {
        query,
        roleIds,
        dictionaryIdUsed: result.dictionary.id,
        responseCacheId: null,
        cacheHit: false,
        normalizedQueryOverride: cacheKey.normalizedQuery,
        guildIdOverride: guildContextId,
      });
      await message.reply(formatReply(responseText));
      await traceEvent(traceId, "reply.sent", "info", {});
      return;
    }
    await traceEvent(traceId, "cache.saved", "info", { cacheId: saved.id.toString() });

    await message.reply(formatReply(responseText));
    await traceEvent(traceId, "reply.sent", "info", {});

    await finalizeLookup(message, traceId, {
      query,
      roleIds,
      dictionaryIdUsed: result.dictionary.id,
      responseCacheId: saved.id,
      cacheHit: false,
      normalizedQueryOverride: cacheKey.normalizedQuery,
      guildIdOverride: guildContextId,
    });
  } catch (err) {
    await traceEvent(traceId, "llm.error", "error", { error: String(err) });
    await message.reply(formatError("LLM生成中にエラーが発生しました。"));
  }
};
