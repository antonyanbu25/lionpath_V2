/**
 * Post-call intake invariants, proven in a real browser.
 *
 * Two invariants, both of which were defects measured on this branch:
 *
 * INVARIANT A (submit single-fire)
 *   One user gesture creates at most ONE new submit-path /api/postcall/resolve
 *   request. Warm-up requests (runZoomPreResolve) are counted separately and are
 *   not gestures.
 *
 *   Context: a user reported "press [Analyse call] twice, that is the issue" with
 *   three POST /api/postcall/resolve requests observed. Reproduced here: the
 *   three were TWO warm-ups plus ONE submit. The warm-up dedup key is the
 *   recording link, so pasting-then-correcting the link re-arms it. The submit
 *   path was never duplicated. This test pins that down so a future change
 *   cannot quietly turn one gesture into two submits.
 *
 * INVARIANT B (no transiently-enabled submit button)
 *   #analyze-call is never enabled while the required fields are empty — not
 *   even for one frame.
 *
 *   Context: setButtonLoading() assigns `disabled = loading`, so the
 *   setButtonLoading(btn, false) inside resetPostCallView() enabled the button
 *   unconditionally. Measured before the fix: disabled went true -> FALSE (and
 *   visible) at t=459ms and back to true only at t=548ms — an ~89ms window in
 *   which an empty intake could be submitted. resetPostCallView() now re-asserts
 *   updateAnalyzeButtonState() synchronously.
 *
 * Deliberately does NOT use waitUntil:"networkidle". web/index.html renders a
 * <video autoplay muted loop preload="auto"> for the login background, which
 * holds a media request open, so networkidle cannot reliably settle — that is
 * why several older e2e specs time out at 30s on this machine. Waits here are on
 * explicit element state, never on network quiescence and never on a bare sleep
 * standing in for a condition.
 *
 * /resolve and /classify are answered from fixtures, so no Zoom, Gemini or
 * Firebase credentials are used.
 */
import { chromium } from "playwright";
import { forceDummyAuth } from "./lib/e2e-dummy-auth.mjs";

const BASE = process.env.E2E_BASE_URL || process.env.WEB_URL || "http://127.0.0.1:8788";
const WORKER = process.env.E2E_WORKER_URL || "http://127.0.0.1:8787";

const RESOLVE_OK = {
  transcript: "SE: Thanks for joining. Customer: Happy to be here.",
  transcriptMeta: { speakers: ["SE", "Customer"] },
  participantEmails: ["prospect@acme-e2e.example.com"],
  customerIdentities: ["Customer"],
  seIdentity: "SE",
  account: { accountId: "acc_e2e", accountName: "Acme E2E" },
  deals: [],
};
const SESSION = {
  userId: "usr_se_e2e",
  uid: "dummy-se-e2e@freshworks.com",
  role: "se",
  email: "se-e2e@freshworks.com",
  name: "SE E2E",
  teamId: "team_demo",
};

const failures = [];
function check(label, ok, detail = "") {
  console.log(`  ${ok ? "PASS" : "FAIL"}  ${label}${ok || !detail ? "" : ` — ${detail}`}`);
  if (!ok) failures.push(label);
}

const browser = await chromium.launch({ headless: true });

