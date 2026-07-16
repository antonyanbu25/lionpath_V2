// Client configuration. The Firebase web config is NOT a secret (security is enforced by
// Firebase Auth + Firestore rules + the Worker's token check), so it's safe to ship.
//
// Leave `firebaseConfig.projectId` EMPTY to run the portal in no-auth preview mode
// (form works against the Worker, no sign-in, no history). Fill it in to turn on
// Google sign-in and Firestore history.

export const firebaseConfig = {
  apiKey: "",
  authDomain: "",
  projectId: "",
  appId: "",
};

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
