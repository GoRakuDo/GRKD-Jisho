# AGENTS.md — GRKD-Jisho 開発方針

このファイルは、このリポジトリで作業する人間・AIエージェント向けの開発ルールである。

目的はシンプル。
「辞書データを根拠に、Discord上で安全に学習者へ説明を返すBot」を作る。

---

## 1. プロダクトの方向性

GRKD-Jisho は、インドネシア語話者の日本語学習者向け Discord 辞書Botだ。

役割分担は固定する。

```txt
Yomitan辞書DB = 根拠となる情報源
LLM           = 辞書定義をロール別に言い換える係
Response-DB   = 生成済み・手動編集済み回答の保存場所
Admin UI      = 品質改善と管理の場所
```

LLMを「辞書そのもの」として扱わない。
LLMは、DBから取得した定義の説明係に限定する。

---

## 2. 技術スタック

採用スタックは以下で固定する。

| 領域 | 採用技術 |
|---|---|
| Bot | Node.js 20 LTS + TypeScript + discord.js v14 |
| DB | PostgreSQL 16 |
| ORM | Drizzle ORM |
| Package Manager | pnpm workspaces |
| LLM | Gemini primary / OpenRouter fallback |
| Web UI | Astro + React islands（複雑なテーブル操作・モーダルは vanilla JS `<script>` を許容） |
| Agent Control Plane | MCP Server (Node.js + TypeScript) |
| Local infra | Docker Compose |

新しい技術を足す前に、既存スタックで解けない理由を書くこと。
「便利そう」だけで依存を増やさない。

---

## 3. リポジトリ構成

最終的な構成は monorepo とする。

```txt
packages/
  bot/   Discord Bot本体
  db/    Drizzle schema、DB client、import scripts
  web/   Admin Web UI
  mcp/   外側AIエージェント向け Control Plane
```

責務を混ぜない。

- `packages/db`: DB schema、DB client、migration、seed、importer
- `packages/bot`: Discord events、commands、Bot services
- `packages/web`: 管理画面のみ
- `packages/mcp`: 外側AIエージェント向けの監視・診断・限定操作窓口

Bot側で直接SQL文字列を散らさない。
DBアクセスは `@grkd-jisho/db` 経由に寄せる。

MCP側にも Discord Bot Token を持たせない。
Discord API を実際に呼ぶのは `packages/bot` だけにする。

---

## 4. 実装順序

実装は ROADMAP のフェーズ順に進める。

```txt
Phase 0: monorepo / Docker / DB schema / Yomitan importer / env schema
Phase 1: Bot MVP / dictionary lookup / cache / LLM / rate limit / wipe scheduler / observability
Phase 2: Slash command 管理機能 / read-only MCP
Phase 3: Web Admin UI / Agent Ops 承認画面 / dry-run MCP
Phase 4: 品質改善・最適化 / limited write MCP / agent runbook
```

Phaseを飛ばさない。
特に DB schema と importer が固まる前に、Botの応答ロジックを作り込まない。

---

## 5. コード方針

### 5-1. KISS / YAGNI を優先

まず小さく作る。
MVPでは以下を守る。

- 辞書検索は「優先順位順に最初に見つかった1件」だけ使う
- 複数辞書の定義を混ぜない
- キャッシュキーは仕様通りに作る
- 管理画面より先に Bot MVP を完成させる

将来使うかもしれない抽象化は入れない。

### 5-2. サービス分割

Bot内の責務は小さな service に分ける。

```txt
dictionary.service.ts       辞書検索
role-mapper.service.ts      Discord Role -> role_key
response-cache.service.ts   生成済み回答の取得・保存
llm.service.ts              Gemini / OpenRouter 呼び出し
lookup-log.service.ts       検索ログ保存
rate-limit.service.ts       ユーザー別リミット
channel-wipe.service.ts     チャンネル消去
observability.service.ts    trace_id / bot_events / heartbeat
ops-job.service.ts          MCP経由の運営ジョブ処理
```

1ファイルに全部詰め込まない。

### 5-3. 型安全

- TypeScript `strict` を前提にする
- `any` に逃げない
- 外部入力は zod か明示的な型ガードで検証する
- Discord ID は `string` として扱う
- DBの `bigserial` は bigint/string 変換に注意する

---

## 6. DB方針

主要テーブルは以下。

