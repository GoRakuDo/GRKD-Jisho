# Pre-Release Plan — v0.1.0 Public Release Criteria

> **Status:** Draft  
> **Target:** Phase 4 完了後  
> **Release candidate:** `v0.1.0`  
> **Important:** この計画は Phase 5 ではない。Phase 5 は `Deferred Scope (TBA)` として後倒しする。

---

## 1. 目的

この計画は、GRKD-Jisho を `v0.1.0` として公開する前に必要な最終確認を定義する。

公開の基本方針は以下。

```txt
Primary release path: GitHub Release + Docker
NPM publish: 判断事項。必須ではない。
Phase 5 scope: TBAへ後倒し。Pre-Releaseでは実装しない。
```

公開版は、現時点では **single guild 前提** として扱う。
Phase 4 Step J で調査した multi-guild 対応は、Phase 5 `Deferred Scope (TBA)` に送る。

---

## 2. 根拠ファイル

| ファイル | 根拠 |
|---|---|
| `MASTER_PLAN.md` | Section 19: Pre-Release Plan、Section 20: Phase 5 Deferred Scope |
| `ROADMAP.md` | Pre-Release Plan、Phase 5 Deferred Scope、Milestone MR / M5 |
| `DOCS/Roadmap_Implement/phase-4-quality-optimization.md` | Step K 最終検証 / Phase 4 sign-off |
| `DOCS/Operations/multi-guild-assessment.md` | multi-guild を Phase 5 へ送る判定 |
| `DOCS/Operations/deploy.md` | Docker / deploy 手順 |
| `DOCS/Operations/agent-runbook.md` | MCP / agent operation の安全運用手順 |

---

## 3. スコープ

### 3-1. Pre-Releaseでやること

```txt
R-1 Release checklist 作成
R-2 GitHub / Docker release 準備
R-3 NPM公開判断
R-4 Deferred scope note
R-5 Security release gate
```

### 3-2. Pre-Releaseでやらないこと

```txt
multi-guild 実装
Guild selector UI
Phase 5 のNPM package公開拡張
複数辞書定義のマージ
本番Discordで未検証のwipe実験
```

multi-guild は公開前に無理に入れない。
理由は、env / command登録 / Web OAuth2 / MCP stats にまたがる中規模変更であり、公開直前に入れるとリスクが大きいから。

---

## 4. R-1 — Release checklist 作成

### 目的

`v0.1.0` 公開前の手動検証結果を、後から追跡できる形で残す。

### 作成ファイル

```txt
DOCS/Operations/release-checklist.md
```

### 記録する項目

| 項目 | 確認内容 |
|---|---|
| Bot login | Discord Bot が正常に login する |
| Search exact match | term完全一致で検索できる |
| Search reading fallback | reading fallback が動く |
| Cache miss | 初回検索で LLM 生成または不足回答になる |
| Cache hit | 2回目以降に cache が使われる |
| Manual override | `is_manual_override=true` が最優先される |
| Web OAuth2 | Discord OAuth2 login が通る |
| CSRF | CSRFなしの書き込みが拒否される |
| Response edit history | 編集履歴が `response_edits` に残る |
| Ops approve/reject | `ops_jobs` を approve / reject できる |
| MCP Level 1 | read-only tools が動く |
| MCP Level 2 | dry-run tools が SELECT のみで動く |
| MCP Level 3 | request tools が `ops_jobs` + audit に限定される |
| Bot ops job execution | Bot が許可された job だけ実行する |
| Unknown job_type | `failed` と `error_message` に残る |

### 完了基準

- 全項目に `pass / fail / not tested` を記録する。
- `not tested` は release note に既知の未検証領域として残す。
- 失敗項目がある場合、公開しない。

---

## 5. R-2 — GitHub / Docker release 準備

### 目的

NPMではなく、まず GitHub Release と Docker で配布できる形にする。

### 確認コマンド

```txt
pnpm --filter @grkd-jisho/db exec tsc --noEmit
pnpm --filter @grkd-jisho/bot exec tsc --noEmit
pnpm --filter @grkd-jisho/mcp exec tsc --noEmit
pnpm --filter @grkd-jisho/web typecheck
pnpm --filter @grkd-jisho/web build
pnpm --filter @grkd-jisho/bot test
docker build -f packages/bot/Dockerfile .
docker build -f packages/web/Dockerfile .
scripts/deploy-precheck.ps1 または scripts/deploy-precheck.sh
```

### Release note に書くこと

```txt
- v0.1.0 は single guild 前提
- multi-guild は Phase 5 Deferred Scope (TBA)
- NPM公開は判断中、または非公開
- 未検証領域
- 既知リスク
- Docker / deploy 手順へのリンク
```

