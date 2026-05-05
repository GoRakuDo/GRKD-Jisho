import { eq, and, or, desc, asc } from "drizzle-orm";
import { db } from "../../index";
import * as schema from "../../schema";
import { adminAuditEvent } from "./audit-utils";

export interface OpsJobRecord {
  id: string;
  jobType: string;
  status: string;
  approvalRequired: boolean;
  argsJson: Record<string, unknown>;
  resultJson: Record<string, unknown>;
  errorMessage: string | null;
  requestedBy: string;
  approvedBy: string | null;
  rejectedBy: string | null;
  createdAt: Date | null;
  approvedAt: Date | null;
  completedAt: Date | null;
}

function mapJob(row: typeof schema.opsJobs.$inferSelect): OpsJobRecord {
  return {
    id: String(row.id),
    jobType: row.jobType,
    status: row.status,
    approvalRequired: row.approvalRequired,
    argsJson: row.argsJson as Record<string, unknown>,
    resultJson: row.resultJson as Record<string, unknown>,
    errorMessage: row.errorMessage,
    requestedBy: row.requestedBy,
    approvedBy: row.approvedBy,
    rejectedBy: row.rejectedBy,
    createdAt: row.createdAt,
    approvedAt: row.approvedAt,
    completedAt: row.completedAt,
  };
}

export async function getPendingJobs(): Promise<OpsJobRecord[]> {
  const rows = await db
    .select()
    .from(schema.opsJobs)
    .where(eq(schema.opsJobs.status, "pending"))
    .orderBy(asc(schema.opsJobs.createdAt));

  return rows.map(mapJob);
}

export async function getAllJobs(limit = 50): Promise<OpsJobRecord[]> {
  const rows = await db
    .select()
    .from(schema.opsJobs)
    .orderBy(desc(schema.opsJobs.createdAt))
    .limit(limit);

  return rows.map(mapJob);
}

export async function approveJob(
  jobId: string,
  approverDiscordId: string,
): Promise<boolean> {
  const numericId = BigInt(jobId);

  const [job] = await db
    .update(schema.opsJobs)
    .set({
      status: "approved",
      approvedBy: approverDiscordId,
    })
    .where(
      and(
        eq(schema.opsJobs.id, numericId),
        eq(schema.opsJobs.status, "pending"),
        eq(schema.opsJobs.approvalRequired, true),
      ),
    )
    .returning({ id: schema.opsJobs.id });

  if (job) {
    await adminAuditEvent("admin.ops_job_approved", {
      jobId,
      approver: approverDiscordId,
    });
    return true;
  }
  return false;
}

export async function rejectJob(
  jobId: string,
  approverDiscordId: string,
): Promise<boolean> {
  const numericId = BigInt(jobId);

  const [job] = await db
    .update(schema.opsJobs)
    .set({
      status: "rejected",
      rejectedBy: approverDiscordId,
    })
    .where(
      and(
        eq(schema.opsJobs.id, numericId),
        eq(schema.opsJobs.status, "pending"),
      ),
    )
    .returning({ id: schema.opsJobs.id });

  if (job) {
    await adminAuditEvent("admin.ops_job_rejected", {
      jobId,
      rejector: approverDiscordId,
    });
    return true;
  }
  return false;
}
