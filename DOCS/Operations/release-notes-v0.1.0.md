# GRKD-Jisho v0.1.0 Release Notes (Draft)

> **Status:** Draft / NOT READY  
> **Release type:** GitHub Release + Docker  
> **NPM publish:** TBD  
> **Scope:** single guild only  
> **Phase 5:** Deferred Scope (TBA)

---

## Summary

`v0.1.0` は、GRKD-Jisho の初回公開候補版。

Discord上で辞書検索し、Yomitan辞書DBを根拠に、ロール別の説明を返す Bot と Web Admin UI を含む。

ただし、現時点ではまだ release candidate 未満。
Docker build と Windows deploy-precheck は通ったが、手動検証とNPM公開判断が未完了のため。

---

## Included

```txt
- Discord Bot MVP
- Yomitan dictionary DB importer
- PostgreSQL + Drizzle schema
- response_cache / manual override / edit history
- role-based response generation
- rate limit service
- bulkDelete channel wipe with pinned message preservation
- Slash Command admin operations
- Web Admin UI with Discord OAuth2
- Observability: trace events / heartbeats / logs
- MCP Level 1 read-only tools
- MCP Level 2 dry-run tools
- MCP Level 3 request tools via ops_jobs + audit logs
- Agent runbook
- Dockerfiles for bot and web
- Cross-platform install-dev / deploy-precheck scripts
```

---

## Important limits

### Single guild only

`v0.1.0` は single guild 前提。

multi-guild は Phase 5 Deferred Scope (TBA) に送る。

理由は、multi-guild が以下にまたがる中規模変更だから。

```txt
- env parsing
- Slash Command registration
- Web OAuth2 guild membership check
- MCP stats guild filter
```

公開直前に入れるより、`v0.1.0` 公開後の運用データを見てから進める。

### NPM publish

NPM公開は未判断。

標準の公開経路は GitHub Release + Docker。

NPM公開候補は以下だけ。

```txt
@grkd-jisho/db
@grkd-jisho/mcp
```

`packages/bot` と `packages/web` はアプリケーションなので、原則NPM公開しない。

---

## Not tested yet

```txt
- Bot login in a real Discord guild
- exact match search in Discord
- reading fallback search in Discord
- cache miss / cache hit runtime flow
- manual override priority in runtime UI
- Web OAuth2 real callback flow
- CSRF rejection in browser/API flow
- response edit history through Web UI
- ops job approve / reject through Web UI
- MCP Level 1 / 2 / 3 runtime tool calls
- Bot ops job execution loop
- Real production env values for Discord / LLM / OAuth2
- Linux/macOS deploy-precheck run
```

---

## Known risks

```txt
- Discord bulkDelete 429 handling is not runtime-tested
- BigInt/String conversion in some Drizzle bigserial flows remains lightly tested
- Discord interaction deferUpdate/editReply flow is not runtime-tested
- Yomitan import still needs a real dictionary zip fixture
- NPM packaging is not ready unless R-3 decides to prepare db/mcp packages
```

---

## Deploy docs

```txt
DOCS/Operations/deploy.md
DOCS/Operations/release-checklist.md
DOCS/Operations/agent-runbook.md
DOCS/Roadmap_Implement/pre-release-v0.1.0-public-release.md
```

---

## Release decision

Current status:

```txt
NOT READY
```

Current R-2 verification:

```txt
bot Docker build: pass
web Docker build: pass
Windows deploy-precheck.ps1: pass with 6 warnings
```

Warnings are from local placeholder `.env` values and unset `MCP_READONLY_MODE`.
Production release still needs real secret configuration outside git.

Release can proceed only after:

```txt
1. release-checklist.md has no fail entries
2. not tested items are either verified or listed as known untested scope
3. Docker build and deploy-precheck pass
4. NPM publish decision is recorded
5. code-reviewer reports BLOCKER/HIGH 0
```
