# Changelog

## [Unreleased]

### Added

### Fixed

### Changed

- **Reindex pipeline** — Removed the Graphify update step and `graphify-out/` project artifact. Codebase structure indexing is now handled through `codebase-memory-mcp` instead of Graphify.

### Security

### Verification

## [v0.1.1] — 2026-05-18

### Added

- **README.md** — Project overview, architecture, workspace layout, and current pre-release status.
- **Release / deploy toolchain**
  - Added `packages/db` scripts for `db:setup`, `deploy:pg-config`, `deploy:check`, and `env:validate` so PostgreSQL initialization, tuning, preflight checks, and env validation can be run consistently.
  - Reworked `deploy-precheck.sh` / `deploy-precheck.ps1` into a deploy preflight flow centered on `pnpm deploy:check`, covering Docker build, typecheck, MCP safety, Wipe, and env checks.
  - Added `DOCS/Operations/deploy-improvements.md` as the runbook for deploy steps, decision criteria, and safety guards.
- **Bot lookup pipeline**
  - Added `sanitizeLookupQuery` to strip mentions, decorative tags, and ticket numbers before lookup.
  - Added greedy term scanning plus deinflection to strengthen Yomitan-style first-term extraction.
  - Consolidated output bucket routing into two buckets, `daily-japanese` and `indonesian`, and made cache keys bucket-aware.
  - Hardened the LLM path with provider-native reasoning separation, Gemini/OpenRouter timeout-retry handling, reasoning suppression, and Discord character-limit handling.
  - Expanded tracing across `messageCreate` and LLM calls so 403/404/500 failures can be tracked more clearly.
- **Web Admin UI**
  - Added TOTP login / setup / reset flows and replaced the Discord OAuth login flow.
  - Added Role Settings / Role Limits / Role Bindings, with role ID-based mapping and rate-limit editing.
  - Added the prompt version manager with timestamp-based versioning, bucket overrides, baseline display, and a single-pane editor.
  - Added response detail/edit/delete, cache edit modal, cache delete preview, recent cache activity, analytics, and the wipe cockpit.
  - Added the full Yomitan import preview / confirm import flow and strengthened large ZIP handling.
  - Continued UI refinements for the admin layout, login layout, prompt cards, and analytics tables.
- **Operations / observability**
  - Added bot heartbeats, trace logs, log purge, safe ops jobs, and MCP audit logs.
  - Added SQLite analytics aggregation with per-hour text tables, separated from PostgreSQL operational data.
  - Updated the agent runbook, release checklist, pre-release plan, and deploy docs.

### Fixed

- **OAuth callback / login flow** — Fixed the `auth/callback` route location and `redirect_uri` mismatch, and made the cookie `secure` flag conditional on the deployment protocol (HTTP vs HTTPS).
- **Prompt / Dictionaries hydration** — Removed React hydration races by moving parts of PromptEditor and Dictionaries to vanilla JS / direct DOM rendering.
- **Response detail crash** — Fixed the BigInt double-conversion and `JSON.stringify` failures that caused 500s in the response detail API.
- **Analytics correctness** — Fixed stringified aggregates, SQLite path drift, cache hit-rate calculations, and table total mismatches.
- **Cache delete reliability** — Hardened delete ordering, cascade behavior, confirmation flow, and locked-row handling.
- **Import preview reliability** — Added CSRF single-gate handling, path matching fixes, larger ZIP limits, and Yomitan parsing hardening.
- **Migration safety** — Fixed duplicate index handling with `IF NOT EXISTS` so fresh migrations no longer fail.

### Changed

- **Release status** — MCP testing is explicitly deferred and does not block this pre-release.
- **Version metadata** — Bumped the root `package.json` and `packages/{bot,db,web,mcp}/package.json` from `0.0.1` to `0.1.1`.
- **Web UI config** — Moved UI text labels and layout constants out of the DB and into `packages/web/src/config/webui.ts`.
- **Prompt scope UI** — Hid the default scope from the UI and switched to bucket baseline display.
- **Role mapping** — Simplified role mapping from role names to role IDs to match bucket routing.
- **Cache / response safety** — Separated delete protection from manual override so edit intent and delete intent are easier to manage.
- **Auth session TTL** — Extended the auth session lifetime from 8 hours to 7 days.
- **Logging format** — Standardized error logs to the `problem + hint` format.

### Security

- Applied `escapeIdent()` / `escapeLiteral()` to all dynamic SQL to prevent SQL injection.
- Added an `assertAllowedParam()` whitelist for `ALTER SYSTEM SET`.
- Applied explicit guards to dangerous operations: CSRF protection on mutating endpoints, owner-only DM restrictions, delete cascade safeguards, manual override protection, and rate-limit bypass conditions.

### Verification

- Verified the current repository state against `CHANGELOG.md`, `README.md`, `MASTER_PLAN.md`, `ROADMAP.md`, and every `package.json` version.
- Confirmed `0.1.1` matches the root and workspace package versions.
- Reviewed the git history from `v0.1.0..HEAD` and reflected the major commit groups in this release note.

## [v0.1.0] — 2026-05-07

### Added

- Initial pre-release.
- Completed all Phase 0–4 implementation work (Bot MVP / Admin commands / MCP control plane / Web Admin UI / quality optimization).
- Completed Pre-Release gate validation R-1 through R-5.
- Published the GitHub pre-release (`https://github.com/GoRakuDo/GRKD-Jisho/releases/tag/v0.1.0`).
- Verified Docker images for the bot and web packages.
- Passed all 39 unit tests.
- Passed static type checks across 4 packages (db / bot / mcp / web).
- Passed the forbidden-pattern scan (`as any` / `eslint-disable` / `Asia/Bangkok` / `@grkd-` / pure black and white) with 0 hits.

### Notes

- NPM publish was skipped (all packages are `private: true`).
- MCP Level 4 dangerous tools were deferred to Phase 5 TBA.
- Multi-guild support was deferred to Phase 5 TBA.
- Manual validation on a live Discord server remained incomplete; status stayed NOT READY.

---

Format: [Keep a Changelog](https://keepachangelog.com/).
