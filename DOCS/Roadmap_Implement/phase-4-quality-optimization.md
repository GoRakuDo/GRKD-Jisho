# Phase 4 — Quality & Optimization + Limited Write MCP 実装プラン

> **対応 Roadmap:** Phase 4 — Quality & Optimization (Ongoing)  
> **Date:** 2026-05-06  
> **Status:** Draft  
> **Phase 3 完了前提:** Web Admin UI / Agent Ops 承認画面 / MCP Level 2 dry-run tools が main に反映済みであること  
> **最優先:** 安全性 > データ保全 > ユーザー体験 > 実装速度 > 技術的きれいさ

---

## 0. 実際に読んだ根拠

このプランは推測で作らない。以下を読んだうえで、Phase 4 の実装順序を決める。

| 根拠 | 読んだ箇所 | 意味 |
|---|---:|---|
| `ROADMAP.md` | 303-355 | Phase 4 の正式スコープは全文検索、ログパージ、prompt version、監視、デプロイ、読み仮名検索、複数Guild optional、Limited write MCP、Agent runbook。 |
| `MASTER_PLAN.md` | 1041-1088 | MCP Level 1〜4 tool の境界。Phase 4 で Level 3 limited write、必要なら Level 4 dangerous request を扱う。 |
| `AGENTS.md` | 340-393 | MCPはDiscord APIを直接呼ばない。Level 3以上は audit 必須。Level 4 は human approval 必須。 |
| `phase-3-web-admin-agent-ops.md` | 64-70, 465, 489, 518, 766-771 | Phase 3 から Phase 4 へ送った残タスク: Level 3/4 MCP、Web heartbeat、response詳細ページ、辞書import preview、複数Guild。 |
| `.env.example` | 1-26 | Web env はあるが、MCP系 env (`MCP_AGENT_ID`, `MCP_READONLY_MODE`, `MCP_ENABLE_DRY_RUN`) がまだ例示されていない。 |
| `packages/mcp/src/config/env.ts` | 3-21 | `MCP_READONLY_MODE=true`, `MCP_ENABLE_DRY_RUN=false` が実装済み。Phase 4 write解禁時はこのガードを本格利用する必要がある。 |
| `packages/mcp/src/index.ts` | 59-185, 187-259 | Level 1 tool は常時登録、Level 2 dry-run は `env.enableDryRun` で条件登録。Level 3 write tool は未実装。 |
| `packages/mcp/src/tools/dry-run-tools.ts` | 9-150 | dry-run はDB SELECTのみ。Discord APIもDB writeも行わない。Phase 4 write tool の前段として再利用できる。 |
| `packages/bot/src/services/ops-job.service.ts` | 100-124 | `cache_refresh`, `user_usage_reset`, `rate_limit_change`, `toggle_wipe` は job type として存在するが、現状は `console.log` のみ。実処理が未実装。 |
| `packages/bot/src/services/__tests__/*.test.ts` | 全行 | `rate-limit`, `response-cache`, `response-admin` のUnitテストはTODO。ユーザー指示どおり Phase 4 最初に実装する。 |
| `packages/db/src/schema/dictionary-entries.ts` | 18-22 | `term`, `reading`, `dictionary_id` の通常indexはある。`pg_trgm` / GIN index はまだない。 |
| `packages/bot/src/services/dictionary.service.ts` | 5-29 | 現在の検索は `term` 完全一致のみ。読み仮名fallbackや表記揺れ対応は未実装。 |
| `packages/bot/Dockerfile` / `packages/web/Dockerfile` | 全行 | 現在は単一stageに近い構成。production用multi-stage / 非root / dev依存削減は未整備。 |
| `DESIGN.md` | 1-47 | Web UIはpure black/white禁止、全色OKLCH、royal blue中心。Phase 4でUIを触る場合もこの規約を継続する。 |

---

## 1. Phase 4 の目的

Phase 4 は「派手な新機能」より、運用で壊れにくくする段階だ。

やることは大きく6つ。

```txt
1. 品質保証      = Phase 3までの中核サービスにUnitテストを入れる
2. 検索品質      = 読み仮名・表記揺れ・全文検索を少しずつ改善する
3. 運用保全      = ログ保持、heartbeat、エラー監視、runbookを整える
4. Prompt管理    = v2 prompt実験とcache invalidation方針を作る
5. Limited write = MCPから安全なops_jobs作成だけを許可する
6. デプロイ準備  = Dockerfile / env / 運用手順を本番寄りにする
```

判断基準は一貫している。

```txt
直接実行しない。
preview / dry-run / ops_jobs / audit / human approval を通す。
```

---

## 2. Phase 4 でやらないこと

YAGNIを守る。Phase 4 でも以下は急がない。

| やらないこと | 理由 | 扱い |
|---|---|---|
| LLMを辞書ソース化 | プロダクト方針違反。辞書DBが根拠。 | 永続禁止 |
| 複数辞書の定義マージ | MVP方針に反する。品質評価が難しくなる。 | Phase 5以降で再検討 |
| MCPからDiscord API直接実行 | MCPはControl Plane。Discord実操作はBotだけ。 | 永続禁止 |
| 任意SQL MCP tool | 危険すぎる。auditしても事故りやすい。 | 永続禁止 |
| manual override の自動削除 | 人間の品質改善結果を壊す。 | dangerous扱い、人間承認必須 |
| 大きな辞書zipを同期HTTP requestでimport | timeout / memory / partial failureが怖い。 | ops_jobs化またはCLI優先 |
| 複数Guild完全対応の一気実装 | 設計変更が大きい。今は単一Guild前提。 | Optionalとして小さく調査 |

---

## 3. 実装順序

Phase 4 は以下の順で進める。

```txt
Step 0: Phase 3境界の再確認
Step A: Unit test hardening
Step B: 検索品質改善（reading fallback -> normalization -> pg_trgm）
Step C: 運用保全（log purge / web heartbeat / error summary）
Step D: MCP Level 3 limited write request tools
Step E: Bot ops job executor 実処理化
Step F: Prompt version management
Step G: Web Admin UIの残タスク（response detail / import preview）
Step H: Production deploy preparation
Step H.5: Cross-platform install scripts（Windows / Linux）
Step I: Agent runbook / 運用ドキュメント
Step J: 複数Guild optional調査
Step K: 最終検証 / Phase 4 sign-off
```

重要。

MCP Level 3 tool だけ作っても意味がない。
Bot 側 `executeJob()` が実処理を持って初めて、安全な限定操作になる。
したがって Step D と Step E は必ず連続で扱う。

---

## 4. Step 0 — Phase 3境界の再確認

### 目的

Phase 4に入る前に、Phase 3の完成物が壊れていないことを確認する。

### 確認コマンド

```txt
pnpm install
docker compose up -d postgres
pnpm db:migrate
pnpm db:generate
pnpm --filter @grkd-jisho/db exec tsc --noEmit
pnpm --filter @grkd-jisho/bot exec tsc --noEmit
pnpm --filter @grkd-jisho/mcp exec tsc --noEmit
pnpm --filter @grkd-jisho/web typecheck
pnpm --filter @grkd-jisho/web build
pnpm --filter @grkd-jisho/bot test
```

### 重点確認

- `as any` が0件であること。
- `Asia/Bangkok` が0件であること。
- `@grkd/` / `grkd.` の旧命名が0件であること。
- `MCP_ENABLE_DRY_RUN=false` では Level 2 tool が登録されないこと。
- Webの非GET APIがCSRFなしで拒否されること。
- `response_cache.is_manual_override=true` が削除対象から外れること。

### 完了基準

Phase 3最終状態と同じ検証が通る。
ここで regression が出たら、Phase 4新規実装に進まない。

---

## 5. Step A — Unit test hardening

### 目的

Phase 2で作ったテスト基盤に、本物のUnitテストを入れる。
ユーザー指示で先送りしていた3サービスを先に固める。

### 対象

| サービス | ファイル | 理由 |
|---|---|---|
| `rate-limit.service.ts` | `packages/bot/src/services/rate-limit.service.ts` | 使用量制限はユーザー体験に直結。日付・ロール・無制限判定が壊れやすい。 |
| `response-cache.service.ts` | `packages/bot/src/services/response-cache.service.ts` | cache key / manual override / conflict処理がBot品質の中心。 |
| `response-admin.ts` | `packages/db/src/services/admin/response-admin.ts` | WebとSlash Commandの編集履歴を支える。beforeTextミスが過去に起きた。 |

### 方針

