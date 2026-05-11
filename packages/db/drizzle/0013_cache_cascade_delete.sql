ALTER TABLE "response_edits" DROP CONSTRAINT "response_edits_response_cache_id_response_cache_id_fk";
ALTER TABLE "lookup_logs" DROP CONSTRAINT "lookup_logs_response_cache_id_response_cache_id_fk";

ALTER TABLE "response_edits"
	ADD CONSTRAINT "response_edits_response_cache_id_response_cache_id_fk" FOREIGN KEY ("response_cache_id") REFERENCES "public"."response_cache"("id") ON DELETE cascade ON UPDATE no action;

ALTER TABLE "lookup_logs"
	ADD CONSTRAINT "lookup_logs_response_cache_id_response_cache_id_fk" FOREIGN KEY ("response_cache_id") REFERENCES "public"."response_cache"("id") ON DELETE cascade ON UPDATE no action;
