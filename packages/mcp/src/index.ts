import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import * as z from "zod/v4";
import { env } from "./config/env.js";
import { writeMcpAuditLog } from "./services/audit.service.js";
import {
  getCacheStats,
  getHealth,
  getLookupStats,
  getRateLimitStatus,
  getRecentErrors,
  getTrace,
  getWipeStatus,
} from "./tools/read-only-tools.js";

type RecentErrorsArgs = { limit: number; level?: "warn" | "error" | undefined };
type LookupStatsArgs = { days: number };
type RateLimitStatusArgs = { user_id?: string | undefined; role_id?: string | undefined };

const server = new McpServer({
  name: "grkd-jisho-mcp",
  version: "0.0.1",
});

async function withAudit<T>(toolName: string, args: unknown, fn: () => Promise<T>): Promise<T> {
  try {
    const result = await fn();
    await writeMcpAuditLog({
      agentId: env.agentId,
      toolName,
      args,
      status: "success",
      dryRun: false,
    });
    return result;
  } catch (error) {
    await writeMcpAuditLog({
      agentId: env.agentId,
      toolName,
      args,
      status: "error",
      dryRun: false,
      errorMessage: error instanceof Error ? error.message : "Unknown MCP tool error",
    });
    throw error;
  }
}

server.registerTool(
  "grkd-jisho.health",
  {
    description: "Return DB/heartbeat/error health snapshot",
    inputSchema: z.object({}),
  },
  async () => {
    const result = await withAudit("grkd-jisho.health", {}, async () => getHealth());
    return {
      content: [{ type: "text", text: JSON.stringify(result) }],
    };
  },
);

server.registerTool(
  "grkd-jisho.recent_errors",
  {
    description: "Return recent warn/error bot events",
    inputSchema: z.object({
      limit: z.number().int().min(1).max(100).default(20),
      level: z.enum(["warn", "error"]).optional(),
    }),
  },
  async (args: RecentErrorsArgs) => {
    const result = await withAudit("grkd-jisho.recent_errors", args, async () => getRecentErrors(args));
    return {
      content: [{ type: "text", text: JSON.stringify(result) }],
    };
  },
);

server.registerTool(
  "grkd-jisho.get_trace",
  {
    description: "Return all events for a trace_id",
    inputSchema: z.object({
      trace_id: z.string().min(1),
    }),
  },
  async (args: { trace_id: string }) => {
    const result = await withAudit("grkd-jisho.get_trace", args, async () => getTrace(args.trace_id));
    return {
      content: [{ type: "text", text: JSON.stringify(result) }],
    };
  },
);

server.registerTool(
  "grkd-jisho.lookup_stats",
  {
    description: "Return lookup statistics in a time window",
    inputSchema: z.object({
      days: z.number().int().min(1).max(30).default(7),
    }),
  },
  async (args: LookupStatsArgs) => {
    const result = await withAudit("grkd-jisho.lookup_stats", args, async () => getLookupStats(args.days));
    return {
      content: [{ type: "text", text: JSON.stringify(result) }],
    };
  },
);

server.registerTool(
  "grkd-jisho.cache_stats",
  {
    description: "Return response_cache statistics",
    inputSchema: z.object({}),
  },
  async () => {
    const result = await withAudit("grkd-jisho.cache_stats", {}, async () => getCacheStats());
    return {
      content: [{ type: "text", text: JSON.stringify(result) }],
    };
  },
);

server.registerTool(
  "grkd-jisho.rate_limit_status",
  {
    description: "Return rate-limit config and today's usage (GMT+7)",
    inputSchema: z.object({
      user_id: z.string().optional(),
      role_id: z.string().optional(),
    }),
  },
  async (args: RateLimitStatusArgs) => {
    const result = await withAudit(
      "grkd-jisho.rate_limit_status",
      args,
      async () => getRateLimitStatus({ userId: args.user_id, roleId: args.role_id }),
    );
    return {
      content: [{ type: "text", text: JSON.stringify(result) }],
    };
  },
);

server.registerTool(
  "grkd-jisho.wipe_status",
  {
    description: "Return wipe-enabled channel settings and recent wipe events",
    inputSchema: z.object({}),
  },
  async () => {
    const result = await withAudit("grkd-jisho.wipe_status", {}, async () => getWipeStatus());
    return {
      content: [{ type: "text", text: JSON.stringify(result) }],
    };
  },
);

async function main(): Promise<void> {
  if (!env.readOnlyMode) {
    throw new Error("MCP_READONLY_MODE must be true in Phase 2");
  }

  const transport = new StdioServerTransport();
  await server.connect(transport);
  console.error("[mcp] grkd-jisho MCP server started on stdio");
}

main().catch((error) => {
  console.error("[mcp] failed to start", error);
  process.exit(1);
});
