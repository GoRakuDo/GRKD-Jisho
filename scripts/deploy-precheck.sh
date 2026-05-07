#!/usr/bin/env bash
# GRKD-Jisho デプロイ前チェック (Linux/macOS)
# Usage: bash scripts/deploy-precheck.sh
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
NC='\033[0m'

PASS=0
FAIL=0
WARN=0

step() { echo -e "\n${CYAN}━━━ $* ━━━${NC}"; }
ok()   { PASS=$((PASS+1)); echo -e "  ${GREEN}✅${NC} $*"; }
warn() { WARN=$((WARN+1)); echo -e "  ${YELLOW}⚠${NC} $*"; }
fail() { FAIL=$((FAIL+1)); echo -e "  ${RED}❌${NC} $*"; }

# ── Required env vars ────────────────────────────────────
step "必須 env の確認"

REQUIRED_VARS=(
    DISCORD_TOKEN
    DISCORD_CLIENT_ID
    DISCORD_GUILD_ID
    DISCORD_ALLOWED_CHANNELS
    DATABASE_URL
    GEMINI_API_KEY
)

if [ -f .env ]; then
    ok ".env ファイルが存在します"
    for var in "${REQUIRED_VARS[@]}"; do
        val=$(grep -E "^${var}=" .env | head -1 | sed "s/^${var}=//")
        if [ -z "$val" ]; then
            warn "$var が空か見つかりません"
        else
            ok "$var が設定されています"
        fi
    done

    # Production DB detection
    db_url=$(grep -E "^DATABASE_URL=" .env | head -1 | sed 's/^DATABASE_URL=//')
    if echo "$db_url" | grep -qvE 'localhost|127\.0\.0\.1'; then
        warn "本番 DATABASE_URL を検出しました。migration は手動で実行してください。"
    fi
else
    fail ".env ファイルが見つかりません"
    warn ".env.example をコピーして必要な値を設定してください: cp .env.example .env"
fi

# ── .env.example diff ────────────────────────────────────
step ".env.example との比較"

if [ -f .env ] && [ -f .env.example ]; then
    example_keys=$(grep -E '^[A-Z_]+=' .env.example | sed 's/=.*//' | sort)
    env_keys=$(grep -E '^[A-Z_]+=' .env | sed 's/=.*//' | sort)
    diff_keys=$(comm -13 <(echo "$example_keys") <(echo "$env_keys") 2>/dev/null || true)
    if [ -n "$diff_keys" ]; then
        warn ".env.example にない env キーがあります:"
        echo "$diff_keys" | while IFS= read -r k; do echo "      $k"; done
    else
        ok ".env は .env.example と一致しています"
    fi
fi

# ── Docker build ─────────────────────────────────────────
step "Docker build テスト"

echo -e "  [1/2] bot Docker build..."
if docker build -f packages/bot/Dockerfile -t grkd-jisho-bot:precheck .; then
    ok "grkd-jisho-bot:precheck build 成功"
else
    fail "grkd-jisho-bot build 失敗"
fi

echo -e "  [2/2] web Docker build..."
if docker build -f packages/web/Dockerfile -t grkd-jisho-web:precheck .; then
    ok "grkd-jisho-web:precheck build 成功"
else
    fail "grkd-jisho-web build 失敗"
fi

# ── Typecheck ────────────────────────────────────────────
step "TypeScript 型チェック"

echo -e "  [1/4] db build..."
if pnpm --filter @grkd-jisho/db run build; then ok "@grkd-jisho/db build OK"; else fail "@grkd-jisho/db build 失敗"; fi

echo -e "  [2/4] bot tsc..."
if pnpm --filter @grkd-jisho/bot exec tsc --noEmit; then ok "@grkd-jisho/bot tsc OK"; else fail "@grkd-jisho/bot tsc 失敗"; fi

echo -e "  [3/4] mcp tsc..."
if pnpm --filter @grkd-jisho/mcp exec tsc --noEmit; then ok "@grkd-jisho/mcp tsc OK"; else fail "@grkd-jisho/mcp tsc 失敗"; fi

echo -e "  [4/4] web astro check..."
if pnpm --filter @grkd-jisho/web exec astro check; then ok "@grkd-jisho/web astro check OK"; else fail "@grkd-jisho/web astro check 失敗"; fi

# ── MCP safety ───────────────────────────────────────────
step "MCP 安全設定の確認"

MCP_READONLY="${MCP_READONLY_MODE:-}"
MCP_LIMITED_WRITE="${MCP_ENABLE_LIMITED_WRITE:-}"

if [ -z "$MCP_READONLY" ]; then
    warn "MCP_READONLY_MODE が未設定 (本番では true を推奨)"
elif [ "$MCP_READONLY" = "true" ]; then
    ok "MCP_READONLY_MODE=true (Read-only)"
else
    warn "MCP_READONLY_MODE=$MCP_READONLY (書き込みモード。本番では true を推奨)"
fi

if [ "$MCP_LIMITED_WRITE" = "true" ]; then
    warn "MCP_ENABLE_LIMITED_WRITE=true (Level 3 書き込み有効。運用状況を確認してください)"
else
    ok "MCP_ENABLE_LIMITED_WRITE は無効"
fi

# ── Wipe check ───────────────────────────────────────────
step "Wipe 運用前チェック"
echo -e "  Wipe を有効にする前に以下を確認してください:"
echo -e "    1. Bot に ManageMessages / ReadMessageHistory / SendMessages 権限がある"
echo -e "    2. 固定メッセージ（ピン留め）は削除されない"
echo -e "    3. Wipe は 00:00 Asia/Jakarta に自動実行される"
echo -e "    4. /wipe-channel スラッシュコマンドでチャンネル単位で有効/無効を管理"
echo -e "    5. 緊急時は UPDATE channel_settings SET wipe_enabled = false で停止"

# ── Migration notice ─────────────────────────────────────
step "Migration 注意"
echo -e "  DB migration は以下を手動で実行してください:"
echo -e "    pnpm db:migrate"
echo -e ""
echo -e "  本番環境で migration を実行する前に、必ずバックアップを取得してください。"

# ── Result ───────────────────────────────────────────────
step "チェック結果"
echo ""
echo -e "  合格: ${PASS}"
echo -e "  警告: ${WARN}"
echo -e "  不合格: ${FAIL}"
echo ""
if [ "$FAIL" -eq 0 ]; then
    echo -e "  ${GREEN}✅ デプロイ準備は整っています。${NC}"
    exit 0
else
    echo -e "  ${RED}❌ 不合格項目を修正してからデプロイしてください。${NC}"
    exit 1
fi
