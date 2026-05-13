# Web UI Configuration — DB 外し方針

## Status

Implemented.

## 背景

GRKD-Jisho の Web UI には、DB に入れる必要がない設定が混ざっていた。

特に、ログイン画面の文言やレイアウト値、管理画面の見出し、補足文、ボタン文言は、データではなく UI の固定設定である。

これらを DB に置くと、DB 再作成や reset 系の操作で UI まで巻き込まれる。

## 方針

- TOTP 状態はそのまま DB 管理
- UI 設定だけを DB から外す
- UI 設定は `packages/web/src/config/webui.ts` に集約する
- ページ側は config を参照して描画する
- 生成済みデータ、認証状態、運営データは DB のまま残す

## DB から外す対象

### 1. Login 画面

- 見出し文言
- 説明文
- Step 01/02/03 の案内文
- access mode の補足文
- loading 文言
- setup / login の見出し
- QR 補助文
- submit ボタン文言
- reset 案内文
- QR / form の最大幅などのレイアウト値

### 2. Prompts 画面

- ページ見出し
- scope rail の補足文
- version history の見出し
- empty state の文言
- editor の見出し
- table header のラベル
- template variables の説明文
- routing contract の説明文
- 主要ボタン文言

### 3. Role Settings 画面

- ページ見出し
- default limit の説明文
- reset usage の説明文
- modal の見出し
- table header のラベル
- output bucket binding の見出しと補足文
- 確認ダイアログ文言
- エラー案内の固定文言

## DB に残す対象

- `admin_totp_secrets`
- `prompts`
- `role_bindings`
- `role_rate_limits`
- `user_usage`
- `response_cache`
- `response_edits`
- `lookup_logs`
- `channel_settings`

## 実装場所

### 新規

- `packages/web/src/config/webui.ts`

### 修正

- `packages/web/src/pages/auth/login.astro`
- `packages/web/src/pages/admin/prompts.astro`
- `packages/web/src/pages/admin/role-settings.astro`

## ルール

1. UI の固定文言は config に寄せる
2. レイアウト値も config に寄せる
3. DB 依存の文言は残さない
4. TOTP と UI 設定は混ぜない
5. copy の変更は DB migration を不要にする

## 実装メモ

- `packages/web/src/config/webui.ts` は Web 専用の設定集約点として実装済み
- `packages/web/src/pages/auth/login.astro` では step ラベル、footer、QR/form 文言を config 化済み
- `packages/web/src/pages/admin/prompts.astro` では variables 表示、runtime 版文言を config 化済み
- `packages/web/src/pages/admin/role-settings.astro` では limit 表示文言と確認/エラー文言の一部を config 化済み
- `webui.ts` は client bundle に Node/DB 依存を入れないよう、純粋な web 側定義を保つ

## 受け入れ条件

- DB を再作成しても UI 文言は変わらない
- TOTP の QR / reset 挙動は今までどおり DB 依存
- `astro check` で error 0
- `web build` が通る
- code-reviewer で問題なし

## スコープ外

- DB へ UI 設定を戻す
- CMS 化する
- ユーザーごとの UI テーマ切替
- ランタイムの動的文言編集
