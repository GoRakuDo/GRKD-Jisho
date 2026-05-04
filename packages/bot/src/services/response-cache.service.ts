import { eq, and } from "drizzle-orm";
import { db, schema } from "@grkd-jisho/db";
import type { CacheKey } from "../types.js";

export async function getCachedResponse(key: CacheKey) {
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
        eq(schema.responseCache.isManualOverride, true),
      ),
    )
    .limit(1);

  if (manual) return manual;

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
        eq(schema.responseCache.isManualOverride, false),
      ),
    )
    .limit(1);

  return cached ?? null;
}

export async function saveResponse(
  params: CacheKey & { responseText: string },
) {
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
    .returning();

  return saved;
}
