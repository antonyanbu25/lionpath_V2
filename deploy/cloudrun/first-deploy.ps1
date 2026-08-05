#Requires -Version 5.1
# First Cloud Run deploy with full API env vars (Windows).
param(
  [string]$Project = "se-singha-paathi",
  [string]$Region = "us-central1",
  [string]$Repo = "prep-portal",
  [string]$Tag = "latest"
)

$ErrorActionPreference = "Stop"
$apiImage = "${Region}-docker.pkg.dev/${Project}/${Repo}/prep-portal-api:${Tag}"
$webImage = "${Region}-docker.pkg.dev/${Project}/${Repo}/prep-portal-web:${Tag}"

gcloud config set project $Project

Write-Host "==> Deploying prep-portal-api"
gcloud run deploy prep-portal-api `
  --image $apiImage `
  --region $Region `
  --project $Project `
  --platform managed `
  --allow-unauthenticated `
  --port 8080 `
  --memory 1Gi `
  --cpu 1 `
  --min-instances 1 `
  --max-instances 10 `
  --concurrency 15 `
  --timeout 300 `
  --set-env-vars "LLM_PROVIDER=gemini,MODEL=gemini-3.1-flash-lite,EFFORT=medium,POSTCALL_LLM_PROVIDER=gemini,POSTCALL_MODEL=gemini-3.1-flash-lite,POSTCALL_EFFORT=low,GOOGLE_CLOUD_PROJECT=$Project,VERTEX_LOCATION=$Region,ALLOWED_ORIGINS=https://portal.benjaminsquare.com,ALLOWED_EMAIL_DOMAIN=freshworks.com,FIREBASE_PROJECT_ID=$Project,HISTORY_FILE_DIR=/data/history,FFMPEG_MAX_CONCURRENT=2" `
  --add-volume="name=history,type=cloud-storage,bucket=se-singha-paathi-prep-history" `
  --add-volume-mount="volume=history,mount-path=/data/history"

Write-Host "==> Deploying prep-portal-web"
gcloud run deploy prep-portal-web `
  --image $webImage `
  --region $Region `
  --project $Project `
  --platform managed `
  --allow-unauthenticated `
  --port 8080 `
  --memory 256Mi `
  --cpu 1 `
  --min-instances 1 `
  --max-instances 5 `
  --concurrency 80

Write-Host "==> Public invoker (required for browser access to *.run.app URLs)"
gcloud run services add-iam-policy-binding prep-portal-api `
  --region $Region `
  --project $Project `
  --member="allUsers" `
  --role="roles/run.invoker" `
  --quiet

$apiUrl = gcloud run services describe prep-portal-api --region=$Region --format="value(status.url)"
$webUrl = gcloud run services describe prep-portal-web --region=$Region --format="value(status.url)"

Write-Host "==> CORS: allow web origin on API"
$allowedOrigins = "https://portal.benjaminsquare.com,$webUrl"
gcloud run services update prep-portal-api `
  --region $Region `
  --project $Project `
  --update-env-vars "ALLOWED_ORIGINS=$allowedOrigins"

Write-Host "API: $apiUrl/api/health"
Write-Host "Web: $webUrl/"
