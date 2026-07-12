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

// Your deployed Worker endpoint. For local dev with `wrangler dev` this is
// http://localhost:8787/api/generate-prep .
export const WORKER_URL = "http://localhost:8787/api/generate-prep";

// Restrict Google sign-in to this domain (also enforced server-side in the Worker).
export const ALLOWED_EMAIL_DOMAIN = "freshworks.com";