### 完了基準

- Docker build が bot / web とも成功する。
- deploy-precheck が重大警告なしで完了する。
- release note に single guild 前提と Phase 5 deferred scope が明記される。

---

## 6. R-3 — NPM公開判断

### 判断方針

NPM公開は必須ではない。
`v0.1.0` の標準公開経路は GitHub Release + Docker とする。

NPM公開を検討する場合の候補は以下に限定する。

```txt
@grkd-jisho/db
@grkd-jisho/mcp
```

`packages/bot` と `packages/web` はアプリケーションであり、原則NPM公開しない。

### 判断責任者とタイミング

NPM公開の最終判断は、リリース責任者（Owner / repository maintainer）が行う。

判断タイミングは以下。

```txt
R-2 GitHub / Docker release 準備が通った後
-> R-4 Deferred scope note を release note に書く前
```

理由は、Docker / GitHub Release で十分に配布できるかを先に確認し、その結果を見てから NPM 公開の必要性を判断するため。

### NPM公開する場合の必須条件

| 条件 | 理由 |
|---|---|
| `private: false` | npm publish 可能にするため |
| `main` が `dist` の JS を指す | TypeScript生ファイルを配布しないため |
| `types` が `.d.ts` を指す | TypeScript利用者の型安全のため |
| `exports` / `files` を明示 | 不要ファイルやsecret混入を防ぐため |
| declaration 出力 | 型定義を配布するため |
| `pnpm pack` 確認 | package内容を公開前に検査するため |
| `.env` / secret 混入ゼロ | セキュリティ事故防止 |

### 完了基準

以下のどちらかを release checklist に記録する。

```txt
A. v0.1.0 では NPM公開しない
B. @grkd-jisho/db / @grkd-jisho/mcp のどちらかを公開する。pack内容確認済み
```

---

## 7. R-4 — Deferred scope note

### 目的

公開版で「できること」と「まだやらないこと」を明確にする。

### Release note に明記する後倒し項目

| 項目 | 扱い |
|---|---|
| multi-guild | Phase 5 Deferred Scope (TBA) |
| Guild selector UI | multi-guild 実装後に必要なら検討 |
| NPM package公開拡張 | Pre-Releaseの判断結果次第 |
| 複数辞書定義マージ | MVP方針に反するため Phase 5以降で再検討 |

### 完了基準

- release note に single guild 前提が明記される。
- Phase 5 TBA の項目が公開版の未実装範囲として明記される。

---

## 8. R-5 — Security release gate

### 目的

公開時に危険操作・secret漏洩・手動上書き破壊を起こさない。

### チェック項目

| 項目 | 期待値 |
|---|---|
| secret混入 | `.env` / token / API key / Discord Bot Token が artifact に入らない |
| MCP default | `MCP_READONLY_MODE=true` がデフォルト |
| MCP Level 3 | `ops_jobs` + `mcp_audit_logs` 経由。直接DB変更しない |
| MCP Level 4 | human approval 必須 |
| Wipe safety | `wipe_enabled=true` のチャンネルのみ、pin保持、24時間範囲、権限チェックあり |
| Manual override | `is_manual_override=true` を LLM / refresh / bulk delete で上書き・削除しない |
| Pattern scan | `as any`, `eslint-disable`, `Asia/Bangkok`, `@grkd/`, `grkd.`, pure black/white がコードに残らない |
| Review | code-reviewer で BLOCKER/HIGH 0件 |

### 完了基準

- R-5 の全項目が `pass`。
- code-reviewer が `Approve`。
- BLOCKER/HIGH が1件でもある場合は公開しない。

`Asia/Bangkok` は旧timezone残骸検出用の禁止パターン。
GRKD-Jisho の GMT+7 canonical timezone は `Asia/Jakarta` とする。

---

## 9. 実行順序

```txt
1. Phase 4 Step K の自動検証を再実行
2. release-checklist.md を作成
3. 手動検証を実施
4. GitHub / Docker release note を作成
5. NPM公開する/しないを判断
6. deferred scope note を release note に記載
7. security release gate を通す
8. code-reviewer に最終レビュー依頼
9. BLOCKER/HIGH が0件なら v0.1.0 release candidate とする
```

---

## 10. Sign-off 条件

`v0.1.0` release candidate は、以下をすべて満たした場合だけ作る。

```txt
- Phase 4 Step K 自動検証が pass
- Release checklist が作成済み
- 手動検証の fail が0件
- not tested が release note に明記済み
- GitHub / Docker release 手順が確認済み
- NPM公開判断が記録済み
- Phase 5 deferred scope が release note に明記済み
- Security release gate が pass
- code-reviewer BLOCKER/HIGH 0件
```

