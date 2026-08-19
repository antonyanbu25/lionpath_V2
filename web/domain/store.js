/**
 * Domain store factory — Firestore when Firebase enabled, localStorage shim otherwise.
 */

import { firebaseConfig, WORKER_BASE_URL } from "../firebase-config.js";
import { createLocalStore } from "./local-store.js";
import { createFirestoreStore } from "./firestore-store.js";
import { createApiStore } from "./api-store.js";
import { isFirebasePermissionError } from "./safe-store.js";
import { runMeddpiccDealMigrationIfNeeded } from "./migrate-meddpicc-to-deals.js";
import { getSession } from "../auth.js";

/** @type {ReturnType<createLocalStore>|null} */
let storeInstance = null;
/** @type {ReturnType<createLocalStore>|null} */
let readStoreInstance = null;
/** @type {ReturnType<createLocalStore>|null} */
let writeStoreInstance = null;

let fbReadyResolve = null;
/** Resolves when initDomainStore has been called with a non-null fb.db (Firestore ready). */
export const fbReadyPromise = new Promise((resolve) => {
  fbReadyResolve = resolve;
});

function useFirestore(fb) {
  return !!firebaseConfig.projectId && !!fb?.db;
}

function isLocalDevHost() {
  if (typeof location === "undefined") return false;
  const host = location.hostname;
  return host === "localhost" || host === "127.0.0.1";
}

/** @returns {"local"|"firestore"|"api"} */
function resolveReadMode(fb) {
  if (!useFirestore(fb)) {
    // Firebase configured but db not yet initialized (lazy init) — use API mode.
    if (!!firebaseConfig.projectId && !fb?.db) return "api";
    return "local";
  }
  if (typeof location !== "undefined" && typeof sessionStorage !== "undefined") {
    const params = new URLSearchParams(location.search || "");
    const override = params.get("storeMode");
    if (override === "api" || override === "firestore") {
      sessionStorage.setItem("lionpath.storeMode", override);
    }
    const sessionOverride = sessionStorage.getItem("lionpath.storeMode");
    if (sessionOverride === "api") return "api";
    if (sessionOverride === "firestore") return "firestore";
  }
  if (typeof localStorage !== "undefined") {
    const override = localStorage.getItem("lionpath.readVia");
    if (override === "api") return "api";
  }
  // Default to firestore for admin/manager, api for SEs (Firestore rules block broad SE reads).
  const session = getSession();
  const isManager = session?.role === "manager" || session?.role === "admin";
  return isManager ? "firestore" : "api";
}

/** @returns {"local"|"firestore"|"api"} */
export function resolveWriteMode(fb) {
  if (!useFirestore(fb)) return "local";
  // Localhost: use browser Firestore SDK directly (worker Admin often lacks GCP creds).
  if (isLocalDevHost()) return "firestore";
  return "api";
}

/** @returns {"local"|"firestore"|"api"} legacy read-mode shim */
export function resolveStoreMode(fb) {
  return resolveReadMode(fb);
}

function createStoreForMode(mode, fb) {
  if (mode === "api") {
    return createApiFallbackStore(fb);
  }
  if (mode === "firestore") return createFirestoreStore(fb);
  return createLocalStore();
}

function isWriteMethod(prop) {
  const name = String(prop || "");
  return (
    name === "setPrimaryDealContact" ||
    name.startsWith("create") ||
    name.startsWith("update") ||
    name.startsWith("upsert") ||
    name.startsWith("delete") ||
    name.startsWith("remove")
  );
}

function createApiFallbackStore(fb) {
  return createApiStore({
    workerBaseUrl: WORKER_BASE_URL,
    getToken: () => fb?.auth?.currentUser?.getIdToken(),
    fb,
  });
}

function createReadFallbackStore(primary, fallback) {
  if (!fallback || primary === fallback) return primary;
  return new Proxy(primary, {
    get(target, prop, receiver) {
      const value = Reflect.get(target, prop, receiver);
      if (typeof value !== "function" || isWriteMethod(prop)) return value;
      const fallbackValue = Reflect.get(fallback, prop, fallback);
      if (typeof fallbackValue !== "function") return value.bind(target);

      if (prop === "subscribeDealDetail") {
        return (dealId, cb) => {
          void fallback.getDealDetail?.(dealId)
            ?.then((detail) => detail && cb?.(detail))
            ?.catch((err) => {
              if (!isFirebasePermissionError(err)) {
                console.warn("[domain] deal detail API fallback failed:", err?.message || err);
              }
            });
          return value.call(target, dealId, cb);
        };
      }

      if (prop === "subscribeCallDetail") {
        return (callId, cb) => {
          void fallback.getPostCallDetail?.(callId)
            ?.then((detail) => detail && cb?.(detail))
            ?.catch((err) => {
              if (!isFirebasePermissionError(err)) {
                console.warn("[domain] call detail API fallback failed:", err?.message || err);
              }
            });
          return value.call(target, callId, cb);
        };
      }

      return async (...args) => {
        try {
          return await value.apply(target, args);
        } catch (err) {
          if (!isFirebasePermissionError(err)) throw err;
          console.warn(`[domain] ${String(prop)} permission denied; using worker API fallback`);
          return fallbackValue.apply(fallback, args);
        }
      };
    },
  });
}

function createSplitStore(readStore, writeStore, readMode, writeMode) {
  if (readStore === writeStore) return readStore;
  return new Proxy(readStore, {
    get(target, prop, receiver) {
      if (prop === "mode") return readMode;
      if (prop === "readMode") return readMode;
      if (prop === "writeMode") return writeMode;
      const source = isWriteMethod(prop) && prop in writeStore ? writeStore : target;
      const value = Reflect.get(source, prop, source === target ? receiver : source);
      return typeof value === "function" ? value.bind(source) : value;
    },
    set(target, prop, value, receiver) {
      const source = isWriteMethod(prop) && prop in writeStore ? writeStore : target;
      return Reflect.set(source, prop, value, source === target ? receiver : source);
    },
    has(target, prop) {
      return prop in target || prop in writeStore;
    },
  });
}

/**
 * Initialize the domain store. Call from app.js after Firebase init (or at boot for dummy mode).
 * @param {object|null} fb Firebase helpers from initFirebase (null for dummy mode)
 */
export function initDomainStore(fb) {
  const readMode = resolveReadMode(fb);
  const writeMode = resolveWriteMode(fb);
  readStoreInstance = createStoreForMode(readMode, fb);
  if (readMode === "firestore" && writeMode === "api") {
    readStoreInstance = createReadFallbackStore(readStoreInstance, createApiFallbackStore(fb));
  }
  writeStoreInstance =
    writeMode === readMode ? readStoreInstance : createStoreForMode(writeMode, fb);
  storeInstance = createSplitStore(readStoreInstance, writeStoreInstance, readMode, writeMode);
  console.info("[domain] store mode:", readMode, "writes:", writeMode);
  // Wake up all callers waiting for the store to be Firestore-ready.
  if (fbReadyResolve && readMode === "firestore") {
    fbReadyResolve(storeInstance);
    fbReadyResolve = null;
  }
  void runMeddpiccDealMigrationIfNeeded(storeInstance).catch((err) => {
    console.warn("[domain] meddpicc deal migration failed:", err.message);
  });
  return storeInstance;
}

export function isFirestoreStoreReady() {
  return !!fbReadyResolve && !!storeInstance && !!fbReadyResolve;
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
