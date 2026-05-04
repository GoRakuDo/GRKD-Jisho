import {
  pgTable, bigserial, text, jsonb, boolean, timestamp, index,
} from "drizzle-orm/pg-core";

export const mcpAuditLogs = pgTable(
  "mcp_audit_logs",
  {
    id: bigserial("id", { mode: "bigint" }).primaryKey(),
    agentId: text("agent_id").notNull(),
    toolName: text("tool_name").notNull(),
    argsJsonRedacted: jsonb("args_json_redacted").default({}),
    resultStatus: text("result_status").notNull(),
    dryRun: boolean("dry_run").notNull().default(false),
    errorMessage: text("error_message"),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow(),
  },
  (table) => [
    index("idx_mcp_audit_logs_agent").on(table.agentId),
    index("idx_mcp_audit_logs_tool").on(table.toolName),
    index("idx_mcp_audit_logs_created_at").on(table.createdAt),
  ],
);

export type McpAuditLog = typeof mcpAuditLogs.$inferSelect;
export type NewMcpAuditLog = typeof mcpAuditLogs.$inferInsert;
