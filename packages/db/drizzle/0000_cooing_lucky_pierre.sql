CREATE TABLE "dictionaries" (
	"id" serial PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"slug" text NOT NULL,
	"priority" integer DEFAULT 0 NOT NULL,
	"enabled" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now(),
	CONSTRAINT "dictionaries_name_unique" UNIQUE("name"),
	CONSTRAINT "dictionaries_slug_unique" UNIQUE("slug")
);
--> statement-breakpoint
CREATE TABLE "dictionary_entries" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"dictionary_id" integer NOT NULL,
	"term" text NOT NULL,
	"reading" text,
	"definitions_json" jsonb NOT NULL,
	"tags_json" jsonb DEFAULT '[]'::jsonb,
	"raw_json" jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE "response_cache" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"query" text NOT NULL,
	"normalized_query" text NOT NULL,
	"dictionary_id" integer,
	"dictionary_entry_id" bigint,
	"role_key" text NOT NULL,
	"prompt_version" text NOT NULL,
	"model_name" text NOT NULL,
	"response_text" text NOT NULL,
	"is_manual_override" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now(),
	"updated_at" timestamp with time zone DEFAULT now(),
	CONSTRAINT "uq_response_cache_key" UNIQUE("normalized_query","dictionary_id","dictionary_entry_id","role_key","prompt_version","model_name")
);
--> statement-breakpoint
CREATE TABLE "response_edits" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"response_cache_id" bigint NOT NULL,
	"editor_discord_id" text NOT NULL,
	"before_text" text NOT NULL,
	"after_text" text NOT NULL,
	"reason" text,
	"created_at" timestamp with time zone DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE "lookup_logs" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"guild_id" text NOT NULL,
	"channel_id" text NOT NULL,
	"message_id" text NOT NULL,
	"user_id" text NOT NULL,
	"user_roles_json" jsonb DEFAULT '[]'::jsonb,
	"query" text NOT NULL,
	"normalized_query" text NOT NULL,
	"dictionary_id_used" integer,
	"response_cache_id" bigint,
	"cache_hit" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE "role_rate_limits" (
	"id" serial PRIMARY KEY NOT NULL,
	"discord_role_id" text NOT NULL,
	"role_label" text,
	"daily_limit" integer NOT NULL,
	"created_at" timestamp with time zone DEFAULT now(),
	"updated_at" timestamp with time zone DEFAULT now(),
	CONSTRAINT "role_rate_limits_discord_role_id_unique" UNIQUE("discord_role_id")
);
--> statement-breakpoint
CREATE TABLE "user_usage" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"user_id" text NOT NULL,
	"guild_id" text NOT NULL,
	"usage_date" date NOT NULL,
	"count" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now(),
	"updated_at" timestamp with time zone DEFAULT now(),
	CONSTRAINT "uq_user_usage_day" UNIQUE("user_id","guild_id","usage_date")
);
--> statement-breakpoint
CREATE TABLE "channel_settings" (
	"id" serial PRIMARY KEY NOT NULL,
	"guild_id" text NOT NULL,
	"channel_id" text NOT NULL,
	"wipe_enabled" boolean DEFAULT false NOT NULL,
	"last_wipe_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now(),
	"updated_at" timestamp with time zone DEFAULT now(),
	CONSTRAINT "channel_settings_channel_id_unique" UNIQUE("channel_id")
);
--> statement-breakpoint
ALTER TABLE "dictionary_entries" ADD CONSTRAINT "dictionary_entries_dictionary_id_dictionaries_id_fk" FOREIGN KEY ("dictionary_id") REFERENCES "public"."dictionaries"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "response_cache" ADD CONSTRAINT "response_cache_dictionary_id_dictionaries_id_fk" FOREIGN KEY ("dictionary_id") REFERENCES "public"."dictionaries"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "response_cache" ADD CONSTRAINT "response_cache_dictionary_entry_id_dictionary_entries_id_fk" FOREIGN KEY ("dictionary_entry_id") REFERENCES "public"."dictionary_entries"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "response_edits" ADD CONSTRAINT "response_edits_response_cache_id_response_cache_id_fk" FOREIGN KEY ("response_cache_id") REFERENCES "public"."response_cache"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "lookup_logs" ADD CONSTRAINT "lookup_logs_dictionary_id_used_dictionaries_id_fk" FOREIGN KEY ("dictionary_id_used") REFERENCES "public"."dictionaries"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "lookup_logs" ADD CONSTRAINT "lookup_logs_response_cache_id_response_cache_id_fk" FOREIGN KEY ("response_cache_id") REFERENCES "public"."response_cache"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "idx_dict_entries_term" ON "dictionary_entries" USING btree ("term");--> statement-breakpoint
CREATE INDEX "idx_dict_entries_reading" ON "dictionary_entries" USING btree ("reading");--> statement-breakpoint
CREATE INDEX "idx_dict_entries_dict_id" ON "dictionary_entries" USING btree ("dictionary_id");--> statement-breakpoint
CREATE INDEX "idx_user_usage_date" ON "user_usage" USING btree ("usage_date");--> statement-breakpoint
CREATE INDEX "idx_channel_wipe_enabled" ON "channel_settings" USING btree ("wipe_enabled") WHERE wipe_enabled = true;