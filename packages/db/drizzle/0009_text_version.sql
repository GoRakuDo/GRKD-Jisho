-- Change version column from pgEnum to text to support timestamp-based labels
-- like "2026-05-09_163045". The old enum "prompt_version" is dropped after conversion.

ALTER TABLE prompts ALTER COLUMN version TYPE text;
DROP TYPE IF EXISTS prompt_version;