```txt
dictionaries        (Phase 0)
dictionary_entries  (Phase 0)
response_cache      (Phase 0)
response_edits      (Phase 0)
lookup_logs         (Phase 0)
role_rate_limits    (Phase 0)
user_usage          (Phase 0)
channel_settings    (Phase 0)
bot_events          (Phase 1: observability)
bot_heartbeats      (Phase 1: observability)
ops_jobs            (Phase 1: safe ops queue)
mcp_audit_logs      (Phase 2: MCP audit)
```

### 6-1. キャッシュキー

回答キャッシュは単語だけで保存しない。

必ず以下の組み合わせで一意にする。

```txt
normalized_query
dictionary_id
dictionary_entry_id
role_key
prompt_version
model_name
```

ロール別・モデル別・プロンプト別に回答が変わるため。

`prompt_content_hash` は cache key に**含めない**（2026-06-21 変更）。
DB カラムとしては残し、編集履歴・analytics のメタ情報として使う。
prompt 編集時は **必ず `prompt_version` を bump する** 運用ルールで cache invalidation を担保する。
詳細は `DOCS/Design/cache-key-prompt-version-only.md` を参照。

### 6-2. 手動編集の優先

`response_cache.is_manual_override = true` は最優先。
LLMで上書きしてはいけない。

### 6-3. 編集履歴

回答を編集したら、必ず `response_edits` に履歴を残す。
誰が、いつ、何を、なぜ変えたかを追える状態にする。

---

## 7. LLM方針

LLMに自由回答させない。

プロンプトでは必ず以下を渡す。

- `role_key`
- `query`
- `dictionary_name`
- `definition_json`
- `prompt_version`

LLMの禁止事項。

- 辞書にない意味を追加しない
- 不明点を推測しない
- ユーザーのDiscordロール名をそのままプロンプトに入れない
- L1負の転移を煽る説明をしない

辞書情報が足りない場合は、足りないと返す。

---

## 8. Discord Bot方針

### 8-1. messageCreate

Botは許可チャンネルでのみ反応する。

基本フローは固定。

```txt
mention検知
-> DM owner 判定（config の固定ユーザーIDに合致すれば DM を通す、その他 DM はブロック）
-> query抽出
-> channel guard（DM はスキップ）
-> rate limit check
-> dictionary lookup
-> role_key resolve
-> response cache check
-> LLM generate if miss
-> save cache / log
-> reply
```

### 8-2. Slash Command

管理コマンドは権限ガード必須。

管理者以外に、編集・削除・wipe・refreshを許可しない。

失敗時は基本的に ephemeral で返す。

---

## 9. Rate Limit方針

リセット基準は GMT+7 の日付。

```txt
毎日 00:00 GMT+7
```

Owner / Administrator は無制限。
一般ユーザーは DB の設定に従う。

優先順位は以下。

```txt
1. Guild Owner / Administrator -> 無制限
2. role_rate_limits に一致するロール -> 最も緩い daily_limit
3. __default__ レコード -> デフォルト上限
```

リミット判定をメモリだけで実装しない。
`user_usage` を使い、Bot再起動後も状態を保つ。

---

## 10. Channel Wipe-out方針

チャンネル自動消去は危険操作である。
実装・テスト・運用のすべてで慎重に扱う。

### 10-1. 対象

Wipe対象は `channel_settings.wipe_enabled = true` のチャンネルだけ。
それ以外のチャンネルを消してはいけない。

毎日 00:00 GMT+7 に動くため、通常の対象は直近24時間以内のメッセージ。
1日分のメッセージを全て消す。

固定メッセージは対象外。

### 10-2. 実装方式

シンプルさを優先する。

毎日 00:00 GMT+7 に動くため、対象メッセージは全て24時間以内。14日制限（`bulkDelete`）に引っかからない。

```txt
ピンID取得
-> messages.fetch({ limit: 100 }) をバッチループ
-> ピン以外を bulkDelete()
-> channel_settings.lastWipeAt を更新
```

ピン留め以外の全メッセージを100件ずつバッチ削除する。

> **戻り値:** `deletedCount` のみ。チャンネルIDは変わらないため `newChannelId` は不要。

### 10-3. 権限

Botには最低限以下が必要。

- `MANAGE_MESSAGES`
- `SEND_MESSAGES`
- `READ_MESSAGE_HISTORY`（`messages.fetch()` に必須）

---

## 11. AI Agent / MCP Control Plane 方針

外側のAIエージェントが、MCP経由で GRKD-Jisho Bot を自律監視・診断・限定運営できるようにする。

