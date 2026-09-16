import { chromium } from "playwright";

const browser = await chromium.launch({ headless: true });
const page = await browser.newPage({ viewport: { width: 390, height: 844 } });

await page.goto("https://portal.benjaminsquare.com/");
await page.fill("#login-email", "se@freshworks.com");
await page.fill("#login-password", "se123");
await page.click('button[type="submit"]');
await page.waitForSelector("#app-shell:not([hidden])");
await page.waitForTimeout(800);

const s = await page.evaluate(() => {
  const dash = document.getElementById("view-dashboard");
  const rect = dash?.getBoundingClientRect();
  return {
    dashLen: dash?.innerHTML?.length ?? 0,
    dashHidden: dash?.hidden,
    height: rect?.height,
    width: rect?.width,
    text: dash?.innerText?.slice(0, 100),
  };
});
console.log("Mobile production:", s);
await browser.close();
if (s.dashHidden || s.dashLen < 200 || (s.height ?? 0) < 50) process.exit(1);
console.log("OK — mobile dashboard visible");
