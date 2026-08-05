# Connect GitHub repo to Cloud Build (one-time, Console only)

Cloud Build cannot pull from GitHub until you connect the repo via the GitHub App.

## Steps

1. Open [Cloud Build → Repositories](https://console.cloud.google.com/cloud-build/repositories?project=se-singha-paathi)
2. Click **Connect repository**
3. Select **GitHub (Cloud Build GitHub App)** → **Continue**
4. Sign in to GitHub if prompted
5. Under **Select repository**, choose **`Antony-sagayaraj/SE-Labs`**
   - If the repo is missing, click **Install Google Cloud Build** on GitHub and grant access to `SE-Labs`
6. Complete the wizard (2nd gen connection is fine)
7. Verify the repo appears under **Repositories**

## After connecting

Run from a machine with `gcloud`:

```bash
bash deploy/cloudrun/setup-trigger.sh
```

Or create the trigger manually:

1. [Cloud Build → Triggers](https://console.cloud.google.com/cloud-build/triggers?project=se-singha-paathi) → **Create trigger**
2. Name: `deploy-2-1`
3. Event: **Push to a branch**
4. Source: `Antony-sagayaraj/SE-Labs`
5. Branch: `^2\.1$`
6. Config file: `deploy/cloudrun/cloudbuild.yaml`

Every push to branch **`2.1`** will build and deploy both Cloud Run services.
