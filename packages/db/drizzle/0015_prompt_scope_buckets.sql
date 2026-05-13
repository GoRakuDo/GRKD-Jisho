ALTER TABLE "prompts" ADD COLUMN "scope_key" text DEFAULT 'default' NOT NULL;--> statement-breakpoint
CREATE INDEX "idx_prompts_scope_updated" ON "prompts" USING btree ("scope_key","updated_at");--> statement-breakpoint
CREATE INDEX "idx_prompts_scope_active" ON "prompts" USING btree ("scope_key","is_active");--> statement-breakpoint
ALTER TABLE "prompts" DROP CONSTRAINT "prompts_version_unique";--> statement-breakpoint
ALTER TABLE "prompts" ADD CONSTRAINT "uq_prompts_scope_version" UNIQUE("scope_key","version");
