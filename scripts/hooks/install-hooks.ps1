Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

$repoRoot = Split-Path -Parent (Split-Path -Parent $PSScriptRoot)
$gitHooksDir = Join-Path $repoRoot '.git/hooks'
$source = Join-Path $PSScriptRoot 'pre-push'
$target = Join-Path $gitHooksDir 'pre-push'

if (-not (Test-Path -LiteralPath $gitHooksDir)) {
  throw "Git hooks directory not found: $gitHooksDir"
}

Copy-Item -LiteralPath $source -Destination $target -Force
Write-Host "Installed pre-push hook: $target" -ForegroundColor Green
