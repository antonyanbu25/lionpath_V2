/**
 * E2E (UAT-009 part 2): browser Back from a call/deal record must return to the
 * list, not exit the SPA.
 *
 * Before this fix, web/app.js used history.replaceState at every navigation
 * site (13 call sites, zero pushState) — so entering a call-record or
 * deal-record from its list never added a browser-history entry. Pressing
 * Back skipped straight past the SPA to whatever was open before the page
 * loaded. The fix makes a small set of "enter a record" transitions
 * (openCallRecord, the calls-list row click, the deals-list row click, and
 * the account/pipeline/call-record "open deal" callbacks) call
 * history.pushState instead, gated by an explicit `pushHistory` option read
 * in switchView() — every other transition, including applyRouteFromHash's
 * own replay calls on popstate/hashchange, is untouched and still uses
 * replaceState.
 *
 * This can only be verified with real browser history semantics
 * (history.pushState/popstate/page.goBack()) — a jsdom-style stub for
 * `history` would not exercise the actual forward/back stack the browser
 * maintains, which is exactly the mechanism under test. Hence Playwright.
 *
 * Each section uses its own browser context so an assertion on
 * `history.length` (proof that pushState — not replaceState — fired) is not
 * confused by forward-history truncation left over from an earlier section's
 * back-navigation in the same tab.
 */
import { chromium } from "playwright";
import { forceDummyAuth } from "./lib/e2e-dummy-auth.mjs";

const BASE = process.env.PORTAL_URL || "http://127.0.0.1:8788";

const SESSION = {
  role: "se",
  email: "se@freshworks.com",
  name: "Alex SE",
  userId: "usr_se_test",
  uid: "usr_se_test",
  teamId: "team_demo",
};

// One post-call history record. This seeds BOTH a "Calls" list row (the raw
// record) and a synthetic "Deals" list row (domain/account-service.js
// listDealsFromHistory derives a fallback deal per account name when the
// live store has none) — so a single fixture exercises both record types.
const HISTORY_RECORD = {
  id: "c1",
  timestamp: Date.now(),
  title: "Acme · Discovery",
  prospectEmails: ["a@acme.com"],
};

async function bootSignedIn(browser) {
  const context = await browser.newContext();
  const page = await context.newPage();
  // Before any goto: with firebase-config.local.js present, real Firebase auth
  // resolves signed-out ~700ms into boot and discards the injected session,
  // re-hiding #app-shell after it had already appeared. See lib/e2e-dummy-auth.mjs.
  await forceDummyAuth(page);
  await page.goto(`${BASE}/`, { waitUntil: "domcontentloaded" });
  await page.evaluate(
    ({ session, record }) => {
      localStorage.setItem("se-sp-session-local", JSON.stringify(session));
      sessionStorage.setItem("se-sp-session", JSON.stringify(session));
      localStorage.setItem(`se-singha-history:${session.email}`, JSON.stringify([record]));
    },
    { session: SESSION, record: HISTORY_RECORD },
  );
  await page.reload({ waitUntil: "domcontentloaded" });
  await page.waitForSelector("#app-shell:not([hidden])", { timeout: 20000 });
  await page.waitForTimeout(500);
  return { context, page };
}

let ok = true;
function track(message, data) {
  ok = false;
  console.error(`FAIL: ${message}`, data ?? "");
}

const browser = await chromium.launch({ headless: true });

