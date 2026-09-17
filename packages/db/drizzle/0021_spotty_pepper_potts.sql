CREATE TABLE "free_pool_usage" (
	"usage_date" text PRIMARY KEY NOT NULL,
	"count" integer DEFAULT 0 NOT NULL,
	"reserved_count" integer DEFAULT 0 NOT NULL
);