ただし、MCPは Discord Bot の代わりではない。
MCPは Control Plane として、DBに記録された状態を読み、必要なら安全な `ops_jobs` を作る。
Discord API を実際に呼ぶのは `packages/bot` だけにする。

### 11-1. 役割分担

```txt
External AI Agent = 監視・診断・提案・安全な操作要求
packages/mcp      = AI向け操作窓口。tool schema、入力検証、audit
PostgreSQL        = trace、heartbeat、ops job、audit log の保存場所
packages/bot      = Discord API を実際に呼ぶ唯一の実行者
Admin UI          = 人間の確認・編集・承認画面
```

### 11-2. 必須の観測性

Botの主要処理には必ず `trace_id` を流す。

対象は以下。

```txt
messageCreate
dictionary lookup
response cache
LLM generate / fallback
rate limit
channel wipe
ops job execution
```

重要イベントは `bot_events` に保存する。
Bot / MCP / Web は `bot_heartbeats` に稼働状態を記録する。

### 11-3. MCP tool の段階

最初は read-only のみ許可する。

```txt
Level 1: read-only
  grkd-jisho.health
  grkd-jisho.recent_errors
  grkd-jisho.get_trace
  grkd-jisho.lookup_stats
  grkd-jisho.cache_stats
  grkd-jisho.rate_limit_status
  grkd-jisho.wipe_status

Level 2: dry-run
  grkd-jisho.dry_run_rate_limit_change
  grkd-jisho.dry_run_cache_refresh

Level 3: limited write
  grkd-jisho.request_cache_refresh
  grkd-jisho.request_user_usage_reset
  grkd-jisho.request_rate_limit_change
  wipe setting changes are handled in Web UI, not MCP

Level 4: dangerous
  grkd-jisho.request_wipe_now
  grkd-jisho.request_bulk_cache_delete
  grkd-jisho.request_prompt_version_rotate
```

Level 3 以上は必ず `mcp_audit_logs` に記録する。
Level 4 は必ず人間承認を必要とする。

### 11-4. ops_jobs 原則

MCPから直接危険操作を実行しない。
書き込み系操作は `ops_jobs` に登録し、Botが安全条件を確認して実行する。

特に以下は人間承認必須。

- チャンネル即時wipe
- bulk cache delete
- prompt_version rotate
- 本番DBの大量変更
- 外部API課金が増える操作

### 11-5. MCPで禁止すること

- Discord Bot Token を MCP に持たせる
- MCP tool から Discord API のチャンネル削除・メッセージ削除を直接呼ぶ
- MCP tool に任意SQL実行機能を持たせる
- `.env`、token、API key、secret を tool 出力に含める
- AIエージェントの判断だけで destructive 操作を実行する
- audit log なしで write tool を実行する

---

## 12. やってはいけないこと

このプロジェクトでは以下を禁止する。

- LLMを辞書ソースとして扱う
- 辞書DBにない意味をLLMに補完させる
- MVP段階で複数辞書の定義を混ぜる
- キャッシュを `query` だけで作る
- `is_manual_override = true` の回答をLLMで上書きする
- Discordロール名を直接プロンプトに入れる
- Rate Limitをメモリだけで管理する
- wipe対象チャンネルをハードコードする
- `wipe_enabled = false` のチャンネルを消す
- 固定メッセージを消す
- MCPにDiscord Bot Tokenを持たせる
- MCPからDiscord APIの危険操作を直接実行する
- MCPに任意SQL実行ツールを公開する
- `ops_jobs` / `mcp_audit_logs` を通さずにAIエージェントの書き込み操作を許可する
- `.env`、トークン、APIキー、Discord Bot Tokenをコミットする
- 本番DBや本番Discordサーバーで未検証のwipe処理を試す
- ユーザーに無断で大量削除・DB削除・チャンネル削除・git履歴改変を行う
- 既存ドキュメントと矛盾した実装を、確認なしに進める

---

## 13. テスト方針

最低限、以下を確認してから完了扱いにする。

### Phase 0

- `pnpm install`
- `docker compose up -d postgres`
- `pnpm db:generate`
- `pnpm db:migrate`
- `pnpm db:seed`
- Yomitan辞書のimport確認

### Phase 1

- Bot login
- 許可チャンネルだけ反応
- 辞書fallback
- cache hit / miss
- role_key別の返答
- rate limit超過
- wipe_enabled channel のみ wipe
- trace_id で1回の処理を追跡できる
- bot_heartbeats が更新される

### Phase 2以降

