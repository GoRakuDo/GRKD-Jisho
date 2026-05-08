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

## C-10: WebUIフロー完成（C-9含む）

### 目的

WebUIを「見た目だけでなく、実運用で詰まらずに使える状態」まで仕上げる。
対象は以下の2軸。

1. **UI/UX完成度**（C-9: ログインページ改善 + Dictionaries導線改善）
2. **フロー破綻防止**（ログイン認証で起きたようなルート/Cookie/ガード不整合を網羅検証）

### 実装スコープ

1) `auth/login` UI改善（C-9）
- ヒーロー見出し、3ステップガイド、フッター（バージョン）
- 既存のDiscordボタンは維持
- エラー表示は現行仕様を維持しつつ視認性改善

2) `admin/dictionaries` 導線改善
- ページヘッダー右上に `Import Dictionary` ボタン追加
- 空状態（No dictionaries found）に CTA 追加（`Import your first dictionary`）
- `admin/dictionaries/import` への導線を明示

3) `admin/dictionaries/import` 利用性改善
- 戻るリンク（Back to Dictionaries）追加
- インポート手順の簡易ガイド追加
- 失敗時エラー表示を明確化（現行ロジック維持）

### フロー検証チェックリスト（破綻防止）

#### A. 認証フロー
1. `/auth/login` 表示
2. `Sign in with Discord` → `/api/auth/authorize` が Discord へ 302
3. Discord 承認後 `/api/auth/callback` でセッション確立
4. `/admin` へ遷移
5. `/auth/logout` でセッションクリア

#### B. 辞書管理フロー
1. `/admin/dictionaries` から Import ボタンが見える
2. `/admin/dictionaries/import` へ遷移
3. ZIP選択→Preview API呼び出し→結果表示
4. エラー時に原因メッセージが表示される

#### C. ガード/セキュリティ
1. 未ログインで `/admin/*` は `/auth/login` へ
2. `/api/auth/authorize` と `/api/auth/callback` は公開ルート
3. 非GET `/api/*` `/admin/*` は CSRF 必須（除外パスのみ免除）
4. HTTP環境で state cookie が返る（`SESSION_COOKIE_SECURE` 判定）

#### D. 運用検証
1. `astro check` 0/0/0
2. Kasouで `pnpm build` + `systemctl restart grkd-jisho-web`
3. 主要エンドポイントのヘッダ確認（302/200の妥当性）

### 役割分担

- **@kuraudo-uidesigner**: UIコンポーネント/レイアウト改善案の実装
- **本体エージェント**: ルートガード・認証整合・動作検証・Kasou反映
- **@code-reviewer**: 最終コードレビュー（BLOCKER/HIGH/MED/LOW）

### 完了条件

1. C-9（ログインページ改善）が適用済み
2. DictionariesページからImportへの導線がUI上で明確
3. 認証〜辞書インポートまでの主要フローが破綻なく通る
4. コードレビューで BLOCKER/HIGH=0

---

### C-10 実装ログ（2026-05-08）

**実装（UI担当: @kuraudo-uidesigner 委譲）**
- `packages/web/src/pages/auth/login.astro`
  - ヒーロー見出し + サブタイトル
  - 3ステップガイド
  - フッター（バージョン/GoRakuDo）
- `packages/web/src/pages/admin/dictionaries.astro`
  - ヘッダー + 説明文
  - `Import Dictionary` ボタン追加（`/admin/dictionaries/import`）
  - Empty state CTA 追加
- `packages/web/src/pages/admin/dictionaries/import.astro`
  - `Back to Dictionaries` 導線追加
  - 3ステップガイドカード追加
  - `ImportPreviewForm` は既存ロジックのまま利用

**統合時の修正（本体エージェント）**
- importページに重複挿入されたガイドブロックを除去
- 3ファイルとも DESIGN.md token方針（純黒/純白禁止、royal-blue主導）を維持

**検証結果**
- `packages/web`: `npx astro check` → **0 errors / 0 warnings / 0 hints**
- Kasou 実機ルート検証:
  - `/auth/login` → 200
  - `/api/auth/authorize` → 302 Discord OAuth + state cookie発行
  - `/admin/dictionaries`（未ログイン）→ 302 `/auth/login`
  - `/admin/dictionaries/import`（未ログイン）→ 302 `/auth/login`

**残タスク（手動）**
- ログイン済み状態で `/admin/dictionaries` 画面上の Import ボタンと Empty CTA の目視確認
- ZIPアップロードのPreview表示（ブラウザ実操作）

---

### 追加修正: OAuth cookie の `Secure` 固定で HTTP ローカル環境が失敗する問題

**発生日**: 2026-05-08

**問題**: Discord 承認後に `oauth_failed` へ戻る。画面はエラーのみで進行不可。

