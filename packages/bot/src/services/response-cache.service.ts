import { eq, and, desc } from "drizzle-orm";
import { db, schema } from "@grkd-jisho/db";
import type { CacheKey } from "../types.js";

export async function getCachedResponse(key: CacheKey) {
  const [row] = await db
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
      ),
    )
    .orderBy(desc(schema.responseCache.isManualOverride))
    .limit(1);

  return row ?? null;
}

/**
 * キャッシュに保存する。既に同じキャッシュキーが存在する場合は何もしない（ON CONFLICT DO NOTHING）。
 * 手動上書き済みのレコードも含めて、既存レコードを絶対に上書きしない。
 * 戻り値: 保存されたレコード、または何もしなかった場合は null。
 */
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
      promptContentHash: params.promptContentHash,
      modelName: params.modelName,
      responseText: params.responseText,
    })
    .onConflictDoNothing()
    .returning();

  return saved ?? null;
}
