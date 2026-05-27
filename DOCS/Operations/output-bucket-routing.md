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
- Admin prompts page
- Response / cache / detail labels in Web UI
- Prompt seed and template variable descriptions
- Runtime language guardrails (`DOCS/Design/language-guardrails.md`)

## Notes

- The `role_key` cache column name is kept for compatibility, but its meaning is now output bucket routing.
- `indonesian` is the default fallback bucket.
- If role binding rows cannot be loaded from the DB, the bot surfaces an error instead of silently falling back.
- Prompt admin UI now shows `default`, `daily-japanese`, and `indonesian` scopes separately.
- Bucket-specific prompts are private overrides; the default prompt remains the public baseline.
- `daily-japanese` and `indonesian` have different allowed-language policies at runtime.
- `daily-japanese` may pass when the output stays within the allowed script set (Japanese + Latin + Common/Inherited + whitespace) and no garbage marker appears.
- `indonesian` uses the same allowed script set, plus English stopword ratio ≤ 10%. If validation fails, the bot should ReAsk the same provider twice; if Gemini still fails, it then falls back to OpenRouter, which also gets the same two ReAsk attempts.