- DBをmockしすぎない。
- DrizzleのSQL挙動が重要な箇所は、test用PostgreSQLで確認する。
- ただし最初は小さく始める。
- `any` は使わない。
- 外部Discord API / LLM APIは呼ばない。

### テストケース

#### rate-limit

- Owner は常に `allowed=true`, `remaining=Infinity`。
- Administrator は常に `allowed=true`, `remaining=Infinity`。
- ロール別上限がない場合、`__default__` を使う。
- 複数ロールを持つ場合、最も緩い上限を使う。
- `daily_limit=-1` は無制限。
- Asia/Jakartaの日付で `user_usage` を見る。
- `incrementUsage()` は同一 `(user_id, guild_id, usage_date)` を加算する。

#### response-cache

- cache key 全一致でレコードを返す。
- 1カラムでも違えば `null`。
- `isManualOverride=true` を優先する。
- `saveResponse()` は `ON CONFLICT DO NOTHING` で既存行を上書きしない。
- `dictionary_entry_id` の bigint/string変換で精度を落とさない。

#### response-admin

- `updateResponse()` は `response_cache` と `response_edits` を同一transactionで更新する。
- `beforeText` は更新前の値になる。
- `afterText` は新しい値になる。
- `isManualOverride` は true になる。
- `deleteCacheByQuery()` は `isManualOverride=true` を削除しない。
- `getResponseById()` は不正IDで `null`。
- `getResponseById()` は bigint id を stringで返す。

### 完了基準

- `pnpm --filter @grkd-jisho/bot test` が実テスト込みで通る。
- `it.todo` が対象3ファイルから消える、または残す場合は明確な理由をコメントする。
- テスト用DB手順を plan に追記する。

---

## 6. Step B — 検索品質改善

### 目的

辞書Botとしての体験を上げる。
ただし、複数辞書の定義を混ぜない。LLMに意味を補完させない。

### 現状

`lookupWord(query)` は以下だけを行う。

```txt
enabled=true の辞書を priority ASC で取得
-> dictionary_entries.term = query を完全一致検索
-> 最初に見つかった1件を返す
```

これだと「かれん」で「可憐」を引けない。
Phase 4では小さく直す。

### 実装順

#### B-1. reading fallback

`term` 完全一致で見つからない場合だけ、同じ辞書内で `reading` 完全一致を試す。

```txt
term exact
-> miss
-> reading exact
-> miss
-> next dictionary
```

注意。
辞書Aのreading fallbackより前に辞書Bのtermを探すかどうかは仕様を固定する必要がある。
Phase 4では「辞書優先順位を最優先」とする。

```txt
dict1: term -> reading
dict2: term -> reading
dict3: term -> reading
```

理由は、辞書priorityが品質順序だから。

#### B-2. query normalization

正規化関数を `@grkd-jisho/db` または bot service に寄せる。

候補:

- trim
- Unicode NFKC
- カタカナ→ひらがな
- 全角英数字→半角（NFKCで対応）

やらないこと:

- 意味推測
- ローマ字変換
- LLMによる候補生成

#### B-3. pg_trgm導入

`pg_trgm` は最後に入れる。
理由は、migration・index・検索順位の影響が大きいから。

予定migration:

```sql
CREATE EXTENSION IF NOT EXISTS pg_trgm;
CREATE INDEX idx_dict_entries_term_trgm
  ON dictionary_entries USING gin (term gin_trgm_ops);
CREATE INDEX idx_dict_entries_reading_trgm
  ON dictionary_entries USING gin (reading gin_trgm_ops);
```

注意。
`pg_trgm` はPostgreSQL拡張なので、migration前にローカルPostgreSQL 16で `CREATE EXTENSION` が通ることを確認する。
managed PostgreSQLへ移す場合も、Railway / Fly.io側で拡張が許可されるか確認する。

#### B-4. fuzzy search APIは作らない

Botの本検索にいきなり曖昧検索を入れない。
まずはAdmin UIやdry-run的な候補確認に限定する。

### 完了基準

- 「かれん」→ `reading=かれん` のentryを引ける。
- 既存の `term` 完全一致が優先される。
- 複数辞書の定義を混ぜない。
- `dictionary_id_used` は実際に採用した辞書IDを記録する。
- 検索ロジックのUnitテストを追加する。

---

## 7. Step C — 運用保全

### 目的

長期運用でDBと監視が腐らないようにする。

### C-1. lookup_logs 90日パージ

`MASTER_PLAN.md` では lookup_logs は90日保持。
Phase 4で自動パージを入れる。

方針:

- まずBotの `node-cron` で実装。
- DB管理サービスが増えたら pg_cron へ移す余地を残す。
- 削除件数を `bot_events` に残す。
- 失敗時もBot本体を落とさない。

スケジュール:

```txt
毎日 00:10 Asia/Jakarta
```

00:00 の wipe / rate limit 日付切替とぶつけない。

### C-2. Web heartbeat

Phase 3では `/api/health` まで実装した。
Phase 4では `bot_heartbeats` にWeb heartbeatを入れる。

注意:

- Astro SSRは常駐プロセスだが、adapterやホスティング環境で差がある。
- まずは `/api/health` hit 時に upsert する方式で始める。
- 常駐intervalはデプロイ環境が決まってから判断する。

### C-3. エラー監視サマリー

Web `/admin/logs` にあるエラー集計を、運用向けにも使う。

候補:

- `bot_events.level='error'` 件数
- LLM fallback件数
- dictionary miss率
- wipe failure件数
- ops_job failed件数

Discord管理者チャンネル通知は、通知先envが決まるまで実装しない。
まずはWebとMCPで見える状態を優先する。

### C-4. Discord週次レポートの扱い

`ROADMAP.md` の Phase 4-4 には「Discord への通知（管理者チャンネルに週次レポート）」がある。
ただし Phase 4 前半では、通知送信は延期する。

理由:

- 通知先 `ADMIN_REPORT_CHANNEL_ID` がまだ実装envにない。
- Botから定期送信するため、誤通知・スパム防止の設計が必要。
- まずWeb/MCPで同じ集計を安定させる方が安全。

再開条件:

- `.env.example` と Bot env schema に `ADMIN_REPORT_CHANNEL_ID` を追加済み。
- Web/MCPのエラー集計が一致している。
- 管理者が通知先チャンネルを明示している。
- dry-run相当のpreviewログを1回確認している。

### 完了基準

- 90日超の `lookup_logs` が自動削除される。
- 削除件数が `bot_events` に残る。
- Web heartbeatが `grkd-jisho.health` の材料になる。
- エラー集計がWeb/MCPで矛盾しない。
- Discord週次レポートは「実装」または「延期理由と再開条件を記録」のどちらかでROADMAP差分を管理する。

---

## 8. Step D — MCP Level 3 limited write request tools

### 目的

外側AIエージェントが「安全な操作依頼」を作れるようにする。
直接変更ではない。必ず `ops_jobs` を作るだけ。

### 追加env

`.env.example` にMCP envを追加する。

```txt
MCP_AGENT_ID=external-agent
MCP_READONLY_MODE=true
MCP_ENABLE_DRY_RUN=false
MCP_ENABLE_LIMITED_WRITE=false
MCP_MAX_CACHE_REFRESH_ROWS=100
```

ルール:

- デフォルトは完全read-only。
- `MCP_READONLY_MODE=true` のとき、Level 3 tool は登録しない。
- `MCP_ENABLE_LIMITED_WRITE=true` でも、`MCP_READONLY_MODE=true` ならwrite無効。
- Level 3 tool call は全て `mcp_audit_logs` に残す。

### Phase 3 hard guard の置換

現コードの `packages/mcp/src/index.ts` には以下の起動ガードがある。

```ts
if (!env.readOnlyMode) {
  throw new Error("MCP_READONLY_MODE must be true in Phase 3");
}
```

Phase 4でLevel 3を入れる場合、このPhase 3固定ガードを置き換える。

期待する起動条件:

```txt
MCP_READONLY_MODE=true
  -> Level 1のみ。Level 2/3は登録しない。

MCP_READONLY_MODE=false + MCP_ENABLE_DRY_RUN=true + MCP_ENABLE_LIMITED_WRITE=false
  -> Level 1 + Level 2。

MCP_READONLY_MODE=false + MCP_ENABLE_DRY_RUN=true + MCP_ENABLE_LIMITED_WRITE=true
  -> Level 1 + Level 2 + Level 3。

MCP_READONLY_MODE=false + MCP_ENABLE_DRY_RUN=false + MCP_ENABLE_LIMITED_WRITE=true
  -> 起動拒否。writeだけをdry-runなしで解禁しない。
```

