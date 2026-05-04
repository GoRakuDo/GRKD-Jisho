import { db, schema } from "@grkd-jisho/db";
import { redactDeep } from "../utils/redact.js";

type AuditStatus = "success" | "error" | "rejected";

export async function writeMcpAuditLog(params: {
  agentId: string;
  toolName: string;
  args: unknown;
  status: AuditStatus;
  dryRun?: boolean;
  errorMessage?: string;
}): Promise<void> {
  try {
    await db.insert(schema.mcpAuditLogs).values({
      agentId: params.agentId,
      toolName: params.toolName,
      argsJsonRedacted: redactDeep(params.args ?? {}),
      resultStatus: params.status,
      dryRun: params.dryRun ?? false,
      errorMessage: params.errorMessage,
    });
  } catch (error) {
    console.error("[mcp] failed to write audit log", error);
  }
}
