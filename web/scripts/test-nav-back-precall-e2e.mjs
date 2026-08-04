/**
 * E2E: browser back must not flash login; sidebar Pre-call opens fresh form after viewing a brief.
 */
import { chromium } from "playwright";
import { appendFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const BASE = process.env.PORTAL_URL || "http://127.0.0.1:8788";
const LOG = join(dirname(fileURLToPath(import.meta.url)), "..", "..", ".cursor", "debug-c01ae9.log");

function debugLog(location, message, data, hypothesisId) {
  const line = JSON.stringify({
    sessionId: "c01ae9",
    location,
    message,
    data,
    hypothesisId,
    runId: "nav-fix-e2e",
    timestamp: Date.now(),
  });
  appendFileSync(LOG, `${line}\n`);
  try {
    fetch("http://127.0.0.1:7865/ingest/46e458f7-44ce-49a5-87ef-1bb8839e9c5e", {
      method: "POST",
      headers: { "Content-Type": "application/json", "X-Debug-Session-Id": "c01ae9" },
      body: line,
    }).catch(() => {});
  } catch {
    // ignore
  }
}

const SAMPLE_BRIEF = {
  id: "einhell-brief-1",
  company: "Einhell",
  kind: "Discovery",
  when: "8/4/2026",
  prep: {
    version: 8,
    about: "German power tools manufacturer.",
    facts: [{ label: "Industry", value: "Manufacturing", sourceLabel: "Verified" }],
    signals: [{ label: "Support channels", value: "Email", sourceLabel: "Verified" }],
    prospects: [{ email: "ceo@einhell.com", name: "Ceo" }],
    sources: [],
  },
  meta: { company: "Einhell", domain: "einhell.com", prospectEmails: ["ceo@einhell.com"] },
  input: {
    companyName: "Einhell",
    companyDomain: "einhell.com",
    prospectEmail: "ceo@einhell.com",
  },
};

const browser = await chromium.launch({ headless: true });
const page = await browser.newPage();

await page.goto(`${BASE}/`);
await page.evaluate((brief) => {
  localStorage.setItem(
    "se-sp-session-local",
    JSON.stringify({
      userId: "usr_se",
      uid: "usr_se",
      role: "se",
      email: "se@freshworks.com",
      name: "SE",
      teamId: "team_demo",
    }),
  );
  sessionStorage.setItem(
    "se-sp-session",
    localStorage.getItem("se-sp-session-local"),
  );
  localStorage.setItem("lionpath_briefs", JSON.stringify([brief]));
}, SAMPLE_BRIEF);

await page.reload({ waitUntil: "domcontentloaded" });
await page.waitForTimeout(3000);
await page.waitForSelector("#app-shell:not([hidden])", { timeout: 20000 });

// Open brief from dashboard recent activity
await page.waitForSelector(".dash-brief-link", { timeout: 10000 });
await page.click(".dash-brief-link");
await page.waitForSelector("#prep-result-view:not([hidden])", { timeout: 5000 });

debugLog("e2e:brief-open", "brief result visible", { hash: await page.evaluate(() => location.hash) }, "H15");

// Leave prep → dashboard → sidebar Pre-call must show new form
await page.click('.nav-item[data-view="dashboard"]');
await page.waitForTimeout(400);
await page.click('.nav-item[data-view="postcall"]');
await page.waitForTimeout(400);
await page.click('.nav-item[data-view="precall"]');
await page.waitForTimeout(400);

const prepState = await page.evaluate(() => ({
  hash: location.hash,
  formHidden: document.getElementById("prep-form-view")?.hidden,
  resultHidden: document.getElementById("prep-result-view")?.hidden,
  loginHidden: document.getElementById("login-view")?.hidden,
  appVisible: !document.getElementById("app-shell")?.hidden,
}));

debugLog("e2e:precall-nav", "after sidebar precall click", prepState, "H15");

if (prepState.formHidden || !prepState.resultHidden) {
  console.error("FAIL: sidebar Pre-call should show new brief form", prepState);
  await browser.close();
  process.exit(1);
}

// Push history then back — login must not flash
await page.evaluate(() => {
  history.pushState(null, "", "#calls/test-call");
});
await page.goBack();
await page.waitForTimeout(500);

const backState = await page.evaluate(() => ({
  hash: location.hash,
  loginHidden: document.getElementById("login-view")?.hidden,
  loginVisible: !document.getElementById("login-view")?.hidden,
  appVisible: !document.getElementById("app-shell")?.hidden,
  hasSession: !!(sessionStorage.getItem("se-sp-session") || localStorage.getItem("se-sp-session-local")),
}));

debugLog("e2e:browser-back", "after history.back", backState, "H14");

await browser.close();

if (backState.loginVisible || !backState.appVisible || !backState.hasSession) {
  console.error("FAIL: browser back flashed login or lost session", backState);
  process.exit(1);
}

console.log("E2E OK — precall nav resets form and back does not flash login");
