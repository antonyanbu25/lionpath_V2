# Run VPS upgrade (git pull + docker rebuild) from Windows via SSH.
# Usage:
#   .\deploy\vps\upgrade-from-windows.ps1 -VpsHost root@YOUR_VPS_IP
#
# Requires OpenSSH ssh on Windows.

param(
  [Parameter(Mandatory = $true)]
  [string]$VpsHost,
  [string]$RemoteDeploy = "/opt/se-singha-paathai/deploy/vps"
)

$ErrorActionPreference = "Stop"
$Api = "https://portalapi.benjaminsquare.com/api/config"

function Get-SchemaFixStatus {
  try {
    $json = curl.exe -sf $Api | ConvertFrom-Json
    return @{
      workerBuild = [string]$json.workerBuild
      schemaFix = [string]$json.geminiSchemaEnumFix
      patched = [bool]$json.geminiSchemaEnumFix
    }
  } catch {
    return @{ workerBuild = ""; schemaFix = ""; patched = $false; error = $_.Exception.Message }
  }
}

Write-Host "=== Before upgrade (production API) ==="
$before = Get-SchemaFixStatus
Write-Host "workerBuild: $($before.workerBuild)"
Write-Host "geminiSchemaEnumFix: $($before.schemaFix)"
if ($before.patched) {
  Write-Host "Already patched — skipping SSH upgrade."
  exit 0
}

Write-Host ""
Write-Host "=== SSH upgrade on $VpsHost ==="
ssh $VpsHost "cd $RemoteDeploy && bash upgrade-now.sh && bash verify-deploy.sh"

Write-Host ""
Write-Host "=== After upgrade (production API) ==="
Start-Sleep -Seconds 5
$after = Get-SchemaFixStatus
Write-Host "workerBuild: $($after.workerBuild)"
Write-Host "geminiSchemaEnumFix: $($after.schemaFix)"
if (-not $after.patched) {
  Write-Host "FAIL: production still missing geminiSchemaEnumFix." -ForegroundColor Red
  Write-Host "Check VPS logs: ssh $VpsHost 'cd $RemoteDeploy && docker compose logs worker --tail 50'"
  exit 1
}

Write-Host "OK: schema fix is live on production." -ForegroundColor Green
