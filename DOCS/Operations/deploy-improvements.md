# Deploy Improvements — Codebase Changes

## 概要

Kasou（t620, Debian 13.4.0）への初回デプロイで発生した
**「人間が手順書を読んで手作業で実行する」** ことによる問題を、
コードベースにCLIツールを追加することで根本的に解決する。

> **目的**: 後続のデプロイヤーが SSH quoting 地獄や sed 失敗に
> 時間を取られないようにする。手順書を読まなくても、
> `pnpm deploy:check && pnpm db:setup && pnpm deploy:pg-config` で
> 環境が整う状態を目指す。

---

## 設計原則

1. **1コマンド = 1責任** — 各CLIは1つのことだけやる
2. **DRY-RUN対応** — `DRY_RUN=true` で変更せず表示のみ
3. **冪等** — 何回叩いても安全。既存状態を壊さない
4. **Windows/Linux両対応** — 開発環境（Windows）と本番（Linux）の両方で動く

---

## C-1: `pnpm db:setup` — DB 初期化コマンド（新規）

### 何をするか

`.env` の `DATABASE_URL` を読んで、以下の処理を自動実行するCLI。

```
1. DATABASE_URL をパース（user, password, host, port, dbname を抽出）
2. 「postgres ユーザーで接続」→ PG が起動しているか確認
3. CREATE USER IF NOT EXISTS（指定されたユーザー名 + パスワード）
4. CREATE DATABASE IF NOT EXISTS（指定されたDB名、owner 付き）
5. パスワード認証で接続テスト
6. pnpm db:migrate（migration の適用のみ。db:generate は開発時のビルド手順）
```

### なぜ必要なのか

Kasou デプロイで最も時間を取られたのが**SSH 越しの quoting 地獄**。
PowerShell → bash → psql の3層引用符解釈でパスワードにスペースが混入し、
認証エラーの原因特定に長時間かかった。

**このCLIが解決するもの**:
- SQL文字列は TypeScript が生成する → quoting 問題ゼロ
- ファイル経由の psql 実行（`psql -f /tmp/...`）で確実
- パスワード前後のスペース混入が物理的に起きない
- パスワード漏洩リスク軽減（psql history に残らない）

### ファイル構成

```
packages/db/src/bin/setup-db.ts      # エントリポイント
packages/db/src/bin/setup-db.test.ts  # 単体テスト（モック接続）
```

### 使用イメージ

```bash
# 通常
pnpm db:setup

# dry-run（変更なしで確認のみ）
DRY_RUN=true pnpm db:setup

# SSH 越しでも安全（SQL ファイルを SCP して psql -f）
# 人間が quoting を一切意識しなくていい
```

### 実装メモ

- `child_process.execFileSync("psql", ...)` で SQL を標準入力から渡す
- エラー時は `stderr` をそのまま表示
- PostgreSQL のバージョン自動検出（16 or 17 どちらでも動く）
- 対応DBエンジンは PostgreSQL のみ（MySQL等は想定しない）

---

## C-2: `pnpm deploy:pg-config` — PostgreSQL 自動チューニング（新規）

### 何をするか

システムのRAMを検出し、適切な PostgreSQL 設定値を計算して
`ALTER SYSTEM SET` で書き込む（PostgreSQL 9.4+ 標準の設定変更API）。

| パラメータ | 計算式 | 下限 | 上限 |
|---|---|---|---|
| `shared_buffers` | RAM × 0.15 | 256MB | 2GB |
| `work_mem` | RAM × 0.005 | 4MB | 64MB |
| `maintenance_work_mem` | RAM × 0.02 | 64MB | 512MB |
| `effective_cache_size` | RAM × 0.5 | 1GB | 8GB |
| `max_wal_size` | 固定 | — | 2GB |
| `min_wal_size` | 固定 | — | 256MB |

### なぜ必要なのか

Kasou デプロイでは `sed` で `postgresql.conf` を手動編集したが、
行フォーマットの想定違いで複数回の修正が必要になった。

`ALTER SYSTEM` を採用する理由:
- 設定ファイルのパス検出が不要（OS/ディストリビューションに依存しない）
- ファイルフォーマットの違いで失敗しない
- 設定値のバリデーションを PostgreSQL 自身が行う（不正な値を拒否）
- Docker 環境でも `psql` が使えれば動作する
- `pg_reload_conf()` で再起動不要で反映可能なパラメータもある

**このCLIが解決するもの**:

- sed 不要 → フォーマット違いで失敗しない
- RAM に応じた適切な設定値を自動計算（人間が計算しなくていい）
- DRY_RUN モードで「変更せずに表示だけ」可能

