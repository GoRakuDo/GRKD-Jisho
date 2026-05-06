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
import {
  dryRunCacheRefresh,
  dryRunRateLimitChange,
  dryRunWipe,
} from "./tools/dry-run-tools.js";
import {
  requestCacheRefresh,
  requestUserUsageReset,
  requestRateLimitChange,
  requestToggleWipe,
} from "./tools/write-request-tools.js";

type RecentErrorsArgs = { limit: number; level?: "warn" | "error" | undefined };
type LookupStatsArgs = { days: number };
type RateLimitStatusArgs = { user_id?: string | undefined; role_id?: string | undefined };

const server = new McpServer({
  name: "grkd-jisho-mcp",
  version: "0.0.1",
});

async function withAudit<T>(
  toolName: string,
  args: unknown,
  params: { dryRun: boolean },
  fn: () => Promise<T>,
): Promise<T> {
  try {
    const result = await fn();
    await writeMcpAuditLog({
      agentId: env.agentId,
      toolName,
      args,
      status: "success",
      dryRun: params.dryRun,
    });
    return result;
  } catch (error) {
    await writeMcpAuditLog({
      agentId: env.agentId,
      toolName,
      args,
      status: "error",
      dryRun: params.dryRun,
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
    const result = await withAudit("grkd-jisho.health", {}, { dryRun: false }, async () => getHealth());
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
    const result = await withAudit(
      "grkd-jisho.recent_errors",
      args,
      { dryRun: false },
      async () => getRecentErrors(args),
    );
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
    const result = await withAudit(
      "grkd-jisho.get_trace",
      args,
      { dryRun: false },
      async () => getTrace(args.trace_id),
    );
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
    const result = await withAudit(
      "grkd-jisho.lookup_stats",
      args,
      { dryRun: false },
      async () => getLookupStats(args.days),
    );
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
    const result = await withAudit("grkd-jisho.cache_stats", {}, { dryRun: false }, async () => getCacheStats());
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
      { dryRun: false },
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
    const result = await withAudit("grkd-jisho.wipe_status", {}, { dryRun: false }, async () => getWipeStatus());
    return {
      content: [{ type: "text", text: JSON.stringify(result) }],
    };
  },
);

async function main(): Promise<void> {
  if (env.readOnlyMode) {
    // Read-only mode: Level 1 tools only
    const transport = new StdioServerTransport();
    await server.connect(transport);
    console.error("[mcp] grkd-jisho MCP server started (read-only mode)");
    return;
  }

  // Read-write mode: require dry-run to be enabled before allowing write
  if (!env.enableDryRun) {
    throw new Error("MCP_ENABLE_DRY_RUN must be true when MCP_READONLY_MODE=false");
  }
  // dry-run tools are already registered above via env.enableDryRun guard

  if (env.enableLimitedWrite) {
    registerLevel3Tools();
  }

  const transport = new StdioServerTransport();
  await server.connect(transport);
  console.error("[mcp] grkd-jisho MCP server started (read-write mode)");
}

function registerLevel2Tools(): void {
  server.registerTool(
    "grkd-jisho.dry_run_wipe",
    {
      description: "Dry-run: check wipe settings and recent wipe events (no DB write, no Discord API)",
      inputSchema: z.object({
        guild_id: z.string().min(1),
        channel_id: z.string().min(1),
      }),
    },
    async (args: { guild_id: string; channel_id: string }) => {
      const result = await withAudit(
        "grkd-jisho.dry_run_wipe",
        args,
        { dryRun: true },
        async () => dryRunWipe({ guildId: args.guild_id, channelId: args.channel_id }),
      );
      return { content: [{ type: "text", text: JSON.stringify(result) }] };
    },
  );

  server.registerTool(
    "grkd-jisho.dry_run_rate_limit_change",
    {
      description: "Dry-run: estimate impact of rate limit change (no DB write)",
      inputSchema: z.object({
        role_id: z.string().min(1),
        new_daily_limit: z.number().int().min(-1).max(100000),
        guild_id: z.string().optional(),
      }),
    },
    async (args: { role_id: string; new_daily_limit: number; guild_id?: string | undefined }) => {
      const result = await withAudit(
        "grkd-jisho.dry_run_rate_limit_change",
        args,
        { dryRun: true },
        async () =>
          dryRunRateLimitChange({
            roleId: args.role_id,
            newDailyLimit: args.new_daily_limit,
            guildId: args.guild_id,
          }),
      );
      return { content: [{ type: "text", text: JSON.stringify(result) }] };
    },
  );

  server.registerTool(
    "grkd-jisho.dry_run_cache_refresh",
    {
      description: "Dry-run: estimate cache refresh deletions (manual overrides excluded)",
      inputSchema: z.object({
        normalized_query: z.string().min(1),
        role_key: z.string().optional(),
        dictionary_id: z.number().int().optional(),
      }),
    },
    async (args: { normalized_query: string; role_key?: string | undefined; dictionary_id?: number | undefined }) => {
      const result = await withAudit(
        "grkd-jisho.dry_run_cache_refresh",
        args,
        { dryRun: true },
        async () =>
          dryRunCacheRefresh({
            normalizedQuery: args.normalized_query,
            roleKey: args.role_key,
            dictionaryId: args.dictionary_id,
          }),
      );
      return { content: [{ type: "text", text: JSON.stringify(result) }] };
    },
  );
}

function registerLevel3Tools(): void {
  server.registerTool(
    "grkd-jisho.request_cache_refresh",
    {
      description: "Request a cache refresh job (queues ops_job; manual overrides excluded). Use dry_run_cache_refresh first.",
      inputSchema: z.object({
        normalized_query: z.string().min(1),
        role_key: z.string().optional(),
        dictionary_id: z.number().int().optional(),
        reason: z.string().min(1),
      }),
    },
    async (args: {
      normalized_query: string;
      role_key?: string | undefined;
      dictionary_id?: number | undefined;
      reason: string;
    }) => {
      const result = await withAudit(
        "grkd-jisho.request_cache_refresh",
        args,
        { dryRun: false },
        async () => requestCacheRefresh(args),
      );
      return { content: [{ type: "text", text: JSON.stringify(result) }] };
    },
  );

  server.registerTool(
    "grkd-jisho.request_user_usage_reset",
    {
      description: "Request user usage reset job (queues ops_job; single user only).",
      inputSchema: z.object({
        guild_id: z.string().min(1),
        user_id: z.string().min(1),
        usage_date: z.string().optional(),
        reason: z.string().min(1),
      }),
    },
    async (args: {
      guild_id: string;
      user_id: string;
      usage_date?: string | undefined;
      reason: string;
    }) => {
      const result = await withAudit(
        "grkd-jisho.request_user_usage_reset",
        args,
        { dryRun: false },
        async () => requestUserUsageReset(args),
      );
      return { content: [{ type: "text", text: JSON.stringify(result) }] };
    },
  );

  server.registerTool(
    "grkd-jisho.request_rate_limit_change",
    {
      description: "Request a rate limit change job (requires human approval). Use dry_run_rate_limit_change first.",
      inputSchema: z.object({
        discord_role_id: z.string().min(1),
        daily_limit: z.number().int().min(-1).max(100000),
        role_label: z.string().optional(),
        reason: z.string().min(1),
      }),
    },
    async (args: {
      discord_role_id: string;
      daily_limit: number;
      role_label?: string | undefined;
      reason: string;
    }) => {
      const result = await withAudit(
        "grkd-jisho.request_rate_limit_change",
        args,
        { dryRun: false },
        async () => requestRateLimitChange(args),
      );
      return { content: [{ type: "text", text: JSON.stringify(result) }] };
    },
  );

  server.registerTool(
    "grkd-jisho.request_toggle_wipe",
    {
      description: "Request a wipe toggle job (requires human approval). Use dry_run_wipe first.",
      inputSchema: z.object({
        guild_id: z.string().min(1),
        channel_id: z.string().min(1),
        wipe_enabled: z.boolean(),
        reason: z.string().min(1),
      }),
    },
    async (args: {
      guild_id: string;
      channel_id: string;
      wipe_enabled: boolean;
      reason: string;
    }) => {
      const result = await withAudit(
        "grkd-jisho.request_toggle_wipe",
        args,
        { dryRun: false },
        async () => requestToggleWipe(args),
      );
      return { content: [{ type: "text", text: JSON.stringify(result) }] };
    },
  );
}

main().catch((error) => {
  console.error("[mcp] failed to start", error);
  process.exit(1);
});
