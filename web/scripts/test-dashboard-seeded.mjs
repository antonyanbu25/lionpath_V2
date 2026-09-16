import { chromium } from "playwright";
import { forceDummyAuth } from "./lib/e2e-dummy-auth.mjs";

const sample = [{
  id: "test-call-1",
  timestamp: Date.now(),
  title: "Acme Corp · Discovery",
  analysis: {
    callHeader: { title: "Acme Corp · Discovery", date: "Jul 10" },
    qualityCoach: {
      overallScore: 7.2,
      dimensions: [{ name: "Discovery", score: 4, maxScore: 5, feedback: "", evidence: "" }],
      missedOpportunities: [],
    },
    momentum: { status: "Advancing", topAction: "Send pricing" },
    nextSteps: [{ action: "Send pricing", owner: "SE", due: "Friday" }],
  },
}];

const browser = await chromium.launch({ headless: true });
const page = await browser.newPage();
// Before any goto: with firebase-config.local.js present, real Firebase auth
// resolves signed-out ~700ms into boot and discards the injected session,
// re-hiding #app-shell after it had already appeared. See lib/e2e-dummy-auth.mjs.
await forceDummyAuth(page);

await page.goto("http://127.0.0.1:8788/");
await page.evaluate((entries) => {
  localStorage.setItem("se-singha-history:se@freshworks.com", JSON.stringify(entries));
  localStorage.setItem("se-sp-session-local", JSON.stringify({
    role: "se", email: "se@freshworks.com", name: "Alex SE", uid: "dummy-se@freshworks.com",
  }));
  sessionStorage.setItem("se-sp-session", localStorage.getItem("se-sp-session-local"));
}, sample);

// J-015: NOT networkidle. web/index.html:90 renders a looping <video>, which
// holds a media request open, so there is no settling point and the reload
// itself times out. Intermittent — it depends on whether the video request
// is still open, which is why this spec passed sometimes and failed others.
// The explicit element wait below already establishes readiness.
await page.reload({ waitUntil: "domcontentloaded" });
await page.waitForSelector("#app-shell:not([hidden])", { timeout: 10000 });
await page.waitForTimeout(500);

const s = await page.evaluate(() => ({
  dashText: document.getElementById("view-dashboard")?.innerText ?? "",
  noCallsYet: document.getElementById("view-dashboard")?.innerText?.includes("No calls yet"),
  hasAcme: document.getElementById("view-dashboard")?.innerText?.includes("Acme"),
}));
console.log(s);
await browser.close();
if (s.noCallsYet || !s.hasAcme) process.exit(1);
console.log("OK — dashboard renders seeded history on login");
