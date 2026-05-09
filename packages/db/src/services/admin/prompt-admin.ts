/**
 * Prompt administration services
 *
 * CRUD operations for prompt versions, active version switching,
 * and edit history tracking.
 */

import { db } from "../../client";
import { prompts, type Prompt, type NewPrompt } from "../../schema/prompts";
import { eq, desc } from "drizzle-orm";

/**
 * Get all prompt versions ordered by updatedAt desc
 */
export async function getPromptVersions(): Promise<Prompt[]> {
  return await db.select().from(prompts).orderBy(desc(prompts.updatedAt));
}

/**
 * Get a single prompt version by version label
 */
export async function getPromptByVersion(version: string): Promise<Prompt | undefined> {
  const result = await db.select().from(prompts).where(eq(prompts.version, version as "v1" | "v2" | "custom")).limit(1);
  return result[0] ?? undefined;
}

/**
 * Get the currently active prompt version
 */
export async function getActivePrompt(): Promise<Prompt | undefined> {
  const result = await db.select().from(prompts).where(eq(prompts.isActive, true)).limit(1);
  return result[0] ?? undefined;
}

/**
 * Create or update a prompt version.
 * If isActive is true, deactivates other versions.
 */
export async function upsertPrompt(
  version: string,
  content: string,
  isActive: boolean,
): Promise<Prompt> {
  const existing = await getPromptByVersion(version);

  if (existing) {
    // Update existing version
    const updates: Partial<Prompt> = { content };
    if (isActive) {
      // Deactivate all other versions first
      await db.update(prompts).set({ isActive: false });
      updates.isActive = true;
    }
    const result = await db.update(prompts).set({ ...updates, updatedAt: new Date() }).where(eq(prompts.version, version as "v1" | "v2" | "custom")).returning();
    return result[0] ?? existing;
  }

  // Create new version
  const newPrompt: NewPrompt = {
    version: version as "v1" | "v2" | "custom",
    content,
    isActive,
  };

  if (isActive) {
    // Deactivate all existing versions
    await db.update(prompts).set({ isActive: false });
  }

  const result = await db.insert(prompts).values(newPrompt).returning();
  return result[0]!;
}

/**
 * Switch the active prompt version
 */
export async function setActivePrompt(version: string): Promise<void> {
  // Deactivate all versions
  await db.update(prompts).set({ isActive: false });
  // Activate target version
  await db.update(prompts).set({ isActive: true, updatedAt: new Date() }).where(eq(prompts.version, version as "v1" | "v2" | "custom"));
}