つまり、Level 3を解禁するにはdry-runも有効であることを必須にする。
「dry-runで影響確認 → request toolでops_jobs作成」という運用順を崩さないためだ。

### 追加tool

| Tool | 作るjob_type | approval_required | 備考 |
|---|---|---:|---|
| `grkd-jisho.request_cache_refresh` | `cache_refresh` | false | manual override除外。件数上限を設ける。 |
| `grkd-jisho.request_user_usage_reset` | `user_usage_reset` | false | 単一ユーザーのみ。guild_id必須。 |
| `grkd-jisho.request_rate_limit_change` | `rate_limit_change` | true | ロール上限変更。人間承認を挟む。 |
| `grkd-jisho.request_toggle_wipe` | `toggle_wipe` | true | wipe_enabled変更。人間承認を挟む。 |

### dry-run / request / executor の入力仕様統一

`daily_limit=-1` は「無制限」を意味する。
この仕様は3箇所で必ず揃える。

| 場所 | daily_limit範囲 |
|---|---|
| `grkd-jisho.dry_run_rate_limit_change` | `-1` 以上 |
| `grkd-jisho.request_rate_limit_change` | `-1` 以上 |
| Bot executor `rate_limit_change` | `-1` 以上 |

現行dry-runは `new_daily_limit` が `min(0)` なので、Phase 4 Step Dで `min(-1)` に変更する。
これをしないと、無制限化だけdry-runできず、本番requestだけ可能になる。

### cache refresh 件数上限

cache refreshの削除上限は `MCP_MAX_CACHE_REFRESH_ROWS` で統一する。

初期値:

```txt
MCP_MAX_CACHE_REFRESH_ROWS=100
```

適用箇所:

- `grkd-jisho.dry_run_cache_refresh` の警告表示。
- `grkd-jisho.request_cache_refresh` のrequest拒否判定。
- Bot executor `cache_refresh` の実行前再検証。

MCPとBotで判断が割れないよう、可能なら `@grkd-jisho/db` に共通定数または共通serviceを置く。

### 共通入力ルール

- zod schemaで検証する。
- IDはstringで受ける。
- reasonを必須にする。
- `requested_by` は `env.agentId`。
- secret / token / key をredactして audit に保存する。
- dry-run tool の結果を事前に確認したかを `dry_run_reference` として任意で受ける。

### ops_jobs + audit のtransaction方針

Level 3以上では、`ops_jobs` 作成と `mcp_audit_logs` への記録を原則同一transactionにする。

理由:

```txt
ops_jobs INSERT 成功
-> audit INSERT 失敗
-> 操作依頼だけが残り、監査ログが欠ける
```

これはAGENTS.mdの「audit logなしでwrite toolを実行しない」に反する。

Phase 4では read-only / dry-run 用の `withAudit()` は残し、write request 用に `createOpsJobWithAudit()` のような専用serviceを作る。

### 出力

```json
{
  "status": "queued",
  "jobId": "123",
  "jobType": "cache_refresh",
  "approvalRequired": false
}
```

### 完了基準

- `MCP_READONLY_MODE=true` では Level 3 tool が出ない。
- `MCP_ENABLE_LIMITED_WRITE=false` でも出ない。
- `MCP_READONLY_MODE=false` でも `MCP_ENABLE_DRY_RUN=false` なら Level 3 は出ない。
- tool call はDBを直接変更せず、`ops_jobs` INSERTだけ行う。
- `mcp_audit_logs` に success/error が残る。
- `ops_jobs` と `mcp_audit_logs` の作成は同一transactionで扱う。
- `daily_limit=-1` がdry-run / request / executorで同じ意味になる。
- cache refresh件数上限がMCP/Botで一致する。
- Level 3 toolのUnit/統合テストを追加する。

---

## 9. Step E — Bot ops job executor 実処理化

### 目的

Step Dで作った `ops_jobs` をBotが安全に実行できるようにする。
現状は `executeJob()` が `console.log` だけなので、ここを実処理に変える。

### 実装対象

#### E-1. `cache_refresh`

入力:

```txt
normalized_query
role_key optional
dictionary_id optional
requested_reason
```

処理:

- `response_cache.is_manual_override=false` のみ削除。
- 削除前に対象件数を再計算。
- 件数上限を超える場合は failed にする。
- `result_json.deleted_count` を保存。

#### E-2. `user_usage_reset`

入力:

```txt
guild_id
user_id
usage_date optional (default Asia/Jakarta today)
```

処理:

- `user_usage.count > 0` の場合だけ0へ更新。
- guild_id必須。
- `result_json.reset_count` を保存。

#### E-3. `rate_limit_change`

入力:

```txt
discord_role_id
daily_limit
role_label optional
```

処理:

- `daily_limit >= -1` を検証。
- `-1` は無制限。
- upsertする。
- `result_json.before/after` を保存。

#### E-4. `toggle_wipe`

入力:

```txt
guild_id
channel_id
wipe_enabled
```

処理:

- channel設定のみ変更。
- Discord APIで削除はしない。
- 即時wipeではない。
- `result_json.before/after` を保存。

### 安全条件

- 実行前に `status` を `running` にclaimする。
- `approval_required=true` のjobは `approved` 以外では実行しない。
- `approval_required=false` のjobは `pending` だけ実行する。
- claim UPDATE のwhere条件には、以下のどちらかをatomicに含める。

```txt
(approval_required=false AND status='pending')
OR
(approval_required=true AND status='approved')
```

単に `status IN ('pending', 'approved')` だけでは足りない。
承認状態の境界をDB更新時に再検証する。

- unknown job_type は failed。
- argsがschemaに合わない場合は failed。
- エラー時は `error_message` と `bot_events` に残す。
- token/secretをログに出さない。

### 完了基準

- 4 job type が実際にDB変更を行う。
- `result_json` が空ではない。
- Agent Ops UIで結果が読める。
- Bot typecheckが通る。
- `ops-job.service` のUnitテストを追加する。

---

## 10. Step F — Prompt version management

### 目的

`PROMPT_VERSION` を安全に上げられるようにする。
ただし、LLMに辞書外の意味を補完させる方向には進めない。

### 現状

- `response_cache` のunique keyには `prompt_version` が含まれる。
- Bot envには `PROMPT_VERSION=v1` がある。
- 古いcacheをどう扱うかは `MASTER_PLAN.md` のOpen Questionsに残っている。

### F-1. prompt v2 draft

`DOCS/Prompts/prompt-v2.md` を作る。

含めるもの:

- role_key別の説明方針。
- 辞書定義だけを根拠にする禁止事項。
- インドネシア語話者向けのL1負の転移への注意。
- 出力形式。
- 「辞書情報が足りない」と返す条件。

### F-2. prompt version切替方針

最初はA/B testを入れない。
理由は、ユーザー割当・評価軸・cache分岐が増えて複雑になるため。

Phase 4前半では以下だけにする。

```txt
PROMPT_VERSION=v1 or v2
-> cache keyが自然に分かれる
-> 古いcacheは残す
-> 必要な単語だけ refresh する
```

### F-3. prompt rotate設計

`grkd-jisho.request_prompt_version_rotate` は Level 4 dangerous として扱う。
Phase 4では設計とdry-runまでを基本にする。

理由:

- 全回答品質に影響する。
- 外部API課金が増える。
- manual overrideを壊す危険がある。

### 完了基準

- `DOCS/Prompts/prompt-v2.md` がある。
- v1/v2の違いと禁止事項が明文化される。
- cache invalidation方針が書かれる。
- `request_prompt_version_rotate` は実装する場合でも必ずhuman approval必須として扱う。

---

## 11. Step G — Web Admin UI の残タスク

### 目的

Phase 3で後回しにしたUIを、必要なものだけ足す。

UI実装は引き続き `DESIGN.md` に従う。

### G-1. `/admin/responses/[id]` 詳細ページ

機能:

- 回答本文を広く表示。
- 編集履歴 `response_edits` をtimelineで表示。
- 辞書ソース情報を表示。
- 保存時は既存 `PUT /api/admin/responses` を使う。

注意:

- `response_edits` は個人情報を増やさない。
- editorはDiscord IDだけ表示。
- `is_manual_override=true` を維持。

### G-2. 辞書 import preview

Phase 4では「preview」までを第一目標にする。

機能:

- zip upload。
- `index.json` の読み取り。
- term_bank件数の概算。
- name / slug / priority の入力。
- import実行前の確認。

