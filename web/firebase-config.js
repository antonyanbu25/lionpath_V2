// Client configuration. The Firebase web config is NOT a secret (security is enforced by
// Firebase Auth + Firestore rules + the Worker's token check), so it's safe to ship.
//
// Leave `firebaseConfig.projectId` EMPTY to run the portal in no-auth preview mode
// (form works against the Worker, no sign-in, no history). Fill it in via
// firebase-config.local.js to turn on Google sign-in and Firestore history.

/** Shipped for production hosts (client config. auth enforced by Firebase + Worker). */
const PRODUCTION_FIREBASE = {
  apiKey: "AIzaSyCtV1K1h3kwcsObxSyBi0qDTxaivArn8HE",
  authDomain: "se-singha-paathi.firebaseapp.com",
  projectId: "se-singha-paathi",
  appId: "1:781846715448:web:bb597d2d001b64d374dacd",
};

export const firebaseConfig = {
  apiKey: "",
  authDomain: "",
  projectId: "",
  appId: "",
};

/** Bump when auth/bootstrap JS changes (cache-bust query on index.html module tags). */
export const AUTH_BUILD_ID = "2.1.22";
/** Cache-bust query for ES module imports — bump with AUTH_BUILD_ID. */
export const MODULE_BUILD = AUTH_BUILD_ID;

function isProductionHost(host) {
  return (
    host === "portal.benjaminsquare.com" ||
    host === "yonus.benjaminsquare.com" ||
    host === "lionpath.benjaminsquare.com" ||
    host.endsWith(".run.app")
  );
}

function mergeFirebaseOverrides(overrides) {
  if (!overrides || typeof overrides !== "object") return;
  for (const [key, value] of Object.entries(overrides)) {
    if (value) firebaseConfig[key] = value;
  }
}

/**
 * Merge optional local overrides from firebase-config.local.js (gitignored).
 * Call once before boot when Firebase SSO should be enabled locally or on VPS.
 */
export async function loadFirebaseConfig() {
  const host = typeof location !== "undefined" ? location.hostname : "";
  const production = isProductionHost(host);
  if (production) {
    Object.assign(firebaseConfig, PRODUCTION_FIREBASE);
  }
  try {
    const mod = await import("./firebase-config.local.js");
    mergeFirebaseOverrides(mod?.firebaseConfig);
  } catch {
    // Local file missing — dummy login mode on localhost only.
  }
  if (production) {
    Object.assign(firebaseConfig, PRODUCTION_FIREBASE);
  }
  return firebaseConfig;
}

/** True when Firebase projectId is configured (production host or firebase-config.local.js). */
export function isFirebaseAuthEnabled() {
  return !!firebaseConfig.projectId;
}

/** Hide dummy login on production before app.js boot (safe if app.js import fails). */
export function applyProductionLoginShell() {
  if (typeof document === "undefined" || typeof location === "undefined") return;
  if (!isProductionHost(location.hostname)) return;
  Object.assign(firebaseConfig, PRODUCTION_FIREBASE);
  const $ = (id) => document.getElementById(id);
  const show = (el, on = true) => { if (el) el.hidden = !on; };
  show($("login-form"), false);
  show($("login-hint"), false);
  const block = $("firebase-signin-block");
  const divider = $("login-or-divider");
  if (divider) divider.hidden = true;
  show(block, true);
  show($("login-subtitle"), false);
}

function bootstrapProductionFirebase() {
  if (typeof location === "undefined" || !isProductionHost(location.hostname)) return;
  Object.assign(firebaseConfig, PRODUCTION_FIREBASE);
  if (typeof document === "undefined") return;
  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", applyProductionLoginShell);
  } else {
    applyProductionLoginShell();
  }
}

bootstrapProductionFirebase();

// Worker base URL — auto-detect local dev vs VPS production (portal.benjaminsquare.com).
function workerBaseUrl() {
  if (typeof location !== "undefined" && location.hostname) {
    const host = location.hostname;
    // VPS production: web on portal.*, API on portalapi.*
    if (host === "portal.benjaminsquare.com") {
      return "https://portalapi.benjaminsquare.com";
    }
    // GCP Cloud Run custom domain (parallel to VPS)
    if (host === "yonus.benjaminsquare.com") {
      return "https://yonus-api.benjaminsquare.com";
    }
    if (host.endsWith(".run.app")) {
      return "https://prep-portal-api-781846715448.us-central1.run.app";
    }
    // Local dev: pin to IPv4 loopback. Worker may be IPv4-only; Chrome often
    // resolves "localhost" to ::1 first and surfaces that as Failed to fetch.
    if (host === "localhost" || host === "127.0.0.1") {
      return `${location.protocol}//127.0.0.1:8787`;
    }
    return `${location.protocol}//${host}:8787`;
  }
  return "http://127.0.0.1:8787";
}

// Manual override (uncomment while testing a different tunnel domain):
// export const WORKER_BASE_URL = "https://portalapi.benjaminsquare.com";

export const WORKER_BASE_URL = workerBaseUrl();

// Legacy alias — pre-call endpoint
export const WORKER_URL = `${WORKER_BASE_URL}/api/generate-prep`;

// Restrict Google sign-in to this domain (also enforced server-side in the Worker).
export const ALLOWED_EMAIL_DOMAIN = "freshworks.com";
