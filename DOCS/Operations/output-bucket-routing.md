# Output Bucket Routing

GRKD-Jisho now routes responses through two output buckets:

- `daily-japanese`
- `indonesian`

## Priority

1. If any bound Discord role ID matches `daily-japanese`, the bot uses daily Japanese output.
2. Otherwise the bot falls back to `indonesian`.
3. If no binding exists at all, the fallback is still `indonesian`.

## Binding model

- One Discord role ID maps to exactly one output bucket.
- One output bucket can have many Discord role IDs.
- Legacy role-key rows are ignored by runtime resolution and can be re-bound manually in the admin UI.

## Impacted surfaces

- Bot role resolution and response cache keys
- Admin role-settings page
- Response / cache / detail labels in Web UI
- Prompt seed and template variable descriptions

## Notes

- The `role_key` cache column name is kept for compatibility, but its meaning is now output bucket routing.
- `indonesian` is the default fallback bucket.
- If role binding rows cannot be loaded from the DB, the bot surfaces an error instead of silently falling back.