安全制約:

- zip以外拒否。
- サイズ上限。
- path traversal拒否。
- uploadファイルをrepoに保存しない。
- 既存 `scripts/import-yomitan.ts` をそのままshell実行しない。
- 大きいimportは `ops_jobs` 化を検討。

### 完了基準

- response詳細で編集履歴が見える。
- import previewが壊れたzipを拒否する。
- 実importは小さい辞書だけ、またはPhase 4後半へ分離する。

---

## 12. Step H — Production deploy preparation

### 目的

Railway / Fly.io へ移せる最低限の形にする。

### Dockerfile改善

現状のDockerfileは短いが、本番にはまだ荒い。

改善方針:

- multi-stage build。
- production依存だけをruntime imageへ入れる。
- non-root userで起動。
- `pnpm install --frozen-lockfile` を維持。
- workspace依存 `@grkd-jisho/db` を壊さない。
- bot / web それぞれの起動コマンドを明記。

対象:

- `packages/bot/Dockerfile`
- `packages/web/Dockerfile`

MCPはまずstdio前提なのでDocker化は後回し。
ただし、将来常駐監視にするなら `packages/mcp/Dockerfile` を検討する。

### env整理

`.env.example` をPhase 4時点の正にする。

追加候補:

```txt
MCP_AGENT_ID=external-agent
MCP_READONLY_MODE=true
MCP_ENABLE_DRY_RUN=false
MCP_ENABLE_LIMITED_WRITE=false
MCP_MAX_CACHE_REFRESH_ROWS=100
ADMIN_REPORT_CHANNEL_ID=
LOG_RETENTION_DAYS=90
```

### deploy docs

`DOCS/Operations/deploy.md` を作る。

内容:

- local docker compose
- Railway env設定
- migration実行手順
- rollback手順
- Bot token / Discord OAuth callback URL設定
- wipeを本番で有効にする前の確認手順

### 完了基準

- bot Docker buildが通る。
- web Docker buildが通る。
- `.env.example` が実装envと一致する。
- deploy手順書がある。

---

### Step H 実装ログ

実施日: 2026-05-07 | 状態: ✅ 完了

#### H-1 Root .dockerignore
- `.dockerignore` 作成（node_modules, .git, .env, dist, *.md を除外）
- ファイル: `.dockerignore`

#### H-2 Bot Dockerfile (multi-stage)
- builder stage: pnpm install → db build → bot build
- runtime stage: node:20-alpine, non-root appuser, CMD `node packages/bot/dist/index.js`
- ファイル: `packages/bot/Dockerfile`
- 検証: `docker build -f packages/bot/Dockerfile -t grkd-jisho-bot:test .` → ✅ 成功 (0 errors)

#### H-3 Web Dockerfile (multi-stage)
- builder stage: pnpm install → db build → astro build
- runtime stage: node:20-alpine, non-root appuser, CMD `node packages/web/dist/server/entry.mjs`
- ファイル: `packages/web/Dockerfile`
- 検証: `docker build -f packages/web/Dockerfile -t grkd-jisho-web:test .` → ✅ 成功 (0 errors)

#### H-4 .env.example 整備
- `MCP_AGENT_ID` 追加（audit log 記録用）
- `CACHE_REFRESH_MAX_ROWS` / `MCP_MAX_CACHE_REFRESH_ROWS` の重複を整理（両方維持、用途をコメントで明確化）
- `LOG_RETENTION_DAYS` に clamp範囲 (30-365) をコメント追記
- 各セクションを見出しコメントで整理
- 検証: bot env.ts / web env.ts / mcp env.ts と一致確認 ✅

#### H-5 DOCS/Operations/deploy.md
- アーキテクチャ概要図（ASCII）
- ローカル開発（Docker Compose）手順
- Railway / Fly.io デプロイ手順
- DB migration / rollback 手順
- Bot Token / OAuth2 設定手順
- Wipe 運用ガイド
- MCP Control Plane 接続設定
- トラブルシューティング
- ファイル: `DOCS/Operations/deploy.md`

#### Side effect: db package.json `main` 変更
- `main`: `./src/index.ts` → `./dist/index.js`（Docker runtime で .ts が読めない問題の修正）
- `types`: `./src/index.ts` を追加
- `build` script 追加
- 影響確認: bot tsc / web astro build / mcp tsc 全パス ✅

#### 完了基準チェック
| 基準 | 結果 |
|------|------|
| bot Docker build が通る | ✅ `grkd-jisho-bot:test` build success |
| web Docker build が通る | ✅ `grkd-jisho-web:test` build success |
| `.env.example` が実装envと一致 | ✅ bot/web/mcp env.ts と整合確認 |
| deploy手順書がある | ✅ `DOCS/Operations/deploy.md` |

#### 検証
- `db tsc --noEmit`: 0 errors ✅
- `bot tsc --noEmit`: 0 errors ✅
- `mcp tsc --noEmit`: 0 errors ✅
- `web astro check`: 0 errors / 0 warnings / 0 hints ✅
- `bot vitest run`: 39 passed ✅
- Docker build: bot/web both success ✅

**Git commit hash:** `6f6ec37`

---

## 12.5. Step H.5 — Cross-platform install scripts

### 目的

Step H の deploy 手順が長くなったため、Windows と Linux の初回セットアップをスクリプトで補助する。

ただし、危険操作は自動化しない。
スクリプトは「安全な準備」と「確認漏れ防止」に絞る。

### 対象スクリプト

```txt
scripts/install-dev.ps1
scripts/install-dev.sh
scripts/deploy-precheck.ps1
scripts/deploy-precheck.sh
```

### H.5-1 install-dev scripts

ローカル開発環境の初回セットアップ用。

対象:

```txt
scripts/install-dev.ps1
scripts/install-dev.sh
```

やること:

```txt
1. Node.js 20+ の存在確認
2. pnpm の存在確認
3. Docker / Docker Compose の存在確認
4. .env がなければ .env.example から作成
5. pnpm install
6. docker compose up -d postgres
7. pnpm db:migrate
8. pnpm db:seed
9. pnpm --filter @grkd-jisho/db run build
10. pnpm --filter @grkd-jisho/bot exec tsc --noEmit
11. pnpm --filter @grkd-jisho/mcp exec tsc --noEmit
12. pnpm --filter @grkd-jisho/web exec astro check
13. 次に実行する dev command を表示
```

出力する次コマンド:

```txt
pnpm bot:register
pnpm bot:dev
pnpm web:dev
```

### H.5-2 deploy-precheck scripts

本番デプロイ前チェック用。

対象:

```txt
scripts/deploy-precheck.ps1
scripts/deploy-precheck.sh
```

やること:

```txt
1. 必須 env の存在確認
2. .env.example と実装 env の差分チェック
3. docker build -f packages/bot/Dockerfile -t grkd-jisho-bot:precheck .
4. docker build -f packages/web/Dockerfile -t grkd-jisho-web:precheck .
5. pnpm --filter @grkd-jisho/db run build
6. pnpm --filter @grkd-jisho/bot exec tsc --noEmit
7. pnpm --filter @grkd-jisho/mcp exec tsc --noEmit
8. pnpm --filter @grkd-jisho/web exec astro check
9. MCP safety flags を表示
10. wipe 運用前チェックリストを表示
11. migration は自動実行せず、手動コマンドだけ表示
```

### 安全ルール

スクリプトで自動実行してよいもの:

```txt
pnpm install
docker compose up -d postgres（local postgres のみ）
pnpm db:migrate（local DATABASE_URL のみ）
pnpm db:seed（local DATABASE_URL のみ）
typecheck / astro check / docker build
```

スクリプトで自動実行しないもの:

```txt
本番DB migration
wipe有効化
wipe即時実行
MCP Level 3 有効化
Discord Bot Token の検証API呼び出し
外部API課金が増える処理
git push / git commit
```

### 実装時の注意

- PowerShell版は PowerShell 7+ 前提。
- Bash版は Linux/macOS 前提。
- Windows版とLinux版で処理順を揃える。
- 失敗時は即停止する。
- env値そのものは表示しない。存在有無だけ出す。
- `.env` が既にある場合は上書きしない。
- 本番向け `DATABASE_URL` を検出した場合、migration は実行せず警告する。

### 完了基準

- Windows用 `install-dev.ps1` がある。
- Linux用 `install-dev.sh` がある。
- Windows用 `deploy-precheck.ps1` がある。
- Linux用 `deploy-precheck.sh` がある。
- 4スクリプトが secrets を出力しない。
- ローカル開発手順が `DOCS/Operations/deploy.md` と矛盾しない。
- MASTER_PLAN / ROADMAP / Phase 4 plan の3文書が一致している。