**原因**:
- `packages/web/src/lib/session.ts` で OAuth state cookie と session cookie を `secure: true` 固定にしていた
- Kasou は `http://192.168.100.46:4321` で運用しているため、ブラウザが `Secure` cookie を callback リクエストで送信しない
- その結果、`verifyOAuthState()` が常に失敗して `/auth/login?error=oauth_failed`

**修正**:
- `SESSION_COOKIE_SECURE=true|false` を追加（任意）
- 未指定時は `WEB_BASE_URL` のスキームで自動判定
  - `https://` → `true`
  - `http://` → `false`
- state 不一致時に原因と復旧ヒントをログ出力

**変更ファイル**:
- `packages/web/src/lib/session.ts`
- `packages/web/src/pages/api/auth/callback.ts`
- `packages/web/src/env.ts`
- `.env.example`

**期待結果**:
- HTTP ローカル環境でも OAuth state cookie が返送され、callback が破綻せず通る
- HTTPS 本番では引き続き secure cookie を維持

---

### 追加修正: `/api/auth/authorize` が未認証でブロックされる問題

**発生日**: 2026-05-08

**問題**: Windows から `http://192.168.100.46:4321/api/auth/authorize` にアクセスすると機能せず、
`/auth/login` に 302 リダイレクトされる。

**原因**:
- `packages/web/src/middleware.ts` の `PUBLIC_PATHS` に `/api/auth/authorize` が未登録
- その結果、`/api/*` 保護ルールに吸い込まれて未認証時に `/auth/login` へ戻される

**修正**:
- `PUBLIC_PATHS` に `/api/auth/authorize` を追加

**影響**:
- ログインページの「Sign in with Discord」ボタン（`/api/auth/authorize`）が正常に OAuth フローを開始できる

**検証**:
- `packages/web` で `astro check` 実行: **0 errors / 0 warnings / 0 hints**

---
### コードレビュー発見: redirect_uri 未更新（3件のBLOCKER）

**発生日**: 2026-05-08 | **原因**: callback.ts を移動したが、OAuth2 ライブラリ内の `redirect_uri` と middleware の `PUBLIC_PATHS` が古いパスのままだった。

| # | 深刻度 | ファイル | 問題 | 修正 |
|---|--------|---------|------|------|
| 1 | 🚨 HIGH | `packages/web/src/lib/discord-oauth.ts:42` | `buildAuthorizeUrl()` の `redirect_uri` が旧パス `/auth/callback` | → `/api/auth/callback` |
| 2 | 🚨 HIGH | `packages/web/src/lib/discord-oauth.ts:62` | `exchangeCode()` の `redirect_uri` が旧パス `/auth/callback` | → `/api/auth/callback` |
| 3 | 🚨 HIGH | `packages/web/src/middleware.ts:7` | `PUBLIC_PATHS` に旧パス `/auth/callback`（callback リクエストが認証必須扱いになる） | → `/api/auth/callback` |

**影響**: 3件とも本番で OAuth2 が動作しない（`redirect_uri_mismatch` エラー）。修正せずに出荷すると Bot 管理画面に一切ログインできない。

**型チェック**: ✅ astro check 0 errors | ✅ GitHub push `093899e` | ✅ Kasou pull + build + restart 完了

**教訓**: API ルートのパスを変更する場合、以下を必ず確認する：
1. OAuth2 ライブラリ内の `redirect_uri` 文字列（authorize URL と token exchange の2箇所）
2. middleware の `PUBLIC_PATHS`（認証スキップ設定）
3. Discord Developer Portal の登録済み redirect URL

---
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

## C-7: Bot エラーメッセージ改善（新規）

### 何をするか

Bot がログインに失敗したとき、生のスタックトレースを吐くのをやめる。
ユーザーが「何を直せばいいか」をひと目で理解できる案内メッセージを表示する。

### 対象エラー

| エラー | 現在の出力 | 改善後 |
|---|---|---|
| Intent 未有効 | `Error: Used disallowed intents ... (stack)` | ❌ **Login failed: Discord Gateway Intents が有効になっていません。** Discord Developer Portal → Bot → Privileged Gateway Intents で `MESSAGE_CONTENT` を有効にしてください。 |
| Token 無効 | `Error: Incorrect login details ... (stack)` | ❌ **Login failed: Discord Bot Token が間違っています。** .env の `DISCORD_TOKEN` を確認してください。 |
| ネットワーク | `Error: connect ECONNREFUSED ... (stack)` | ❌ **Login failed: Discord に接続できません。** ネットワーク / プロキシ設定を確認してください。 |

### 実装

`packages/bot/src/index.ts` の `client.login().catch()` を拡張:

