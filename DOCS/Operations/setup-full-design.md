# C-6: 全自動セットアップスクリプト設計案

## 狙い

「GRKD-Jisho を使いたい」→ 1コマンド実行 → 質問に答えるだけで全部動く。

## 方式

**Node.js スクリプト（tsx）** 1本で全プラットフォーム対応。
薄いラッパー（`setup.sh` / `setup.ps1`）が tsx を呼ぶ。

```
scripts/setup-full.ts       ← 本体（tsx実行）
scripts/setup.sh            ← Linux/Mac用ラッパー
scripts/setup.ps1           ← Windows用ラッパー
```

## 処理フロー

```
Phase 1: 事前チェック
  1. Node.js 自動検出（Homebrew / nvm / system / nodesource を自動判別）
  2. pnpm 自動検出（なければ corepack enable または npm i -g pnpm）
  3. Git 確認（なければ fatal）
  4. 空き容量チェック（5GB未満なら警告）
  5. PostgreSQL 検出（pg_isready / pg_config / Docker）

Phase 2: 環境変数収集（対話式）
  1. Discord Token → 入力 or EnterでWebブラウザ起動案内
  2. Discord Client ID → 入力
  3. Discord Client Secret → 入力
  4. GEMINI_API_KEY → 入力
  5. OPENROUTER_API_KEY → 空Enterでスキップ（任意）
  6. SESSION_SECRET → 空Enterで自動生成（32文字 hex）
  7. WEB_BASE_URL → 空Enterで自動検出（IP自動取得 + :4321）
  8. Discordの許可チャンネル → 入力（カンマ区切り）
  9. Botを招待 → 招待URLを表示、Enterで次へ

Phase 3: PostgreSQL セットアップ
  Linux:
    - apt install postgresql-17（未インストールの場合）
    - データディレクトリを /home/ に設定（ルート溢れ対策）
    - shared_buffers 自動チューニング（RAMの15%）
    - ユーザー/DB作成
  Windows:
    - Docker Compose 起動（未起動の場合）
    - pg_isready 確認

Phase 4: プロジェクトセットアップ
  1. .env 書き出し
  2. pnpm install
  3. pnpm db:migrate
  4. Discord ギルドID 自動検出（起動→取得→切断）
  5. スラッシュコマンド登録

Phase 5: サービス登録
  Linux:
    - systemd service 作成（/etc/systemd/system/grkd-jisho-*.service）
    - 起動スクリプト生成（PATH問題を自動解決）
    - systemctl enable --now
    - ステータス確認
  Windows:
    - タスクスケジューラ登録（再起動後自動起動）
    - または Start-Bot.ps1 生成

Phase 6: 動作確認
  1. Botログイン確認（journalctl / ログ）
  2. Web Admin UI curl確認（200 OK）
  3. 結果サマリ表示
```

## 自動検出ロジック（Node.js）

```typescript
function detectNode(): string {
  // 1. カレントプロセスの node が使えるか
  if (tryExec('node --version')) return process.execPath;
  // 2. 既知のパスを探索
  const candidates = [
    '/home/linuxbrew/.linuxbrew/bin/node',
    '/usr/local/bin/node',
    '/usr/bin/node',
    '/opt/homebrew/bin/node',  // macOS ARM
    `${os.homedir()}/.nvm/versions/node/*/bin/node`,  // nvm
  ];
  for (const p of candidates) {
    const expanded = globSync(p);
    if (expanded.length > 0 && tryExec(`${expanded[0]} --version`)) return expanded[0];
  }
  throw new Error('Node.js not found');
}
```

## PostgreSQL 自動検出

```typescript
function detectPostgres(): 'system' | 'docker' | 'not-found' {
  if (tryExec('pg_isready')) return 'system';
  if (tryExec('docker ps --filter name=postgres -q')) return 'docker';
  return 'not-found';
}
```

## PATH問題の自動解決（Kasou教訓）

起動スクリプト生成時に、`detectNode()` で見つけた node のディレクトリを PATH に追加:

```bash
# start-bot.sh（自動生成）
export PATH=/home/linuxbrew/.linuxbrew/bin:/usr/local/bin:/usr/bin
export NODE_ENV=production
cd /path/to/packages/bot
exec npx tsx src/index.ts
```

## .env 自動生成例

```
DISCORD_TOKEN=***
DISCORD_CLIENT_ID=123...
DISCORD_GUILD_ID=auto-detected
DISCORD_ALLOWED_CHANNELS=123...,456...
SESSION_SECRET=auto-generated-hex
WEB_BASE_URL=http://192.168.100.46:4321
DATABASE_URL=postgresql://grkd_jisho:***@localhost:5432/grkd_jisho
GEMINI_API_KEY=***
```

## 工数見積もり

| フェーズ | 工数 | 備考 |
|---|---|---|
| Phase 1: 事前チェック | 2h | Node検出ロジックが肝 |
| Phase 2: 対話式env収集 | 3h | readline / inquirer 系 |
| Phase 3: PostgreSQL | 2h | Linux/Windows分岐 |
| Phase 4: プロジェクト | 1h | 既存CLIの組み合わせ |
| Phase 5: サービス登録 | 3h | systemdテンプレート + PATH解決 |
| Phase 6: 動作確認 | 1h | ヘルスチェック |
| **合計** | **12h** | |

## ファイル構成

```
scripts/
  setup-full.ts          ← 本体（tsx実行）
  setup.sh               ← Linux/Mac用ラッパー
  setup.ps1              ← Windows用ラッパー
  templates/
    start-bot.sh.tpl     ← systemd起動スクリプトテンプレート
    start-web.sh.tpl
    grkd-jisho-bot.service.tpl
    grkd-jisho-web.service.tpl
    start-bot.ps1.tpl    ← Windows用
    start-web.ps1.tpl
```

---

## 既存ドキュメントとの関連

| ドキュメント | 関係 |
|---|---|
| `DOCS/Operations/deploy-improvements.md`（C-1〜C-5） | このC-6はC-1〜C-5の上位統合スクリプト。各CLIを内部から呼ぶ |
| `DOCS/Operations/deploy-kasou.md` | C-6完成後は手順が大幅に短縮される。参照程度に |
| `DOCS/Operations/deploy.md` | Docker/Railway向け。C-6はbare-metal向け |
