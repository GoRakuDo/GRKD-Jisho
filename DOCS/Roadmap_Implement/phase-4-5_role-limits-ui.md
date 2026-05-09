# Phase 4-additional: Role Limits & Usage Reset — Web Admin UI

## Status: **Implementing** (Phase 4 追加タスク)

## Context

ユーザーから以下の要望を受けた：
1. Discordロール別レート制限の**管理ページ**がWebUIにない
2. **カスタムロールの追加**と**そのロールの制限数設定**
3. **ユーザーIDの使用量リセット**機能
4. **ロールごとの制限リセット**機能

## 既存バックエンド資産

| ファイル | 内容 |
|---|---|
| `rate-limit-admin.ts` | `setRoleLimit()`, `getRoleLimits()`, `resetUserUsage()` → すべて利用可能 |
| `rate-limit.service.ts` | Owner=Infinity, Admin=Infinity, role match or `__default__` fallback |
| `DB: role_rate_limits` | `id(serial)`, `discordRoleId(unique)`, `roleLabel`, `dailyLimit` |
| `DB: user_usage` | `bigserial`, `userId`, `guildId`, `usageDate`, `count` |

## 実装内容

### 1. DBサービス追加 — `rate-limit-admin.ts`

- [x] `getRoleLimits()` — 既存
- [x] `setRoleLimit(roleId, label, limit)` — 既存
- [ ] **`deleteRoleLimit(roleId)`** — 新規追加 ← 消す関数が無いため
- [x] `resetUserUsage(userId, guildId)` — 既存

### 2. APIルート — `pages/api/admin/role-limits.ts`

- **GET** — ロール制限一覧 + デフォルト値を返す
  - Response: `{ defaultLimit: number, roleLimits: RoleRateLimit[] }`
- **PUT** — ロール制限を追加/更新
  - Body: `{ discordRoleId: string, roleLabel?: string|null, dailyLimit: number }`
  - 既存の `discordRoleId` があれば更新、なければ挿入 (ON CONFLICT)
- **DELETE** — カスタムロール制限を削除
  - Query: `?discordRoleId=xxx`
  - `__default__` は削除不可
- **POST** — ユーザー使用量リセット (`/api/admin/role-limits/reset-usage`)
  - Body: `{ userId: string, guildId: string }`

※ セキュリティ: 全エンドポイントに CSRF チェック + 管理者権限チェック

### 3. WebUIページ — `pages/admin/role-limits.astro`

完全にvanilla JS方式（`client:load` React Island は使用しない）。

**構成:**
```
📄 Role Limits ページ
┌────────────────────────────────────────────────┐
│  デフォルト制限: 10件/日（変更不可）              │
├────────────────────────────────────────────────┤
│  [＋ カスタムロール制限を追加]                    │
│  ┌──────────┬──────────────┬────────┬────────┐  │
│  │ ロール名   │ Role ID      │ 制限数 │ 操作   │  │
│  ├──────────┼──────────────┼────────┼────────┤  │
│  │ Admin     │ 123456789    │ 100    │ ✏️ 🗑 │  │
│  │ Moderator │ 987654321    │ 50     │ ✏️ 🗑 │  │
│  └──────────┴──────────────┴────────┴────────┘  │
├────────────────────────────────────────────────┤
│  ユーザー使用量リセット                            │
│  UserID: ________________  GuildID: _________  │
│  [使用量リセット]                                  │
└────────────────────────────────────────────────┘
```

**機能:**
- 一覧表示（ページ読み込み時にAPI GET）
- カスタムロール追加モーダル（discordRoleId + roleLabel + dailyLimit入力）
- 既存ロール編集（modalで既存値をpre-fill、上書き保存）
- カスタムロール削除（確認ダイアログ、`__default__`は保護）
- ユーザー使用量リセット（userId + guildId入力 + 確認）

### 4. Sidebarメニュー項目追加

`Sidebar.tsx` に「Role Limits → /admin/role-limits」リンクを追加

## 進行状況

