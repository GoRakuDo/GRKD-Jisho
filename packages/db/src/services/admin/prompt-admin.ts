/**
 * Prompt administration services
 *
 * CRUD operations for prompt versions with auto-generated timestamp labels.
 * "Create New Version" creates a new row; editing an existing version
 * overwrites it (same id). The seed "default" version cannot be deleted.
 */

import { db } from "../../client";
import {
  prompts,
  type Prompt,
  type NewPrompt,
  PROMPT_SCOPE_KEYS,
  PROMPT_SCOPE_LABELS,
  PROMPT_SCOPE_DESCRIPTIONS,
  type PromptScopeKey,
} from "../../schema/prompts";
import { and, desc, eq } from "drizzle-orm";

/**
 * Domain error with a machine-readable code for API routing.
 */
export class PromptDomainError extends Error {
  constructor(message: string, public code: "NOT_FOUND" | "PROTECTED_DELETE") {
    super(message);
    this.name = "PromptDomainError";
  }
}

export type PromptScopeView = {
  scopeKey: PromptScopeKey;
  scopeLabel: string;
  scopeDescription: string;
  versions: Prompt[];
  activePrompt: Prompt | null;
  resolvedPrompt: Prompt | null;
  inheritedFromDefault: boolean;
};

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
export async function getPromptVersions(scopeKey?: PromptScopeKey): Promise<Prompt[]> {
  if (scopeKey) {
    return await db.select().from(prompts).where(eq(prompts.scopeKey, scopeKey)).orderBy(desc(prompts.updatedAt));
  }

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
 * Get the prompt list grouped by scope.
 */
export async function getPromptScopeViews(): Promise<PromptScopeView[]> {
  const versions = await getPromptVersions();
  const defaultActive = versions.find((prompt) => prompt.scopeKey === "default" && prompt.isActive) ?? null;

  return PROMPT_SCOPE_KEYS.map((scopeKey) => {
    const scopeVersions = versions.filter((prompt) => prompt.scopeKey === scopeKey);
    const activePrompt = scopeVersions.find((prompt) => prompt.isActive) ?? null;
    const resolvedPrompt = activePrompt ?? (scopeKey === "default" ? null : defaultActive);

    return {
      scopeKey,
      scopeLabel: PROMPT_SCOPE_LABELS[scopeKey],
      scopeDescription: PROMPT_SCOPE_DESCRIPTIONS[scopeKey],
      versions: scopeVersions,
      activePrompt,
      resolvedPrompt,
      inheritedFromDefault: scopeKey !== "default" && activePrompt === null,
    };
  });
}

/**
 * Get the currently active prompt version
 */
export async function getActivePrompt(): Promise<Prompt | undefined> {
  const result = await db
    .select()
    .from(prompts)
    .where(and(eq(prompts.scopeKey, "default"), eq(prompts.isActive, true)))
    .limit(1);
  return result[0] ?? undefined;
}

/**
 * Get the active prompt for a specific scope, with default fallback.
 */
export async function getActivePromptForScope(scopeKey: PromptScopeKey): Promise<Prompt | undefined> {
  const scoped = await db
    .select()
    .from(prompts)
    .where(and(eq(prompts.scopeKey, scopeKey), eq(prompts.isActive, true)))
    .limit(1);

  if (scoped[0]) {
    return scoped[0];
  }

  if (scopeKey !== "default") {
    return await getActivePrompt();
  }

  return undefined;
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
export async function createPrompt(content: string, isActive: boolean, scopeKey: PromptScopeKey = "default"): Promise<Prompt> {
  const version = generateVersionLabel();

  const newPrompt: NewPrompt = {
    scopeKey,
    version,
    content,
    isActive,
  };

  if (isActive) {
    const result = await db.transaction(async (tx) => {
      await tx.update(prompts).set({ isActive: false }).where(eq(prompts.scopeKey, scopeKey));
      const rows = await tx.insert(prompts).values(newPrompt).returning();
      return rows[0]!;
    });
    return result;
  }

  const result = await db.insert(prompts).values(newPrompt).returning();
  return result[0]!;
}

/**
 * Overwrite an existing prompt version's content and active state.
 * History is preserved by the updatedAt timestamp.
 */
export async function updatePrompt(
  id: string,
  content: string,
  isActive: boolean,
): Promise<Prompt> {
  const existing = await getPromptById(id);
  if (!existing) throw new PromptDomainError(`Prompt not found: ${id}`, "NOT_FOUND");

  if (isActive) {
    return await db.transaction(async (tx) => {
      await tx.update(prompts).set({ isActive: false }).where(eq(prompts.scopeKey, existing.scopeKey));
      const rows = await tx
        .update(prompts)
        .set({ content, isActive, updatedAt: new Date() })
        .where(eq(prompts.id, id))
        .returning();
      if (!rows[0]) throw new PromptDomainError(`Prompt not found: ${id}`, "NOT_FOUND");
      return rows[0];
    });
  }

  const rows = await db
    .update(prompts)
    .set({ content, updatedAt: new Date() })
    .where(eq(prompts.id, id))
    .returning();
  if (!rows[0]) throw new PromptDomainError(`Prompt not found: ${id}`, "NOT_FOUND");
  return rows[0];
}

/**
 * Delete a prompt version by id.
 * The "default" seed version cannot be deleted.
 */
export async function deletePrompt(id: string): Promise<void> {
  const existing = await getPromptById(id);
  if (!existing) {
    throw new PromptDomainError(`Prompt not found: ${id}`, "NOT_FOUND");
  }
  if (existing.scopeKey === "default" && existing.version === "default") {
    throw new PromptDomainError("Cannot delete the default prompt version", "PROTECTED_DELETE");
  }
  await db.delete(prompts).where(eq(prompts.id, id));
}

/**
 * Delete every prompt version in a scope.
 * The default scope is protected.
 */
export async function deletePromptScope(scopeKey: PromptScopeKey): Promise<number> {
  if (scopeKey === "default") {
    throw new PromptDomainError("Cannot delete the default prompt scope", "PROTECTED_DELETE");
  }

  const rows = await db.delete(prompts).where(eq(prompts.scopeKey, scopeKey)).returning({ id: prompts.id });
  return rows.length;
}

/**
 * Switch the active prompt version by id
 */
export async function setActivePromptById(id: string): Promise<void> {
  const existing = await getPromptById(id);
  if (!existing) {
    throw new PromptDomainError(`Prompt not found: ${id}`, "NOT_FOUND");
  }

  await db.transaction(async (tx) => {
    await tx.update(prompts).set({ isActive: false }).where(eq(prompts.scopeKey, existing.scopeKey));
    await tx.update(prompts).set({ isActive: true, updatedAt: new Date() }).where(eq(prompts.id, id));
  });
}
