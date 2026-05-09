ALTER TABLE "prompts" ALTER COLUMN "version" SET DATA TYPE text;--> statement-breakpoint
DROP TYPE "public"."prompt_version";