// Client configuration. The Firebase web config is NOT a secret (security is enforced by
// Firebase Auth + Firestore rules + the Worker's token check), so it's safe to ship.
//
// Leave `firebaseConfig.projectId` EMPTY to run the portal in no-auth preview mode
// (form works against the Worker, no sign-in, no history). Fill it in via
// firebase-config.local.js to turn on Google sign-in and Firestore history.

export const firebaseConfig = {
  apiKey: "",
  authDomain: "",
  projectId: "",
  appId: "",
};

/**
 * Merge optional local overrides from firebase-config.local.js (gitignored).
 * Call once before boot when Firebase SSO should be enabled locally or on VPS.
 */
export async function loadFirebaseConfig() {
  try {
    const mod = await import("./firebase-config.local.js");
    if (mod?.firebaseConfig && typeof mod.firebaseConfig === "object") {
      Object.assign(firebaseConfig, mod.firebaseConfig);
    }
  } catch {
    // Local file missing — dummy login mode (empty projectId).
  }
  return firebaseConfig;
}

// Worker base URL — auto-detect local dev vs VPS production (portal.benjaminsquare.com).
function workerBaseUrl() {
  if (typeof location !== "undefined" && location.hostname) {
    const host = location.hostname;
    // Production VPS: web on portal.*, API on portalapi.*
    if (host === "portal.benjaminsquare.com") {
      return "https://portalapi.benjaminsquare.com";
    }
    // Local dev: same hostname, port 8787 (localhost:8788 → localhost:8787)
    return `${location.protocol}//${host}:8787`;
  }
  return "http://localhost:8787";
}

// Manual override (uncomment while testing a different tunnel domain):
// export const WORKER_BASE_URL = "https://portalapi.benjaminsquare.com";

export const WORKER_BASE_URL = workerBaseUrl();

// Legacy alias — pre-call endpoint
export const WORKER_URL = `${WORKER_BASE_URL}/api/generate-prep`;

// Restrict Google sign-in to this domain (also enforced server-side in the Worker).
export const ALLOWED_EMAIL_DOMAIN = "freshworks.com";
