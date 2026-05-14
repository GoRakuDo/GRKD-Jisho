import { eq, and, count, ilike, inArray, desc } from "drizzle-orm";
import { db } from "../../index";
import * as schema from "../../schema";

export interface CacheStats {
  total: number;
  manualOverride: number;
  deletable: number; // non-delete-protected, can be refreshed
}

export async function getCacheStats(): Promise<CacheStats> {
  const [row] = await db
    .select({
      total: count(schema.responseCache.id),
    })
    .from(schema.responseCache);

  const total = row ? Number(row.total) : 0;

  const [manualRow] = await db
    .select({
      count: count(schema.responseCache.id),
    })
    .from(schema.responseCache)
    .where(eq(schema.responseCache.isManualOverride, true));

  const manual = manualRow ? Number(manualRow.count) : 0;

  const [protectedRow] = await db
    .select({
      count: count(schema.responseCache.id),
    })
    .from(schema.responseCache)
    .where(eq(schema.responseCache.isDeleteProtected, true));

  const protectedCount = protectedRow ? Number(protectedRow.count) : 0;

  return {
    total,
    manualOverride: manual,
    deletable: total - protectedCount,
  };
}

export async function searchCacheEntries(
  queryText: string,
  limit = 20,
): Promise<
  {
    id: string;
    query: string;
    roleKey: string;
    modelName: string;
    isManualOverride: boolean;
    isDeleteProtected: boolean;
    updatedAt: Date | null;
  }[]
> {
  const rows = await db
    .select({
      id: schema.responseCache.id,
      query: schema.responseCache.query,
      roleKey: schema.responseCache.roleKey,
      modelName: schema.responseCache.modelName,
      isManualOverride: schema.responseCache.isManualOverride,
      isDeleteProtected: schema.responseCache.isDeleteProtected,
      updatedAt: schema.responseCache.updatedAt,
    })
    .from(schema.responseCache)
    .where(ilike(schema.responseCache.normalizedQuery, `%${queryText}%`))
    .limit(limit);

  return rows.map((r) => ({ ...r, id: String(r.id) }));
}

export async function bulkDeleteCache(ids: string[], forceDeleteProtected = false): Promise<number> {
  const numericIds = ids
    .filter((id) => /^\d+$/.test(id))
    .map((id) => BigInt(id));

  if (numericIds.length === 0) return 0;

  const result = await db.transaction(async (tx) => {
    const deletableRows = await tx
      .select({ id: schema.responseCache.id })
      .from(schema.responseCache)
      .where(
        forceDeleteProtected
          ? inArray(schema.responseCache.id, numericIds)
          : and(inArray(schema.responseCache.id, numericIds), eq(schema.responseCache.isDeleteProtected, false)),
      );

    if (deletableRows.length === 0) return [] as { id: bigint }[];

    const deletableIds = deletableRows.map((row) => row.id);

    // Delete children first (FK safety — no cascade dependency)
    await tx
      .delete(schema.lookupLogs)
      .where(inArray(schema.lookupLogs.responseCacheId, deletableIds));

    await tx
      .delete(schema.responseEdits)
      .where(inArray(schema.responseEdits.responseCacheId, deletableIds));

    return tx
      .delete(schema.responseCache)
      .where(inArray(schema.responseCache.id, deletableIds))
      .returning({ id: schema.responseCache.id });
  });

  return result.length;
}

export interface RecentCacheActivityRow {
  activity: "added" | "edited";
  query: string;
  roleKey: string;
  promptVersion: string;
  createdAt: Date | null;
}

export async function getRecentCacheActivity(limit = 10): Promise<RecentCacheActivityRow[]> {
  const safeLimit = Number.isFinite(limit) ? Math.floor(limit) : 10;
  if (safeLimit <= 0) {
    return [];
  }

  const fetchLimit = Math.min(safeLimit, 100);

  const [addedRows, editedRows] = await Promise.all([
    db
      .select({
        query: schema.responseCache.query,
        roleKey: schema.responseCache.roleKey,
        promptVersion: schema.responseCache.promptVersion,
        createdAt: schema.responseCache.createdAt,
      })
      .from(schema.responseCache)
      .orderBy(desc(schema.responseCache.createdAt))
      .limit(fetchLimit),
    db
      .select({
        query: schema.responseCache.query,
        roleKey: schema.responseCache.roleKey,
        promptVersion: schema.responseCache.promptVersion,
        createdAt: schema.responseEdits.createdAt,
      })
      .from(schema.responseEdits)
      .innerJoin(
        schema.responseCache,
        eq(schema.responseEdits.responseCacheId, schema.responseCache.id),
      )
      .orderBy(desc(schema.responseEdits.createdAt))
      .limit(fetchLimit),
  ]);

  const merged = [
    ...addedRows.map((row) => ({
      activity: "added" as const,
      query: row.query,
      roleKey: row.roleKey,
      promptVersion: row.promptVersion,
      createdAt: row.createdAt,
    })),
    ...editedRows.map((row) => ({
      activity: "edited" as const,
      query: row.query,
      roleKey: row.roleKey,
      promptVersion: row.promptVersion,
      createdAt: row.createdAt,
    })),
  ].sort((a, b) => {
    const timeA = a.createdAt?.getTime() ?? 0;
    const timeB = b.createdAt?.getTime() ?? 0;
    return timeB - timeA;
  });

  return merged.slice(0, limit);
}
