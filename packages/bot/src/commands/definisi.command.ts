import { createHash, randomUUID } from "node:crypto";
import {
  SlashCommandBuilder,
  type ChatInputCommandInteraction,
  type GuildMemberRoleManager,
} from "discord.js";
import {
  getActivePromptForScope,
  sanitizeLookupQuery,
  type PromptScopeKey,
} from "@grkd-jisho/db";
import { env } from "../config/env.js";
import { renderMessage } from "../config/messages.js";
import type { Command } from "./types.js";
import { extractFirstTerm } from "../services/extract-first-term.js";
import { resolveOutputBucketKey } from "../services/role-mapper.service.js";
import {
  getCachedResponse,
  saveResponse,
} from "../services/response-cache.service.js";
import {
  generateFreeWithLanguageGuardrails,
  generateWithLanguageGuardrails,
  LanguageGuardError,
  normalizePromptTemplate,
} from "../services/llm.service.js";
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
import { transformDefinitionForPrompt } from "../services/dictionary-definition-transformer.service.js";

function buildDefinitionJsonForPrompt(entry: {
  definitionsJson: unknown;
  term: string;
}): string {
  return JSON.stringify(
    transformDefinitionForPrompt(entry.definitionsJson, entry.term),
  );
}

type ActivePromptContext = {
  promptVersion: string;
  promptTemplate: string;
  promptContentHash: string;
};

async function loadActivePromptContext(
  interaction: ChatInputCommandInteraction,
  traceId: string,
  scopeKey: PromptScopeKey,
): Promise<ActivePromptContext | null> {
  const activePrompt = await getActivePromptForScope(scopeKey);

  if (!activePrompt) {
    await traceEvent(traceId, "llm.error", "error", {
      error: "Active prompt missing",
    });
    console.error(
      `[Definisi] trace=${traceId} active prompt missing → Check prompts table and set one row active`,
    );
    await interaction.editReply(
      formatError(
        renderMessage("promptMissing"),
      ),
    );
    return null;
  }

  if (activePrompt.content.trim().length === 0) {
    await traceEvent(traceId, "llm.error", "error", {
      error: `Active prompt empty: ${activePrompt.version}`,
    });
    console.error(
      `[Definisi] trace=${traceId} active prompt empty → Check prompts.content for version=${activePrompt.version}`,
    );
    await interaction.editReply(
      formatError(
        renderMessage("promptEmpty"),
      ),
    );
    return null;
  }

  const promptTemplate = normalizePromptTemplate(activePrompt.content);
  const promptContentHash = createHash("sha256").update(promptTemplate, "utf8").digest("hex");
  console.log(`[Definisi] trace=${traceId} active prompt loaded → version=${activePrompt.version} hash=${promptContentHash.slice(0, 8)}`);
  return {
    promptVersion: activePrompt.version,
    promptTemplate,
    promptContentHash,
  };
}

