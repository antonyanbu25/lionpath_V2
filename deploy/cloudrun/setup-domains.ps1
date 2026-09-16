#Requires -Version 5.1
# Map custom domains to Cloud Run (Windows).
param(
  [string]$Project = "se-singha-paathi",
  [string]$Region = "us-central1"
)

$ErrorActionPreference = "Stop"
gcloud config set project $Project

Write-Host "==> portal.benjaminsquare.com -> prep-portal-web"
gcloud beta run domain-mappings create --service prep-portal-web --domain portal.benjaminsquare.com --region $Region --project $Project 2>$null
if ($LASTEXITCODE -ne 0) {
  gcloud beta run domain-mappings describe --domain portal.benjaminsquare.com --region $Region --project $Project
}

Write-Host "==> portalapi.benjaminsquare.com -> prep-portal-api"
gcloud beta run domain-mappings create --service prep-portal-api --domain portalapi.benjaminsquare.com --region $Region --project $Project 2>$null
if ($LASTEXITCODE -ne 0) {
  gcloud beta run domain-mappings describe --domain portalapi.benjaminsquare.com --region $Region --project $Project
}

Write-Host ""
Write-Host "Add CNAME records in DNS (grey cloud / DNS only)."
Write-Host "Firebase Console -> Authentication -> Authorized domains -> portal.benjaminsquare.com"
