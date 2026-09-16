#Requires -Version 5.1
# Upload web/firebase-config.local.js to Secret Manager. Run from repo root.
param(
  [string]$Project = "se-singha-paathi",
  [string]$SecretName = "firebase-config-local",
  [string]$ConfigFile = "web/firebase-config.local.js"
)

$ErrorActionPreference = "Stop"
if (-not (Get-Command gcloud -ErrorAction SilentlyContinue)) {
  Write-Error "gcloud not found. Install Google Cloud SDK first."
}
if (-not (Test-Path $ConfigFile)) {
  Write-Error "Missing $ConfigFile - copy web/firebase-config.local.example.js and fill Firebase values."
}

gcloud config set project $Project

$exists = gcloud secrets describe $SecretName --project=$Project 2>$null
if ($LASTEXITCODE -eq 0) {
  Write-Host "==> Updating secret $SecretName"
  gcloud secrets versions add $SecretName --data-file=$ConfigFile
} else {
  Write-Host "==> Creating secret $SecretName"
  gcloud secrets create $SecretName --data-file=$ConfigFile
}

$projectNumber = gcloud projects describe $Project --format="value(projectNumber)"
$cloudBuildSa = "${projectNumber}@cloudbuild.gserviceaccount.com"

Write-Host "==> Grant Cloud Build access to secret"
gcloud secrets add-iam-policy-binding $SecretName `
  --member="serviceAccount:$cloudBuildSa" `
  --role="roles/secretmanager.secretAccessor"

Write-Host "==> Done."
