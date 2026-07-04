ALTER TABLE "response_cache" DROP CONSTRAINT "uq_response_cache_key";--> statement-breakpoint
--> Deduplicate: keep only the newest row per 5-column key (model_name removed from constraint)
DELETE FROM "response_cache" WHERE id IN (
  SELECT id FROM (
    SELECT id, ROW_NUMBER() OVER (
      PARTITION BY "normalized_query", "dictionary_id", "dictionary_entry_id", "role_key", "prompt_version"
      ORDER BY "updated_at" DESC
    ) AS rn
    FROM "response_cache"
  ) ranked WHERE rn > 1
);--> statement-breakpoint
ALTER TABLE "response_cache" ADD CONSTRAINT "uq_response_cache_key" UNIQUE("normalized_query","dictionary_id","dictionary_entry_id","role_key","prompt_version");