CREATE TABLE "ops_jobs" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"job_type" text NOT NULL,
	"requested_by" text NOT NULL,
	"args_json" jsonb NOT NULL,
	"status" text DEFAULT 'pending' NOT NULL,
	"approval_required" boolean DEFAULT true NOT NULL,
	"approved_by" text,
	"result_json" jsonb DEFAULT '{}'::jsonb,
	"error_message" text,
	"created_at" timestamp with time zone DEFAULT now(),
	"approved_at" timestamp with time zone,
	"completed_at" timestamp with time zone
);
--> statement-breakpoint
CREATE INDEX "idx_ops_jobs_status" ON "ops_jobs" USING btree ("status");--> statement-breakpoint
CREATE INDEX "idx_ops_jobs_type" ON "ops_jobs" USING btree ("job_type");