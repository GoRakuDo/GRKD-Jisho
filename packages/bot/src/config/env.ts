import { z } from "zod";

const envSchema = z.object({
  // Discord
  DISCORD_TOKEN: z.string().min(1),
  DISCORD_CLIENT_ID: z.string().min(1),
  DISCORD_GUILD_ID: z.string().min(1),
  DISCORD_ALLOWED_CHANNELS: z
    .string()
    .min(1)
    .transform((s) => s.split(",").map((id) => id.trim())),

  // Database
  DATABASE_URL: z.string().url(),

  // LLM
  GEMINI_API_KEY: z.string().min(1),
  OPENROUTER_API_KEY: z.string().min(1),

  // Prompt
  PROMPT_VERSION: z.string().default("v1"),

  // Ops
  CACHE_REFRESH_MAX_ROWS: z.coerce.number().int().min(0).max(10000).default(100),
  LOG_RETENTION_DAYS: z.coerce.number().int().min(30).max(365).default(90),

  // Web UI Auth (optional at bot startup)
  DISCORD_CLIENT_SECRET: z.string().optional(),
  SESSION_SECRET: z.string().optional(),
  ADMIN_ROLE_IDS: z
    .string()
    .optional()
    .transform((s) => s?.split(",").map((id) => id.trim()) ?? []),
});

export type Env = z.infer<typeof envSchema>;

function loadEnv(): Env {
  const result = envSchema.safeParse(process.env);
  if (!result.success) {
    console.error("Invalid environment variables:");
    console.error(result.error.flatten().fieldErrors);
    process.exit(1);
  }
  return result.data;
}

export const env = loadEnv();
