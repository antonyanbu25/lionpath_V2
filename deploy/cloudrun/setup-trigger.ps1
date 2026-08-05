#Requires -Version 5.1
# Create Cloud Build trigger for Antony-sagayaraj/SE-Labs branch 2.1.
# Prerequisite: CONNECT-GITHUB.md (Console repo connection).
param(
  [string]$Project = "se-singha-paathi",
  [string]$TriggerName = "deploy-2-1",
  [string]$RepoOwner = "Antony-sagayaraj",
  [string]$RepoName = "SE-Labs",
  [string]$BranchPattern = "^2\.1$"
)

$ErrorActionPreference = "Stop"
gcloud config set project $Project

$exists = gcloud builds triggers describe $TriggerName --project=$Project 2>$null
if ($LASTEXITCODE -eq 0) {
  Write-Host "Trigger $TriggerName exists — updating"
  gcloud builds triggers update github $TriggerName `
    --repo-owner=$RepoOwner `
    --repo-name=$RepoName `
    --branch-pattern=$BranchPattern `
    --build-config="deploy/cloudrun/cloudbuild.yaml" `
    --substitutions="_TAG=`$SHORT_SHA"
} else {
  Write-Host "==> Creating trigger $TriggerName"
  gcloud builds triggers create github `
    --name=$TriggerName `
    --repo-owner=$RepoOwner `
    --repo-name=$RepoName `
    --branch-pattern=$BranchPattern `
    --build-config="deploy/cloudrun/cloudbuild.yaml" `
    --substitutions="_TAG=`$SHORT_SHA"
}

Write-Host "==> Done. Push to branch 2.1 to deploy."
