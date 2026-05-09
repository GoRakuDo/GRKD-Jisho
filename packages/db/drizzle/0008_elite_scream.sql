CREATE TYPE "public"."prompt_version" AS ENUM('v1', 'v2', 'custom');--> statement-breakpoint
CREATE TABLE "prompts" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"version" "prompt_version" NOT NULL,
	"content" text NOT NULL,
	"is_active" boolean DEFAULT false NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "prompts_version_unique" UNIQUE("version")
);
--> statement-breakpoint
ALTER TABLE "dictionary_entries" ALTER COLUMN "reading" SET NOT NULL;--> statement-breakpoint
CREATE UNIQUE INDEX "uq_dict_entries_dict_term_reading" ON "dictionary_entries" USING btree ("dictionary_id","term","reading");