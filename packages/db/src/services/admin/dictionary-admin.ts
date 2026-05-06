import { eq, and, asc, count } from "drizzle-orm";
import { db } from "../../index";
import * as schema from "../../schema";

export async function getDictionaryList() {
  return db
    .select()
    .from(schema.dictionaries)
    .orderBy(asc(schema.dictionaries.priority));
}

export async function getDictionaryById(id: number) {
  const [row] = await db
    .select()
    .from(schema.dictionaries)
    .where(eq(schema.dictionaries.id, id))
    .limit(1);
  return row ?? null;
}

export async function setDictionaryEnabled(
  id: number,
  enabled: boolean,
): Promise<void> {
  await db
    .update(schema.dictionaries)
    .set({ enabled })
    .where(eq(schema.dictionaries.id, id));
}

export async function setDictionaryPriority(
  id: number,
  priority: number,
): Promise<void> {
  await db
    .update(schema.dictionaries)
    .set({ priority })
    .where(eq(schema.dictionaries.id, id));
}

export async function getDictionaryEntryCount(dictionaryId: number): Promise<number> {
  const [result] = await db
    .select({ count: count(schema.dictionaryEntries.id) })
    .from(schema.dictionaryEntries)
    .where(eq(schema.dictionaryEntries.dictionaryId, dictionaryId));
  return result ? Number(result.count) : 0;
}
