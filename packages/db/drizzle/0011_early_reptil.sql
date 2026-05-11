CREATE TABLE "admin_totp_secrets" (
	"id" text PRIMARY KEY DEFAULT 'singleton' NOT NULL,
	"secret" text NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL
);