- [ ] Step 1: DBサービス `deleteRoleLimit` 追加
- [ ] Step 2: APIルート実装
- [ ] Step 3: WebUIページ実装
- [ ] Step 4: Sidebarリンク追加
- [ ] Step 5: typecheck + build + test
- [ ] Step 6: commit + push + Kasou deploy
- [ ] Step 7: code-reviewer レビュー
- [ ] Step 8: 動作確認

## 注意事項

- Owner/Admin は無制限（コードレベルで保証、UIで表示のみ）
- `__default__` のレコードは編集/削除不可
- `dailyLimit` に `-1` は「無制限」の意味
- すべてvanilla JS方式で実装（React Island は使用しない）

---

## 🔴 プレモーションで最もエラーになりやすい3点と対策

### エラー予測 1: `deleteRoleLimit` のDELETE対象キー不一致

**リスク内容：**
`role_rate_limits.id` は `serial`（整数型）だが、フロントエンドからは `discordRoleId`（文字列）しか渡せない。
サービス層で `WHERE id = $1`（整数）と指定すると、フロントが文字列 `"123456"` を送ってSQLエラーになる。
あるいは、誤って `WHERE discrodRoleId = $1` と typo すると 0件更新（silent failure）となり、
「削除成功」表示が出てもデータが残る。

**対策：**
- サービス層の `deleteRoleLimit` は引数を `discordRoleId: string` で受け取る（serial id を使わない）
- DELETE SQL は `WHERE discord_role_id = $1` を明示
- 影響行数が 0 の場合のみ `throw new Error("Role limit not found")` で例外送出
- フロント側の削除ボタンクリック時に `data-discord-role-id` 属性から値を取得

### エラー予測 2: `dailyLimit` 入力値の型変換・バリデーション漏れ

**リスク内容：**
- HTML の `<input type="number">` は `value` が文字列を返す。`JSON.stringify({ dailyLimit: "50" })` でAPIに送ると、
  `typeof dailyLimit === "string"` となり `number` 型チェックで 400 エラーになる。
- `-1`（無制限）以外の負値（例: `-5`）や `NaN` が入力される可能性。
- `parseInt("")` → `NaN` がそのままDBに挿入される。

**対策：**
- **フロント**: `parseInt(rawValue, 10)` で数値変換 + `Number.isInteger()` チェック後送信
- **API PUT**: `typeof dailyLimit !== "number"` チェックに加え、`!Number.isInteger(dailyLimit)` を検証
- **API PUT**: dailyLimit の有効値は `-1` または `1 ≤ n ≤ 99999` とする。範囲外は 400 エラー。
- **API POST（リセット）**: `guildId` 未指定時は Bot の起動ギルドID（`BOT_GUILD_ID` env）で代替

### エラー予測 3: CSRF トークン取得失敗（403再発）

**リスク内容：**
`prompts.astro` で経験済み — `fetch('/api/auth/csrf-token')` が403を返すと、
後の `PUT` / `DELETE` リクエストに空の `x-csrf-token` ヘッダーが付き、すべて 403 で失敗する。
特に、ページ読み込み時の並列 fetch で CSRF トークン取得が完了する前、
ユーザーが素早くフォーム送信すると発生する。

**対策：**
- CSRF トークンはページ初回読み込み時に **インライン `<script>` で定数** として注入（`prompts.astro` と同パターン）
- `fetch('/api/auth/csrf-token')` 方式はバックアップとして残すが、メインルートはインライン注入
- `handleSave()` / `handleDelete()` でトークンが空文字の場合は `console.error` + `alert` で早期return
- 403 レスポンスを受けた場合は「セッションが切れています。再ログインしてください。」と表示

---

### 過去の類似エラー履歴（参考）

| エラー | 発生箇所 | 根本原因 |
|---|---|---|
| "Invalid id format" | `prompts.ts` DELETE | UUID正規表現で数値IDを弾いた |
| No DELETE handler | `prompts.ts` | `DEL` ではなく `DELETE` をexportし忘れた |
| CSRF 403 | `dictionaries.astro` | `generateCsrfToken` を削除したまま使おうとした |
| 空のEditor | `prompts.astro` | `useEffect` がhydration前に発火、データ未ロード |
| 型不一致 | `response-admin.ts` | `returning()[0]` が undefined の可能性 |