export const definisiCommand: Command = {
  builder: new SlashCommandBuilder()
    .setName("definisi")
    .setDescription("Cari arti kata di kamus Jepang")
    .addStringOption((opt) =>
      opt
        .setName("word")
        .setDescription("Kata bahasa Jepang yang ingin dicari")
        .setRequired(true),
    )
    .setDMPermission(false),
  requiresAdmin: false,
  async execute(interaction: ChatInputCommandInteraction): Promise<void> {
    if (!interaction.inGuild() || !interaction.channelId) {
      await interaction.reply({
        content: renderMessage("commandGuildOnly"),
        ephemeral: true,
      });
      return;
    }

    const allowedChannels = env.DISCORD_ALLOWED_CHANNELS;
    if (!allowedChannels.includes(interaction.channelId)) {
      await interaction.reply({
        content: renderMessage("commandChannelOnly"),
        ephemeral: true,
      });
      return;
    }

    await interaction.deferReply();

    const traceId = `lookup_slash_${randomUUID()}_${interaction.id}`;
    const rawWord = interaction.options.getString("word", true);
    const sanitizedInput = rawWord.replace(/@(here|everyone)\b/g, " ").trim();
    const cleanedText = sanitizeLookupQuery(sanitizedInput);

    if (!cleanedText) {
      await interaction.editReply(
        formatError(renderMessage("missingQuerySlash")),
      );
      return;
    }

    console.log(
      `[Definisi] trace=${traceId} received → user=${interaction.user.id} channel=${interaction.channelId} guild=${interaction.guildId} raw="${rawWord}" cleaned="${cleanedText}"`,
    );

    await traceEvent(traceId, "message.received", "info", {
      guildId: interaction.guildId,
      channelId: interaction.channelId,
      userId: interaction.user.id,
      command: "definisi",
    });

    const member = interaction.member;
    const memberRoles = Array.isArray(member?.roles)
      ? member.roles
      : (member?.roles as GuildMemberRoleManager | undefined)?.cache.map(
          (r) => r.id,
        ) ?? [];

    const isOwner = interaction.guild?.ownerId === interaction.user.id;
    const hasAdmin =
      interaction.memberPermissions?.has("Administrator") ?? false;

    const {
      allowed,
      limit,
      freeUser = false,
      freePoolFallback = false,
    } = await checkRateLimit({
      userId: interaction.user.id,
      guildId: interaction.guildId ?? "",
      memberRoles,
      isOwner,
      hasAdminPermission: hasAdmin,
      includeFreeUser: true,
    });
    const useFreeModel = freeUser || freePoolFallback;

    if (!allowed && !freePoolFallback) {
      console.log(
        `[Definisi] trace=${traceId} rate limit blocked → limit=${limit}`,
      );
      await interaction.editReply(formatRateLimitExceeded(limit));
      await traceEvent(traceId, "rate_limit.blocked", "warn", { limit });
      return;
    }

    await traceEvent(traceId, "rate_limit.checked", "info", {});

    let freeReservation: FreePoolReservation | null = null;

    const extracted = await extractFirstTerm(cleanedText);
    const query = extracted?.term ?? cleanedText;
    const result = extracted?.result ?? null;
    await traceEvent(traceId, "query.extracted", "info", {
      raw: rawWord,
      cleaned: cleanedText,
      query,
    });

    const guildContextId = interaction.guildId ?? env.DISCORD_GUILD_ID;
    const outputBucketKey = await resolveOutputBucketKey(
      memberRoles,
      guildContextId,
    );

    if (!result) {
      console.log(`[Definisi] trace=${traceId} dictionary miss`);
      if (freeReservation) {
        await releaseFreePoolReservation(freeReservation);
        freeReservation = null;
      }
      await interaction.editReply(formatNotFound(query));
      await traceEvent(traceId, "dictionary.miss", "warn", { query });
      if (!useFreeModel) {
        await recordLookup({
          guildId: guildContextId,
          channelId: interaction.channelId,
          messageId: interaction.id,
          userId: interaction.user.id,
          userRolesJson: memberRoles,
          query,
          normalizedQuery: query,
          dictionaryIdUsed: null,
          responseCacheId: null,
          cacheHit: false,
          outputBucketKey,
          llmSource: null,
        });
        await incrementUsage({
          userId: interaction.user.id,
          guildId: guildContextId,
        });
      }
      return;
    }

    console.log(
      `[Definisi] trace=${traceId} dictionary hit → ${result.dictionary.name}`,
    );
    await traceEvent(traceId, "dictionary.hit", "info", {
      dict: result.dictionary.name,
      matchedBy: result.matchedBy,
      normalizedQuery: result.normalizedQuery,
    });

    const promptContext = await loadActivePromptContext(
      interaction,
      traceId,
      outputBucketKey,
    );
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
      console.log(
        `[Definisi] trace=${traceId} cache hit → cacheId=${cached.id.toString()}`,
      );
      await interaction.editReply(formatReply(cached.responseText));
      await traceEvent(traceId, "cache.hit", "info", {
        cacheId: cached.id.toString(),
      });
      await recordLookup({
        guildId: guildContextId,
        channelId: interaction.channelId,
        messageId: interaction.id,
        userId: interaction.user.id,
        userRolesJson: memberRoles,
        query,
        normalizedQuery: cacheLookupKey.normalizedQuery,
        dictionaryIdUsed: result.dictionary.id,
        responseCacheId: cached.id,
        cacheHit: true,
        outputBucketKey,
        llmSource: null,
      });
      // キャッシュヒットは生成していないため、無料経路では個人使用量も共有枠も消費しない。
      // メンバー経路は従来どおり使用量を記録する。
      if (!useFreeModel) {
        await incrementUsage({
          userId: interaction.user.id,
          guildId: guildContextId,
        });
      }
      return;
    }

    console.log(
      `[Definisi] trace=${traceId} cache miss → version=${promptContext.promptVersion}`,
    );
    if (useFreeModel) {
      freeReservation = await reserveFreePool();
      if (!freeReservation) {
        await interaction.editReply(freeUser ? formatFreePoolExhausted() : formatMemberPoolExhausted(limit));
        await traceEvent(traceId, "rate_limit.blocked", "warn", { scope: "free_pool" });
        return;
      }
      await traceEvent(traceId, "rate_limit.checked", "info", { scope: "free_pool" });
    }
    await traceEvent(traceId, "cache.miss", "info", {});
    await traceEvent(traceId, "llm.generate.started", "info", {
      promptVersion: promptContext.promptVersion,
    });

    try {
      const { text: responseText, source: llmSource } =
        await (useFreeModel
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

      console.log(
        `[Definisi] trace=${traceId} llm.generate.success source=${llmSource ?? "fallback"}`,
      );
      await traceEvent(traceId, "llm.generated", "info", {});

      const saved = await saveResponse({
        ...cacheLookupKey,
        promptContentHash: promptContext.promptContentHash,
        modelName: llmSource ?? "fallback",
        responseText,
      });

      const responseCacheId = saved ? saved.id : null;
      if (saved) {
        await traceEvent(traceId, "cache.saved", "info", {
          cacheId: saved.id.toString(),
        });
      }

      await interaction.editReply(formatReply(responseText));
      await traceEvent(traceId, "reply.sent", "info", {});

      await recordLookup({
        guildId: guildContextId,
        channelId: interaction.channelId,
        messageId: interaction.id,
        userId: interaction.user.id,
        userRolesJson: memberRoles,
        query,
        normalizedQuery: cacheLookupKey.normalizedQuery,
        dictionaryIdUsed: result.dictionary.id,
        responseCacheId,
        cacheHit: false,
        outputBucketKey,
        llmSource,
      });
      if (useFreeModel) {
        if (freeReservation) {
          await commitFreePoolReservation(freeReservation);
          freeReservation = null;
        }
        await incrementUsage({
          userId: interaction.user.id,
          guildId: guildContextId,
        });
      } else {
        await incrementUsage({
          userId: interaction.user.id,
          guildId: guildContextId,
        });
      }
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
        console.warn(
          `[Definisi] trace=${traceId} language guard failed → bucket=${err.bucket} source=${err.source} attempts=${err.reaskAttempts}`,
        );
        await interaction.editReply(
          useFreeModel
            ? (freePoolFallback ? formatFreeModelErrorForMember() : formatFreeModelError())
            : formatError(
                renderMessage("languageGuardFailed"),
              ),
        );
        return;
      }

      await traceEvent(traceId, "llm.error", "error", { error: String(err) });
      console.error(
        `[Definisi] trace=${traceId} failed: ${err instanceof Error ? err.message : String(err)} → Check CPA_API_KEY in .env or CPA service`,
      );
      await interaction.editReply(
        useFreeModel
          ? (freePoolFallback ? formatFreeModelErrorForMember() : formatFreeModelError())
          : formatError(renderMessage("llmGenerationError")),
      );
    }
  },
};
