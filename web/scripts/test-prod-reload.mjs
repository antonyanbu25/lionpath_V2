import { chromium } from "playwright";

const URL = "https://portal.benjaminsquare.com";

const browser = await chromium.launch({ headless: true });
const page = await browser.newPage();

await page.goto(URL, { waitUntil: "networkidle" });
await page.fill("#login-email", "se@freshworks.com");
await page.fill("#login-password", "se123");
await page.click('button[type="submit"]');
await page.waitForSelector("#app-shell:not([hidden])");
await page.waitForTimeout(3000);

const bad = await page.evaluate(() => {
  const key = "se-singha-history:se@freshworks.com";
  const raw = localStorage.getItem(key);
  if (!raw) return { error: "no data" };
  const list = JSON.parse(raw);
  const issues = [];
  for (const rec of list) {
    const ns = rec?.analysis?.nextSteps;
    if (ns != null && !Array.isArray(ns)) {
      issues.push({ id: rec.id, title: rec.title, type: typeof ns, keys: Object.keys(ns), sample: JSON.stringify(ns).slice(0, 200) });
    }
    const ft = rec?.analysis?.followUpTable;
    if (ft != null && !Array.isArray(ft)) {
      issues.push({ id: rec.id, field: "followUpTable", type: typeof ft });
    }
    const mo = rec?.analysis?.qualityCoach?.missedOpportunities;
    if (mo != null && !Array.isArray(mo)) {
      issues.push({ id: rec.id, field: "missedOpportunities", type: typeof mo });
    }
  }
  return { total: list.length, issues };
});

console.log(JSON.stringify(bad, null, 2));

// Simulate hard refresh with cached data
await page.reload({ waitUntil: "networkidle" });
await page.waitForTimeout(2000);
const afterReload = await page.evaluate(() => ({
  dashLen: document.getElementById("view-dashboard")?.innerHTML?.length ?? 0,
  dashText: document.getElementById("view-dashboard")?.innerText?.slice(0, 80),
  historyCount: document.querySelectorAll(".sidebar-history-item").length,
}));
console.log("AFTER RELOAD:", JSON.stringify(afterReload, null, 2));

await browser.close();