- 管理コマンドの権限ガード
- 編集履歴
- refresh後の再生成
- Web UIの認証ガード
- MCP read-only tools の入力検証
- MCP tool call が `mcp_audit_logs` に残る
- dangerous ops job が人間承認なしに実行されない

---

## 14. ドキュメントの扱い

作業前に必ず読む。

```txt
MASTER_PLAN.md
ROADMAP.md
DOCS/Roadmap_Implement/phase-0-foundation.md
```

ただし、ドキュメント同士に矛盾がある場合は止まる。
勝手に片方を選ばない。

現時点の正は以下。

- Wipe-out は bulkDelete 方式（14日制限対象外のため）
- Phase 0 のDB完了基準は `channel_settings` を含む全8テーブル
- Wipe-out 対象は毎日 00:00 GMT+7 時点の直近24時間以内メッセージ
- 固定メッセージ（ピン留め）のみ保持する

実装前に、対象ドキュメントがこの方針と一致しているか確認すること。

---

## 15. 変更時の原則

大きく変えない。
必要な場所だけ変える。

作業の基本手順。

```txt
1. 関連ドキュメントを読む
2. 既存コードを読む
3. 影響範囲を確認する
4. 小さく変更する
5. 型チェック / テスト / 手動確認を行う
6. 結果と残リスクを記録する
```

コードがまだ存在しない場合でも、ドキュメントを根拠に最小構成から作る。

### 15-1. code-reviewer 機械ゲート

ファイル編集・コード変更・設定変更・ドキュメント更新を行った場合、`@code-reviewer` の **APPROVE** は必須である。

> **限界:** この gate は「うっかり review を飛ばす」事故を止めるための process-trust gate である。marker 自体は署名付き証明ではない。`git push --no-verify` や CI 直 push は hook を迂回できるため、将来の完全強制は GitHub branch protection + required status check で行う。

このルールは prose だけにしない。以下のコマンドは、現在の `HEAD` に対応する approval marker が無い場合に失敗する。

```bash
pnpm review:check
pnpm push:reindex
scripts/deploy-precheck.sh
scripts/deploy-precheck.ps1
```

レビューが APPROVE になった後だけ、以下で marker を作る。

```bash
pnpm review:approve -- --blocker-high-count 0 --summary "code-reviewer APPROVE: <短い要約>"
```

marker は `.review/approved/<commit-sha>.json` に保存される。`.review/` はローカル専用で、コミットしない。

初回セットアップでは、通常の `git push` でも止まるように hook を入れる。

```bash
pnpm hooks:install
```

---

## 16. 判断に迷ったら

以下の順に判断する。

```txt
安全性 > データ保全 > ユーザー体験 > 実装速度 > 技術的きれいさ
```

Discordチャンネル削除、DB削除、履歴改変、外部API課金に関わる判断は必ず確認する。

「動くけど危ない」より、「少し遅いが壊さない」を選ぶ。

---

## 17. ログ出力フォーマット

Bot のログは常に以下のフォーマットに従う。

```txt
console.error / console.warn:
  [Tag] {問題の要約}: {err.message} → {ユーザーへの具体的な直し方}

console.log（情報表示）:
  従来通り。運用状態の可視性を保つためフォーマット変更しない。
```

### ルール

1. **生の `err`（スタックトレース）を `console.error` の第2引数に渡さない**
   - NG: `console.error("[Foo] failed:", err);`
   - OK: `console.error("[Foo] failed: ${err.message} → Check BAR in .env");`

2. **ヒントは具体的に書く**
   - NG: `→ Error occurred`
   - OK: `→ Check GEMINI_API_KEY in .env`
   - OK: `→ Check bot permissions (MANAGE_MESSAGES)`

3. **不明なエラーやデバッグ用の完全スタックトレースは DB（bot_events）に書き込む**
   - `console.error` には短いメッセージ
   - 詳細は `traceEvent()` で `payloadJson` に `String(err)` を入れる

4. **例外: 起動時のログ（Bot logged in 等）や情報ログは対象外**

5. **多段フローの処理は stage 単位で必ず残す**
   - 例: `received -> validate -> filter -> delete -> audit -> reply`
   - 各 stage は `trace_id` と一緒に記録し、最後に落ちた箇所を即座に特定できる状態にする
   - WebUI に全部出さなくてよい。人間が見やすいのは DB / console / 追跡ログ側でいい

このルールは、Kasouデプロイ時に「生スタックトレースを見ても何を直せばいいかわからない」という問題を解決するために導入された。
