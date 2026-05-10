CREATE TABLE "role_bindings" (
	"id" serial PRIMARY KEY NOT NULL,
	"guild_id" text NOT NULL,
	"discord_role_name" text NOT NULL,
	"system_role_key" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now(),
	"updated_at" timestamp with time zone DEFAULT now(),
	CONSTRAINT "role_bindings_guild_id_discord_role_name_unique" UNIQUE("guild_id","discord_role_name")
);
