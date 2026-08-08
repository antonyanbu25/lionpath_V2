/**
 * Domain store factory — Firestore when Firebase enabled, localStorage shim otherwise.
 */

import { firebaseConfig, WORKER_BASE_URL } from "../firebase-config.js";
import { createLocalStore } from "./local-store.js";
import { createFirestoreStore } from "./firestore-store.js";
import { createApiStore } from "./api-store.js";
import { runMeddpiccDealMigrationIfNeeded } from "./migrate-meddpicc-to-deals.js";

/** @type {ReturnType<createLocalStore>|null} */
let storeInstance = null;

function useFirestore(fb) {
  return !!firebaseConfig.projectId && !!fb?.db;
}

function isLocalDevHost() {
  if (typeof location === "undefined") return false;
  const host = location.hostname;
  return host === "localhost" || host === "127.0.0.1";
}

/** @returns {"local"|"firestore"|"api"} */
function resolveStoreMode(fb) {
  if (!useFirestore(fb)) return "local";
  if (typeof localStorage !== "undefined") {
    const override = localStorage.getItem("lionpath.readVia");
    if (override === "firestore") return "firestore";
    if (override === "api") return "api";
  }
  // Localhost: use browser Firestore SDK directly (worker Admin often lacks GCP creds).
  if (isLocalDevHost()) return "firestore";
  return "api";
}

/**
 * Initialize the domain store. Call from app.js after Firebase init (or at boot for dummy mode).
 * @param {object|null} fb Firebase helpers from initFirebase (null for dummy mode)
 */
export function initDomainStore(fb) {
  const mode = resolveStoreMode(fb);
  if (mode === "api") {
    storeInstance = createApiStore({
      workerBaseUrl: WORKER_BASE_URL,
      getToken: () => fb?.auth?.currentUser?.getIdToken(),
      fb,
    });
  } else if (mode === "firestore") {
    storeInstance = createFirestoreStore(fb);
  } else {
    storeInstance = createLocalStore();
  }
  console.info("[domain] store mode:", mode);
  void runMeddpiccDealMigrationIfNeeded(storeInstance).catch((err) => {
    console.warn("[domain] meddpicc deal migration failed:", err.message);
  });
  return storeInstance;
}

/** @returns {ReturnType<createLocalStore>} */
export function getStore() {
  if (!storeInstance) {
    storeInstance = createLocalStore();
  }
  return storeInstance;
}

export function isDomainStoreReady() {
  return !!storeInstance;
}
