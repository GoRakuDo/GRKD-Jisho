param(
  [Parameter(ValueFromRemainingArguments = $true)]
  [string[]]$PushArgs = @()
)

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

$repoRoot = Split-Path -Parent $PSScriptRoot
Set-Location $repoRoot

function Invoke-Step {
  param(
    [Parameter(Mandatory = $true)]
    [string]$Name,
    [Parameter(Mandatory = $true)]
    [scriptblock]$Command
  )

  Write-Host "==> $Name" -ForegroundColor Cyan
  & $Command
  if ($LASTEXITCODE -ne 0) {
    throw "$Name failed with exit code $LASTEXITCODE"
  }
}

Invoke-Step -Name 'git push' -Command {
  & git push @PushArgs
}

$reindexScript = Join-Path $repoRoot 'reindex.ps1'
if (-not (Test-Path -LiteralPath $reindexScript)) {
  throw "reindex.ps1 not found: $reindexScript"
}

$logDir = Join-Path $repoRoot 'logs'
if (-not (Test-Path -LiteralPath $logDir)) {
  New-Item -ItemType Directory -Path $logDir | Out-Null
}

$stamp = Get-Date -Format 'yyyyMMdd-HHmmss'
$stdoutLog = Join-Path $logDir "reindex-$stamp.out.log"
$stderrLog = Join-Path $logDir "reindex-$stamp.err.log"
$pwshExe = Join-Path $PSHOME 'pwsh.exe'
if (-not (Test-Path -LiteralPath $pwshExe)) {
  $pwshExe = 'pwsh'
}

$startProcessArgs = @{
  FilePath = $pwshExe
  ArgumentList = @(
    '-NoProfile',
    '-ExecutionPolicy', 'Bypass',
    '-File', $reindexScript
  )
  WorkingDirectory = $repoRoot
  WindowStyle = 'Hidden'
  RedirectStandardOutput = $stdoutLog
  RedirectStandardError = $stderrLog
  PassThru = $true
}

$proc = Start-Process @startProcessArgs

# Fire-and-forget by design: push must not wait for reindex.
Write-Host "Reindex started in background (PID $($proc.Id))." -ForegroundColor Green
Write-Host "  stdout: $stdoutLog" -ForegroundColor DarkGray
Write-Host "  stderr: $stderrLog" -ForegroundColor DarkGray
