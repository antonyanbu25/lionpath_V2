/** E2E smoke: director login sees SEs from both teams (Playwright). */

import { spawn } from "node:child_process";
import { setTimeout as delay } from "node:timers/promises";
import { fileURLToPath } from "node:url";
import path from "node:path";

const WEB_ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");
const BASE = process.env.E2E_BASE_URL || "http://127.0.0.1:8788";

let webProc = null;

async function startDevServer() {
  if (process.env.E2E_BASE_URL) return;
  webProc = spawn("node", ["dev-server.mjs"], {
    cwd: WEB_ROOT,
    stdio: ["ignore", "pipe", "pipe"],
    env: { ...process.env, PORT: "8788" },
  });
  for (let i = 0; i < 40; i++) {
    try {
      const res = await fetch(BASE);
      if (res.ok) return;
    } catch {
      // wait
    }
    await delay(250);
  }
  throw new Error("Dev server did not start on " + BASE);
}

async function stopDevServer() {
  if (webProc) {
    webProc.kill("SIGTERM");
    webProc = null;
  }
}

async function main() {
  let playwright;
  try {
    playwright = await import("playwright");
  } catch {
    console.log("SKIP: playwright not installed — run npm install in web/");
    return;
  }

  await startDevServer();

  const browser = await playwright.chromium.launch({ headless: true });
  const page = await browser.newPage();

  try {
    await page.goto(BASE, { waitUntil: "networkidle" });
    await page.waitForTimeout(800);

    // fw-input's real <input> lives in its shadow DOM — setting .value on
    // the custom-element host directly never syncs the component's internal
    // state, so login silently never happened (same root cause fixed in
    // test-dispute-full-flow-e2e.mjs and the test-dashboard-*.mjs suite).
    await page.locator("#login-email input:not([type=hidden])").fill("vipin.thomas@freshworks.com");
    await page.locator("#login-password input:not([type=hidden])").fill("vipin123");
    await page.click("#login-submit");
    await page.waitForTimeout(2000);

    // The manager/director team page's title is always literally "Team"
    // (dashboard.js hardcodes it) — org-wide-ness shows up in the subtitle
    // ("Org-wide roll-up · N SEs · ...") via managerDashboardSubtitle(),
    // not the title. "Org dashboard" never existed anywhere in the source.
    const title = await page.textContent(".one-pager-title");
    if (title?.trim() !== "Team") {
      throw new Error(`Expected "Team" title, got: ${title}`);
    }
    const subtitle = await page.textContent(".manager-subtitle");
    if (!subtitle?.includes("Org-wide")) {
      throw new Error(`Expected org-wide subtitle for a director login, got: ${subtitle}`);
    }

    // displayNameForEmail() (auth.js) is a deliberately synchronous, simple
    // fallback — always the raw email local-part, never a "real" display
    // name (that comes from session.name at login time, a different path).
    // Confirmed live: the table renders "saketh.poruri" not "Saketh Poruri".
    const tableText = await page.textContent(".manager-se-table");
    if (!tableText?.includes("saketh.poruri") && !tableText?.includes("vivehanandan.agoram")) {
      throw new Error("Director dashboard missing Antony-branch team SEs");
    }
    if (!tableText?.includes("vijai.vijayakumar") && !tableText?.includes("cibby.kurian")) {
      throw new Error("Director dashboard missing Nurture team SE");
    }
    if (!tableText?.includes("avinash.kumar") && !tableText?.includes("calvin.joseph")) {
      throw new Error("Director dashboard missing Digital team SE");
    }
    if (!tableText?.includes("Team")) {
      throw new Error("Director dashboard missing Team column header");
    }

    console.log("ok: director login E2E — org dashboard shows both teams");
  } finally {
    await browser.close();
    await stopDevServer();
  }
}

main().catch(async (err) => {
  console.error("FAIL:", err.message);
  await stopDevServer();
  process.exit(1);
});
