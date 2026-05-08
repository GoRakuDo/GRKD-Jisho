UPDATE "dictionary_entries"
SET "reading" = "term"
WHERE "reading" IS NULL OR "reading" = '';

ALTER TABLE "dictionary_entries"
ALTER COLUMN "reading" SET NOT NULL;
