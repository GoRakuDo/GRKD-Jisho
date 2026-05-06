import { z } from "zod";

const envSchema = z.object({
  DATABASE_URL: z.string().min(1),
  MCP_AGENT_ID: z.string().default("external-agent"),
  MCP_READONLY_MODE: z.enum(["true", "false"]).default("true"),
  MCP_ENABLE_DRY_RUN: z.enum(["true", "false"]).default("false"),
  MCP_ENABLE_LIMITED_WRITE: z.enum(["true", "false"]).default("false"),
  MCP_MAX_CACHE_REFRESH_ROWS: z.string().default("100"),
});

const parsed = envSchema.safeParse(process.env);
if (!parsed.success) {
  console.error("[mcp] Invalid environment variables", parsed.error.format());
  process.exit(1);
}

export const env = {
  databaseUrl: parsed.data.DATABASE_URL,
  agentId: parsed.data.MCP_AGENT_ID,
  readOnlyMode: parsed.data.MCP_READONLY_MODE === "true",
  enableDryRun: parsed.data.MCP_ENABLE_DRY_RUN === "true",
  enableLimitedWrite: parsed.data.MCP_ENABLE_LIMITED_WRITE === "true",
  maxCacheRefreshRows: Number(parsed.data.MCP_MAX_CACHE_REFRESH_ROWS) || 100,
};
