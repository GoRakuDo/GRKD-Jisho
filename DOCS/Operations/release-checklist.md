# GRKD-Jisho v0.1.0 Release Checklist

> **Status:** Draft / Not signed off  
> **Release candidate:** `v0.1.0`  
> **Scope:** Pre-Release Plan R-1  
> **Important:** このチェックリストは Phase 5 ではない。Phase 5 は Deferred Scope (TBA)。

---

## 1. 判定

現時点では **release candidate 未満**。

理由:

```txt
- 手動検証が未完了
- GitHub / Docker release note が未作成
- NPM公開判断が未記録
- Security release gate が未完了
```

---

## 2. 記入ルール

各項目は必ず `pass / fail / not tested` のどれかで記録する。

```txt
pass       = 実際に確認済み
fail       = 確認して失敗。公開不可
not tested = 未確認。release note に既知の未検証領域として残す
```

`fail` が1つでもある場合、`v0.1.0` は公開しない。

---

## 3. 検証環境

| 項目 | 値 |
|---|---|
| Date | 2026-05-07 |
| Reviewer | AI-assisted local verification |
| Commit SHA | `823beda` (v0.1.0 tag) |
| Node.js | `v24.15.0` local. Docker builds use `node:20-alpine` and passed in R-2 |
| pnpm | `10.33.0` |
| PostgreSQL | PostgreSQL 16 |
| Discord Guild | single guild only |
| Release path | GitHub Release + Docker |
| NPM publish | undecided |

---

## 4. 自動検証

| Check | Command | Status | Notes |
|---|---|---|---|
| DB typecheck | `pnpm --filter @grkd-jisho/db exec tsc --noEmit` | pass | 0 errors |
| Bot typecheck | `pnpm --filter @grkd-jisho/bot exec tsc --noEmit` | pass | 0 errors |
| MCP typecheck | `pnpm --filter @grkd-jisho/mcp exec tsc --noEmit` | pass | 0 errors |
| Web typecheck | `pnpm --filter @grkd-jisho/web typecheck` | pass | 0 errors / 0 warnings / 0 hints |
| Web build | `pnpm --filter @grkd-jisho/web build` | pass | Astro server build complete |
| Bot tests | `pnpm --filter @grkd-jisho/bot test` | pass | 6 files / 39 tests passed |
| Bot Docker build | `docker build -f packages/bot/Dockerfile .` | pass | `grkd-jisho-bot:r2-precheck` build succeeded |
| Web Docker build | `docker build -f packages/web/Dockerfile .` | pass | `grkd-jisho-web:r2-precheck` build succeeded |
| Deploy precheck | `scripts/deploy-precheck.ps1` or `scripts/deploy-precheck.sh` | pass | Windows `deploy-precheck.ps1` exit 0。警告6件: local `.env` 空値と MCP_READONLY_MODE 未設定 |

---

## 5. 手動検証

| Check | Expected result | Status | Evidence / notes |
|---|---|---|---|
| Bot login | Discord Bot が正常に login する | not tested |  |
| Search exact match | term完全一致で検索できる | not tested |  |
| Search reading fallback | reading fallback が動く | not tested |  |
| Cache miss | 初回検索で LLM 生成、または辞書不足回答になる | not tested |  |
| Cache hit | 2回目以降に cache が使われる | not tested |  |
| Manual override | `is_manual_override=true` が最優先される | not tested |  |
| Web OAuth2 | Discord OAuth2 login が通る | not tested |  |
| CSRF | CSRFなしの書き込みが拒否される | not tested |  |
| Response edit history | 編集履歴が `response_edits` に残る | not tested |  |
| Ops approve/reject | `ops_jobs` を approve / reject できる | not tested |  |
| MCP Level 1 | read-only tools が動く | not tested |  |
| MCP Level 2 | dry-run tools が SELECT のみで動く | not tested |  |
| MCP Level 3 | request tools が `ops_jobs` + audit に限定される | not tested |  |
| Bot ops job execution | Bot が許可された job だけ実行する | not tested |  |
| Unknown job_type | `failed` と `error_message` に残る | not tested |  |

---

## 6. Security release gate

| Check | Expected result | Status | Notes |
|---|---|---|---|
| Secret scan | `.env` / token / API key / Discord Bot Token が artifact に入らない | not tested |  |
| MCP default | `MCP_READONLY_MODE=true` がデフォルト | not tested |  |
| MCP Level 3 boundary | `ops_jobs` + `mcp_audit_logs` 経由。直接DB変更しない | not tested |  |
| MCP Level 4 boundary | human approval 必須 | not tested |  |
| Wipe safety | `wipe_enabled=true` のチャンネルのみ、pin保持、24時間範囲、権限チェックあり | not tested |  |
| Manual override protection | `is_manual_override=true` を LLM / refresh / bulk delete で上書き・削除しない | not tested |  |
| Pattern scan | `as any`, `eslint-disable`, `Asia/Bangkok`, `@grkd/`, `grkd.`, pure black/white がコードに残らない | pass | コード/設定ファイル限定scanで全0件。`Asia/Bangkok` は旧timezone残骸検出用 |
| code-reviewer | BLOCKER/HIGH 0件 | pass | R-1 verification review approved. R-2 release prep review approved |

---

## 7. Release note 必須記載

`v0.1.0` release note には必ず以下を書く。

```txt
- v0.1.0 は single guild 前提
- multi-guild は Phase 5 Deferred Scope (TBA)
- NPM公開判断: A. 公開しない（判断記録済み）
- 未検証領域: 本ドキュメント「5. 手動検証」節を参照（全項目 not tested）
- 既知リスク: DOCS/Operations/release-notes-v0.1.0.md「Known risks」節を参照
- Docker / deploy 手順: DOCS/Operations/deploy.md
- Agent runbook: DOCS/Operations/agent-runbook.md
```

---

## 8. NPM公開判断

**A. v0.1.0 では NPM公開しない。**

判断責任者:

```txt
Owner / repository maintainer
```

判断タイミング:

```txt
R-3 Pre-Release Plan 記録時点
```

判断理由:

```txt
- 標準公開経路は GitHub Release + Docker で十分。
- @grkd-jisho/db / @grkd-jisho/mcp は公開候補だが、private: true / mainがsrc参照 / declaration未出力 / pack確認未実施のため、公開形が未整備。
- bot / web はアプリケーションであり NPM公開対象外。
```

---

## 9. Sign-off

| Item | Status |
|---|---|
| 主要自動検証 | pass |
| Docker build / deploy-precheck | pass |
| 手動検証 | not tested |
| `not tested` の release note 記載 | pass |
| GitHub / Docker release 準備 | pass |
| NPM公開判断 | pass (A. 公開しない) |
| Phase 5 deferred scope note | pass |
| Security release gate | not tested |
| code-reviewer BLOCKER/HIGH 0件 | pass |

最終判定:

```txt
NOT READY
```
