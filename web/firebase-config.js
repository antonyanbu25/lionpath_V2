// Client configuration. The Firebase web config is NOT a secret (security is enforced by
// Firebase Auth + Firestore rules + the Worker's token check), so it's safe to ship.
//
// Leave `projectId` EMPTY to run dummy auth (se@freshworks.com / se123).
// For real login: copy web/firebase-config.local.example.js → firebase-config.local.js
// and fill in your Firebase web app config. See docs/FIREBASE_SETUP.md.

/** @type {{ apiKey: string, authDomain: string, projectId: string, appId: string }} */
export let firebaseConfig = {
  apiKey: "",
  authDomain: "",
  projectId: "",
  appId: "",
};

/** Load optional gitignored local override before auth init. */
export async function loadFirebaseConfig() {
  try {
    const mod = await import("./firebase-config.local.js");
    if (mod?.firebaseConfig?.projectId) {
      firebaseConfig = { ...firebaseConfig, ...mod.firebaseConfig };
    }
  } catch {
    // firebase-config.local.js not present — dummy auth mode
  }
  return firebaseConfig;
}

export function isFirebaseAuthEnabled() {
  return !!firebaseConfig.projectId;
}

// Worker base URL — auto-detect local dev vs VPS production (lionpath.benjaminsquare.com).
function workerBaseUrl() {
  if (typeof location !== "undefined" && location.hostname) {
    const host = location.hostname;
    // Production VPS: web on lionpath.*, API on lionpathapi.*
    if (host === "lionpath.benjaminsquare.com") {
      return "https://lionpathapi.benjaminsquare.com";
    }
    // Local dev: same hostname, port 8787 (localhost:8788 → localhost:8787)
    return `${location.protocol}//${host}:8787`;
  }
  return "http://localhost:8787";
}

// Manual override (uncomment while testing a different tunnel domain):
// export const WORKER_BASE_URL = "https://lionpathapi.benjaminsquare.com";

export const WORKER_BASE_URL = workerBaseUrl();

// Legacy alias — pre-call endpoint
export const WORKER_URL = `${WORKER_BASE_URL}/api/generate-prep`;

// Restrict Google sign-in to this domain (also enforced server-side in the Worker).
export const ALLOWED_EMAIL_DOMAIN = "freshworks.com";
