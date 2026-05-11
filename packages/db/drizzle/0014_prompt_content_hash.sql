ALTER TABLE "response_cache" DROP CONSTRAINT "uq_response_cache_key";--> statement-breakpoint
ALTER TABLE "response_cache" ADD COLUMN "prompt_content_hash" text;--> statement-breakpoint
UPDATE "response_cache" SET "prompt_content_hash" = '';--> statement-breakpoint
ALTER TABLE "response_cache" ALTER COLUMN "prompt_content_hash" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "response_cache" ADD CONSTRAINT "uq_response_cache_key" UNIQUE("normalized_query","dictionary_id","dictionary_entry_id","role_key","prompt_version","prompt_content_hash","model_name");