---

## 11. 現時点の判定

現時点では、`v0.1.0` は **release candidate 未満**。

理由:

```txt
- release-checklist.md は作成済み
- 主要自動検証は pass: db/bot/mcp typecheck、web typecheck/build、bot tests、pattern scan
- Docker build / deploy-precheck は not tested のまま
- 手動検証が未完了
- release note が未作成
- NPM公開判断が未記録
- security release gate の最終確認が未完了
```

したがって、次の作業は **R-1 checklist の実検証記入** または **R-2 GitHub / Docker release 準備** とする。

---

## 12. 実装ログ

### 12-1. R-1 Release checklist 作成

**Status:** Completed as checklist skeleton / automatic verification partially recorded / manual verification not executed

作成ファイル:

```txt
DOCS/Operations/release-checklist.md
```

内容:

```txt
- 自動検証チェック表
- 手動検証チェック表
- Security release gate
- Release note 必須記載
- NPM公開判断欄
- Sign-off 判定欄
```

判断:

```txt
現時点では NOT READY。
理由は、主要自動検証は pass になったが、手動検証・Docker build・deploy-precheck がまだ not tested のままだから。
```

次の作業:

```txt
1. Bot / Web / MCP の手動検証を実施
2. R-2 GitHub / Docker release 準備へ進む
3. Node 20 LTS / Docker 環境でも確認する
```

### 12-2. R-1 自動検証記録

**Status:** Partial pass / manual verification not executed

実行結果:

```txt
DB typecheck: pass / 0 errors
Bot typecheck: pass / 0 errors
MCP typecheck: pass / 0 errors
Web typecheck: pass / 0 errors, 0 warnings, 0 hints
Web build: pass
Bot tests: pass / 6 files, 39 tests
Pattern scan: pass / as any, eslint-disable, Asia/Bangkok, @grkd/, grkd., pure black/white all 0 in code/config files
code-reviewer: pass / BLOCKER 0, HIGH 0, MED 0, LOW 0
```

注意:

```txt
ローカル実行環境は Node.js v24.15.0。
プロジェクト標準は Node.js 20 LTS のため、Node 20 / Docker 環境での最終確認は R-2 で行う。
```

### 12-3. R-2 GitHub / Docker release 準備

**Status:** Partial pass / release still NOT READY

作成ファイル:

```txt
DOCS/Operations/release-notes-v0.1.0.md
```

修正ファイル:

```txt
.env.example
DOCS/Operations/deploy.md
scripts/deploy-precheck.ps1
scripts/deploy-precheck.sh
scripts/install-dev.ps1
DOCS/Operations/release-checklist.md
```

修正内容:

```txt
- .env.example に v0.1.0 は single guild 前提と明記
- deploy.md の Bot権限一覧を bulkDelete方式に合わせ、clone方式時代の Manage Channels 権限を削除
- deploy-precheck.ps1 の .env / .env.example パスを .\.env / .\.env.example に修正
- deploy-precheck.sh が missing env で `set -e` 終了しないよう `|| true` guard を追加
- install-dev.ps1 の .env / .env.example パスを .\.env / .\.env.example に修正
- v0.1.0 release note draft を作成
```

実行結果:

```txt
bot Docker build: pass
web Docker build: pass
Windows deploy-precheck.ps1: pass / exit 0 / warnings 6
code-reviewer: pass / BLOCKER 0, HIGH 0, MED 0, LOW 0
```

注意:

```txt
deploy-precheck の警告6件は、local .env の Discord/LLM 値が空であることと MCP_READONLY_MODE 未設定によるもの。
これは本番secretをgitに置かないためのローカル状態であり、release前に外部secretで設定する。
Linux/macOS deploy-precheck は未実行。
```

### 12-4. R-3 NPM公開判断

**Status:** Completed — A. v0.1.0 では NPM公開しない

判断根拠:

```txt
1. 標準公開経路（GitHub Release + Docker）で配布可能。
2. @grkd-jisho/db / @grkd-jisho/mcp は公開候補だが、private: true / mainがsrc参照 / declaration未出力 / pack確認未実施。
3. bot / web はアプリケーションであり NPM公開対象外。
```

更新ファイル:

```txt
DOCS/Operations/release-checklist.md
DOCS/Operations/release-notes-v0.1.0.md
```

反映内容:

```txt
- release-checklist.md: NPM公開判断 → pass (A. 公開しない)
- release-notes-v0.1.0.md: 判断理由を追記、条件4をdoneに更新
```