/** Boot the post-call form with a dummy session and request instrumentation. */
async function openIntake({ resolveResponder }) {
  const page = await browser.newPage();
  // Must precede goto: with firebase-config.local.js present, real Firebase
  // auth resolves signed-out ~700ms into boot and discards the injected
  // session, re-hiding #app-shell after it had already appeared.
  await forceDummyAuth(page);
  const state = { net: 0 };
  await page.route(`${WORKER}/api/postcall/resolve`, async (route) => {
    state.net += 1;
    await resolveResponder(route, state.net);
  });
  await page.route(`${WORKER}/api/postcall/classify`, (route) =>
    route.fulfill({
      contentType: "application/json",
      body: JSON.stringify({ primary: "demo", confidence: 0.9, seMotion: "new_business" }),
    }),
  );

  await page.addInitScript(() => {
    // Attribute each /resolve to its call site, and record the submit button's
    // state from the instant it exists. Instrumentation lives in the test, never
    // in product code.
    window.__resolveCalls = [];
    const origFetch = window.fetch;
    window.fetch = function (input) {
      const url = typeof input === "string" ? input : input?.url;
      if (url && url.includes("/api/postcall/resolve")) {
        window.__resolveCalls.push({ t: Math.round(performance.now()), stack: new Error().stack || "" });
      }
      return origFetch.apply(this, arguments);
    };
    window.__btnTrace = [];
    const t0 = performance.now();
    const tick = () => {
      const btn = document.getElementById("analyze-call");
      if (btn) {
        const prev = window.__btnTrace[window.__btnTrace.length - 1];
        const cur = {
          t: Math.round(performance.now() - t0),
          disabled: btn.disabled,
          visible: !!(btn.offsetParent || btn.getClientRects().length),
        };
        if (!prev || prev.disabled !== cur.disabled || prev.visible !== cur.visible) {
          window.__btnTrace.push(cur);
        }
      }
      if (performance.now() - t0 < 30000) requestAnimationFrame(tick);
    };
    requestAnimationFrame(tick);
  });

  await page.goto(`${BASE}/`, { waitUntil: "domcontentloaded", timeout: 30000 });
  await page.evaluate((session) => {
    localStorage.setItem("se-sp-session-local", JSON.stringify(session));
    sessionStorage.setItem("se-sp-session", JSON.stringify(session));
  }, SESSION);
  await page.reload({ waitUntil: "domcontentloaded", timeout: 30000 });
  await page.waitForSelector("#app-shell:not([hidden])", { timeout: 30000 });
  await page.waitForSelector("#app-loading", { state: "hidden", timeout: 30000 }).catch(() => {});
  await page.click('.nav-item[data-view="postcall"]');
  await page.waitForSelector("#postcall-form-view:not([hidden])", { timeout: 20000 });
  return { page, state };
}

/** Fill every required intake field with real keystrokes, so fw* events fire. */
async function fillIntake(page) {
  await page.click("#pc-recording-url");
  await page.type("#pc-recording-url", "https://freshworks.zoom.us/rec/share/e2efixture.tok", { delay: 8 });
  // The passcode field is revealed asynchronously once a Zoom link is present.
  await page.waitForSelector("#pc-recording-pwd", { state: "visible", timeout: 5000 }).catch(() => {});
  if (await page.locator("#pc-recording-pwd").isVisible().catch(() => false)) {
    await page.click("#pc-recording-pwd");
    await page.type("#pc-recording-pwd", "abcd1234", { delay: 8 });
  }
  // fw-input keeps a hidden light-DOM input; the editable one is the visible one.
  const email = page.locator('#pc-prospect-emails input:not([type="hidden"])').first();
  await email.click();
  await email.type("prospect@acme-e2e.example.com", { delay: 8 });
  await page.click("body");
  await page.waitForFunction(
    () => document.getElementById("analyze-call")?.disabled === false,
    { timeout: 15000 },
  );
}

function attribute(stack) {
  const frames = stack.split("\n").map((l) => l.trim()).filter((l) => /postcall\.js/.test(l));
  const named = frames.find((l) => /runZoomPreResolve|resolveWithZoomPendingRetry|startPipeline/.test(l));
  return (named || frames[1] || frames[0] || "").match(/at (?:async )?([A-Za-z0-9_$.]+)/)?.[1] || "unknown";
}

