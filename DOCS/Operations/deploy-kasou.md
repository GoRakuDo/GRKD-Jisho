# GRKD-Jisho Kasou Deploy — Premortem & Deployment Guide

> **対象マシン**: HP t620 (AMD GX-217GA, 8GB RAM, 120GB SSD + 2.7TB HDD)
> **OS**: Debian 13.4 Trixie + Xfce 4.20
> **同居サービス**: DennouAibou (OpenClaw v2026.4.5), episodic-claw, smart-tts-proxy
> **最終更新**: 2026-05-08

## 目次

1. [プレモーテム概要](#1-プレモーテム概要)
2. [シナリオ① — ルートパーティション枯渇](#2-シナリオ--ルートパーティション枯渇)
3. [シナリオ② — RAM競合とOOM Killer](#3-シナリオ--ram競合とoom-killer)
4. [シナリオ③ — Node.js v25互換性問題](#4-シナリオ--nodejs-v25互換性問題)
5. [デプロイ手順](#5-デプロイ手順)
6. [動作確認チェックリスト](#6-動作確認チェックリスト)
7. [緊急時対応](#7-緊急時対応)

---

## 1. プレモーテム概要

GRKD-Jisho を DennouAibou（OpenClaw）と同じマシンに同居デプロイするにあたり、
事前に想定される3つの障害シナリオを特定し、それぞれに対策を組み込んだ。

### 共存リソースマップ

```
リソース          DennouAibou側         GRKD-Jisho側          競合リスク
──────────────    ──────────────        ──────────────         ────────
RAM (7.2GB)       ~1.5GB (ピーク2GB)    ~1.0GB (固定500MB)     ★ MED
/  (32GB)         ~4.5GB                ~2GB (PGデータ除く)    ★ HIGH
/home (86GB)      ~使用中               PGデータはここに配置   なし
HDD (2.7TB)       バックアップ用        バックアップ先候補     なし
CPU               〜5% (アイドル)       〜1% (Bot待機)         無視できる
ポート            18789, 8881, 5900     5432 (PG), 4321 (Web)  競合なし
```

---

## 2. シナリオ① — ルートパーティション枯渇

### リスク度: HIGH

### 前提

`/dev/sda2` は32GBしかない。今は25GB空いているが油断できない。

### 失敗の連鎖

```
1. apt install postgresql-16
2. PostgreSQL のデータディレクトリは /var/lib/postgresql/16/main/
   → つまり / 以下にデータが溜まる
3. Yomitan辞書のインポート
   → 辞書データが数GB〜10GBになる可能性
4. WALログが無制限に蓄積（デフォルト設定）
5. ある日 / の空きが0になる
6. PostgreSQLが起動しなくなる (pg_ctl: could not write to log file)
7. Bot停止、Web UI停止
8. OS自体の動作も不安定化（journal、tmp、apt cache用の空きがない）
9. DennouAibouも影響を受ける（同じ / を使用）
```

### 対策

#### 対策A: PostgreSQLデータを `/home` に逃がす（必須）

```bash
# インストール前（重要: cluster作成前にディレクトリを準備）
sudo mkdir -p /home/postgresql-data/16
sudo chown postgres:postgres /home/postgresql-data/16

# apt install 後に cluster 作成（デフォルトの auto-start は止めておく）
sudo pg_dropcluster 16 main --stop   # デフォルトclusterを削除（まだデータなし）
sudo pg_createcluster 16 main --datadir /home/postgresql-data/16/main

# 確認
sudo pg_lsclusters
# → 16  main  5432  /home/postgresql-data/16/main  online
```

/homeパーティションは86GBあるため、辞書データが20GBになっても余裕。

#### 対策B: WALサイズ制限（推奨）

```ini
# /home/postgresql-data/16/main/postgresql.conf に追加
max_wal_size = 1GB
min_wal_size = 256MB
```

デフォルトは max_wal_size = 1GB なので多くの場合問題ないが、明示しておく。

#### 対策C: apt cache と journal の肥大化防止

```bash
# apt cache を制限（お好みで）
echo 'APT::Keep-Downloaded-Packages "false";' | sudo tee /etc/apt/apt.conf.d/99autoclean

# journal の最大サイズを 500MB に制限
sudo journalctl --vacuum-size=500M
# 永続化:
sudo sed -i 's/^#SystemMaxUse=/SystemMaxUse=500M/' /etc/systemd/journald.conf
```

---

## 3. シナリオ② — RAM競合とOOM Killer

### リスク度: MED

### 前提

| コンポーネント | 通常時 | ピーク時 |
|---|---|---|
| DennouAibou | 750MB | 1.2GB |
| PostgreSQL | 400MB | 600MB（設定次第で跳ねる） |
| Bot + Web | 200MB | 300MB |
| Xfce + VNC | 200MB | 300MB（Firefox起動時+400MB） |
| OS + journal | 200MB | 200MB |
| **合計** | **1,750MB** | **3,000MB** |

7.2GB RAM に対して3GBピークなので通常は安全。**ただし PostgreSQL の
`shared_buffers` を大きく設定しすぎると危険。**

### 失敗の連鎖

```
1. PostgreSQL の shared_buffers をデフォルト（128MB）から大きく変更
   → 例: shared_buffers = 2GB に設定
2. しばらくは正常に見える（合計3GB〜4GB）
3. DennouAibou の会話が増えて peak 1.5GB
4. XfceでFirefoxを開く（+400MB）
5. 合計が7GB超 → Swap開始 → OOM Killer発動
6. OOM Killer が一番メモリを食ってるプロセスを殺す
   → PostgreSQL か DennouAibou が標的になる
7. 「なんでDennouAibouが死んだ？」→ 原因がわからず混乱
```

### 対策

#### 対策A: PostgreSQL shared_buffers は 512MB上限（必須）

```ini
# postgresql.conf（推奨設定）
shared_buffers = 512MB            # RAM 7.2GB の約7%。多すぎない
work_mem = 16MB                   # ソート用、1接続あたり
maintenance_work_mem = 128MB      # VACUUM等のメンテナンス用
effective_cache_size = 2GB        # OSファイルキャッシュ込みの見積もり（実際の値より控えめ）
wal_buffers = 4MB                 # 最小でOK
max_connections = 20              # Bot + Web + MCP で十分
```

**絶対ルール**: `shared_buffers` は決して RAM の **50%（3.6GB）を超えない**。
このマシンでは **512MB〜1GB** が安全圏。推奨は **512MB**。

#### 対策B: systemd OOM調整（推奨）

DennouAibou が OOM Killer に殺されないよう優先度を設定:

```bash
# DennouAibou（openclaw-gateway）の OOMスコアを最低に
mkdir -p ~/.config/systemd/user/openclaw-gateway.service.d/
cat << 'EOF' > ~/.config/systemd/user/openclaw-gateway.service.d/oom.conf
[Service]
OOMScoreAdjust=-1000
EOF
systemctl --user daemon-reload
systemctl --user restart openclaw-gateway

# GRKD-Jisho Bot の OOMスコア（殺されてもいいように通常値）
# → デフォルトのままでOK。Botはsystemdが自動再起動できる
```

#### 対策C: ZRAMの確認（念のため）

```bash
# 現在のzramサイズ
zramctl
# → 4GB swap として動作中。特に変更不要
```

---

## 4. シナリオ③ — Node.js v25互換性問題

### リスク度: LOW〜MED

### 前提

KasouにインストールされているNode.jsは v25.9.0。
GRKD-Jishoは Node.js 20 LTS で開発・テストされている。

### 失敗の連鎖

```
1. pnpm install        → 成功（v25は後方互換性が高い）
2. pnpm build          → 成功（TypeScriptコンパイルは通る）
3. node dist/index.js  → 起動エラー or 意図しない挙動
4. 原因特定に時間がかかる
   「discord.js v14 が v25 で動かないのか？」
   「native addon が未対応なのか？」
```

Node.js v25 で実際に GRKD-Jisho が動くかは未確認。
互換性の問題が出るリスクは低いが見積もれないため、対策を用意する。

### 対策

#### 対策A: Node.js 20 LTS を別途インストール（推奨）

nvm でシステムの v25 を残したまま v20 と切り替え:

```bash
# nvm インストール
curl -o- https://raw.githubusercontent.com/nvm-sh/nvm/v0.40.3/install.sh | bash

# 新しいシェル or source ~/.bashrc
nvm install 20
nvm alias default 20

# 確認
node --version  # → v20.x.x
which node      # → ~/.nvm/versions/node/v20.x.x/bin/node

# v25 に戻したいとき
nvm use 25
```

#### 対策B: まず v25 で試してから決める（楽な順）

```bash
# 1. v25 のまま pnpm install → pnpm build → pnpm test
# 2. もし通れば、nvm不要。そのまま進む
# 3. もし落ちたら、その時点で nvm install 20
```

これが最も手間が少ない。ほとんどの場合 v25 でも動く。

---

## 5. デプロイ手順

上記の全対策を組み込んだデプロイ手順。

### Step 1: 事前確認

```bash
# リソース空き確認
free -h
df -h /
df -h /home

# Node.js バージョン確認
node --version
npm --version
pnpm --version

# もし v25 なら、念のため nvm で v20 を準備（Step 3判断）
```

### Step 2: PostgreSQL 16 インストール（対策①）

```bash
# データディレクトリを /home に確保
sudo mkdir -p /home/postgresql-data/16
sudo chown postgres:postgres /home/postgresql-data/16

# PostgreSQL インストール
sudo apt install -y postgresql-16

# デフォルトclusterを削除（/var/lib/ に作られるため）
sudo pg_dropcluster 16 main --stop

# /home にclusterを作り直し
sudo pg_createcluster 16 main --datadir /home/postgresql-data/16/main

# メモリ設定を反映（対策②）
sudo sed -i "s/^#shared_buffers = 128MB/shared_buffers = 512MB/" \
  /home/postgresql-data/16/main/postgresql.conf
sudo sed -i "s/^#work_mem = 4MB/work_mem = 16MB/" \
  /home/postgresql-data/16/main/postgresql.conf
sudo sed -i "s/^#max_wal_size = 1GB/max_wal_size = 1GB/" \
  /home/postgresql-data/16/main/postgresql.conf

# PostgreSQL 再起動
sudo systemctl restart postgresql@16-main

# 接続確認
sudo -u postgres psql -c "SELECT version();"
```

### Step 3: Node.js 準備（対策③）

```bash
# 現在のバージョンでまず試す
node --version  # v25.x.x

# v25でビルドが通ればそのまま進む。落ちたらnvm:
# curl -o- https://raw.githubusercontent.com/nvm-sh/nvm/v0.40.3/install.sh | bash
# nvm install 20 && nvm alias default 20
```

### Step 4: GRKD-Jisho デプロイ

```bash
# リポジトリを clone または Windows から転送
cd /home/kasou_yoshia
git clone https://github.com/GoRakuDo/GRKD-Jisho.git

cd GRKD-Jisho

# 依存関係インストール
pnpm install

# 環境変数設定
cp .env.example .env
# → .env を編集（以下参照）

# DB migration + seed
pnpm db:migrate
pnpm db:seed

# Slash Command 登録
pnpm bot:register

# 型チェック
pnpm -r typecheck
```

### Step 5: .env 設定

最低限必要な変数:

```env
DATABASE_URL=postgresql://grkd_jisho:your_password@localhost:5432/grkd_jisho
DISCORD_TOKEN=your_discord_bot_token
DISCORD_CLIENT_ID=your_discord_client_id
DISCORD_GUILD_ID=your_guild_id
DISCORD_ALLOWED_CHANNELS=channel_id_1,channel_id_2
DISCORD_CLIENT_SECRET=your_client_secret
SESSION_SECRET=your_32char_random_secret
GEMINI_API_KEY=your_gemini_api_key
WEB_BASE_URL=http://192.168.100.46:4321
```

### Step 6: systemd service 登録

```ini
# /etc/systemd/system/grkd-jisho-bot.service
[Unit]
Description=GRKD-Jisho Discord Bot
After=network.target postgresql@16-main.service
Requires=postgresql@16-main.service

[Service]
Type=simple
User=kasou_yoshia
WorkingDirectory=/home/kasou_yoshia/GRKD-Jisho
ExecStart=/home/kasou_yoshia/.nvm/versions/node/v20.x.x/bin/node \
  packages/bot/dist/index.js
Restart=on-failure
RestartSec=10
Environment=NODE_ENV=production
EnvironmentFile=/home/kasou_yoshia/GRKD-Jisho/.env
# OOMスコアはデフォルト（通常値）
OOMScoreAdjust=0

[Install]
WantedBy=multi-user.target
```

```ini
# /etc/systemd/system/grkd-jisho-web.service
[Unit]
Description=GRKD-Jisho Web Admin UI
After=network.target postgresql@16-main.service
Requires=postgresql@16-main.service

[Service]
Type=simple
User=kasou_yoshia
WorkingDirectory=/home/kasou_yoshia/GRKD-Jisho
ExecStart=/home/kasou_yoshia/.nvm/versions/node/v20.x.x/bin/node \
  packages/web/dist/server/entry.mjs
Restart=on-failure
RestartSec=10
Environment=NODE_ENV=production
EnvironmentFile=/home/kasou_yoshia/GRKD-Jisho/.env

[Install]
WantedBy=multi-user.target
```

登録と起動:

```bash
sudo systemctl daemon-reload
sudo systemctl enable --now grkd-jisho-bot
sudo systemctl enable --now grkd-jisho-web
sudo systemctl status grkd-jisho-bot --no-pager
```

### Step 7: 自動起動確認

```bash
sudo systemctl list-dependencies postgresql@16-main.service
# → PostgreSQL 起動後に Bot と Web が自動起動することを確認
```

---

## 6. 動作確認チェックリスト

### デプロイ後確認

- [ ] `psql -U grkd_jisho -d grkd_jisho -c "SELECT count(*) FROM dictionary_entries;"` → 0以上
- [ ] `sudo systemctl status grkd-jisho-bot --no-pager` → active (running)
- [ ] `sudo systemctl status grkd-jisho-web --no-pager` → active (running)
- [ ] `curl -s http://localhost:4321/api/health` → `{"status":"ok"}`
- [ ] DennouAibou の動作に変化がない → `systemctl --user status openclaw-gateway --no-pager`
- [ ] 空きRAM: `free -h` → Bot/PG追加後も **3GB以上** 残っている
- [ ] 空き /: `df -h /` → 20GB以上残っている

### VNC 同時使用時の確認

VNCからFirefoxを開いてWeb Admin UI(`http://192.168.100.46:4321`)にアクセスし、
DennouAibouとの会話が同時に遅くならないことを確認する。

### 再起動確認（重要）

```bash
sudo reboot
# → 起動後、自動で全サービスが立ち上がることを確認
# → DennouAibou も自動起動することを確認
```

---

## 7. 緊急時対応

### A) PostgreSQL が落ちた

```bash
sudo systemctl status postgresql@16-main
sudo journalctl -u postgresql@16-main -n 50 --no-pager

# 典型的な原因と対処:
# / の空き不足 → df -h / を確認し、不要ファイルを削除
# データ破損 → pg_dump からのリストアが必要か確認
```

### B) Bot が落ちた

```bash
# systemd が自動再起動する（Restart=on-failure）
sudo journalctl -u grkd-jisho-bot -n 50 --no-pager

# 再起動されない場合
sudo systemctl restart grkd-jisho-bot
```

### C) DennouAibou が落ちた（GRKD-Jishoが原因の疑い）

```bash
# 原因特定
dmesg | grep -i "oom"
sudo journalctl -k -n 30 --no-pager

# 応急処置: GRKD-Jisho Bot を一時停止
sudo systemctl stop grkd-jisho-bot
sudo systemctl stop grkd-jisho-web

# DennouAibou 再起動
systemctl --user restart openclaw-gateway

# メモリ空き確認
free -h

# 原因がRAM不足なら、postgresql.conf の shared_buffers を減らす
# → 256MB に変更して Bot/Web 再開
```

### D) 全サービス再起動（正しい順序）

```bash
# 順序厳守:
sudo systemctl restart postgresql@16-main       # 1. DB
sleep 3
sudo systemctl restart grkd-jisho-bot           # 2. Bot
sudo systemctl restart grkd-jisho-web           # 3. Web
systemctl --user restart openclaw-gateway       # 4. DennouAibou（最後。他に依存しない）
```

---

## 参考

- [deploy.md](./deploy.md) — Docker/Railway デプロイ手順（汎用）
- [agent-runbook.md](./agent-runbook.md) — AI Agent 向け運用手順
