import { existsSync, readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { z } from "zod";

export const DEFAULT_LLM_TEMPERATURE = 0.7;
export const DEFAULT_LLM_TOP_P = 0.8;

export const llmModelEntrySchema = z.object({
  id: z.string().min(1),
  priority: z.number().int(),
  baseUrl: z.string().url(),
  apiKeyEnv: z.string().min(1),
  timeoutMs: z.number().int().positive().optional().default(150_000),
  maxAttempts: z.number().int().positive().optional().default(2),
  reasoningEffort: z.enum(["low", "medium", "high"]).optional(),
});

export const modelsConfigSchema = z.object({
  models: z.array(llmModelEntrySchema).min(1),
});

export type LlmModelEntry = z.infer<typeof llmModelEntrySchema>;

function resolveModelsJsonPath(): string {
  const currentDir = dirname(fileURLToPath(import.meta.url));
  const sameDirPath = resolve(currentDir, "models.json");
  if (existsSync(sameDirPath)) return sameDirPath;

  const srcConfigPath = resolve(currentDir, "..", "..", "src", "config", "models.json");
  if (existsSync(srcConfigPath)) return srcConfigPath;

  return sameDirPath;
}

export function loadLlmModels(jsonContent?: string): LlmModelEntry[] {
  try {
    let raw: unknown;
    if (jsonContent !== undefined) {
      raw = JSON.parse(jsonContent);
    } else {
      const filePath = resolveModelsJsonPath();
      const content = readFileSync(filePath, "utf-8");
      raw = JSON.parse(content);
    }

    const parsed = modelsConfigSchema.parse(raw);
    return [...parsed.models].sort((a, b) => a.priority - b.priority);
  } catch (err) {
    console.error(`[Config] models.json load failed: ${err instanceof Error ? err.message : String(err)} → Check packages/bot/src/config/models.json schema (models[].id/priority/baseUrl/apiKeyEnv)`);
    throw err;
  }
}

export const LLM_MODELS: LlmModelEntry[] = loadLlmModels();