// ---------------------------------------------------------------------------
// INVARIANT B — checked first, because it is observable during the same boot.
// ---------------------------------------------------------------------------
console.log("\nINVARIANT B — #analyze-call is never enabled while fields are empty");
{
  const { page } = await openIntake({
    resolveResponder: (route) => route.fulfill({ contentType: "application/json", body: JSON.stringify(RESOLVE_OK) }),
  });
  // Let the view settle through its own initialisation; the trace records every
  // transition since the button first existed, so nothing is missed.
  await page.waitForFunction(() => (window.__btnTrace || []).length > 0, { timeout: 15000 });
  await page.waitForTimeout(3000);
  const trace = await page.evaluate(() => window.__btnTrace);
  trace.slice(0, 10).forEach((s) => console.log(`      t=${String(s.t).padStart(5)}ms disabled=${s.disabled} visible=${s.visible}`));
  const enabledWhileEmpty = trace.filter((s) => s.disabled === false);
  check(
    "no enabled-while-empty transition",
    enabledWhileEmpty.length === 0,
    enabledWhileEmpty.length ? `enabled at ${enabledWhileEmpty.map((s) => s.t + "ms").join(", ")}` : "",
  );
  check("button reaches a disabled state before becoming visible",
    trace.some((s) => s.disabled === true && s.visible === false));
  await page.close();
}

// ---------------------------------------------------------------------------
// INVARIANT A — one gesture, at most one submit-path resolve.
// ---------------------------------------------------------------------------
const SCENARIOS = [
  {
    name: "one ordinary click (200)",
    responder: (route) => route.fulfill({ contentType: "application/json", body: JSON.stringify(RESOLVE_OK) }),
    gesture: (page) => page.click("#analyze-call"),
  },
  {
    name: "rapid double click, slow server (200)",
    responder: async (route) => {
      await new Promise((r) => setTimeout(r, 600));
      await route.fulfill({ contentType: "application/json", body: JSON.stringify(RESOLVE_OK) });
    },
    gesture: async (page) => {
      await page.click("#analyze-call", { delay: 0 });
      await page.click("#analyze-call", { force: true, delay: 0 }).catch(() => {});
    },
  },
  {
    name: "hard Zoom OAuth 400 (the originally reported condition)",
    responder: (route) =>
      route.fulfill({ status: 400, contentType: "application/json", body: JSON.stringify({ error: "Zoom OAuth not configured" }) }),
    gesture: (page) => page.click("#analyze-call"),
  },
  {
    name: "rapid double click + hard 400",
    responder: async (route) => {
      await new Promise((r) => setTimeout(r, 600));
      await route.fulfill({ status: 400, contentType: "application/json", body: JSON.stringify({ error: "Zoom OAuth not configured" }) });
    },
    gesture: async (page) => {
      await page.click("#analyze-call", { delay: 0 });
      await page.click("#analyze-call", { force: true, delay: 0 }).catch(() => {});
    },
  },
];

console.log("\nINVARIANT A — one gesture produces at most one submit-path /resolve");
for (const scenario of SCENARIOS) {
  const { page } = await openIntake({ resolveResponder: scenario.responder });
  await fillIntake(page);
  await page.waitForTimeout(1200); // allow the warm-up debounce (800ms) to land
  const warmupCount = await page.evaluate(() => window.__resolveCalls.length);

  await scenario.gesture(page);
  await page.waitForFunction(
    (n) => window.__resolveCalls.length > n,
    warmupCount,
    { timeout: 15000 },
  ).catch(() => {});
  await page.waitForTimeout(2500); // give any duplicate trigger time to appear

  const calls = await page.evaluate(() => window.__resolveCalls);
  const submits = calls.slice(warmupCount);
  const warmups = calls.slice(0, warmupCount);
  check(
    `${scenario.name}: exactly 1 submit-path request`,
    submits.length === 1,
    `saw ${submits.length} (${submits.map((c) => attribute(c.stack)).join(", ") || "none"})`,
  );
  if (warmups.length) {
    check(
      `${scenario.name}: warm-ups attributed to runZoomPreResolve`,
      warmups.every((c) => attribute(c.stack) === "runZoomPreResolve"),
      warmups.map((c) => attribute(c.stack)).join(", "),
    );
  }
  await page.close();
}

await browser.close();

console.log("");
if (failures.length) {
  console.error(`FAIL — ${failures.length} invariant check(s) failed:`);
  failures.forEach((f) => console.error(`  - ${f}`));
  process.exit(1);
}
console.log("E2E OK — post-call intake invariants hold: single-fire submit, and no transiently-enabled submit button.");
