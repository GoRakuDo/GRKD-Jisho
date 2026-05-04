import { eq, asc, desc, and, sql } from "drizzle-orm";
import { db, schema } from "@grkd-jisho/db";

// ── Search ──

export interface SearchResult {
  id: string;
  query: string;
  roleKey: string;
  modelName: string;
  promptVersion: string;
  isManualOverride: boolean;
  updatedAt: Date | null;
  responseText: string;
}

export async function searchResponse(
  word: string,
  limit = 10,
): Promise<SearchResult[]> {
  const rows = await db
    .select({
      id: schema.responseCache.id,
      query: schema.responseCache.query,
      roleKey: schema.responseCache.roleKey,
      modelName: schema.responseCache.modelName,
      promptVersion: schema.responseCache.promptVersion,
      isManualOverride: schema.responseCache.isManualOverride,
      updatedAt: schema.responseCache.updatedAt,
      responseText: schema.responseCache.responseText,
    })
    .from(schema.responseCache)
    .where(eq(schema.responseCache.normalizedQuery, word))
    .orderBy(desc(schema.responseCache.isManualOverride))
    .limit(limit);

  return rows.map((r) => ({ ...r, id: String(r.id) }));
}

// ── Single response ──

export async function getResponseById(
  id: string,
): Promise<SearchResult | null> {
  // DB の bigserial は bigint → BigInt で扱う。Number は精度限界（2^53）を超える可能性がある
  if (!/^\d+$/.test(id)) return null;
  let numericId: bigint;
  try {
    numericId = BigInt(id);
  } catch {
    return null;
  }

  const [row] = await db
    .select({
      id: schema.responseCache.id,
      query: schema.responseCache.query,
      roleKey: schema.responseCache.roleKey,
      modelName: schema.responseCache.modelName,
      promptVersion: schema.responseCache.promptVersion,
      isManualOverride: schema.responseCache.isManualOverride,
      updatedAt: schema.responseCache.updatedAt,
      responseText: schema.responseCache.responseText,
    })
    .from(schema.responseCache)
    .where(eq(schema.responseCache.id, BigInt(numericId)))
    .limit(1);

  if (!row) return null;
  return { ...row, id: String(row.id) };
}

// ── Update (override) ──

export async function updateResponse(
  cacheId: string,
  newText: string,
  editorDiscordId: string,
  reason?: string,
): Promise<void> {
  if (!/^\d+$/.test(cacheId)) throw new Error("Invalid response ID");

  const numericId = BigInt(cacheId);

  await db.transaction(async (tx) => {
    // トランザクション内で変更前テキストを取得（update 後に失われるため先に読む）
    const [before] = await tx
      .select({ responseText: schema.responseCache.responseText })
      .from(schema.responseCache)
      .where(eq(schema.responseCache.id, numericId))
      .limit(1);

    if (!before) throw new Error("Response not found");

    await tx
      .update(schema.responseCache)
      .set({
        responseText: newText,
        isManualOverride: true,
        updatedAt: sql`now()`,
      })
      .where(eq(schema.responseCache.id, numericId));

    await tx.insert(schema.responseEdits).values({
      responseCacheId: numericId,
      editorDiscordId,
      beforeText: before.responseText,
      afterText: newText,
      reason: reason ?? null,
    });
  });
}

// ── Delete cache (skip manual override) ──

export async function deleteCacheByQuery(
  normalizedQuery: string,
  roleKey?: string,
): Promise<number> {
  const conditions = [
    eq(schema.responseCache.normalizedQuery, normalizedQuery),
    eq(schema.responseCache.isManualOverride, false),
  ];
  if (roleKey) {
    conditions.push(eq(schema.responseCache.roleKey, roleKey));
  }

  const result = await db
    .delete(schema.responseCache)
    .where(and(...conditions))
    .returning({ id: schema.responseCache.id });

  return result.length;
}

// ── Source lookup ──

export interface SourceResult {
  dictionaryName: string | null;
  dictionaryId: number | null;
  cacheId: string | null;
  cacheHit: boolean;
  createdAt: Date | null;
}

export async function getLookupSource(
  normalizedQuery: string,
  limit = 5,
): Promise<SourceResult[]> {
  const rows = await db
    .select({
      dictionaryName: schema.dictionaries.name,
      dictionaryId: schema.lookupLogs.dictionaryIdUsed,
      cacheId: schema.lookupLogs.responseCacheId,
      cacheHit: schema.lookupLogs.cacheHit,
      createdAt: schema.lookupLogs.createdAt,
    })
    .from(schema.lookupLogs)
    .leftJoin(
      schema.dictionaries,
      eq(schema.lookupLogs.dictionaryIdUsed, schema.dictionaries.id),
    )
    .where(eq(schema.lookupLogs.normalizedQuery, normalizedQuery))
    .orderBy(desc(schema.lookupLogs.createdAt))
    .limit(limit);

  return rows.map((r) => ({
    ...r,
    cacheId: r.cacheId ? String(r.cacheId) : null,
  }));
}

// ── Dictionary list ──

export async function getDictionaryList() {
  return db
    .select()
    .from(schema.dictionaries)
    .orderBy(asc(schema.dictionaries.priority));
}
