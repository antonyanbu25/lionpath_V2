# Push local web/ to VPS and restart containers (post-call UI hotfix).
# Usage:
#   .\deploy\vps\push-web-from-windows.ps1 -VpsHost root@YOUR_VPS_IP
#
# Requires OpenSSH scp/ssh on Windows (Settings → Apps → Optional features → OpenSSH Client).

param(
  [Parameter(Mandatory = $true)]
  [string]$VpsHost,
  [string]$RepoRoot = (Resolve-Path (Join-Path $PSScriptRoot "..\..")).Path,
  [string]$RemoteWeb = "/opt/se-singha-paathai/web",
  [string]$RemoteDeploy = "/opt/se-singha-paathai/deploy/vps"
)

$ErrorActionPreference = "Stop"
$web = Join-Path $RepoRoot "web"

if (-not (Test-Path (Join-Path $web "index.html"))) {
  throw "web/index.html not found under $RepoRoot"
}

$html = Get-Content (Join-Path $web "index.html") -Raw
if ($html -notmatch "postcall-intake-card") {
  throw "Local web/index.html missing postcall-intake-card — wrong branch/checkout?"
}
if ($html -match 'id="pc-company-name"') {
  throw "Local web/index.html still has legacy pc-company-name field."
}

Write-Host "=== Local portal-build ==="
Select-String -Path (Join-Path $web "index.html") -Pattern 'portal-build" content="([^"]+)"' | ForEach-Object { $_.Matches.Groups[1].Value }

Write-Host "=== Uploading web/* to ${VpsHost}:${RemoteWeb} ==="
scp -r "$web\*" "${VpsHost}:${RemoteWeb}/"

Write-Host "=== Restart web + rebuild worker on VPS ==="
ssh $VpsHost @"
set -e
cd $RemoteDeploy
docker compose up -d --force-recreate web
docker compose build --no-cache worker
docker compose up -d
echo '=== Portal HTML check ==='
grep -o 'portal-build\" content=\"[^\"]*\"' $RemoteWeb/index.html | head -1
grep -q postcall-intake-card $RemoteWeb/index.html && echo 'OK: postcall-intake-card present' || echo 'FAIL: postcall-intake-card missing'
grep -q 'id=\"pc-company-name\"' $RemoteWeb/index.html && echo 'FAIL: legacy pc-company-name still present' || echo 'OK: no legacy company field'
"@

Write-Host ""
Write-Host "=== Verify from this PC ==="
Write-Host 'curl.exe -sf "https://portal.benjaminsquare.com/" | findstr /i "portal-build postcall-intake pc-company-name"'
