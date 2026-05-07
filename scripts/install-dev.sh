#!/usr/bin/env bash
# GRKD-Jisho ローカル開発環境 初回セットアップ (Linux/macOS)
# Usage: bash scripts/install-dev.sh
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd -P)"
ROOT_DIR="$(cd "$SCRIPT_DIR/.." && pwd -P)"
cd "$ROOT_DIR"

# ── Color helpers ────────────────────────────────────────
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
RED='\033[0;31m'
CYAN='\033[0;36m'
BOLD='\033[1m'
NC='\033[0m' # No Color

step() { echo -e "\n${CYAN}━━━ $* ━━━${NC}"; }
ok()   { echo -e "  ${GREEN}✅${NC} $*"; }
warn() { echo -e "  ${YELLOW}⚠${NC} $*"; }
err()  { echo -e "  ${RED}❌${NC} $*"; exit 1; }

# ── Prerequisite checks ──────────────────────────────────
step "依存関係の確認"

if ! command -v node &>/dev/null; then err "node が見つかりません"; fi
NODE_MAJOR=$(node --version | sed 's/v//' | cut -d. -f1)
if [ "$NODE_MAJOR" -lt 20 ]; then err "Node.js 20+ が必要です (現在: $(node --version))"; fi
ok "Node.js $(node --version)"

if ! command -v pnpm &>/dev/null; then err "pnpm が見つかりません"; fi
ok "pnpm $(pnpm --version)"

if ! command -v docker &>/dev/null; then err "docker が見つかりません"; fi
ok "docker $(docker --version 2>/dev/null | head -1)"

if ! docker compose version &>/dev/null; then err "docker compose が見つかりません"; fi
ok "docker compose $(docker compose version 2>/dev/null)"

if ! docker info &>/dev/null; then err "Docker daemon が起動していません"; fi

# ── .env ──────────────────────────────────────────────────
step ".env の準備"

if [ -f .env ]; then
    ok ".env は既に存在します (上書きしません)"
else
    if [ ! -f .env.example ]; then err ".env.example が見つかりません"; fi
    cp .env.example .env
    ok ".env.example から .env を作成しました"
    warn "必要な値を .env に設定してください (DISCORD_TOKEN, GEMINI_API_KEY など)"
fi

# ── pnpm install ─────────────────────────────────────────
step "依存パッケージのインストール"
pnpm install || err "pnpm install 失敗"
ok "pnpm install 完了"

# ── PostgreSQL ────────────────────────────────────────────
step "PostgreSQL の起動 (Docker Compose)"
docker compose -f docker-compose.yml up -d postgres || err "PostgreSQL 起動失敗"
ok "PostgreSQL 起動"

echo -e "  PostgreSQL の起動待機..."
RETRIES=30
i=0
until docker compose -f docker-compose.yml exec -T postgres pg_isready -U grkd 2>/dev/null; do
    i=$((i+1))
    if [ "$i" -ge "$RETRIES" ]; then err "PostgreSQL が起動しません"; fi
    sleep 1
done
ok "PostgreSQL 接続確認 OK"

# ── DB migration ─────────────────────────────────────────
step "DB migration"
pnpm db:migrate || err "DB migration 失敗"
ok "DB migration 完了"

# ── DB seed ──────────────────────────────────────────────
step "デフォルトデータ投入"
pnpm db:seed || err "DB seed 失敗"
ok "DB seed 完了"

# ── Build packages ───────────────────────────────────────
step "パッケージビルド"
pnpm --filter @grkd-jisho/db run build || err "@grkd-jisho/db ビルド失敗"
ok "@grkd-jisho/db ビルド完了"

# ── Typecheck ────────────────────────────────────────────
step "型チェック"
echo -e "  [1/3] bot tsc..."
pnpm --filter @grkd-jisho/bot exec tsc --noEmit || err "@grkd-jisho/bot 型チェック失敗"
ok "@grkd-jisho/bot 型チェック OK"

echo -e "  [2/3] mcp tsc..."
pnpm --filter @grkd-jisho/mcp exec tsc --noEmit || err "@grkd-jisho/mcp 型チェック失敗"
ok "@grkd-jisho/mcp 型チェック OK"

echo -e "  [3/3] web astro check..."
pnpm --filter @grkd-jisho/web exec astro check || err "@grkd-jisho/web 型チェック失敗"
ok "@grkd-jisho/web 型チェック OK"

# ── Done ─────────────────────────────────────────────────
step "セットアップ完了"
echo ""
echo -e "${BOLD}次に実行するコマンド${NC}"
echo ""
echo -e "  ${GREEN}(1)${NC} Slash Command 登録"
echo -e "      ${CYAN}pnpm bot:register${NC}"
echo ""
echo -e "  ${GREEN}(2)${NC} Bot 起動 (開発モード)"
echo -e "      ${CYAN}pnpm bot:dev${NC}"
echo ""
echo -e "  ${GREEN}(3)${NC} Web UI 起動 (開発モード)"
echo -e "      ${CYAN}pnpm web:dev${NC}"
echo ""
