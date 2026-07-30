import { chromium } from "playwright";

const URL = "https://portal.benjaminsquare.com";

const browser = await chromium.launch({ headless: true });
const page = await browser.newPage();
const errors = [];
page.on("pageerror", (err) => errors.push(err.message));

await page.goto(URL, { waitUntil: "networkidle" });
await page.fill("#login-email", "se@freshworks.com");
await page.fill("#login-password", "se123");
await page.click('button[type="submit"]');
await page.waitForSelector("#app-shell:not([hidden])");

async function snap(label) {
  return page.evaluate((label) => {
    const dash = document.getElementById("view-dashboard");
    const bad = [];
    for (const btn of document.querySelectorAll(".sidebar-history-item")) {
      const id = btn.dataset.id;
      const raw = localStorage.getItem("lionpath-postcall-" + (document.querySelector("[data-email]")?.dataset?.email || ""));
    }
    // inspect localStorage keys for nextSteps shape
    const nextShapes = [];
    for (let i = 0; i < localStorage.length; i++) {
      const k = localStorage.key(i);
      if (!k?.includes("postcall") && !k?.includes("history")) continue;
      try {
        const v = JSON.parse(localStorage.getItem(k));
        const list = Array.isArray(v) ? v : v?.analyses || v?.records || [v].filter(Boolean);
        for (const rec of list) {
          const ns = rec?.analysis?.nextSteps;
          if (ns != null) nextShapes.push({ key: k, id: rec.id, type: Array.isArray(ns) ? "array" : typeof ns, ns: JSON.stringify(ns).slice(0, 80) });
        }
      } catch {}
    }
    return {
      label,
      dashLen: dash?.innerHTML?.length ?? 0,
      dashText: dash?.innerText?.slice(0, 60),
      historyCount: document.querySelectorAll(".sidebar-history-item").length,
      syncing: !document.getElementById("sidebar-history-sync")?.hidden,
      nextShapes: nextShapes.slice(0, 5),
    };
  }, label);
}

for (const ms of [0, 500, 1500, 3000, 6000, 10000]) {
  if (ms) await page.waitForTimeout(ms);
  const s = await snap(`t+${ms}ms`);
  console.log(JSON.stringify(s));
  if (errors.length) console.log("errors so far:", errors);
}

await browser.close();