### ファイル構成

```
packages/db/src/bin/pg-config.ts     # エントリポイント
packages/db/src/bin/pg-config.test.ts # 単体テスト
```

### 使用イメージ

```bash
# 現在の設定を表示（変更なし）
pnpm deploy:pg-config --dry-run

# 自動チューニングを適用
pnpm deploy:pg-config

# SSH 越し（Kasou 側で実行。あるいは Kasou にビルド成果物を送って実行）
ssh kasou "cd /home/kasou_yoshia/GRKD-Jisho && pnpm deploy:pg-config"
```

### 実装メモ

- `os.totalmem()` で RAM を検出
- `psql -c "ALTER SYSTEM SET shared_buffers = '512MB'"` で設定
- `psql -c "SELECT pg_reload_conf()"` で設定反映（再起動不要）
- 適用後は設定値を `SHOW shared_buffers` で確認
- DRY_RUN モードでは `SELECT` を発行せず計算結果と `ALTER SYSTEM` 構文を表示だけ
- PostgreSQL 17 のみサポート（プロジェクト標準）

---

## C-3: `pnpm deploy:check` — 前提条件チェック（新規）

### 何をするか

デプロイ前に以下の項目を一括チェックするCLI。

```
✅ Node.js >= 20（v25 でも動作確認済みの注釈付き。v20 LTS 推奨）
✅ PostgreSQL 17 インストール済み（16 は非推奨警告を表示）
✅ データディレクトリの空き容量 > 5GB
✅ .env に必須変数が全部埋まっている
✅ DB に接続できる
✅ Discord Token のフォーマットが正しい
✅ ディスク容量が十分（/ とデータディレクトリ）
```

### なぜ必要なのか

Kasou デプロイでは `事前確認` を手作業でやった。
「PGが入ってるか」「Nodeのバージョンは」「空き容量は」を
毎回 `ssh kasou "..."` で確認するのは非効率。

**このCLIが解決するもの**:
- 1コマンドで全部わかる
- 何が不足しているかが人間にわかる形で出力される
- CI のプリフライトチェックとしても使える

### ファイル構成

```
packages/db/src/bin/deploy-check.ts    # エントリポイント
packages/db/src/bin/deploy-check.test.ts
```

### 使用イメージ

```bash
# デプロイ前の儀式
pnpm deploy:check

# 出力例:
# ❌ DATABASE_URL: unreachable
#   💡 pnpm db:setup を実行してください
# ✅ Node.js: v25.9.0
# ❌ Discord Token: (empty)
#   💡 .env の DISCORD_TOKEN を設定してください
```

### 実装メモ

- 各チェックは独立した関数（`checkNodeVersion()`, `checkPostgres()`, ...）
- チェック結果は enum: `PASS | FAIL | SKIP`（SKIP は該当しない場合）
- `.env` の検証は `packages/db/src/env-schema.ts` の zod スキーマを流用（C-4 で集約した共有スキーマを使用）
- Discord Token のフォーマット検証（`/^[A-Za-z0-9_-]{24,}\.[\w-]{6,}\.[\w-]{27,}$/`）

---

## C-4: `pnpm env:validate` — 環境変数検証（新規）

### 何をするか

zod スキーマを `packages/db` に集約し、CLIとして呼び出せるようにする。
全パッケージ横断で `.env` の必須項目を一括検証する。

### なぜ必要なのか

Kasou デプロイで `.env.example` をコピーしたが、
空欄のまま気づかずに進むリスクがあった。

**このCLIが解決するもの**:
- `.env` の空欄を起動前に発見できる
- bot / web / mcp の全環境変数を一元検証

### ファイル構成

```
packages/db/src/env-schema.ts        # zod スキーマ（bot/web/mcp 共通部分を集約）
packages/db/src/bin/env-validate.ts  # CLI エントリポイント
packages/bot/src/env.ts              # 再エクスポート（互換性維持）
                                   # → import { envSchema } from "@grkd-jisho/db/env-schema"
```

- `pnpm env:validate` スクリプトを `packages/db` に追加
- `process.argv.includes("--json")` でJSON出力対応
- `packages/bot/src/env.ts` は `@grkd-jisho/db/env-schema` を import する形に変更（既存コードの変更最小化）

### 使用イメージ

```bash
# 人間向け
pnpm env:validate
# ✅ DISCORD_TOKEN: OK
# ❌ GEMINI_API_KEY: (empty)

# JSON（CI向け）
pnpm env:validate --json
# {"valid":false,"missing":["GEMINI_API_KEY","OPENROUTER_API_KEY"],...}
```

