CREATE TABLE "term_frequencies" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"dictionary_id" integer NOT NULL,
	"expression" text NOT NULL,
	"reading" text,
	"frequency_value" numeric(20, 6) NOT NULL,
	"display_value" text,
	"frequency_mode" text NOT NULL,
	"raw_json" jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now()
);
--> statement-breakpoint
ALTER TABLE "term_frequencies" ADD CONSTRAINT "term_frequencies_dictionary_id_dictionaries_id_fk" FOREIGN KEY ("dictionary_id") REFERENCES "public"."dictionaries"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "idx_term_freq_expression" ON "term_frequencies" USING btree ("expression");--> statement-breakpoint
CREATE INDEX "idx_term_freq_dict_id" ON "term_frequencies" USING btree ("dictionary_id");--> statement-breakpoint
-- 重要: NULLS NOT DISTINCT を必ず含めること。
-- Drizzle 0.41 の snapshot.json は unique().nullsNotDistinct() のフラグを
-- 保存しないため、drizzle-kit generate で再生成するとこのセマンティクスが
-- 失われる可能性がある。次回 schema 変更時は手動で NULLS NOT DISTINCT を
-- 維持するか、`deploy:check` での検証を追加すること。
ALTER TABLE "term_frequencies" ADD CONSTRAINT "uq_term_freq_dict_expression_reading" UNIQUE NULLS NOT DISTINCT("dictionary_id","expression","reading");