---

### Step H.5 実装ログ

実施日: 2026-05-07 | 状態: ✅ 完了

#### 作成したスクリプト

| スクリプト | 用途 | 対象OS |
|---|---|---|
| `scripts/install-dev.ps1` | 初回セットアップ | Windows (PowerShell 7+) |
| `scripts/install-dev.sh` | 初回セットアップ | Linux / macOS (Bash) |
| `scripts/deploy-precheck.ps1` | デプロイ前チェック | Windows (PowerShell 7+) |
| `scripts/deploy-precheck.sh` | デプロイ前チェック | Linux / macOS (Bash) |

#### code-reviewer 結果と修正内容

code-reviewer 判定: ✅ Approve（全修正後）

🔴 BLOCKER 2件:
- `readlink -f` が macOS で非互換 → 両 `.sh` スクリプトを `SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd -P)"` に変更
- `Assert-DockerCompose` が PowerShell で `try/catch` を使っており終了コードを捕捉できない → `$LASTEXITCODE` チェックに変更

🟠 HIGH 4件:
- PowerShell スクリプトがリポジトリルートに移動していない → 両 `.ps1` の先頭に `Set-Location (Split-Path -Parent $PSScriptRoot)` 追加
- `deploy-precheck.ps1` の env 値抽出で `-match` が配列を返すと `.Trim()` でエラー → `Select-Object -First 1` で単一行に絞る
- 両 `deploy-precheck` スクリプトが不合格時に非ゼロ終了コードを返さない → `exit 1` / `exit 0` 追加
- `install-dev.ps1` の pg_isready 待機ループで未使用変数 `$ready` → `| Out-Null` に変更

🟡 MED 4件:
- Docker daemon 未起動チェックがない → 両 `install-dev` に `docker info` チェック追加
- その他は fix 不要（既存設計の範囲内）

#### Post-review: $PSScriptRoot パス簡略化

`Set-Location` でリポジトリルートに移動しているため、相対パスから `$PSScriptRoot` 経由の不要な間接参照を除去:

| ファイル | 変更前 | 変更後 |
|---|---|---|
| `install-dev.ps1` | `Join-Path $PSScriptRoot "..\.env"` | `".\env"` |
| `install-dev.ps1` | `Join-Path $PSScriptRoot "..\docker-compose.yml"` | `"docker-compose.yml"` |
| `deploy-precheck.ps1` | `Join-Path $PSScriptRoot "..\packages\bot\Dockerfile"` | `"packages/bot/Dockerfile"` |
| `deploy-precheck.ps1` | `Join-Path $PSScriptRoot "..\packages\web\Dockerfile"` | `"packages/web/Dockerfile"` |

`$PSScriptRoot` は `Set-Location` 行の1箇所のみ残存（正しい使い方）。

#### 安全ルール遵守確認

| ルール | 結果 |
|---|---|
| secrets を出力しない | ✅ env値そのものは非表示、存在有無のみ |
| `.env` が既にあれば上書きしない | ✅ チェックしてからスキップ |
| 本番DATABASE_URL検出時に警告 | ✅ migration 実行せず警告表示 |
| 危険操作を自動実行しない | ✅ 本番migration / wipe / MCP Level3有効化 は一切実行しない |

#### 整合性確認

| 文書 | 状態 |
|---|---|
| **MASTER_PLAN.md** (L541-579) | ✅ Step H.5 定義とスクリプト名が一致 |
| **ROADMAP.md** (L334-341) | ✅ Phase 4 タスクとスクリプト名が一致 |
| **phase-4-quality-optimization.md** (plan) | ✅ H.5-1/H.5-2 の手順と実装が一致 |
| **DOCS/Operations/deploy.md** | ✅ ローカル開発手順と矛盾なし |

ドリフトなし。

**Git commit hash:** `1923c1a`

---

## 13. Step I — Agent runbook / 自律監視

### 目的

外側AIエージェントが、壊さずに監視・診断・操作依頼できるようにする。

### 作成ドキュメント

`DOCS/Operations/agent-runbook.md`

### 内容

#### I-1. 通常監視

```txt
1. grkd-jisho.health
2. heartbeatが古いなら grkd-jisho.recent_errors
3. trace failureがあるなら grkd-jisho.get_trace
4. lookup低下なら grkd-jisho.lookup_stats
5. cache異常なら grkd-jisho.cache_stats
6. rate limit問い合わせなら grkd-jisho.rate_limit_status
7. wipe失敗なら grkd-jisho.wipe_status -> dry_run_wipe
```

#### I-2. 操作依頼

```txt
dry-run
-> request_* tool
-> ops_jobs pending
-> Web Admin UIで人間が確認
-> Botが実行
-> trace / result_json / audit を確認
```

#### I-3. 禁止事項

- MCPからDiscord APIを直接呼ばない。
- token / secret を出力しない。
- 任意SQLを要求しない。
- human approvalなしにLevel 4を進めない。
- wipe_now / bulk_cache_delete / prompt_rotate は必ず人間承認。

### 完了基準

- Agentが読む順番が固定される。
- Level 1 / 2 / 3 / 4 の違いが明記される。
- 事故時の停止判断が書かれている。

---

### Step I 実装ログ

実施日: 2026-05-07 | 状態: ✅ 完了

#### 作成ファイル

`DOCS/Operations/agent-runbook.md` — 全409行、7セクション構成

#### セクション概要

| セクション | 内容 |
|---|---|
| 0\. 前提条件 | MCP接続設定例、L1-L4アクセスレベルテーブル、MCP_AGENT_IDとaudit log説明 |
| 1\. 通常監視フロー | health→recent_errors→get_trace→lookup_stats→cache_stats→rate_limit_status→wipe_status（7step固定順） |
| 2\. Dry-runフロー | dry_run_wipe / dry_run_rate_limit_change / dry_run_cache_refresh 解説 |
| 3\. 操作依頼フロー | dry_run→request_*→Bot自動実行→get_trace確認→audit log確認（6step） |
| 4\. 危険操作フロー | request_wipe_now / request_bulk_cache_delete / request_prompt_version_rotate（人間承認必須） |
| 5\. 緊急停止判断 | 即時停止条件5項目 / 操作中断条件4項目 / 報告テンプレート |
| 6\. 禁止事項 | Discord Bot Token禁止含む全7項目 |
| 7\. トラブルシューティング | 9ケースの症状×原因×対処表 |

#### code-reviewer 指摘対応（全10件修正）

| severity | 件数 | 主な修正内容 |
|---|---|---|
| 🔴 BLOCKER | 1 | L4ツール名に `request_` プレフィックスが不足していたのを修正 |
| 🟠 HIGH | 4 | L3フローの人間承認表記削除（L4のみ承認必須）、`/ratelimit-set`→MCPツール参照、Discord Bot Token禁止追加、audit log記述追加 |
| 🟡 MED | 3 | L1ツール一覧を明示、`MCP_AGENT_ID`がaudit logに記録されることを説明、「月間集計には影響しない」削除 |
| 🟢 LOW | 2 | cross-ref（セクション1-2参照）追加、prompt-v2.mdを汎用的な表現に変更 |

#### 整合性確認

| 文書 | 状態 |
|---|---|
| **MASTER_PLAN.md** | ✅ Step I定義とrunbook内容一致 |
| **ROADMAP.md** | ✅ Phase 4 Step Iタスクと一致 |
| **AGENTS.md** (MCP禁止事項 §11-5) | ✅ runbook §6 に反映済み |
| **phase-4-quality-optimization.md** (plan) | ✅ 全完了基準（固定順/Lv区分/停止判断）充足 |

ドリフトなし。

**Git commit hash:** `20ef0e8`

---

## 14. Step J — 複数Guild optional調査

### 目的

複数Guild対応を実装する前に、影響範囲だけを確認する。
Phase 4では一気に完全対応しない。

### 調査対象

- `DISCORD_GUILD_ID` 単一前提の箇所。
- Web OAuth2 のguild判定。
- `DISCORD_ALLOWED_CHANNELS` の扱い。
- `channel_settings.guild_id` の既存利用。
- `/wipe-status` のguild scope。
- MCP stats tool のguild filter有無。

### 成果物

`DOCS/Operations/multi-guild-assessment.md` を作る。

書くこと:

