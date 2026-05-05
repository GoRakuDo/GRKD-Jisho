import { pgTable, bigserial, text, jsonb, boolean, timestamp, index } from "drizzle-orm/pg-core";

export const opsJobs = pgTable(
  "ops_jobs",
  {
    id: bigserial("id", { mode: "bigint" }).primaryKey(),
    jobType: text("job_type").notNull(),
    requestedBy: text("requested_by").notNull(),
    argsJson: jsonb("args_json").notNull(),
    status: text("status").notNull().default("pending"),
    // pending / approved / running / succeeded / failed / rejected
    approvalRequired: boolean("approval_required").notNull().default(true),
    approvedBy: text("approved_by"),
    rejectedBy: text("rejected_by"),
    resultJson: jsonb("result_json").default({}),
    errorMessage: text("error_message"),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow(),
    approvedAt: timestamp("approved_at", { withTimezone: true }),
    completedAt: timestamp("completed_at", { withTimezone: true }),
  },
  (table) => [
    index("idx_ops_jobs_status").on(table.status),
    index("idx_ops_jobs_type").on(table.jobType),
  ],
);

export type OpsJob = typeof opsJobs.$inferSelect;
export type NewOpsJob = typeof opsJobs.$inferInsert;