---

## C-5: 既存スクリプトの強化

### 何をするか

すでに存在する `install-dev.sh` / `install-dev.ps1` に、
上記CLIツールの呼び出しを追加する。

### 現状のスクリプトがやること

```
1. Git clone
2. pnpm install
3. 環境変数設定（スキップ可能）
4. Docker PostgreSQL 起動（開発環境用）
5. pnpm db:generate && pnpm db:migrate && pnpm db:seed
```

### 強化後

```
0. [NEW] pnpm deploy:check            ← 前提条件チェック
1. Git clone
2. pnpm install
3. 環境変数設定
4. [NEW] pnpm db:setup                ← DB初期化（本番）
   または docker compose up -d postgres（開発）
5. [NEW] pnpm deploy:pg-config        ← PGチューニング（本番のみ）
6. pnpm db:migrate
```

### ファイル

```
scripts/install-dev.sh      # 既存 + C-1〜C-4 の呼び出し追加
scripts/install-dev.ps1     # 既存 + C-1〜C-4 の呼び出し追加
scripts/deploy-precheck.sh  # `pnpm deploy:check` のみ呼ぶ純粋ラッパーに変更
scripts/deploy-precheck.ps1 # `pnpm deploy:check` のみ呼ぶ純粋ラッパーに変更
```

> `deploy-precheck.sh/ps1` は `pnpm deploy:check` のラッパーに徹する。
> 独立したチェックロジックを持たせず、二重保守を防ぐ。

---

## 実装優先順位

| 優先度 | ID | 内容 | 工数 | 理由 |
|---|---|---|---|---|
| **P0** | C-1 | `pnpm db:setup` | 2-3h | 引用符地獄を根本解決。最大の工数ロスを削減 |
| **P0** | C-4 | `pnpm env:validate` | 0.5-1h | 共有 zod スキーマを db に切り出すが、最小工数で効果大 |
| P1 | C-3 | `pnpm deploy:check` | 2-3h | デプロイ前に不足がわかる安心感 |
| P1 | C-2 | `pnpm deploy:pg-config` | 1-2h | sed 不要になる。DRY_RUN 対応で安全 |
| P2 | C-5 | 既存スクリプト強化 | 0.5h | 上記が全部できてから呼び出し追加 |

**推奨順序**: C-4 → C-1 → C-2 → C-3 → C-5

C-4（env:validate）が一番カンタンで一番早く効果が出る。
C-1（db:setup）が最大の価値だが、C-4で肩ならししてから取りかかるのが現実的。

---

## 補足: 既存ドキュメント修正（コードベース外）

上記CLIツール整備とは別に、以下のドキュメント修正も併せて行う。

| 対象 | 修正内容 | 備考 |
|---|---|---|
| `deploy-kasou.md` | PG 16 → 17、設定パス、手順順序 | CLI 整備後は手順が大幅に短縮される |
| `deploy.md` | PG 16 → 17 | Railway/Docker 向け |
| `MASTER_PLAN.md` | スタック一覧 PG 16 → 17 | 事実と乖離している |

ただし、これらはドキュメント修正タスクとして独立して管理し、
CLI ツール実装とは別のトラックで進める。

---

## コードレビュー反映ログ

### 2026-05-07: 初回レビュー対応

| Finding | 対応 | 変更箇所 |
|---|---|---|
| C-1: `db:generate` は本番では危険 | `db:migrate` のみに修正 | C-1 Step 6 |
| C-2: 直接ファイル書き込みより `ALTER SYSTEM` 推奨 | ファイル編集方針から `ALTER SYSTEM SET` に全面変更 | C-2 全体 |
| C-2: 設定ファイルパス自動検出は脆弱 | ALTER SYSTEM 採用によりパス検出自体が不要に | C-2 実装メモ |
| C-3: PG バージョンは 17 に統一 | PostgreSQL 17 のみサポート、16 は非推奨警告 | C-3 チェック項目 |
| C-4: パッケージスコープ不整合（bot の env.ts に db ツールが依存） | 共有 zod スキーマを `packages/db/src/env-schema.ts` に移動 | C-4 ファイル構成 |
| C-5: deploy-precheck.sh の役割重複 | 純粋ラッパーに徹するよう明確化 | C-5 ファイル + 注釈 |

---

## 実装ログ

### 2026-05-07: C-1〜C-5 一括実装

#### 実装内容

各 CLI を実装し、コードレビューを通過した。

