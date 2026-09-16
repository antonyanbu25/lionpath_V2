/**
 * E2E (implementation prompt P12 / T13, astra-audit F-016/F-017/F-018):
 * proves in a real browser that
 *   (a) the Analyse button enables on field completeness alone, with no CRM
 *       network round-trip required (item 1);
 *   (b) one physical submit issues exactly one /api/postcall/resolve request,
 *       not two (item 2/3 — the fwClick+submit and pass0Busy fixes);
 *   (c) the confirmation gate renders from the resolve response alone, before
 *       classify has returned at all (item 5).
 *
 * No live worker/Gemini/Zoom credentials are used or required: /resolve and
 * /classify are intercepted with page.route() and answered with fixture JSON.
 */
import { chromium } from "playwright";
import { forceDummyAuth } from "./lib/e2e-dummy-auth.mjs";

const BASE = process.env.PORTAL_URL || "http://127.0.0.1:8788";
const WORKER = "http://127.0.0.1:8787";

const RESOLVE_FIXTURE = {
  transcript: "SE: Thanks for joining. Customer: Happy to be here.",
  transcriptMeta: { speakers: ["SE", "Customer"] },
  participantEmails: ["prospect@acme-e2e.example.com"],
  customerIdentities: ["Customer"],
  seIdentity: "SE",
  account: { accountId: "acc_e2e", accountName: "Acme E2E" },
  deals: [],
};

let resolveCallCount = 0;
let classifyCallCount = 0;
/** Resolved only once the test explicitly releases it, so the gate's first
 *  paint is provably driven by /resolve alone, before classify answers. */
let releaseClassify;
const classifyGate = new Promise((r) => { releaseClassify = r; });

const browser = await chromium.launch({ headless: true });
const page = await browser.newPage();
// Before any goto: with firebase-config.local.js present, real Firebase auth
// resolves signed-out ~700ms into boot and discards the injected session,
// re-hiding #app-shell after it had already appeared. See lib/e2e-dummy-auth.mjs.
await forceDummyAuth(page);

await page.route(`${WORKER}/api/postcall/resolve`, async (route) => {
  resolveCallCount++;
  await route.fulfill({ contentType: "application/json", body: JSON.stringify(RESOLVE_FIXTURE) });
});
await page.route(`${WORKER}/api/postcall/classify`, async (route) => {
  classifyCallCount++;
  await classifyGate;
  await route.fulfill({
    contentType: "application/json",
    body: JSON.stringify({ primary: "demo", confidence: 0.87, seMotion: "new_business" }),
  });
});
await page.goto(`${BASE}/`);
await page.evaluate(() => {
  const session = {
    userId: "usr_se_e2e",
    uid: "dummy-se-e2e@freshworks.com",
    role: "se",
    email: "se-e2e@freshworks.com",
    name: "SE E2E",
    teamId: "team_demo",
  };
  localStorage.setItem("se-sp-session-local", JSON.stringify(session));
  sessionStorage.setItem("se-sp-session", JSON.stringify(session));
});
// J-015: NOT networkidle. web/index.html:90 renders a looping <video>,
// which holds a media request open, so there is no settling point and the
// reload itself times out. The explicit element waits below already
// establish readiness, so this made no assertion stronger.
await page.reload({ waitUntil: "domcontentloaded" });
await page.waitForSelector("#app-shell:not([hidden])", { timeout: 20000 });
await page.waitForSelector("#app-loading", { state: "hidden", timeout: 20000 }).catch(() => {});

await page.click('.nav-item[data-view="postcall"]');
await page.waitForSelector("#postcall-form-view:not([hidden])", { timeout: 10000 });

// --- (a) button starts disabled, and enables on field completeness alone ---
const initiallyDisabled = await page.$eval("#analyze-call", (el) => el.disabled);
if (!initiallyDisabled) {
  console.error("FAIL: #analyze-call must start disabled");
  await browser.close();
  process.exit(1);
}

// Real keystrokes, not page.fill. These ids are Crayons <fw-input> hosts, not
// native inputs, so fill() rejects them outright ("Element is not an <input>").
// Reaching the inner input with a descendant selector would work but is worse:
// fill() sets .value and dispatches one synthetic `input`, while the app binds
// the PAIRED fwInput+input events these components emit and de-dupes them.
// Typing exercises the real event sequence. Same approach as
// test-postcall-intake-invariants.mjs.
await page.click("#pc-recording-url");
await page.type("#pc-recording-url", "https://freshworks.zoom.us/rec/share/e2efixture.tok?pwd=abcd", { delay: 8 });
await page.click("#pc-prospect-emails");
await page.type("#pc-prospect-emails", "prospect@acme-e2e.example.com", { delay: 8 });
// Blur without waiting for any CRM lookup to settle — the button must already
// reflect field completeness, per item 1. A short settle for the input/blur
// events themselves (not a network wait) is still fine.
await page.click("body");
await page.waitForFunction(
  () => document.getElementById("analyze-call")?.disabled === false,
  { timeout: 3000 },
);
console.log("OK: button enabled on field completeness alone (no CRM wait required)");

