import { chromium } from "playwright";

async function testDashboard(baseUrl, label) {
  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage();
  const errors = [];
  page.on("pageerror", (err) => errors.push(err.message));
  page.on("console", (msg) => {
    if (msg.type() === "error") errors.push(`console: ${msg.text()}`);
  });

  await page.goto(`${baseUrl}/`, { waitUntil: "networkidle" });
  await page.fill("#login-email", "se@freshworks.com");
  await page.fill("#login-password", "se123");
  await page.click('button[type="submit"]');

  await page.waitForSelector("#app-shell:not([hidden])", { timeout: 10000 });
  await page.waitForTimeout(500);

  const dashboard = page.locator("#view-dashboard");
  await dashboard.waitFor({ state: "visible", timeout: 5000 });
  const html = await dashboard.innerHTML();
  const text = await dashboard.innerText();

  const checks = {
    htmlLength: html.length,
    hasTitle: text.includes("My dashboard"),
    hasPrep: text.includes("Prep a call"),
    hasRecent: text.includes("Recent calls"),
    hasFollowups: text.includes("Follow-ups owed") || text.includes("All caught up"),
    isPanelHidden: await dashboard.isHidden(),
    currentHash: await page.evaluate(() => location.hash),
    viewTitle: await page.locator("#main-view-title").innerText(),
    errors,
  };

  console.log(`\n=== ${label} (${baseUrl}) ===`);
  console.log(JSON.stringify(checks, null, 2));

  await browser.close();
  return checks;
}

const local = await testDashboard("http://127.0.0.1:8788", "localhost");
const prod = await testDashboard("https://portal.benjaminsquare.com", "production");

const ok = (c) => c.htmlLength > 200 && c.hasTitle && c.hasPrep && !c.isPanelHidden;
if (!ok(local) || !ok(prod)) process.exit(1);
console.log("\nOK — browser dashboard checks passed on both environments");
