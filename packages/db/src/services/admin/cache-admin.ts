import { eq, and, count, ilike, inArray } from "drizzle-orm";
import { db } from "../../index";
import * as schema from "../../schema";

export interface CacheStats {
  total: number;
  manualOverride: number;
  deletable: number; // non-manual, can be refreshed
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

  return {
    total,
    manualOverride: manual,
    deletable: total - manual,
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
      updatedAt: schema.responseCache.updatedAt,
    })
    .from(schema.responseCache)
    .where(ilike(schema.responseCache.normalizedQuery, `%${queryText}%`))
    .limit(limit);

  return rows.map((r) => ({ ...r, id: String(r.id) }));
}

export async function bulkDeleteCache(ids: string[]): Promise<number> {
  const numericIds = ids
    .filter((id) => /^\d+$/.test(id))
    .map((id) => BigInt(id));

  if (numericIds.length === 0) return 0;

  const result = await db.transaction(async (tx) => {
    const deletableRows = await tx
      .select({ id: schema.responseCache.id })
      .from(schema.responseCache)
      .where(
        and(inArray(schema.responseCache.id, numericIds), eq(schema.responseCache.isManualOverride, false)),
      );

    if (deletableRows.length === 0) return [] as { id: bigint }[];

    const deletableIds = deletableRows.map((row) => row.id);

    return tx
      .delete(schema.responseCache)
      .where(inArray(schema.responseCache.id, deletableIds))
      .returning({ id: schema.responseCache.id });
  });

  return result.length;
}
