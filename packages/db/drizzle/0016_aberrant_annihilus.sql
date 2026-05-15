ALTER TABLE "prompts" DROP CONSTRAINT "uq_prompts_scope_version";--> statement-breakpoint
ALTER TABLE "response_cache" ADD COLUMN "is_delete_protected" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "lookup_logs" ADD COLUMN "output_bucket_key" text DEFAULT '' NOT NULL;--> statement-breakpoint
ALTER TABLE "lookup_logs" ADD COLUMN "llm_source" text;--> statement-breakpoint
CREATE UNIQUE INDEX "uq_prompts_scope_version" ON "prompts" USING btree ("scope_key","version");