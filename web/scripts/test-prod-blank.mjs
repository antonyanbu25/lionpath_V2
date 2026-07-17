import { chromium } from "playwright";

const URL = "https://portal.benjaminsquare.com";

const browser = await chromium.launch({ headless: true });
const page = await browser.newPage();
const errors = [];
page.on("console", (msg) => {
  if (msg.type() === "error") errors.push(`console: ${msg.text()}`);
});
page.on("pageerror", (err) => errors.push(`pageerror: ${err.message}`));

await page.goto(URL, { waitUntil: "networkidle" });
await page.fill("#login-email", "se@freshworks.com");
await page.fill("#login-password", "se123");
await page.click('button[type="submit"]');
await page.waitForSelector("#app-shell:not([hidden])", { timeout: 15000 });
await page.waitForTimeout(2000);

const dash = await page.evaluate(() => {
  const el = document.getElementById("view-dashboard");
  const cs = el ? getComputedStyle(el) : null;
  const inner = el?.firstElementChild;
  const innerCs = inner ? getComputedStyle(inner) : null;
  return {
    hash: location.hash,
    title: document.getElementById("main-view-title")?.textContent,
    dashHidden: el?.hidden,
    dashInnerLen: el?.innerHTML?.length ?? 0,
    dashTextLen: el?.innerText?.trim().length ?? 0,
    dashText: el?.innerText?.slice(0, 120),
    dashDisplay: cs?.display,
    dashVisibility: cs?.visibility,
    dashOpacity: cs?.opacity,
    dashHeight: cs?.height,
    dashColor: cs?.color,
    innerClass: inner?.className,
    innerDisplay: innerCs?.display,
    innerVisibility: innerCs?.visibility,
    innerOpacity: innerCs?.opacity,
    innerHeight: innerCs?.height,
    innerColor: innerCs?.color,
    historyCount: document.querySelectorAll(".sidebar-history-item").length,
  };
});
console.log("DASHBOARD:", JSON.stringify(dash, null, 2));

await page.click('.nav-item[data-view="coaching"]');
await page.waitForTimeout(500);

const coach = await page.evaluate(() => {
  const el = document.getElementById("view-coaching");
  const cs = el ? getComputedStyle(el) : null;
  const inner = el?.firstElementChild;
  const innerCs = inner ? getComputedStyle(inner) : null;
  return {
    hash: location.hash,
    title: document.getElementById("main-view-title")?.textContent,
    coachHidden: el?.hidden,
    coachInnerLen: el?.innerHTML?.length ?? 0,
    coachTextLen: el?.innerText?.trim().length ?? 0,
    coachText: el?.innerText?.slice(0, 120),
    coachDisplay: cs?.display,
    coachVisibility: cs?.visibility,
    coachOpacity: cs?.opacity,
    innerClass: inner?.className,
    innerDisplay: innerCs?.display,
    innerColor: innerCs?.color,
  };
});
console.log("COACHING:", JSON.stringify(coach, null, 2));

if (errors.length) {
  console.log("ERRORS:", errors.join("\n"));
} else {
  console.log("ERRORS: none");
}

await browser.close();

const ok = dash.dashInnerLen > 200 && dash.dashTextLen > 20 && !dash.dashHidden
  && coach.coachInnerLen > 200 && coach.coachTextLen > 20 && !coach.coachHidden;
process.exit(ok ? 0 : 1);
