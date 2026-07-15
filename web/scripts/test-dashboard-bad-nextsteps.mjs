import { chromium } from "playwright";

const badObjectNextSteps = {
  seActions: [{ action: "Provide trial sign-up link", dueHint: "Within 24 hours" }],
  aeActions: [{ action: "Schedule follow-up", dueHint: "Next week" }],
  suggestedFollowUpEmail: { subject: "Thanks", body: "Hi" },
};

const sample = [
  {
    id: "bad-nextsteps-1",
    timestamp: Date.now(),
    title: "Freshdesk product demonstration",
    analysis: {
      callHeader: { title: "Freshdesk product demonstration" },
      qualityCoach: {
        overallScore: 7.2,
        dimensions: [{ name: "Discovery", score: 4, maxScore: 5 }],
        missedOpportunities: [],
      },
      momentum: { status: "Advancing", topAction: "Send trial link" },
      nextSteps: badObjectNextSteps,
    },
  },
];

const browser = await chromium.launch({ headless: true });
const page = await browser.newPage();
const errors = [];
page.on("pageerror", (err) => errors.push(err.message));

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
await page.waitForTimeout(800);

let s = await page.evaluate(() => ({
  dashLen: document.getElementById("view-dashboard")?.innerHTML?.length ?? 0,
  dashText: document.getElementById("view-dashboard")?.innerText?.slice(0, 100),
}));

console.log("DASHBOARD after reload:", s);
if (errors.length) console.log("ERRORS:", errors);

await page.click('.nav-item[data-view="coaching"]');
await page.waitForTimeout(400);
s = await page.evaluate(() => ({
  hash: location.hash,
  coachLen: document.getElementById("view-coaching")?.innerHTML?.length ?? 0,
  coachText: document.getElementById("view-coaching")?.innerText?.slice(0, 100),
}));
console.log("COACHING:", s);
if (errors.length) console.log("ERRORS:", errors);

await browser.close();

const ok = s.coachLen > 200 && !errors.length;
if (!ok) process.exit(1);
console.log("OK — object nextSteps no longer blanks dashboard/coaching");
