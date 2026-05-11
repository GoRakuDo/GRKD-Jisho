Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

$repoRoot = $PSScriptRoot
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

Write-Host "Repo root: $repoRoot" -ForegroundColor DarkGray

Invoke-Step -Name 'Codesight wiki + scan' -Command {
  # Pinned for reproducibility; update intentionally when bumping Codesight.
  npx --yes codesight@1.14.0 --wiki
}

Invoke-Step -Name 'Graphify update' -Command {
  python -m graphify update .
}

Write-Host "\nDone." -ForegroundColor Green
Write-Host "Codesight: .codesight/wiki/index.md" -ForegroundColor DarkGray
Write-Host "Graphify:  graphify-out/GRAPH_REPORT.md" -ForegroundColor DarkGray
Write-Host "Graphify:  graphify-out/graph.html" -ForegroundColor DarkGray
Write-Host "Graphify:  graphify-out/graph.json" -ForegroundColor DarkGray
