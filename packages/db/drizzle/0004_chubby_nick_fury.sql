CREATE TABLE "mcp_audit_logs" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"agent_id" text NOT NULL,
	"tool_name" text NOT NULL,
	"args_json_redacted" jsonb DEFAULT '{}'::jsonb,
	"result_status" text NOT NULL,
	"dry_run" boolean DEFAULT false NOT NULL,
	"error_message" text,
	"created_at" timestamp with time zone DEFAULT now()
);
--> statement-breakpoint
CREATE INDEX "idx_mcp_audit_logs_agent" ON "mcp_audit_logs" USING btree ("agent_id");--> statement-breakpoint
CREATE INDEX "idx_mcp_audit_logs_tool" ON "mcp_audit_logs" USING btree ("tool_name");--> statement-breakpoint
CREATE INDEX "idx_mcp_audit_logs_created_at" ON "mcp_audit_logs" USING btree ("created_at");