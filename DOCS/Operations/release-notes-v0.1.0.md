# GRKD-Jisho v0.1.0 Release Notes (Draft)

> **Status:** Pre-Release Published  
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

multi-guild 対応を含む後倒し項目の一覧は、下記「Deferred scope」節を参照。

### NPM publish

**v0.1.0 では NPM公開しない。**

判断理由:

```txt
- 標準公開経路は GitHub Release + Docker で十分。
- @grkd-jisho/db / @grkd-jisho/mcp は公開候補だが、private: true / mainがsrc参照 / declaration未出力のため、公開形が未整備。
- 公開ニーズが生じた場合は v0.2.0 以降で検討。
```

`packages/bot` と `packages/web` はアプリケーションであり、原則NPM公開しない。

NPM package 公開拡張を含む後倒し項目の一覧は、下記「Deferred scope」節を参照。

### Deferred scope

v0.1.0 で意図的に実装を見送った項目。

| 項目 | 扱い |
|---|---|
| multi-guild 対応 | Phase 5 Deferred Scope (TBA) |
| Guild selector UI | multi-guild 実装後に必要なら検討 |
| NPM package 公開拡張 | 標準経路は GitHub Release + Docker。公開ニーズが生じた場合に v0.2.0 以降で再検討 |
| 複数辞書定義マージ | MVP方針（最初に見つかった1件のみ使用）に反するため、Phase 5 以降で再検討 |

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
- NPM packaging 準備状況は Deferred scope 節「NPM package 公開拡張」を参照
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
4. NPM publish decision is recorded (A. not publish — done)
5. code-reviewer reports BLOCKER/HIGH 0
```