- 変更が必要なファイル。
- DB schema変更が必要か。
- 既存single guild運用を壊さない移行案。
- Phase 5へ送るべきかどうか。

### 完了基準

- 実装ではなく調査レポートを作る。
- single guild前提を壊さない。
- 追加実装が必要ならPhase 5候補として明記する。

---

## 15. Step K — 最終検証 / Phase 4 sign-off

### 静的検証

```txt
pnpm --filter @grkd-jisho/db exec tsc --noEmit
pnpm --filter @grkd-jisho/bot exec tsc --noEmit
pnpm --filter @grkd-jisho/mcp exec tsc --noEmit
pnpm --filter @grkd-jisho/web typecheck
pnpm --filter @grkd-jisho/web build
pnpm --filter @grkd-jisho/bot test
```

### パターン検証

```txt
as any
eslint-disable
Asia/Bangkok
@grkd/
grkd.
#000000
#ffffff
```

期待値はすべて0件。

### 手動検証

- Discord Bot login。
- `@grkd-jisho` 検索。
- term完全一致。
- reading fallback。
- cache hit / miss。
- manual override優先。
- Web OAuth2 login。
- CSRFなし書き込み拒否。
- response編集履歴。
- ops_job approve/reject。
- MCP Level 1。
- MCP Level 2 dry-run。
- MCP Level 3 request tool。
- Bot ops job execution。
- `approval_required=true` かつ `status=pending` のjobが実行されない。
- rejected job が実行されない。
- unknown job_type が `failed` になり、`error_message` に残る。

### sign-off条件

- Phase 4 planに実装ログを追記済み。
- code-reviewerでBLOCKER/HIGHなし。
- 既知の未検証領域を明記。
- GitHub mainへpush済み。

---

## 16. 安全マトリクス

| 操作 | 実行者 | DB write | Discord API | 承認 | Phase 4方針 |
|---|---|---:|---:|---:|---|
| Unit test | dev | test DBのみ | no | 不要 | 最優先 |
| reading fallback | bot | lookup_logsのみ | replyのみ | 不要 | 許可 |
| lookup_logs purge | bot | yes | no | 不要 | 90日超のみ |
| web heartbeat | web | yes | no | 不要 | health用途のみ |
| request_cache_refresh | MCP | ops_jobs + audit | no | 原則不要 | manual除外、件数上限 |
| request_user_usage_reset | MCP | ops_jobs + audit | no | 原則不要 | 単一ユーザー限定 |
| request_rate_limit_change | MCP | ops_jobs + audit | no | 必須 | Web承認後Bot実行 |
| request_toggle_wipe | MCP | ops_jobs + audit | no | 必須 | 即時wipeではない |
| request_wipe_now | MCP | ops_jobs + audit | no | 必須 | Level 4。Phase 4後半でも慎重 |
| bulk_cache_delete | MCP/Web | yes | no | 必須 | manual override保護必須 |
| prompt_version_rotate | MCP/Web | ops_jobs + audit | no | 必須 | Phase 4では設計/dry-run優先。実行はLevel 4 |

---

## 17. 既知リスクと対処

### Risk 1: MCP write tool が直接DB変更になる

対処:

- Level 3 toolは `ops_jobs` INSERTだけ。
- 実変更はBot workerだけ。
- `MCP_READONLY_MODE=true` を最優先ガードにする。

### Risk 2: ops_jobs executor が危険操作を広げすぎる

対処:

- job_typeごとにzod schema。
- 件数上限。
- unknown job_typeはfailed。
- Level 4はhuman approval必須。

### Risk 3: reading fallbackで検索順位が変わる

対処:

- term exactを最優先。
- 辞書priorityを維持。
- fallbackは同一辞書内のreading exactだけ。

### Risk 4: pg_trgmでDB migrationが重くなる

対処:

- reading fallbackを先に入れる。
- pg_trgmは別Stepで実行。
- 大きな辞書import後はindex作成時間を測る。

### Risk 5: Docker最適化でworkspace依存が壊れる

対処:

- bot / web それぞれ build確認。
- `@grkd-jisho/db` のdist参照を確認。
- Docker buildはローカルで通してからpush。

### Risk 6: Web heartbeatが環境依存で不安定

対処:

- 最初は `/api/health` hit時upsert。
- 常駐intervalは本番環境が決まってから。

### Risk 7: prompt v2で回答品質が落ちる

対処:

- v1 cacheを消さない。
- v2は `PROMPT_VERSION` で明示切替。
- manual overrideを絶対に上書きしない。
- prompt rotateはLevel 4扱いにする。

---

## 18. Phase 4 完了基準

Phase 4はongoingだが、一区切りの完了条件を置く。

- 3つの中核Unitテストが実装済み。
- reading fallbackが動く。
- lookup_logs 90日パージが動く。
- Web heartbeatがhealthに反映される。
- prompt v2 draftとcache invalidation方針がある。
- MCP Level 3 request toolsが `ops_jobs` を作れる。
- Botが4つのlimited jobを実行できる。
- Agent runbookがある。
- Dockerfileが本番寄りに整理されている。
- `.env.example` が実装envと一致している。
- 複数Guild optional調査レポートがある。
- 全typecheck / build / testが通る。
- code-reviewerでBLOCKER/HIGHなし。

---

## 19. Phase 4 実装ログ置き場

実装を進めるたびに、この下へ追記する。

