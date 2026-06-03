import { eq, desc, sql, inArray } from "drizzle-orm";
import { db } from "../../index";
import * as schema from "../../schema";
import type { ResponseEdit } from "../../schema/response-edits";

// ── Types ──

export interface SearchResult {
  id: string;
  query: string;
  roleKey: string;
  modelName: string;
  promptVersion: string;
  isManualOverride: boolean;
  isDeleteProtected: boolean;
  updatedAt: Date | null;
  responseText: string;
}

export interface SourceResult {
  dictionaryName: string | null;
  dictionaryId: number | null;
  cacheId: string | null;
  cacheHit: boolean;
  createdAt: Date | null;
}

// ── Search ──

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
      isDeleteProtected: schema.responseCache.isDeleteProtected,
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
      isDeleteProtected: schema.responseCache.isDeleteProtected,
      updatedAt: schema.responseCache.updatedAt,
      responseText: schema.responseCache.responseText,
    })
    .from(schema.responseCache)
    .where(eq(schema.responseCache.id, numericId))
    .limit(1);

  if (!row) return null;
  return { ...row, id: String(row.id) };
}

// ── Response detail (with edits + source) ──

export interface ResponseDetailResult extends SearchResult {
  edits: ResponseEdit[];
  source: SourceResult[];
}

export async function getResponseDetail(
  id: string,
): Promise<ResponseDetailResult | null> {
  const base = await getResponseById(id);
  if (!base) return null;

  const numericId = BigInt(id);
  // getResponseById 内で BigInt 変換済みの base が返っているが、edits と source の
  // クエリで再変換が必要なため、ここで独立して BigInt(id) を実行する。
  // numericId は Promise.all の両方の分岐で参照するため、1回の変換で共用している。
  const [edits, source] = await Promise.all([
    db
      .select()
      .from(schema.responseEdits)
      .where(eq(schema.responseEdits.responseCacheId, numericId))
      .orderBy(desc(schema.responseEdits.createdAt)),
    getLookupSource(base.query, 5),
  ]);

  return { ...base, edits, source };
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
        // Editing should make the response manually curated, but keep it deletable.
        isDeleteProtected: false,
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

// ── Delete single response ──

type LockedResponseCacheRow = {
  id: bigint;
  isDeleteProtected: boolean;
};

type RawLockedResponseCacheRow = {
  id: bigint | string | number;
  isDeleteProtected?: boolean;
  isdeleteprotected?: boolean;
  is_delete_protected?: boolean;
};

function toLockedResponseCacheRows(result: unknown): LockedResponseCacheRow[] {
  const rows = Array.isArray(result)
    ? result
    : Array.isArray((result as { rows?: unknown }).rows)
      ? (result as { rows: unknown[] }).rows
      : [];

  return rows.map((row) => {
    const raw = row as RawLockedResponseCacheRow;
    return {
      id: BigInt(raw.id),
      isDeleteProtected: Boolean(
        raw.isDeleteProtected ?? raw.isdeleteprotected ?? raw.is_delete_protected,
      ),
    };
  });
}

async function lockResponseCacheRowsById(tx: Pick<typeof db, "execute">, cacheId: bigint) {
  const result = await tx.execute(sql`
    SELECT id, is_delete_protected AS "isDeleteProtected"
    FROM response_cache
    WHERE id = ${cacheId}
    FOR UPDATE
  `);

  return toLockedResponseCacheRows(result);
}

async function lockResponseCacheRowsByQuery(
  tx: Pick<typeof db, "execute">,
  normalizedQuery: string,
  roleKey?: string,
) {
  const roleClause = roleKey ? sql` AND role_key = ${roleKey}` : sql``;

  const result = await tx.execute(sql`
    SELECT id, is_delete_protected AS "isDeleteProtected"
    FROM response_cache
    WHERE normalized_query = ${normalizedQuery}
    ${roleClause}
    FOR UPDATE
  `);

  return toLockedResponseCacheRows(result);
}

export async function deleteResponse(cacheId: string): Promise<number> {
  if (!/^\d+$/.test(cacheId)) throw new Error("Invalid response ID");

  const numericId = BigInt(cacheId);

  return db.transaction(async (tx) => {
    const [row] = await lockResponseCacheRowsById(tx, numericId);

    if (!row || row.isDeleteProtected) {
      return 0;
    }

    // Delete children first so single-response delete works even if the live DB
    // is still missing ON DELETE CASCADE on one of the child FKs.
    await tx
      .delete(schema.lookupLogs)
      .where(eq(schema.lookupLogs.responseCacheId, numericId));

    await tx
      .delete(schema.responseEdits)
      .where(eq(schema.responseEdits.responseCacheId, numericId));

    const result = await tx
      .delete(schema.responseCache)
      .where(eq(schema.responseCache.id, numericId))
      .returning({ id: schema.responseCache.id });

    return result.length;
  });
}

// ── Delete cache (skip delete-protected rows) ──

export async function deleteCacheByQuery(
  normalizedQuery: string,
  roleKey?: string,
): Promise<number> {
  return db.transaction(async (tx) => {
    const rows = await lockResponseCacheRowsByQuery(tx, normalizedQuery, roleKey);
    const deletableIds = rows.filter((row) => !row.isDeleteProtected).map((row) => row.id);

    if (deletableIds.length === 0) {
      return 0;
    }

    await tx
      .delete(schema.lookupLogs)
      .where(inArray(schema.lookupLogs.responseCacheId, deletableIds));

    await tx
      .delete(schema.responseEdits)
      .where(inArray(schema.responseEdits.responseCacheId, deletableIds));

    const result = await tx
      .delete(schema.responseCache)
      .where(inArray(schema.responseCache.id, deletableIds))
      .returning({ id: schema.responseCache.id });

    return result.length;
  });
}

// ── Source lookup ──

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

