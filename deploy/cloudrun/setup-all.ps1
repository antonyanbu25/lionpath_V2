#Requires -Version 5.1
# Run all Cloud Run setup steps in order (Windows).
# Prerequisite: gcloud auth login && gcloud config set project se-singha-paathi
# Manual: deploy/cloudrun/CONNECT-GITHUB.md (GitHub repo connection)
param(
  [string]$Project = "se-singha-paathi"
)

$ErrorActionPreference = "Stop"
$root = Split-Path (Split-Path $PSScriptRoot -Parent) -Parent
Set-Location $root

$gcloud = Get-Command gcloud -ErrorAction SilentlyContinue
if (-not $gcloud) {
  $gcloudPath = "$env:LOCALAPPDATA\Google\Cloud SDK\google-cloud-sdk\bin\gcloud.cmd"
  if (Test-Path $gcloudPath) { $env:Path = "$(Split-Path $gcloudPath -Parent);$env:Path" }
}
if (-not (Get-Command gcloud -ErrorAction SilentlyContinue)) {
  Write-Error "Install Google Cloud SDK, then run: gcloud auth login"
}

$accounts = gcloud auth list --filter=status:ACTIVE --format="value(account)" 2>$null
if (-not $accounts) {
  Write-Error "No active gcloud account. Run: gcloud auth login"
}

Write-Host "=== Step 1/5: GCP one-time setup ==="
& "$PSScriptRoot\setup-gcp.ps1" -Project $Project

Write-Host ""
Write-Host "=== Step 2/5: Firebase secret ==="
& "$PSScriptRoot\setup-firebase-secret.ps1" -Project $Project

Write-Host ""
Write-Host "=== Step 3/5: First build + deploy ==="
Write-Host "Submitting Cloud Build..."
gcloud builds submit . --config deploy/cloudrun/cloudbuild.yaml --project $Project

Write-Host ""
Write-Host "=== Step 4/5: Cloud Build trigger ==="
Write-Host "If GitHub is not connected yet, complete CONNECT-GITHUB.md first, then re-run:"
Write-Host "  .\deploy\cloudrun\setup-trigger.ps1"
try {
  & "$PSScriptRoot\setup-trigger.ps1" -Project $Project
} catch {
  Write-Warning "Trigger creation failed (GitHub repo may not be connected yet): $_"
}

Write-Host ""
Write-Host "=== Step 5/5: Custom domains (optional) ==="
Write-Host "When *.run.app URLs work, run:"
Write-Host "  bash deploy/cloudrun/setup-domains.sh"
Write-Host "  Firebase Console -> Authorized domains -> portal.benjaminsquare.com"
Write-Host ""
Write-Host "=== Done ==="
