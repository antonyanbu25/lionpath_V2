/**
 * Domain store factory — Firestore when Firebase enabled, localStorage shim otherwise.
 */

import { firebaseConfig } from "../firebase-config.js";
import { createLocalStore } from "./local-store.js";
import { createFirestoreStore } from "./firestore-store.js";

/** @type {ReturnType<createLocalStore>|null} */
let storeInstance = null;

function useFirestore(fb) {
  return !!firebaseConfig.projectId && !!fb?.db;
}

/**
 * Initialize the domain store. Call from app.js after Firebase init (or at boot for dummy mode).
 * @param {object|null} fb Firebase helpers from initFirebase (null for dummy mode)
 */
export function initDomainStore(fb) {
  if (useFirestore(fb)) {
    storeInstance = createFirestoreStore(fb);
  } else {
    storeInstance = createLocalStore();
  }
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
