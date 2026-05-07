<#
.SYNOPSIS
  GRKD-Jisho ローカル開発環境 初回セットアップ (PowerShell 7+)
.DESCRIPTION
  Node.js / pnpm / Docker の確認から DB migration、seed、typecheck までを
  1コマンドで実行する。.env が無ければ .env.example から自動作成する。
  危険操作（本番DB migration / wipe / API呼び出し）は実行しない。
.NOTES
  Version: 1.0.0
#>

$ErrorActionPreference = 'Stop'

# リポジトリルートに移動
Set-Location (Split-Path -Parent $PSScriptRoot)

# ── Utility ──────────────────────────────────────────────
function Write-Step {
    param([string]$Message)
    Write-Output ""
    Write-Output "━━━ $Message ━━━"
}

function Assert-Command {
    param([string]$Name)
    if (-not (Get-Command $Name -ErrorAction SilentlyContinue)) {
        Write-Error "'$Name' が見つかりません。インストールしてください。"
        exit 1
    }
    Write-Output "  ✅ $Name 確認 OK"
}

function Assert-NodeVersion {
    $raw = & node --version 2>&1
    if ($LASTEXITCODE -ne 0) { Write-Error "Node.js の取得に失敗"; exit 1 }
    $ver = [System.Version]($raw.Trim() -replace '^v', '')
    if ($ver.Major -lt 20) {
        Write-Error "Node.js 20+ が必要です (現在: v$($ver.Major).$($ver.Minor))"
        exit 1
    }
    Write-Output "  ✅ Node.js $($raw.Trim())"
}

function Assert-DockerCompose {
    docker compose version 2>&1 | Out-Null
    if ($LASTEXITCODE -ne 0) {
        Write-Error "Docker Compose (docker compose) が見つかりません"
        exit 1
    }
    Write-Output "  ✅ docker compose 確認 OK"
}

# ── Main ─────────────────────────────────────────────────
Write-Output "╔══════════════════════════════════════════════╗"
Write-Output "║   GRKD-Jisho 開発環境セットアップ           ║"
Write-Output "╚══════════════════════════════════════════════╝"

Write-Step "依存関係の確認"
Assert-Command "node"
Assert-Command "pnpm"
Assert-Command "docker"
Assert-DockerCompose

# Docker daemon 稼働確認
docker info 2>&1 | Out-Null
if ($LASTEXITCODE -ne 0) { Write-Error "Docker daemon が起動していません"; exit 1 }

Assert-NodeVersion

Write-Step ".env の準備"
$envPath = ".\env"
$envExamplePath = ".\env.example"

if (Test-Path $envPath) {
    Write-Output "  ✅ .env は既に存在します (上書きしません)"
} else {
    if (-not (Test-Path $envExamplePath)) {
        Write-Error ".env.example が見つかりません"
        exit 1
    }
    Copy-Item $envExamplePath $envPath
    Write-Output "  ✅ .env.example から .env を作成しました"
    Write-Output "  ⚠  必要な値を .env に設定してください (DISCORD_TOKEN, GEMINI_API_KEY など)"
}

Write-Step "依存パッケージのインストール"
& pnpm install
if ($LASTEXITCODE -ne 0) { Write-Error "pnpm install 失敗"; exit 1 }
Write-Output "  ✅ pnpm install 完了"

Write-Step "PostgreSQL の起動 (Docker Compose)"
& docker compose -f "docker-compose.yml" up -d postgres
if ($LASTEXITCODE -ne 0) { Write-Error "PostgreSQL 起動失敗"; exit 1 }
Write-Output "  ✅ PostgreSQL 起動"

# Wait for PostgreSQL to be ready
Write-Output "  PostgreSQL の起動待機..."
$maxRetries = 30
$retryCount = 0
do {
    & docker compose -f "docker-compose.yml" exec -T postgres pg_isready -U grkd 2>&1 | Out-Null
    if ($LASTEXITCODE -eq 0) { break }
    $retryCount++
    Start-Sleep -Seconds 1
} while ($retryCount -lt $maxRetries)

if ($retryCount -ge $maxRetries) {
    Write-Error "PostgreSQL が起動しません"
    exit 1
}
Write-Output "  ✅ PostgreSQL 接続確認 OK"

Write-Step "DB migration"
& pnpm db:migrate
if ($LASTEXITCODE -ne 0) { Write-Error "DB migration 失敗"; exit 1 }
Write-Output "  ✅ DB migration 完了"

Write-Step "デフォルトデータ投入"
& pnpm db:seed
if ($LASTEXITCODE -ne 0) { Write-Error "DB seed 失敗"; exit 1 }
Write-Output "  ✅ DB seed 完了"

Write-Step "パッケージビルド"
& pnpm --filter @grkd-jisho/db run build
if ($LASTEXITCODE -ne 0) { Write-Error "@grkd-jisho/db ビルド失敗"; exit 1 }
Write-Output "  ✅ @grkd-jisho/db ビルド完了"

Write-Step "型チェック"
Write-Output "  [1/3] bot tsc..."
& pnpm --filter @grkd-jisho/bot exec tsc --noEmit
if ($LASTEXITCODE -ne 0) { Write-Error "@grkd-jisho/bot 型チェック失敗"; exit 1 }
Write-Output "  ✅ @grkd-jisho/bot 型チェック OK"

Write-Output "  [2/3] mcp tsc..."
& pnpm --filter @grkd-jisho/mcp exec tsc --noEmit
if ($LASTEXITCODE -ne 0) { Write-Error "@grkd-jisho/mcp 型チェック失敗"; exit 1 }
Write-Output "  ✅ @grkd-jisho/mcp 型チェック OK"

Write-Output "  [3/3] web astro check..."
& pnpm --filter @grkd-jisho/web exec astro check
if ($LASTEXITCODE -ne 0) { Write-Error "@grkd-jisho/web 型チェック失敗"; exit 1 }
Write-Output "  ✅ @grkd-jisho/web 型チェック OK"

Write-Step "セットアップ完了"
Write-Output "╔══════════════════════════════════════════════╗"
Write-Output "║   次に実行するコマンド                       ║"
Write-Output "╠══════════════════════════════════════════════╣"
Write-Output "║  (1) Slash Command 登録                      ║"
Write-Output "║    pnpm bot:register                         ║"
Write-Output "║                                              ║"
Write-Output "║  (2) Bot 起動 (開発モード)                   ║"
Write-Output "║    pnpm bot:dev                              ║"
Write-Output "║                                              ║"
Write-Output "║  (3) Web UI 起動 (開発モード)                ║"
Write-Output "║    pnpm web:dev                              ║"
Write-Output "╚══════════════════════════════════════════════╝"
