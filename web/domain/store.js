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

function readViaApi() {
  if (typeof localStorage === "undefined") return false;
  return localStorage.getItem("lionpath.readVia") === "api";
}

/**
 * Initialize the domain store. Call from app.js after Firebase init (or at boot for dummy mode).
 * @param {object|null} fb Firebase helpers from initFirebase (null for dummy mode)
 */
export function initDomainStore(fb) {
  if (useFirestore(fb)) {
    if (readViaApi()) {
      storeInstance = createApiStore({
        workerBaseUrl: WORKER_BASE_URL,
        getToken: () => fb?.auth?.currentUser?.getIdToken(),
        fb,
      });
    } else {
      storeInstance = createFirestoreStore(fb);
    }
  } else {
    storeInstance = createLocalStore();
  }
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
