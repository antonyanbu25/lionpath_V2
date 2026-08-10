#!/usr/bin/env node
/**
 * Regression: dashboardOpts() must gate subscribeRemotePreps/subscribeRemoteCalls
 * on fb?.db, not just isFirebaseAuthEnabled().
 *
 * buildSubscribeRemoteCalls()/buildSubscribeRemotePreps() (also in app.js)
 * silently no-op — never call their onChange callback — whenever fb.db is
 * null, which it always is for SE / role-unknown users by design (Firestore
 * is intentionally never opened for them, see completeFirebaseLogin). If
 * dashboardOpts() hands the dashboard a truthy-but-dead subscribe function,
 * web/dashboard.js's `_hasSub` check treats "is a function" as "a real
 * subscription is coming" and skips BOTH the local-data render and the
 * worker-API fallback (refreshLaunchpadRemote) — Recent Activity then stays
 * empty forever for exactly the users this app has the most of.
 *
 * app.js can't be unit-imported directly (global side effects, assumes a
 * browser DOM on load), so this is a structural source check rather than a
 * behavioral one — same technique this repo already uses for app.js/index.html
 * invariants that can't be exercised any other way (see
 * test-precall-design-tokens.mjs, test-no-await-in-loop.mjs).
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const webDir = join(dirname(fileURLToPath(import.meta.url)), "..");
const appJs = readFileSync(join(webDir, "app.js"), "utf8");

const fnStart = appJs.indexOf("function dashboardOpts(");
assert.ok(fnStart >= 0, "dashboardOpts() must exist in app.js");
const fnBody = appJs.slice(fnStart, fnStart + 2000);

for (const key of ["subscribeRemotePreps", "subscribeRemoteCalls"]) {
  const lineMatch = fnBody.match(new RegExp(`${key}:\\s*([^\\n]+)`));
  assert.ok(lineMatch, `dashboardOpts() must assign ${key}`);
  const line = lineMatch[1];
  assert.ok(
    /isFirebaseAuthEnabled\(\)/.test(line),
    `${key} must still check isFirebaseAuthEnabled()`,
  );
  assert.ok(
    /fb\?\.db|fb\.db/.test(line),
    `${key} must also gate on fb.db — the builder silently no-ops when fb.db is null (SE users), ` +
      "and dashboard.js treats a truthy-but-dead subscribe function as \"a subscription is coming\"",
  );
}

console.log("test-dashboard-subscribe-fb-db-gate.mjs: ok");
