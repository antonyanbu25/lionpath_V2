#Requires -Version 5.1
# One-time GCP setup for Cloud Run (Windows). Run from repo root in PowerShell.
param(
  [string]$Project = "se-singha-paathi",
  [string]$Region = "us-central1",
  [string]$Repo = "prep-portal",
  [string]$Bucket = "se-singha-paathi-prep-history"
)

$ErrorActionPreference = "Stop"
$gcloud = Get-Command gcloud -ErrorAction SilentlyContinue
if (-not $gcloud) {
  Write-Error "gcloud not found. Install Google Cloud SDK and run: gcloud auth login"
}

Write-Host "==> Setting project $Project"
gcloud config set project $Project

Write-Host "==> Enabling APIs"
gcloud services enable run.googleapis.com artifactregistry.googleapis.com cloudbuild.googleapis.com secretmanager.googleapis.com storage.googleapis.com aiplatform.googleapis.com

Write-Host "==> Creating Artifact Registry repo (ignore if exists)"
gcloud artifacts repositories create $Repo --repository-format=docker --location=$Region --description="Prep portal API + web" 2>$null

Write-Host "==> Creating GCS history bucket (ignore if exists)"
gsutil mb -l $Region "gs://$Bucket" 2>$null

$projectNumber = gcloud projects describe $Project --format="value(projectNumber)"
$computeSa = "${projectNumber}-compute@developer.gserviceaccount.com"
$cloudBuildSa = "${projectNumber}@cloudbuild.gserviceaccount.com"

Write-Host "==> Grant compute SA GCS + Vertex access"
gsutil iam ch "serviceAccount:${computeSa}:objectAdmin" "gs://$Bucket"
gcloud projects add-iam-policy-binding $Project --member="serviceAccount:$computeSa" --role="roles/aiplatform.user" --condition=None | Out-Null

Write-Host "==> Grant Cloud Build SA deploy + secret access"
foreach ($role in @("roles/run.admin", "roles/iam.serviceAccountUser", "roles/artifactregistry.writer")) {
  gcloud projects add-iam-policy-binding $Project --member="serviceAccount:$cloudBuildSa" --role=$role --condition=None | Out-Null
}

Write-Host "==> Done. Project number: $projectNumber"