try {
  // ---------- Calls: list -> record -> Back must return to the list ----------
  {
    const { context, page } = await bootSignedIn(browser);
    try {
      await page.click('.nav-item[data-view="calls"]');
      await page.waitForSelector(".act-feed-row[data-call-id]", { timeout: 10000 });

      const hashOnList = await page.evaluate(() => location.hash);
      if (hashOnList !== "#calls") track("expected #calls hash on the calls list", hashOnList);

      const lengthBeforeOpen = await page.evaluate(() => history.length);
      await page.click(".act-feed-row[data-call-id]");
      await page.waitForSelector(".call-record", { timeout: 10000 });
      const lengthAfterOpen = await page.evaluate(() => history.length);
      const hashOnRecord = await page.evaluate(() => location.hash);

      if (!/^#calls\//.test(hashOnRecord)) {
        track("expected #calls/<id> hash after opening a call record", hashOnRecord);
      }
      if (lengthAfterOpen !== lengthBeforeOpen + 1) {
        track("opening a call record should pushState (history.length +1), not replaceState", {
          lengthBeforeOpen,
          lengthAfterOpen,
        });
      }

      await page.goBack();
      await page.waitForTimeout(500);

      const state = await page.evaluate(() => ({
        hash: location.hash,
        url: location.href,
        appVisible: !document.getElementById("app-shell")?.hidden,
        loginVisible: !document.getElementById("login-view")?.hidden,
        rowCount: document.querySelectorAll(".act-feed-row[data-call-id]").length,
        recordCount: document.querySelectorAll(".call-record").length,
      }));

      if (!state.url.startsWith(BASE)) {
        track("browser Back left the SPA origin entirely", state);
      }
      if (!state.appVisible || state.loginVisible) {
        track("browser Back exited the app shell instead of returning to the list", state);
      }
      if (state.hash !== "#calls") {
        track("expected hash to revert to #calls after Back", state);
      }
      if (state.rowCount < 1) {
        track("expected the calls list to re-render after Back", state);
      }
      if (state.recordCount !== 0) {
        track("expected the call record to be gone after Back (should show the list)", state);
      }
      if (ok) console.log("OK — calls: list -> record -> Back returns to the list");
    } finally {
      await context.close();
    }
  }

  // ---------- Deals: list -> record -> Back must return to the list ----------
  {
    const { context, page } = await bootSignedIn(browser);
    try {
      await page.click('.nav-item[data-view="deals"]');
      await page.waitForSelector(".deal-list-row[data-deal-id]", { timeout: 10000 });

      const hashOnList = await page.evaluate(() => location.hash);
      if (hashOnList !== "#deals") track("expected #deals hash on the deals list", hashOnList);

      const lengthBeforeOpen = await page.evaluate(() => history.length);
      await page.click(".deal-list-row[data-deal-id]");
      await page.waitForSelector(".deal-record", { timeout: 10000 });
      const lengthAfterOpen = await page.evaluate(() => history.length);
      const hashOnRecord = await page.evaluate(() => location.hash);

      if (!/^#deals\//.test(hashOnRecord)) {
        track("expected #deals/<id> hash after opening a deal record", hashOnRecord);
      }
      if (lengthAfterOpen !== lengthBeforeOpen + 1) {
        track("opening a deal record should pushState (history.length +1), not replaceState", {
          lengthBeforeOpen,
          lengthAfterOpen,
        });
      }

      await page.goBack();
      await page.waitForTimeout(500);

      const state = await page.evaluate(() => ({
        hash: location.hash,
        url: location.href,
        appVisible: !document.getElementById("app-shell")?.hidden,
        loginVisible: !document.getElementById("login-view")?.hidden,
        rowCount: document.querySelectorAll(".deal-list-row[data-deal-id]").length,
        recordCount: document.querySelectorAll(".deal-record").length,
      }));

      if (!state.url.startsWith(BASE)) {
        track("browser Back left the SPA origin entirely", state);
      }
      if (!state.appVisible || state.loginVisible) {
        track("browser Back exited the app shell instead of returning to the list", state);
      }
      if (state.hash !== "#deals") {
        track("expected hash to revert to #deals after Back", state);
      }
      if (state.rowCount < 1) {
        track("expected the deals list to re-render after Back", state);
      }
      if (state.recordCount !== 0) {
        track("expected the deal record to be gone after Back (should show the list)", state);
      }
      if (ok) console.log("OK — deals: list -> record -> Back returns to the list");
    } finally {
      await context.close();
    }
  }
} finally {
  await browser.close();
}

if (!ok) process.exit(1);
console.log("E2E OK — UAT-009 browser Back returns to the originating list for calls and deals");
