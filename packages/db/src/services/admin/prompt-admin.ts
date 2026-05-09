/**
 * Prompt administration services
 *
 * CRUD operations for prompt versions with auto-generated timestamp labels.
 * Each Save creates a NEW version (e.g. "2026-05-09_163045"),
 * keeping the full edit history. The seed "default" version is
 * never overwritten.
 */

import { db } from "../../client";
import { prompts, type Prompt, type NewPrompt } from "../../schema/prompts";
import { eq, desc } from "drizzle-orm";

/**
 * Generate a human-readable version label from Asia/Jakarta time.
 * Format: "2026-05-09_163045123" (second + millisecond precision to avoid
 * unique constraint collisions when two saves happen in the same second).
 */
export function generateVersionLabel(): string {
  const now = new Date();
  // Use Asia/Jakarta timezone for consistency with bot cron jobs
  const jakarta = new Intl.DateTimeFormat("sv-SE", {
    timeZone: "Asia/Jakarta",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  }).formatToParts(now);

  const parts = Object.fromEntries(jakarta.filter(p => p.type !== "literal").map(p => [p.type, p.value]));
  const base = `${parts.year}-${parts.month}-${parts.day}_${parts.hour}${parts.minute}${parts.second}`;
  const ms = String(now.getMilliseconds()).padStart(3, "0");
  return `${base}${ms}`;
}

/**
 * Get all prompt versions ordered by updatedAt desc
 */
export async function getPromptVersions(): Promise<Prompt[]> {
  return await db.select().from(prompts).orderBy(desc(prompts.updatedAt));
}

/**
 * Get a single prompt version by id
 */
export async function getPromptById(id: string): Promise<Prompt | undefined> {
  const result = await db.select().from(prompts).where(eq(prompts.id, id)).limit(1);
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
 * Create a NEW prompt version with the given content.
 * Always inserts a new row (never overwrites existing versions)
 * so that full edit history is preserved.
 *
 * @param content - Prompt template content
 * @param isActive - Whether to mark this version as active
 * @returns The newly created prompt record
 */
export async function createPrompt(content: string, isActive: boolean): Promise<Prompt> {
  const version = generateVersionLabel();

  const newPrompt: NewPrompt = {
    version,
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
 * Switch the active prompt version by id
 */
export async function setActivePromptById(id: string): Promise<void> {
  // Deactivate all versions
  await db.update(prompts).set({ isActive: false });
  // Activate target version
  await db.update(prompts).set({ isActive: true, updatedAt: new Date() }).where(eq(prompts.id, id));
}
