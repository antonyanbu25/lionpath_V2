import { chromium } from "playwright";

const base = process.argv[2] || "http://127.0.0.1:8788";
const browser = await chromium.launch({ headless: true });
const page = await browser.newPage();

await page.goto(`${base}/`);
await page.locator("#login-email input:not([type=hidden])").fill("se@freshworks.com");
await page.locator("#login-password input:not([type=hidden])").fill("se123");
await page.click('#login-submit');
await page.waitForSelector("#app-shell:not([hidden])");

for (const wait of [500, 1500, 4000, 8000]) {
  await page.waitForTimeout(wait);
  const s = await page.evaluate((waitMs) => {
    const dash = document.getElementById("view-dashboard");
    const key = "se-singha-history:se@freshworks.com";
    let stored = [];
    try {
      stored = JSON.parse(localStorage.getItem(key) || "[]");
    } catch {}
    const withQc = stored.filter((r) => r.analysis?.qualityCoach);
    return {
      waitMs,
      dashLen: dash?.innerHTML?.length ?? 0,
      noCallsYet: (dash?.innerText ?? "").includes("No calls yet"),
      hasFreshdesk: (dash?.innerText ?? "").includes("Freshdesk"),
      sidebarItems: document.getElementById("sidebar-history-list")?.querySelectorAll("li").length ?? 0,
      storedCount: stored.length,
      withQcCount: withQc.length,
      currentView: window.__debugView || null,
    };
  }, wait);
  console.log(s);
}

await browser.close();