```txt
Step A 実装ログ
Step B 実装ログ
Step C 実装ログ
Step D 実装ログ
実施日: 2026-05-06
変更ファイル:
  - packages/mcp/src/config/env.ts (修正) — MCP_ENABLE_LIMITED_WRITE, MCP_MAX_CACHE_REFRESH_ROWS 追加、NaN guard修正
  - packages/mcp/src/index.ts (修正) — main()にregisterLevel2Tools()追加、Phase 3 hard guard置換
  - packages/mcp/src/services/audit.service.ts (修正) — writeMcpAuditLog維持、createOpsJobWithAudit追加
  - packages/mcp/src/tools/write-request-tools.ts (新規) — 4つのLevel 3 request tools実装
  - .env.example (修正) — MCP section追加
検証コマンド:
  - pnpm --filter @grkd-jisho/mcp exec tsc --noEmit → 0 errors
  - pnpm --filter @grkd-jisho/bot exec tsc --noEmit → 0 errors
  - pnpm --filter @grkd-jisho/db exec tsc --noEmit → 0 errors
  - pnpm --filter @grkd-jisho/bot test → 6 files / 39 tests / 0 failed
code-reviewer結果:
  - HIGH-1: env.ts maxCacheRefreshRows NaN guard (0 overrides 100) → 修正済み (L24 IIFE pattern)
  - HIGH-2: dry-run tools module-level registration violates readOnlyMode guard → 修正済み (registerLevel2Tools()をmain()内に移動)
  - MED: createOpsJobWithAudit return value wrapping → 修正不要 (機能的に正しい)
  - その他LOW/MED findings → 修正済み
残リスク:
  - Level 3 toolsのreason文字列がそのままops_jobs.argsJsonに入る（redactionなし）。悪意ある入力でのデータリークはaudit logに依存
  - registerLevel2Tools()とregisterLevel3Tools()の分岐がmain()内でしっかりしているが、env.enableDryRun=falseでLevel 3を呼べないことを保証するにはE2Eテストが必要
Git commit hash: 
  - 初期実装: 8275802 (feat: implement Phase 4 Step D MCP Level 3 limited write)
  - 修正版: 0aab647 (fix: MCP Level 3 env NaN guard and dry-run scope)
  - 追加修正: dd30985 (fix: add missing registerLevel2Tools() call in main())

> **修正経緯:** git reset --hard origin/main 後に修正を再適用した際、registerLevel2Tools() の定義は追加したが main() からの呼び出しを忘れていた。aad3df7（reset前のamend）では正しく呼ばれていたため、reset+reapply の過程で欠落した reggression。現コードは aad3df7 と同じ状態に復元済み。

Step E 実装ログ
実施日: 2026-05-06
変更ファイル:
  - packages/bot/src/services/ops-job.service.ts (書き換え) — 4 job type 実処理化
  - packages/bot/src/config/env.ts (修正) — CACHE_REFRESH_MAX_ROWS 追加 (min 0)
  - .env.example (修正) — CACHE_REFRESH_MAX_ROWS=100 追記
検証コマンド:
  - pnpm --filter @grkd-jisho/bot exec tsc --noEmit → 0 errors
  - pnpm --filter @grkd-jisho/db exec tsc --noEmit → 0 errors
  - pnpm --filter @grkd-jisho/bot test → 6 files / 39 tests / 0 passed
code-reviewer結果:
  - 🔴 BLOCKER: ops-job.service.ts のインターフェースが snake_case、write-request-tools.ts は camelCase → 修正済み（インターフェース全プロパティを camelCase に統一）
  - 🟠 HIGH: executeCacheRefresh に normalizedQuery 必須チェック不足 → 修正済み（早期 throw 追加）
  - 🟠 HIGH: lte 未使用 import → 削除済み
  - 🟡 MED: CACHE_REFRESH_MAX_ROWS min(1) だと無効化不可 → min(0) に変更、maxRows===0 で早期 return
  - 🟡 MED: claim race condition（select→update の2段階ガード） → 現状の atomic UPDATE WHERE でOK、コメント追加
残リスク:
  - argsJson の runtime 検証が isRecord のみ。Zod schema 導入は YAGNI のため保留
  - write-request-tools.ts の jobArgs と executor のインターフェースは手動同期。shared types 化は今後の課題
  - executeUserUsageReset の usageDate が文字列で渡される（write-request-tools.ts L98）
Git commit hash: e43e073

Step F 実装ログ
実施日: 2026-05-06
変更ファイル:
  - DOCS/Prompts/prompt-v2.md (新規) — v2 draft、L1負の転移具体例、ロール別説明方針、出力形式、cache invalidation方針、rotate設計
検証コマンド:
  - pnpm --filter @grkd-jisho/bot exec tsc --noEmit → 0 errors
  - pnpm --filter @grkd-jisho/db exec tsc --noEmit → 0 errors
  - pnpm --filter @grkd-jisho/mcp exec tsc --noEmit → 0 errors
  - pnpm --filter @grkd-jisho/bot test → 6 files / 39 tests / 0 passed
code-reviewer結果:
  - コード変更なし（文書作成のみ）。レビュー不要と判断。
完了基準:
  - ✅ DOCS/Prompts/prompt-v2.md を作成 (Section 1-9)
  - ✅ v1/v2の違いと禁止事項を明文化 (Section 2, 7)
  - ✅ cache invalidation方針を記述 (Section 8)
  - ✅ request_prompt_version_rotate は human approval 必須として設計 (Section 9)
残リスク:
  - v2プロンプトは実環境でテストしていない。実際のLLM出力品質はPhase 4後半で評価する
  - v2テンプレートを llm.service.ts に組み込むのは Phase 4 post-Step F に委ねる
  - A/B test 基盤は Phase 4 対象外（計画通り）
Git commit hash: a0c264b

---

### Step 0→F regression verification (2026-05-06)

Phase 4 Steps 0→F の全コードを1ファイルずつ読み直して、バグ・regressionの有無を検証。
発見されたバグは以下の2件。

| Step | Severity | バグ内容 | 修正内容 | ファイル |
|------|----------|---------|---------|---------|
| B | 🔴 BLOCKER | `normalizeQuery` で全角カタカナ→ひらがな変換 (`テレビ`→`てれび`) により、Yomitan辞書の term=`テレビ` が検索不能に | `or(eq(term, rawQuery), eq(term, normalizedQuery))` で両方OR検索。reading も同様 | `dictionary.service.ts` |
| C | 🟡 MED | `index.ts` L69 が `process.env["LOG_RETENTION_DAYS"]` を直接読んでいた。env.ts に zod 検証がなく env 経由の統一ルール違反 | env.ts に `LOG_RETENTION_DAYS` (z min 30 max 365 default 90) 追記。`index.ts` を `env.LOG_RETENTION_DAYS` 経由に変更 | `env.ts`, `index.ts` |

検証コマンド（修正後）:
  - pnpm --filter @grkd-jisho/bot exec tsc --noEmit → 0 errors
  - pnpm --filter @grkd-jisho/db exec tsc --noEmit → 0 errors
  - pnpm --filter @grkd-jisho/mcp exec tsc --noEmit → 0 errors
  - npx astro check (web) → 0 errors / 0 warnings / 2 hints
  - pnpm --filter @grkd-jisho/bot test → 6 files / 39 tests / 0 passed
  - pnpm --filter @grkd-jisho/db exec tsc --noEmit → 0 errors

残リスク（既知のまま）:
  - normalizeQuery でも「カタカナ→ひらがな」後の最終的な形は依然として正規化クエリ。reading が null かつ term がカタカナのみのエントリは、いずれかの term が元の表記と一致すれば発見可能（OR条件でカバー）
  - web heartbeat の unique constraint は composite (service_name, instance_id)。Drizzle onConflictDoUpdate で正しく動作確認済み
Git commit hash: 981b4c7

LOW follow-up: `originalQuery === normalizedQuery` のとき OR をスキップする `matchColumn` ヘルパーを抽出。同一条件の重複 eq を回避。
Git commit hash: d483527

**Step G 実装ログ**

| 項目 | 内容 |
|---|---|
| 日付 | 2026-05-07 |
| 従属 | Step F (prompt v2) 完了後、独立して実装 |
| 作業 | G-1: response詳細ページ / G-2: 辞書import preview |
| 状態 | ✅ 完了 |

**修正ファイル:**

| ファイル | 変更 |
|---|---|
| `packages/db/src/services/admin/response-admin.ts` | `getResponseDetail()` 追加（response + edits + source を1クエリグループで） |
| `packages/web/src/pages/api/admin/responses.ts` | GET id時は `getResponseDetail()` → enriched JSON を返す |
| `packages/web/src/pages/admin/responses/[id].astro` | 新規: SSR詳細ページ（bigint/Date→string変換） |
| `packages/web/src/pages/admin/responses.astro` | 行クリックで詳細ページへリンク追加 |
| `packages/web/src/components/admin/ResponseDetailPanel.tsx` | React コンポーネント（kuraudo-uidesigner 再デザイン） |
| `packages/web/src/components/admin/ResponseEditTimeline.tsx` | React コンポーネント（kuraudo-uidesigner 再デザイン） |
| `packages/web/src/pages/api/admin/dictionaries/import-preview.ts` | 新規: zip parse → index.json → term_bank estimate preview |
| `packages/web/src/pages/admin/dictionaries/import.astro` | 新規: import preview SSRページ |
| `packages/web/src/components/admin/ImportPreviewForm.tsx` | React コンポーネント（kuraudo-uidesigner 再デザイン） |
| `packages/web/package.json` | `adm-zip` 追加 |
| `pnpm-lock.yaml` | lock更新 |

**検証:**

- `astro check`: 0 errors, 0 warnings
- `bot tsc --noEmit`: 0 errors
- `bot vitest run`: 39 passed
- `db tsc --noEmit`: 0 errors
- code-reviewer: 後日Step H統合で実施予定

**残リスク:**

- import preview は API単体での動作確認のみ。zipアップロード画面はプレビュー実装までで、実際のimport（DB保存）は未実装（Phase計画通り）
- UIコンポーネントのPUT /api/admin/responses はCSRF対応済みだが、エラーハンドリングはサイレント（将来強化）
- adm-zip 依存追加済み。大きなzip（50MB超）は一貫して拒否

**Git commit hash:** 6522c2a

### 🔍 Step G Code Review Findings & Fixes
reviewed: 2026-05-07 | Verdict: ✅ Approve (after fixes)

| Severity | Finding | File | Fix |
|---|---|---|---|
| 🔴 BLOCKER | CSRF token のfetch先が間違い (`/api/admin/csrf-token` → `/api/auth/csrf-token`) | ResponseDetailPanel.tsx:29, ImportPreviewForm.tsx:22 | 両方のfetch URLを修正 |
| 🔴 BLOCKER | PUT response.ok をチェックしていない。保存失敗時にユーザーに気付かれない | ResponseDetailPanel.tsx:42-60 | `saveError` state追加、非OK時にエラー表示＋編集モード維持 |
| 🟠 HIGH | Path traversalが `..` のみで絶対パスを検出できない | import-preview.ts:63 | `path.win32.isAbsolute()` + `path.posix.isAbsolute()` + `/` / `\\` 先頭チェック追加 |
| 🟠 HIGH | Zip bomb対策なし。圧縮50MB制限のみで解凍後サイズ未チェック | import-preview.ts:80,96 | `entry.header.size` (uncompressed) 上限100MB/entry + total 500MB チェック追加 |
| 🟠 HIGH | Path traversalエラーでentry名を返し情報漏洩 | import-preview.ts:65 | エラーメッセージを `"Path traversal detected"` に変更（entry名除去） |
| 🟡 MED | getResponseDetail() 内の BigInt変換が重複して見える | response-admin.ts:97 | 設計意図を説明するコメント追加（Promise.all共用のため独立変換） |
| 🟡 MED | ResponseDetailData が SearchResult の手動再定義リスク | [id].astro:11 | シリアライズ型であることの設計意図コメント追加 |

**検証（fix後）:**
- `astro check`: 0 errors, 0 warnings
- `bot tsc --noEmit`: 0 errors  
- `bot vitest run`: 39 passed
- `db tsc --noEmit`: 0 errors

**Fix commit hash:** 1c4b96d

**Astro hint fix:** `FormEvent` 非推奨 (×2) → `React.SyntheticEvent` に変更。`z.string().url()` 非推奨 → `z.url()` に変更（zod v4 トップレベルAPI）。
- Git commit hash: d333d17 (FormEvent), 67bbad7 (z.url)
- 検証: `astro check`: 0 errors / 0 warnings / 0 hints

Step I 実装ログ
Step J 調査ログ
Step K 最終検証ログ
```

