/**
 * Preflight for production-like local dev (Firebase SSO + Firestore).
 * Called from dev-node.mjs before starting the worker.
 */
import { existsSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const REPO = join(ROOT, "..");
const firebaseLocal = join(REPO, "web", "firebase-config.local.js");

const projectId = (process.env.FIREBASE_PROJECT_ID || "").trim();
const saJson = (process.env.FIREBASE_SERVICE_ACCOUNT_JSON || "").trim();
const adcPath = (process.env.GOOGLE_APPLICATION_CREDENTIALS || "").trim();
const hasAdcFile = adcPath && existsSync(adcPath);
const firebaseWeb = existsSync(firebaseLocal);

if (!firebaseWeb && !projectId) {
  console.log("[local-dev] Dummy mode — no firebase-config.local.js, FIREBASE_PROJECT_ID unset.");
} else if (firebaseWeb && !projectId) {
  console.warn(
    "\n⚠️  web/firebase-config.local.js is present but worker FIREBASE_PROJECT_ID is unset.\n" +
      "   Set FIREBASE_PROJECT_ID=se-singha-paathi in worker/.dev.vars and restart.\n",
  );
} else if (!firebaseWeb && projectId) {
  console.warn(
    "\n⚠️  worker FIREBASE_PROJECT_ID is set but web/firebase-config.local.js is missing.\n" +
      "   Copy web/firebase-config.local.example.js → firebase-config.local.js for Google SSO.\n",
  );
} else {
  const hasWorkerCreds = !!saJson || hasAdcFile;
  if (projectId && !hasWorkerCreds) {
    const secretsDir = join(REPO, "worker", "secrets");
    const secretHint = existsSync(secretsDir)
      ? "     Or drop the JSON into worker/secrets/ and restart dev.\n"
      : "";
    console.warn(
      "\n⚠️  Firebase SSO enabled but worker has no GCP credentials.\n" +
        "   CRM reads via GET /api/accounts/* will fail until you set ONE of:\n" +
        "     GOOGLE_APPLICATION_CREDENTIALS=/path/to/service-account.json\n" +
        "     FIREBASE_SERVICE_ACCOUNT_JSON={...}  in worker/.dev.vars\n" +
        secretHint +
        "   Download key: Firebase Console → se-singha-paathi → Service accounts → Generate new private key.\n" +
        "   Browser Firestore (signed-in Google SSO) uses store mode firestore on localhost.\n",
    );
  } else if (projectId && hasWorkerCreds) {
    console.log(`[local-dev] Firebase production-like mode (project=${projectId}, worker creds=ok)`);
  }
}
