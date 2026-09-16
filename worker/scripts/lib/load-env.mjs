/**
 * Load worker/.dev.vars and repo .env into process.env (same order as dev-node.mjs).
 */

import { readFileSync, existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
export const WORKER_ROOT = join(__dirname, "..", "..");
export const REPO_ROOT = join(WORKER_ROOT, "..");

/** Load KEY=VALUE files without overwriting existing process.env. */
export function loadEnvFile(path) {
  if (!existsSync(path)) return;
  for (const line of readFileSync(path, "utf8").split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const eq = trimmed.indexOf("=");
    if (eq <= 0) continue;
    const key = trimmed.slice(0, eq).trim();
    let value = trimmed.slice(eq + 1).trim();
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }
    if (!(key in process.env)) process.env[key] = value;
  }
}

export function loadEnv() {
  loadEnvFile(join(WORKER_ROOT, ".dev.vars"));
  loadEnvFile(join(REPO_ROOT, ".env"));
}

export function firebaseProjectIdHelp(scriptName = "worker/scripts/backfill-embeddings.mjs") {
  return `FIREBASE_PROJECT_ID is required (Firestore could not detect a project id).

Set it in one of:
  • worker/.dev.vars   (copy from worker/.dev.vars.example)
  • .env at repo root
  • PowerShell (from repo root):
      $env:FIREBASE_PROJECT_ID="se-singha-paathi"
      $env:GOOGLE_APPLICATION_CREDENTIALS="C:\\path\\to\\service-account.json"
      node ${scriptName}
  • bash:
      export FIREBASE_PROJECT_ID=se-singha-paathi
      export GOOGLE_APPLICATION_CREDENTIALS=/path/to/service-account.json
      node ${scriptName}

Also set GOOGLE_APPLICATION_CREDENTIALS to your Firebase service account JSON path,
or run: gcloud auth application-default login

Project id should match web/firebase-config.local.js (typically se-singha-paathi).`;
}

/** @returns {string} trimmed project id */
export function requireFirebaseProjectId(scriptName) {
  const projectId = (process.env.FIREBASE_PROJECT_ID || process.env.GCLOUD_PROJECT || "").trim();
  if (!projectId) {
    console.error(firebaseProjectIdHelp(scriptName));
    process.exit(1);
  }
  return projectId;
}
