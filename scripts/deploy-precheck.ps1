<#
.SYNOPSIS
  GRKD-Jisho デプロイ前チェック (PowerShell 7+)
.DESCRIPTION
  本番デプロイ前に、必須 env / Docker build / typecheck / MCP安全設定を
  チェックする。危険操作（本番DB migration / wipe / API呼び出し）は
  自動実行せず、確認表示のみ行う。
.NOTES
  Version: 1.0.0
#>

$ErrorActionPreference = 'Stop'

# ── Utility ──────────────────────────────────────────────
$passCount = 0
$failCount = 0
$warnCount = 0

function Write-Pass {
    param([string]$Message)
    $script:passCount++
    Write-Output "  ✅ $Message"
}

function Write-Fail {
    param([string]$Message)
    $script:failCount++
    Write-Output "  ❌ $Message"
}

function Write-Warn {
    param([string]$Message)
    $script:warnCount++
    Write-Output "  ⚠  $Message"
}

function Write-Step {
    param([string]$Message)
    Write-Output ""
    Write-Output "━━━ $Message ━━━"
}

# ── Main ─────────────────────────────────────────────────
Write-Output "╔══════════════════════════════════════════════╗"
Write-Output "║   GRKD-Jisho デプロイ前チェック             ║"
Write-Output "╚══════════════════════════════════════════════╝"

Write-Step "code-reviewer approval gate"
try {
    $result = & pnpm review:check 2>&1
    if ($LASTEXITCODE -eq 0) {
        Write-Pass "code-reviewer APPROVE marker confirmed"
        Write-Output $result
    } else {
        Write-Fail "code-reviewer APPROVE marker がありません"
        Write-Warn "@code-reviewer を実行し、APPROVE後に pnpm review:approve を実行してください"
        Write-Output $result
    }
}
catch {
    Write-Fail "review gate の実行に失敗: $($_.Exception.Message)"
}

Write-Step "pnpm deploy:check (環境変数・前提条件)"
try {
    $result = & pnpm --filter @grkd-jisho/db run deploy:check 2>&1
    if ($LASTEXITCODE -eq 0) {
        Write-Pass "pnpm deploy:check 合格"
    } else {
        Write-Fail "pnpm deploy:check で不合格項目あり"
        Write-Warn "上記の不合格項目を修正してから再度実行してください"
        Write-Output $result
    }
}
catch {
    Write-Fail "pnpm deploy:check の実行に失敗: $($_.Exception.Message)"
}

Write-Step "Docker build テスト"
Write-Output "  [1/2] bot Docker build..."
& docker build -f "packages/bot/Dockerfile" -t grkd-jisho-bot:precheck .
if ($LASTEXITCODE -eq 0) {
    Write-Pass "grkd-jisho-bot:precheck build 成功"
} else {
    Write-Fail "grkd-jisho-bot build 失敗"
}

Write-Output "  [2/2] web Docker build..."
& docker build -f "packages/web/Dockerfile" -t grkd-jisho-web:precheck .
if ($LASTEXITCODE -eq 0) {
    Write-Pass "grkd-jisho-web:precheck build 成功"
} else {
    Write-Fail "grkd-jisho-web build 失敗"
}

Write-Step "TypeScript 型チェック"
Write-Output "  [1/4] db build..."
& pnpm --filter @grkd-jisho/db run build
if ($LASTEXITCODE -eq 0) { Write-Pass "@grkd-jisho/db build OK" }
else { Write-Fail "@grkd-jisho/db build 失敗" }

Write-Output "  [2/4] bot tsc..."
& pnpm --filter @grkd-jisho/bot exec tsc --noEmit
if ($LASTEXITCODE -eq 0) { Write-Pass "@grkd-jisho/bot tsc OK" }
else { Write-Fail "@grkd-jisho/bot tsc 失敗" }

Write-Output "  [3/4] mcp tsc..."
& pnpm --filter @grkd-jisho/mcp exec tsc --noEmit
if ($LASTEXITCODE -eq 0) { Write-Pass "@grkd-jisho/mcp tsc OK" }
else { Write-Fail "@grkd-jisho/mcp tsc 失敗" }

Write-Output "  [4/4] web astro check..."
& pnpm --filter @grkd-jisho/web exec astro check
if ($LASTEXITCODE -eq 0) { Write-Pass "@grkd-jisho/web astro check OK" }
else { Write-Fail "@grkd-jisho/web astro check 失敗" }

Write-Step "MCP 安全設定の確認"
$mcpReadonly = $env:MCP_READONLY_MODE
$mcpDryRun = $env:MCP_ENABLE_DRY_RUN
$mcpLimitedWrite = $env:MCP_ENABLE_LIMITED_WRITE

if ([string]::IsNullOrEmpty($mcpReadonly)) {
    Write-Warn "MCP_READONLY_MODE が未設定 (本番では true を推奨)"
} elseif ($mcpReadonly -eq 'true') {
    Write-Pass "MCP_READONLY_MODE=true (Read-only)"
} else {
    Write-Warn "MCP_READONLY_MODE=$mcpReadonly (書き込みモード。本番では true を推奨)"
}

if ($mcpLimitedWrite -eq 'true') {
    Write-Warn "MCP_ENABLE_LIMITED_WRITE=true (Level 3 書き込み有効。運用状況を確認してください)"
} else {
    Write-Pass "MCP_ENABLE_LIMITED_WRITE は無効"
}

Write-Step "Wipe 運用前チェック"
Write-Output "  Wipe を有効にする前に以下を確認してください:"
Write-Output "    1. Bot に ManageMessages / ReadMessageHistory / SendMessages 権限がある"
Write-Output "    2. 固定メッセージ（ピン留め）は削除されない"
Write-Output "    3. Wipe は 00:00 Asia/Jakarta に自動実行される"
Write-Output "    4. /wipe-channel スラッシュコマンドでチャンネル単位で有効/無効を管理"
Write-Output "    5. 緊急時は UPDATE channel_settings SET wipe_enabled = false で停止"

Write-Step "Migration 注意"
Write-Output "  DB migration は以下を手動で実行してください:"
Write-Output "    pnpm db:migrate"
Write-Output ""
Write-Output "  本番環境で migration を実行する前に、必ずバックアップを取得してください。"

Write-Step "チェック結果"
Write-Output ""
Write-Output "  合格: $passCount"
if ($warnCount -gt 0) { Write-Output "  警告: $warnCount" }
if ($failCount -gt 0) { Write-Output "  不合格: $failCount" }
Write-Output ""
if ($failCount -eq 0) {
    Write-Output "  ✅ デプロイ準備は整っています。"
    exit 0
}
else {
    Write-Output "  ❌ 不合格項目を修正してからデプロイしてください。"
    exit 1
}