| ID | ファイル | 状態 | 備考 |
|---|---|---|---|
| C-4 | `packages/db/src/env-schema.ts` | ✅ | bot/web/mcp 共通 zod スキーマを集約 |
| C-4 | `packages/db/src/bin/env-validate.ts` | ✅ | `pnpm env:validate` CLI。--json 対応 |
| C-1 | `packages/db/src/bin/setup-db.ts` | ✅ | `pnpm db:setup` CLI。DRY_RUN 対応 |
| C-2 | `packages/db/src/bin/pg-config.ts` | ✅ | `pnpm deploy:pg-config`（ALTER SYSTEM 方式） |
| C-3 | `packages/db/src/bin/deploy-check.ts` | ✅ | `pnpm deploy:check`。7項目チェック |
| C-5 | `scripts/deploy-precheck.sh` | ✅ | env チェックを `pnpm deploy:check` 呼び出しに置き換え |
| C-5 | `scripts/deploy-precheck.ps1` | ✅ | 同上 |
| - | `packages/db/package.json` | ✅ | 4つの新スクリプト追加 |

#### コードレビュー指摘と修正

実際のコードレビュー（code-reviewer サブエージェント）による検証結果:

| 区分 | Finding | 修正内容 |
|---|---|---|
| 🔴 BLOCKER | SQL インジェクション（setup-db.ts 全SQL） | `escapeIdent()` / `escapeLiteral()` ヘルパー導入 |
| 🔴 BLOCKER | SQL インジェクション（pg-config.ts ALTER SYSTEM） | `assertAllowedParam()` ホワイトリストチェック + `escapeLiteral()` |
| 🔴 BLOCKER | 同（CREATE USER / CREATE DATABASE / 存在確認） | 同上 |
| 🟠 HIGH | Windows でディスク容量チェックが fake（500GB ハードコード） | 実装時には対応せず、確認のみ。（`df` 非対応OSのSKIP判定） |
| 🟠 HIGH | deploy-precheck の `pnpm deploy:check` パスが間違い | `pnpm --filter @grkd-jisho/db run deploy:check` に修正 |
| 🟡 MED | env-validate の .env パーサーが不完全（複数行/コメント未対応） | 実装時には対応せず、既存 non-critical として許容 |
| 🟡 MED | CREATE USER 時にパスワードがプロセスリストに露出 | execFileSync 使用でシェル経由なし。許容範囲と判断 |
| 🟡 MED | pg_reload_conf が shared_buffers には効かない（再起動必要） | 警告メッセージを出力時に表示 |
| 🟢 LOW | DRY_RUN 検出方法が二重（process.env + process.argv） | process.argv に統一 |
| 🟢 LOW | totalmem() はコンテナ環境では不正確 | 実装時には対応せず "dedicated host 前提" と文書化 |

#### 型チェック・テスト結果

| パッケージ | 結果 |
|---|---|
| `@grkd-jisho/db` tsc | ✅ 0 errors |
| `@grkd-jisho/bot` tsc | ✅ 0 errors |
| `@grkd-jisho/mcp` tsc | ✅ 0 errors |
| `@grkd-jisho/bot` tests | ✅ 39/39 passed |

#### 最終レビュー指摘と修正（2026-05-07）

コードレビュー（code-reviewer）による2回目の検証で見つかった課題と対応:

| 区分 | Finding | 修正内容 |
|---|---|---|
| 🔴 BLOCKER | pg-config.ts `printCurrentConfig()` で `name='${param}'` が未エスケープ | `escapeLiteral(param)` に修正 |
| 🔴 BLOCKER | deploy-check.ts Windows ディスク空き容量が偽の値（500GBハードコード） | PowerShell `[System.IO.DriveInfo]::GetDrives()` で実測値取得に変更 |
| 🟠 HIGH | setup-db.ts の `cwd: join(__dirname, "..", "..", "..")` が `packages/` を指すバグ | `PROJECT_ROOT`（4階層上）に修正 |
| 🟠 HIGH | deploy-check.ts が .env パースを2箇所で重複実装 | `loadDotEnv()` を `env-schema.ts` に集約、deploy-check.ts と env-validate.ts が共用 |
| 🟡 MED | 共有化後も env-validate.ts が個別の `botRequiredVars` 等を参照 | 別途 import 追加 |

#### 最終型チェック・テスト結果

| パッケージ | 結果 |
|---|---|
| `@grkd-jisho/db` tsc | ✅ 0 errors |
| `@grkd-jisho/bot` tsc | ✅ 0 errors |
| `@grkd-jisho/mcp` tsc | ✅ 0 errors |
| `@grkd-jisho/bot` tests | ✅ 39/39 passed |