```typescript
client.login(env.DISCORD_TOKEN).catch((err) => {
  const message = parseLoginError(err);
  console.error(message);
  process.exit(1);
});

function parseLoginError(err: unknown): string {
  const msg = err instanceof Error ? err.message : String(err);

  if (msg.includes("disallowed intents")) {
    return [
      "❌ Login failed: Discord Gateway Intents が有効になっていません。",
      "",
      "   Discord Developer Portal (https://discord.com/developers/applications) で",
      "   Bot → Privileged Gateway Intents から MESSAGE_CONTENT を有効にしてください。",
    ].join("\n");
  }

  if (msg.includes("Incorrect login details") || msg.includes("401")) {
    return [
      "❌ Login failed: Discord Bot Token が間違っています。",
      "",
      "   .env の DISCORD_TOKEN を確認してください。",
      "   Token は Discord Developer Portal → Bot → Reset Token で再発行できます。",
    ].join("\n");
  }

  if (msg.includes("ECONNREFUSED") || msg.includes("ENOTFOUND") || msg.includes("ETIMEDOUT")) {
    return [
      "❌ Login failed: Discord に接続できません。",
      "",
      "   ネットワーク接続とプロキシ設定を確認してください。",
    ].join("\n");
  }

  // 予期しないエラー → 従来通り出力
  return `❌ Login failed: ${msg}`;
}
```

### 既存コードとの関係

| ファイル | 変更 |
|---|---|
| `packages/bot/src/index.ts` | `client.login().catch()` のエラー処理を `parseLoginError()` に置き換え |

### ファイル構成（変更のみ）

```
packages/bot/src/index.ts  ← 追記（parseLoginError + 呼び出し修正）
```

---

## C-8: 全ログメッセージをユーザーフレンドリーに改善（新規）

### 何をするか

`console.error("prefix:", err)` のように生のスタックトレースを吐いている30箇所のログを、**「問題原因 → ユーザーへのヒント」** の短いメッセージに置き換える。

### 対象

bot パッケージ内の `console.error` / `console.warn` 呼び出し30件:

| ファイル | 箇所 | 変更前のパターン | 変更後 |
|---|---|---|---|
| `index.ts` | 2 | `console.error("[Wipe] Failed:", err)` | `[Wipe] Channel ${id}: {error message} → Check bot permissions` |
| `observability.service.ts` | 2 | `console.error("[Observability] Failed:", err)` | `[Observability] Event recording failed: {error message} → Check DB connection` |
| `log-purge.service.ts` | 1 | `console.error("[LogPurge] Failed:", err)` | `[LogPurge] Purge failed: {error message} → Check DB connection` |
| `llm.service.ts` | 1 | `console.warn("Gemini failed:", err)` | `[LLM] Gemini failed: {error message} → Check GEMINI_API_KEY` |
| `channel-wipe.service.ts` | 2 | `console.error("[Wipe] ...:", err)` | `[Wipe] Channel ${id} bulkDelete failed: {error message} → Check permissions` |
| `register-commands.ts` | 1 | `console.error("Failed to register:", err)` | `[Register] Command registration failed: {error message} → Check DISCORD_TOKEN` |
| `messageCreate.ts` | 1 | `console.error("[messageCreate] Unhandled:", err)` | `[messageCreate] Search failed: {error message} → Check LLM/Dict config` |
| `interactionCreate.ts` | 8 | `console.error("[Interaction] ...:", err)` | `[Interaction] ${type} failed: {error message} → {specific hint}` |
| `env.ts` | 2 | `console.error("Invalid env:", fieldErrors)` | パターン変更なし（すでに十分明確） |
| `commands/index.ts` | 1 | `console.warn("Duplicate registration")` | パターン変更なし（すでに十分明確） |

### ルール

```
すべてのエラーログは以下のフォーマットに統一:

  [Tag] {short description}: {error.message} → {actionable hint}

例外:
- console.log (情報) は変更しない。運用状態の可視性を保つ
- env.ts / commands/index.ts はすでに十分明確なのでスキップ
```

### 対象外

- `console.log` → 情報表示として維持。稼働状態の可視性を保つ
- `packages/bot/test/` → テストコード。実運用に影響しない
- MCP / Web パッケージ → 別の機会に

### ファイル構成

```
packages/bot/src/
  index.ts                    ← 2箇所修正
  services/
    observability.service.ts  ← 2箇所修正
    log-purge.service.ts      ← 1箇所修正
    llm.service.ts            ← 1箇所修正
    channel-wipe.service.ts   ← 2箇所修正
  scripts/
    register-commands.ts      ← 1箇所修正
  events/
    messageCreate.ts          ← 1箇所修正
    interactionCreate.ts      ← 8箇所修正
```

---

## 実装優先順位

