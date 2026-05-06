import { db, schema } from "@grkd-jisho/db";
import { redactDeep } from "../utils/redact.js";

type AuditStatus = "success" | "error" | "rejected";

/** 単独の監査ログ書き込み（Level 1/2 tool からの呼び出し用） */
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

/**
 * ops_jobs と mcp_audit_logs を同一トランザクションで作成する。
 * Level 3 MCP tool から呼び出す。
 */
export async function createOpsJobWithAudit(params: {
  agentId: string;
  toolName: string;
  jobType: string;
  args: Record<string, unknown>;
  approvalRequired: boolean;
  rawToolArgs: unknown;
}): Promise<{ jobId: string; status: string }> {
  const [result] = await db.transaction(async (tx) => {
    const [job] = await tx
      .insert(schema.opsJobs)
      .values({
        jobType: params.jobType,
        requestedBy: params.agentId,
        argsJson: params.args,
        status: "pending",
        approvalRequired: params.approvalRequired,
      })
      .returning({ id: schema.opsJobs.id });

    if (!job) {
      throw new Error("Failed to create ops job");
    }

    await tx.insert(schema.mcpAuditLogs).values({
      agentId: params.agentId,
      toolName: params.toolName,
      argsJsonRedacted: redactDeep(params.rawToolArgs ?? {}),
      resultStatus: "success",
      dryRun: false,
    });

    return [{ jobId: String(job.id), status: "queued" }];
  });

  return result;
}