// --- (b) one click issues exactly one ADDITIONAL /resolve call ---
// Measured as a delta across the click, not as an absolute total. Phase 2
// root-caused the reported "triple resolve" as two deliberate warm-ups
// (runZoomPreResolve, fired when a Zoom link is present) plus one submit.
// resolveCallCount is global from page load, so by the time the button is
// clicked the warm-up has already been counted and an absolute `!== 1` check
// fails on correct behaviour.
//
// The invariant this spec means to hold is that ONE GESTURE issues ONE
// request, which is the delta. Warm-up attribution is asserted separately and
// more precisely in test-postcall-intake-invariants.mjs, which reads the call
// stack of each /resolve to tell a warm-up from a submit.
// Let the warm-up debounce (800ms in runZoomPreResolve) land BEFORE snapshotting,
// so the warm-up is attributed to the typing that triggered it rather than to
// the click. Without this the warm-up and the submit fall in the same window
// and the delta is 2 — which is correct behaviour being measured wrongly.
// test-postcall-intake-invariants.mjs waits 1200ms at the same point.
await page.waitForTimeout(1200);
const resolvesBeforeClick = resolveCallCount;
await page.click("#analyze-call");
await page.waitForTimeout(500); // let any duplicate same-tick trigger fire, if it exists

const resolvesFromClick = resolveCallCount - resolvesBeforeClick;
if (resolvesFromClick !== 1) {
  console.error(
    `FAIL: expected exactly 1 /resolve from the click, saw ${resolvesFromClick} ` +
      `(total ${resolveCallCount}, ${resolvesBeforeClick} before the click)`,
  );
  await browser.close();
  process.exit(1);
}
console.log(
  `OK: one physical click issued exactly one /resolve request ` +
    `(${resolvesBeforeClick} warm-up(s) preceded it)`,
);

// --- (c) confirmation gate renders from resolve alone, before classify returns ---
await page.waitForSelector("#postcall-confirm-view:not([hidden])", { timeout: 10000 });
const gateStateBeforeClassify = await page.evaluate(() => ({
  hasDetecting: document.querySelector("#postcall-confirm-view")?.textContent?.includes("Detecting"),
  // Case-insensitive on purpose: the gate renders account names through
  // titleCaseDisplayName, so "Acme E2E" is displayed as "Acme E2e". This
  // assertion is about the account SURVIVING the classify patch, not about
  // its casing — an exact-case check fails on correct behaviour.
  hasAccount: /acme e2e/i.test(document.querySelector("#postcall-confirm-view")?.textContent || ""),
}));
if (!gateStateBeforeClassify.hasDetecting) {
  console.error("FAIL: gate should show the pending 'Detecting…' state before classify returns", gateStateBeforeClassify);
  await browser.close();
  process.exit(1);
}
if (classifyCallCount < 1) {
  console.error("FAIL: classify should have been called (even if not yet answered)");
  await browser.close();
  process.exit(1);
}
console.log(
  "OK: confirmation gate rendered from /resolve alone, before /classify answered " +
    `(account present before classify: ${gateStateBeforeClassify.hasAccount})`,
);

// Now let classify answer and confirm the chip patches in place.
releaseClassify();
await page.waitForFunction(
  () => !document.querySelector("#postcall-confirm-view")?.textContent?.includes("Detecting"),
  { timeout: 5000 },
);
const gateStateAfterClassify = await page.evaluate(() => ({
  callTypeValue: document.getElementById("pc-confirm-call-type")?.value,
  accountStillThere: /acme e2e/i.test(document.querySelector("#postcall-confirm-view")?.textContent || ""),
}));
if (gateStateAfterClassify.callTypeValue !== "demo" || !gateStateAfterClassify.accountStillThere) {
  // Print what the gate actually contains. Without this the failure says only
  // "accountStillThere: false", which reads as a clobber even when the account
  // is present under different casing or wording.
  const gateText = await page.evaluate(
    () => document.querySelector("#postcall-confirm-view")?.textContent?.replace(/\s+/g, " ").slice(0, 600),
  );
  console.error("FAIL: classify patch did not land correctly, or clobbered the rest of the gate", gateStateAfterClassify);
  console.error("      gate text was:", gateText);
  await browser.close();
  process.exit(1);
}
console.log("OK: call-type chip patched in place from classify, rest of the gate untouched");

await browser.close();
console.log("E2E OK — post-call intake: button gating, single-fire submit, and progressive gate render all verified live");
