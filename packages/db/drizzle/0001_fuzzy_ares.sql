CREATE TABLE "bot_events" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"trace_id" text NOT NULL,
	"level" text NOT NULL,
	"event_type" text NOT NULL,
	"guild_id" text,
	"channel_id" text,
	"user_id" text,
	"payload_json" jsonb DEFAULT '{}'::jsonb,
	"duration_ms" integer,
	"created_at" timestamp with time zone DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE "bot_heartbeats" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"service_name" text NOT NULL,
	"instance_id" text NOT NULL,
	"status" text NOT NULL,
	"last_seen_at" timestamp with time zone NOT NULL,
	"metadata_json" jsonb DEFAULT '{}'::jsonb,
	"created_at" timestamp with time zone DEFAULT now(),
	"updated_at" timestamp with time zone DEFAULT now()
);
--> statement-breakpoint
CREATE INDEX "idx_bot_events_trace_id" ON "bot_events" USING btree ("trace_id");--> statement-breakpoint
CREATE INDEX "idx_bot_events_created_at" ON "bot_events" USING btree ("created_at");--> statement-breakpoint
CREATE INDEX "idx_bot_events_level" ON "bot_events" USING btree ("level");