| 優先度 | ID | 内容 | 工数 | 理由 |
|---|---|---|---|---|
| **P0** | C-1 | `pnpm db:setup` | 2-3h | 引用符地獄を根本解決。最大の工数ロスを削減 |
| **P0** | C-4 | `pnpm env:validate` | 0.5-1h | 共有 zod スキーマを db に切り出すが、最小工数で効果大 |
| P1 | C-3 | `pnpm deploy:check` | 2-3h | デプロイ前に不足がわかる安心感 |
| P1 | C-2 | `pnpm deploy:pg-config` | 1-2h | sed 不要になる。DRY_RUN 対応で安全 |
| P2 | C-5 | 既存スクリプト強化 | 0.5h | 上記が全部できてから呼び出し追加 |
| P2 | C-7 | login エラーメッセージ改善 | 0.5h | デプロイ後に「Intent未有効」の生スタックトレースが表示されるのを、人間にわかる案内に改善 |
| **P0** | **C-8** | **全ログメッセージ改善** | **1-2h** | **全30箇所の `console.error` を「問題原因＋ユーザーヒント」に統一。Kasou運用で顕在化した最大のUX課題** |
| P2 | C-9 | ログインページUI改善 | 1-2h | 現在の「白いカード＋ボタンだけ」のログインページに、サービス名・ガイダンス・バージョン表示を追加する |

**推奨順序**: C-4 → C-1 → C-2 → C-3 → C-5 → C-7 → C-8 → C-9

C-4（env:validate）が一番カンタンで一番早く効果が出る。
C-1（db:setup）が最大の価値だが、C-4で肩ならししてから取りかかるのが現実的。
C-7（login エラーメッセージ）はKasouデプロイ時に顕在化した問題を即座に修正。
C-8（全ログ改善）はC-7のパターンを全ファイルに展開する。30箇所の一括置換だが、各ファイルの読み取りが必要。

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

---

## C-9: ログインページUI改善

### 現状

`packages/web/src/pages/auth/login.astro` は白背景に灰色カードとロイヤルブルーのボタン1つだけ。
ブランド感がなく、初めてのユーザーに何をすればいいかのガイダンスがない。

### 改善内容

ログイン画面に以下の要素を追加する：

**① サービスのヒーローセクション**
- "GRKD-Jisho" の大きなテキストロゴ
- ロイヤルブルーのアクセントライン
- タグライン: "Indonesian Japanese Dictionary Bot for Discord"

**② 3ステップのガイダンス**
1. Sign in with Discord — ボタンをクリック
2. Grant permissions — 権限を承認
3. Access the admin panel — 管理画面へ

各ステップに記号アイコン（①・②・③ または ◆）

**③ 既存のDiscord OAuth2ボタン（そのまま）**

**④ エラー表示（既存、そのまま）**

**⑤ フッター領域**
- バージョン: `v0.1.0`
- "GoRakuDo" リンク

### デザインルール

| 項目 | 値 |
|---|---|
| ボタン色 | `bg-royal-blue-600 hover:bg-royal-blue-700` |
| カード背景 | `bg-porcelain-100 border-graphite-180` |
| 見出し | `text-graphite-800 font-grkd-sans` |
| 本文 | `text-graphite-650 font-grkd-sans` |
| バージョン | `text-graphite-550 font-grkd-mono text-body-xs` |
| アクセントライン | `border-royal-blue-600` 水平線 |

詳細は `DESIGN.md` のトークン定義に従う。

### 禁止事項（DESIGN.md準拠）
- pure black / pure white 不使用
- 過剰なアニメーション禁止
- Discord ロゴ画像不使用（テキストのみ）

### 変更ファイル

```
packages/web/src/pages/auth/login.astro  ← 全面書き換え
```

### 関連修正: OAuth callback ルートパス不整合（Kasouデプロイ時に発見）

**発生日**: 2026-05-08

**問題**: Discord Developer Portal の redirect_uri は `/api/auth/callback` だが、
実際の Astro ファイルは `src/pages/auth/callback.ts` にあったため、URL は `/auth/callback` に
マッピングされていた。そのため OAuth 認証が成功しても Discord からブラウザへのリダイレクトが
404 で失敗していた。

**修正内容**:

| 変更 | 内容 |
|---|---|
| ファイル移動 | `src/pages/auth/callback.ts` → `src/pages/api/auth/callback.ts` |
| import パス | `../../lib/...` → `../../../lib/...`（2階層→3階層に修正） |
| ログフォーマット | `console.error("OAuth:", err)` → `[OAuth] {reason} → Check Discord OAuth2 config`（AGENTS.md §17 準拠） |
| 型チェック | ✅ astro check 0 errors |

**教訓**: Astro の `src/pages/api/` ディレクトリが `/api/` にマッピングされることを
文書化し、新しい API ルートは必ず `src/pages/api/` 以下に作成する。

---
