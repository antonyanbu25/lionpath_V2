import { chromium } from "playwright";

const browser = await chromium.launch({ headless: true });
const page = await browser.newPage();

await page.goto("http://127.0.0.1:8788/#workspace");
await page.locator("#login-email input:not([type=hidden])").fill("se@freshworks.com");
await page.locator("#login-password input:not([type=hidden])").fill("se123");
await page.click('#login-submit');
await page.waitForSelector("#app-shell:not([hidden])");
await page.waitForTimeout(300);

let s = await page.evaluate(() => ({
  hash: location.hash,
  title: document.getElementById("main-view-title")?.textContent,
  dashLen: document.getElementById("view-dashboard")?.innerHTML?.length ?? 0,
  dashHidden: document.getElementById("view-dashboard")?.hidden,
}));
console.log("After login on #workspace:", s);

await page.click('.nav-item[data-view="dashboard"]');
await page.waitForTimeout(300);

s = await page.evaluate(() => ({
  hash: location.hash,
  title: document.getElementById("main-view-title")?.textContent,
  dashLen: document.getElementById("view-dashboard")?.innerHTML?.length ?? 0,
  dashHidden: document.getElementById("view-dashboard")?.hidden,
  dashText: document.getElementById("view-dashboard")?.innerText?.slice(0, 80),
}));
console.log("After clicking My dashboard nav:", s);

await browser.close();
if (s.dashHidden || s.dashLen < 200) process.exit(1);
console.log("OK — nav click renders dashboard");
