#!/usr/bin/env tsx
/**
 * Parity check: server repositories vs web firestore-store (via admin client shim).
 *
 * Usage:
 *   FIREBASE_PROJECT_ID=se-singha-paathi GOOGLE_APPLICATION_CREDENTIALS=... \
 *     npm run test:api-store-parity --workspace=worker
 *
 * Optional: TEST_OWNER_ID=usr_xxx (internal user id for scoped list tests)
 */

import { pathToFileURL } from "node:url";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { clearAll } from "../src/data/cache";
import { listPostCallsByOwner, getPostCall, getPostCallDetail } from "../src/data/repositories/calls";
import { listAccounts, getAccount } from "../src/data/repositories/accounts";
import { listDealsByOwner, getDeal } from "../src/data/repositories/deals";
import { createFirestoreClientShim } from "./lib/firestore-client-shim";

const __dirname = dirname(fileURLToPath(import.meta.url));
const WEB_ROOT = resolve(__dirname, "../../web");

function stableJson(value: unknown): string {
  return JSON.stringify(value, (_k, v) => (v instanceof Map ? Object.fromEntries(v) : v));
}

function assertEqual(label: string, a: unknown, b: unknown) {
  const sa = stableJson(a);
  const sb = stableJson(b);
  if (sa !== sb) {
    console.error(`FAIL ${label}`);
    console.error("left:", sa.slice(0, 500));
    console.error("right:", sb.slice(0, 500));
    process.exitCode = 1;
    throw new Error(`Parity mismatch: ${label}`);
  }
  console.log(`OK ${label}`);
}

async function loadFirestoreStore(fb: object) {
  const mod = await import(pathToFileURL(resolve(WEB_ROOT, "domain/firestore-store.js")).href);
  return mod.createFirestoreStore(fb);
}

async function main() {
  const projectId = (process.env.FIREBASE_PROJECT_ID || "").trim();
  if (!projectId) {
    console.error("FIREBASE_PROJECT_ID is required.");
    process.exit(1);
  }
  if (!process.env.GOOGLE_APPLICATION_CREDENTIALS && !process.env.FIREBASE_SERVICE_ACCOUNT_JSON) {
    console.error("Set GOOGLE_APPLICATION_CREDENTIALS or FIREBASE_SERVICE_ACCOUNT_JSON.");
    process.exit(1);
  }

  const env = {
    FIREBASE_PROJECT_ID: projectId,
    FIREBASE_SERVICE_ACCOUNT_JSON: process.env.FIREBASE_SERVICE_ACCOUNT_JSON,
  };

  const fb = await createFirestoreClientShim(env);
  const clientStore = await loadFirestoreStore(fb);

  const ownerId = (process.env.TEST_OWNER_ID || "").trim();
  if (!ownerId) {
    console.warn("TEST_OWNER_ID not set — skipping scoped list parity (accounts-only smoke).");
    clearAll();
    const repoAccounts = await listAccounts(env);
    const clientAccounts = await clientStore.listAccounts();
    assertEqual("listAccounts", repoAccounts, clientAccounts);

    if (repoAccounts[0]?.id) {
      const id = String(repoAccounts[0].id);
      clearAll();
      assertEqual("getAccount", await getAccount(id, env), await clientStore.getAccount(id));
    }
    console.log("Parity smoke complete.");
    return;
  }

  clearAll();
  const repoCalls = await listPostCallsByOwner(ownerId, 20, env);
  const clientCalls = await clientStore.listPostCallsByOwner(ownerId, 20);
  assertEqual("listPostCallsByOwner", repoCalls, clientCalls);

  if (repoCalls[0]?.id) {
    const callId = String(repoCalls[0].id);
    clearAll();
    assertEqual("getPostCall", await getPostCall(callId, env), await clientStore.getPostCall(callId));

    clearAll();
    const repoDetail = await getPostCallDetail(callId, env);
    const clientScorecards = await clientStore.listScorecardsByCall(callId);
    assertEqual("listScorecardsByCall", repoDetail?.scorecards || [], clientScorecards);
  }

  clearAll();
  assertEqual("listAccounts", await listAccounts(env), await clientStore.listAccounts());

  clearAll();
  const repoDeals = await listDealsByOwner(ownerId, 20, env);
  const clientDeals = await clientStore.listDealsByOwner(ownerId, 20);
  assertEqual("listDealsByOwner", repoDeals, clientDeals);

  if (repoDeals[0]?.id) {
    const dealId = String(repoDeals[0].id);
    clearAll();
    assertEqual("getDeal", await getDeal(dealId, env), await clientStore.getDeal(dealId));
  }

  console.log("Parity checks passed.");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
