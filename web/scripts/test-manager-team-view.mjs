/**
 * Regression test for a real bug the eval harness's manual browser pass caught:
 * `buildManagerTeamView` called `listDealsForSession` without importing it,
 * so every manager/segment-leader/org-director's Team dashboard threw an
 * uncaught ReferenceError and hung forever on "Loading team dashboard...".
 * No prior test actually invoked `buildManagerTeamView` end-to-end —
 * `test-manager-dashboard.mjs` only exercises pure render helpers with a
 * hand-built view object, and the e2e login test never opens the Team tab.
 */

const store = new Map();
globalThis.localStorage = {
  getItem: (k) => store.get(k) ?? null,
  setItem: (k, v) => store.set(k, v),
  removeItem: (k) => store.delete(k),
};

const sessionStore = new Map();
globalThis.sessionStorage = {
  getItem: (k) => sessionStore.get(k) ?? null,
  setItem: (k, v) => sessionStore.set(k, v),
  removeItem: (k) => sessionStore.delete(k),
};

const { buildManagerTeamView } = await import("../dashboard.js");
const { loginDummy } = await import("../auth.js");

// A segment leader — same role class as the manager who hit this in the browser.
const MANAGER_EMAIL = "antony.sagayaraj@freshworks.com";
const { ok, session } = await loginDummy(MANAGER_EMAIL, "leader123");
if (!ok) {
  console.error("FAILED: dummy login for manager fixture did not succeed");
  process.exit(1);
}

let view;
try {
  view = await buildManagerTeamView(session);
} catch (err) {
  console.error("FAILED: buildManagerTeamView threw —", err?.message || err);
  console.error(err?.stack || "");
  process.exit(1);
}

if (!view || typeof view !== "object") {
  console.error("FAILED: buildManagerTeamView did not return a view object");
  process.exit(1);
}
if (!Array.isArray(view.dealsNeedingAttention)) {
  console.error("FAILED: view.dealsNeedingAttention missing — deal rows never resolved");
  process.exit(1);
}
if (!view.teamMetrics || typeof view.teamMetrics !== "object") {
  console.error("FAILED: view.teamMetrics missing");
  process.exit(1);
}

console.log("OK — buildManagerTeamView resolves deal rows without throwing");
