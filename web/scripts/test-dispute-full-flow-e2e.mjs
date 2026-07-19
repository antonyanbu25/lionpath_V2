/**
 * E2E: login → prep brief with Report → dispute modal fields visible.
 */
import { chromium } from "playwright";

const BASE = process.env.PREP_E2E_URL || "http://127.0.0.1:8788";

const browser = await chromium.launch({ headless: true });
const page = await browser.newPage();

try {
  await page.goto(`${BASE}/`, { waitUntil: "networkidle" });
  await page.waitForTimeout(800);

  await page.evaluate(() => {
    const email = document.getElementById("login-email");
    const pass = document.getElementById("login-password");
    if (email) email.value = "se@freshworks.com";
    if (pass) pass.value = "se123";
    document.getElementById("login-form")?.requestSubmit?.();
  });
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