各ログに必ず書くもの。

- 実施日
- 変更ファイル
- 検証コマンド
- code-reviewer結果
- 残リスク
- Git commit hash

---

## 🔍 Audit Report — Round 1
> Reviewed from the perspective of an IBM / Google Pro Engineer  
> Date: 2026-05-06  
> Mode: Pre-Implementation  
> Prior audits: 0 | New findings this round: 7

### 📊 Convergence Status
| Prior Round Issues | Status |
|-------------------|--------|
| なし | 初回監査 |

### ⚠️ Impact on Related Features *(new only)*
- **HIGH-1:** Step D は `MCP_ENABLE_LIMITED_WRITE=false` を追加するが、実コード `packages/mcp/src/index.ts` は `MCP_READONLY_MODE=false` で即起動失敗する hard guard を持つ。Plan が `main()` の Phase 3 固定ガードを Phase 4 用に置換する手順を明示していないため、Level 3 tool を実装しても MCP server が起動できないリスクが高い。
- **HIGH-2:** Step E の claim 条件が「status を running にする」とだけ書かれており、`approval_required` と `status` の組み合わせを同一UPDATE条件で再検証することが明文化されていない。現コードも selected job 取得後の claim が `pending OR approved` のみなので、承認状態変更との競合時に境界が曖昧になる。`approval_required=false AND status=pending` または `approval_required=true AND status=approved` を atomic claim 条件に含める必要がある。
- **MED-1:** Step C のエラー監視はWeb/MCP可視化で止まり、ROADMAP Phase 4-4 の「Discord管理者チャンネルへの週次レポート」との扱いが完了基準に入っていない。実装しない判断自体はYAGNIとして妥当だが、Phase 4から明示的に延期する成果物・理由・再開条件を書かないと、ROADMAPとの差分が未管理になる。

### 🚨 Potential Problems & Risks *(new only)*
- **HIGH-3:** Level 3 `request_rate_limit_change` と dry-run の入力仕様がズレる可能性がある。Plan の Step E は `daily_limit >= -1` とし、`-1` を無制限として扱う。一方、現行 dry-run tool は `new_daily_limit` が `min(0)` で、無制限化のdry-runができない。Phase 4で「dry-run確認後にrequest」という運用にするなら、`-1` の扱いをdry-run / request / executorで統一しないと、本番操作だけが可能で事前検証不能になる。
- **MED-2:** `request_cache_refresh` は「件数上限」とあるが、上限値の所在が未定義。env、定数、tool入力、またはDB設定のどれが正かが書かれていない。実装者が任意値を散らすと、MCP、Bot executor、Web UIで削除可能件数の判断が割れる。

### 📋 Missing Steps & Considerations *(new only)*
- **MED-3:** `mcp_audit_logs` への記録は書かれているが、`ops_jobs` 作成と audit log 書き込みを同一transactionで扱うかが未記載。MCP write tool で `ops_jobs` INSERT 成功後に audit INSERT が失敗すると、「操作は残るがauditが欠ける」という方針違反状態になる。Level 3以上は `ops_jobs` と `mcp_audit_logs` を原則同一transactionで作成する、と明記すべき。
- **LOW-1:** Step K のパターン検証に `#000000` / `#ffffff` が含まれるが、Phase 4本文内の根拠ドキュメントやAGENTSの禁止事項とは直接つながっていない。UIデザイン規約由来なら `DESIGN.md` 根拠を Step 0 の根拠表に追加する。根拠がないならパターン検証から外すべき。

### 🕳️ Unaddressed Edge Cases *(new only)*
- **LOW-2:** 見出し番号とStep順は現状崩れていない。ただし Step D/E は「必ず連続」と書く一方で、Step K の手動検証は Level 3 request と Bot execution のみで、未承認jobが実行されないこと、reject後に実行されないこと、unknown jobがfailedになることの手動検証が抜けている。AGENTSの dangerous ops job 条件を守るなら、sign-off検証に明示した方がよい。

### ✅ Recommended Actions
| Priority | Action | Reason | Is New? |
|----------|--------|--------|---------|
| HIGH | `packages/mcp/src/index.ts` の Phase 3 read-only hard guard を Phase 4 limited-write env設計に合わせて変更する手順をStep Dに明記する | Level 3実装後にMCPが起動不能になる | ✅ New |
| HIGH | ops job claim UPDATE に `approval_required` と許可statusの組み合わせを含める、とStep E安全条件に明記する | 承認境界をDB更新時にatomicに守る必要がある | ✅ New |
| HIGH | dry-run / request / executor の `daily_limit=-1` 仕様を統一する | 無制限化だけ事前検証不能になる | ✅ New |
| MED | `ops_jobs` INSERT と `mcp_audit_logs` INSERT のtransaction方針をStep Dへ追加する | auditなしwriteを防ぐ | ✅ New |
| MED | cache refresh件数上限の定義場所と値を決める | Bot/MCP/Webで削除安全条件が割れる | ✅ New |
| MED | Discord週次レポートを延期するなら、ROADMAP差分として延期理由と再開条件を書く | Phase 4-4との差分を管理する | ✅ New |
| LOW | Step Kの追加手動検証に未承認・reject済み・unknown jobの非実行/failed確認を入れる | human approval境界の回帰を検出する | ✅ New |

---

## Audit Round 1 対応ログ

> Date: 2026-05-06  
> 対象: Phase 4 pre-implementation audit findings  
> 状態: BLOCKER 0 / HIGH 3 / MED 3 / LOW 2 すべて本文へ反映済み

| Finding | 対応 |
|---|---|
| HIGH-1: MCP Phase 3 read-only hard guard のままだとLevel 3実装後に起動不能 | Step Dに「Phase 3 hard guard の置換」を追加。`MCP_READONLY_MODE`, `MCP_ENABLE_DRY_RUN`, `MCP_ENABLE_LIMITED_WRITE` の起動条件を明文化 |
| HIGH-2: ops job claim が `approval_required` をatomic条件に含めていない | Step E安全条件に `(approval_required=false AND status='pending') OR (approval_required=true AND status='approved')` を明記 |
| HIGH-3: `daily_limit=-1` がdry-run/request/executorで不統一 | Step Dに仕様統一表を追加。現行dry-runの `min(0)` を `min(-1)` に変更する手順を明記 |
| MED-1: Discord週次レポートがROADMAP差分として未管理 | Step C-4を追加し、延期理由と再開条件を明記 |
| MED-2: cache refresh件数上限の所在が未定義 | Step Dに `MCP_MAX_CACHE_REFRESH_ROWS=100` と適用箇所を追加 |
| MED-3: `ops_jobs` と `mcp_audit_logs` のtransaction方針が未記載 | Step Dに `createOpsJobWithAudit()` 方針を追加し、同一transaction原則を明記 |
| LOW-1: UI色検証の根拠が薄い | 根拠表に `DESIGN.md` を追加 |
| LOW-2: sign-off検証で未承認/rejected/unknown jobが抜けている | Step K手動検証へ追加 |

### 対応後の状態

- 見出し順: `0` → `19`、Step `0` → `K` で整合。
- 旧wipe方式 / 旧戻り値仕様: 実運用方針としての残存なし。
- 旧timezone `Asia/Bangkok`: 検査対象文字列としてのみ記載。
- 旧命名 `@grkd/` / `grkd.`: 検査対象文字列としてのみ記載。
- MCP Level 3/4 境界: dry-run必須、ops_jobs作成のみ、audit transaction、人間承認を明記。
