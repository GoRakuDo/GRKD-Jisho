# TOTP Auth Plan — Web Admin 認証を Discord OAuth から TOTP に移行

## 背景
現状の Web Admin は Discord OAuth で認証しており、8時間ごとに再ログインが必要。
Kasou は個人運用サーバーのため、毎回 Discord ログインを踏むのが面倒。
Bot の動作とは完全に独立しているため、認証方式を変えても Bot に影響はない。

## ゴール
- Discord OAuth を完全削除
- TOTP（Time-based One-Time Password）で代替
- 初回のみ QR スキャン、以降は認証アプリの 6 桁コードでログイン
- SSH からリセット可能（忘れた場合も再セットアップできる）

## 全体フロー

```txt
[未セットアップ]
  /auth/login → クライアントが /api/auth/status を確認
    → setupRequired=true → /auth/setup にリダイレクト

[セットアップ]
  /auth/setup を開く
    → GET /api/auth/setup
      → TOTP secret を生成、DB に保存、QR data URL を返却
    → 画面に QR コード表示
    → 認証アプリでスキャン → 6桁コード入力
    → POST /api/auth/verify { code }
      → 検証成功 → セッション発行 → /admin へリダイレクト

[通常ログイン]
  /auth/login を開く
    → 6桁コード入力フォーム表示
    → POST /api/auth/verify { code }
      → 検証成功 → セッション発行 → /admin へリダイレクト

[リセット]
  SSH → reset-auth.ts 実行 → DB の secret 削除
    → 次回 /auth/login → setupRequired=true → /auth/setup へ
```

## 変更対象ファイル

### 新規作成（5ファイル）
| ファイル | 役割 |
|---|---|
| `packages/db/src/schema/admin-totp-secrets.ts` | TOTP secret 保存用テーブル |
| `packages/web/src/pages/api/auth/setup.ts` | GET: secret 生成 + QR data URL 返却 |
| `packages/web/src/pages/api/auth/verify.ts` | POST: TOTP コード検証 + セッション発行 |
| `packages/web/src/pages/api/auth/status.ts` | GET: setupRequired を返す（login ページ用） |
| `packages/web/src/pages/auth/setup.astro` | QR 表示 + 初回コード入力ページ |
| `packages/web/scripts/reset-auth.ts` | CLI: DB の secret を削除 |

### 修正（5ファイル）
| ファイル | 変更内容 |
|---|---|
| `packages/db/src/schema/index.ts` | admin-totp-secrets を export |
| `packages/web/src/pages/auth/login.astro` | OAuth→TOTP コード入力に全面書き換え |
| `packages/web/src/middleware.ts` | PUBLIC_PATHS / CSRF_EXEMPT_PATHS 更新 |
| `packages/web/src/env.ts` | DISCORD_CLIENT_ID/CLIENT_SECRET/ADMIN_ROLE_IDS 削除 |
| `packages/web/package.json` | speakeasy + qrcode 依存追加、reset-auth スクリプト追加 |

### 削除（4ファイル）
| ファイル | 理由 |
|---|---|
| `packages/web/src/lib/discord-oauth.ts` | Discord OAuth 不要 |
| `packages/web/src/pages/api/auth/callback.ts` | OAuth callback 不要 |
| `packages/web/src/pages/api/auth/authorize.ts` | OAuth authorize 不要 |

### 変更なし（セッション・CSRFは互換維持）
- `packages/web/src/lib/session.ts` — SessionData の型はそのまま、値に `"totp_admin"` を入れる
- `packages/web/src/lib/csrf.ts` — 同一セッション内で動作するため変更不要
- `packages/web/src/lib/locals.ts` — 変更不要

## DB スキーマ

```ts
// admin_totp_secrets テーブル
// 最大1行（singleton）。secret が存在すればセットアップ済み。
export const adminTotpSecrets = pgTable("admin_totp_secrets", {
  id: text("id").primaryKey().default("singleton"),
  secret: text("secret").notNull(),
  createdAt: timestamp("created_at").notNull().defaultNow(),
});
```

## セッション設計

SessionData の型は変更しない。値だけ差し替える。

```ts
setSession(context, {
  discordUserId: "totp_admin",   // 固定プレースホルダ
  guildId: env.DISCORD_GUILD_ID, // env から読み取り
  isAdmin: true,
  expiresAt: Date.now() + SESSION_MAX_AGE_MS,
  authCheckedAt: Date.now(),
});
```

CSRF は SessionData 内の `discordUserId` を使って HMAC 署名する。
値が固定でも同一セッション内では動作する。

## 環境変数

### 削除
- `DISCORD_CLIENT_ID`
- `DISCORD_CLIENT_SECRET`
- `ADMIN_ROLE_IDS`

### 保持
- `DATABASE_URL` — DB 接続に必要
- `DISCORD_GUILD_ID` — API ルートの guild-scoped query に必要
- `SESSION_SECRET` — セッション署名に必要
- `SESSION_COOKIE_SECURE` — Cookie Secure フラグ制御
- `WEB_BASE_URL` — リダイレクト等に必要
- `PORT` / `HOST` — サーバー設定

## Middleware 更新

```ts
const PUBLIC_PATHS = new Set([
  "/auth/login",
  "/auth/setup",
  "/auth/logout",
]);

const CSRF_EXEMPT_PATHS = new Set([
  "/api/health",
  "/api/auth/verify",       // POST でセッションなし → CSRF 不能
  "/api/admin/dictionaries/import-preview",
]);
```

`/api/auth/setup` と `/api/auth/status` は GET のみのため CSRF 対象外（明示不要）。

## CSRF ノート

`POST /api/auth/verify` はログイン前（セッションなし）で動作するため、
CSRF のバインディングに使う `discordUserId` が存在しない。
そのため CSRF_EXEMPT_PATHS に追加し、ミドルウェアの CSRF チェックをスキップする。

TOTP コード（6桁、30秒ごと変更）が実質的な認証＋CSRF トークンの役割を兼ねる。

## リセット CLI

```ts
// packages/web/scripts/reset-auth.ts
// 使い方: pnpm auth:reset
// または: tsx scripts/reset-auth.ts
import { db } from "@grkd-jisho/db";
import { adminTotpSecrets } from "@grkd-jisho/db/schema/admin-totp-secrets";

await db.delete(adminTotpSecrets);
console.log("TOTP secret deleted. Next login will trigger setup.");
process.exit(0);
```

package.json に追加:
```json
"scripts": {
  "auth:reset": "tsx scripts/reset-auth.ts"
}
```

## セキュリティ考慮

| リスク | 対策 |
|---|---|
| Secret 流出（QR 撮影） | セットアップ画面は1回だけ表示。再表示不可 |
| セットアップ中断でロックアウト | SSH → reset-auth で解除。これは想定内 |
| Verify へのブルートフォース | 6桁×30秒 = 1,000,000通りのため現実的ではない |
| 複数管理者 | 非対応（Kasou 個人運用のため。必要なら Phase 5 で） |

## 非対応（スコープ外）

- 複数 TOTP secret（複数端末対応）
- リカバリーコード
- メール/SMS フォールバック
- レート制限（verify エンドポイント）
- ブルートフォース対策の遅延

## 影響範囲

| 領域 | 影響 |
|---|---|
| Bot 本体 | **なし**（完全独立） |
| Bot テスト | なし |
| MCP | なし |
| DB migration | 新テーブル 1つ追加（admin_totp_secrets） |
| .env.example | 3変数削除 |
| Kasou .env | 3変数削除要 |
| Dockerfile | 変更不要 |
