/**
 * E2E: login → prep brief with Report → dispute modal fields visible.
 */
import { chromium } from "playwright";
import { forceDummyAuth } from "./lib/e2e-dummy-auth.mjs";

const BASE = process.env.PREP_E2E_URL || "http://127.0.0.1:8788";

const browser = await chromium.launch({ headless: true });
const page = await browser.newPage();
// Before any goto: with firebase-config.local.js present, real Firebase auth
// resolves signed-out ~700ms into boot and discards the injected session,
// re-hiding #app-shell after it had already appeared. See lib/e2e-dummy-auth.mjs.
await forceDummyAuth(page);

try {
  await page.goto(`${BASE}/`, { waitUntil: "networkidle" });
  await page.waitForTimeout(800);

  // fw-input's actual native <input> lives in its shadow DOM — setting
  // .value on the custom-element host directly (or via requestSubmit
  // without real input events) doesn't sync the component's internal
  // state, so login silently never happens. Fill the real shadow input
  // like a user would, same fix as test-dashboard-nav.mjs etc.
  await page.locator("#login-email input:not([type=hidden])").fill("se@freshworks.com");
  await page.locator("#login-password input:not([type=hidden])").fill("se123");
  await page.click('#login-submit');
  await page.waitForTimeout(2000);

  const loggedIn = await page.evaluate(() => ({
    appVisible: !document.getElementById("app-shell")?.hidden,
    loginHidden: document.getElementById("login-view")?.hidden ?? false,
  }));

  await page.evaluate(() => {
    const card = document.getElementById("prep-result") || document.getElementById("prep-result-view");
    const host = card || document.getElementById("view-precall");
    if (!host) return;
    host.hidden = false;
    const wrap = document.createElement("div");
    wrap.className = "prep-brief-mock";
    wrap.innerHTML = `<p class="prep-company-name">Acme Corp</p><button type="button" class="prep-dispute-trigger prep-dispute-btn-inline" data-dispute-step="brief_result" data-dispute-section="facts" data-dispute-idx="0" data-dispute-key="Industry">Report</button>`;
    host.append(wrap);
  });

  await page.evaluate(() => document.querySelector(".prep-dispute-trigger")?.click());
  await page.waitForTimeout(400);

  const afterClick = await page.evaluate(() => ({
    hasDebugBadge: !!document.getElementById("se-build-badge"),
    modalHidden: document.getElementById("prep-dispute-modal")?.hidden ?? true,
    categoryHeight: document.getElementById("prep-dispute-category")?.offsetHeight || 0,
    noteHeight: document.getElementById("prep-dispute-note")?.offsetHeight || 0,
    titleText: document.getElementById("prep-dispute-title")?.textContent || "",
  }));

  const pass =
    loggedIn.appVisible &&
    !afterClick.hasDebugBadge &&
    !afterClick.modalHidden &&
    afterClick.categoryHeight > 0 &&
    afterClick.noteHeight > 0 &&
    afterClick.titleText === "Report research issue";

  console.log(pass ? "PASS: full flow login → Report → dispute form" : "FAIL");
  console.log(JSON.stringify({ loggedIn, afterClick }, null, 2));
  if (!pass) process.exit(1);
} catch (err) {
  console.error("E2E error:", err.message);
  process.exit(1);
} finally {
  await browser.close();
}
