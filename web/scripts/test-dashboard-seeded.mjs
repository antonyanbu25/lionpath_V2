import { chromium } from "playwright";

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

await page.goto("http://127.0.0.1:8788/");
await page.evaluate((entries) => {
  localStorage.setItem("se-singha-history:se@freshworks.com", JSON.stringify(entries));
  localStorage.setItem("se-sp-session-local", JSON.stringify({
    role: "se", email: "se@freshworks.com", name: "Alex SE", uid: "dummy-se@freshworks.com",
  }));
  sessionStorage.setItem("se-sp-session", localStorage.getItem("se-sp-session-local"));
}, sample);

await page.reload({ waitUntil: "networkidle" });
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
