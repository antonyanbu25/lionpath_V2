import { chromium } from "playwright";

const sampleEntry = {
  id: "test-call-1",
  timestamp: Date.now(),
  zoomLink: "https://freshworks.zoom.us/rec/share/test123",
  title: "Acme Corp · Discovery",
  analysis: {
    callHeader: { title: "Acme Corp · Discovery", date: "Jul 15, 2026" },
    momentum: { status: "Advancing", topAction: "Send ROI deck" },
    nextSteps: [{ owner: "SE", action: "Send ROI deck", due: "Jul 20, 2026" }],
    qualityCoach: {
      overallScore: 7.5,
      overallLabel: "Strong",
      dimensions: [{ name: "Discovery", score: 4, maxScore: 5, feedback: "", evidence: "" }],
      strengths: [],
      improvements: [],
      missedOpportunities: [],
    },
  },
};

const browser = await chromium.launch({ headless: true });
const page = await browser.newPage();

await page.route("**/api/history?email=*", async (route) => {
  await route.fulfill({
    status: 200,
    contentType: "application/json",
    body: JSON.stringify({ email: "se@freshworks.com", entries: [sampleEntry] }),
  });
});

await page.goto("http://127.0.0.1:8788/", { waitUntil: "networkidle" });
await page.locator("#login-email input:not([type=hidden])").fill("se@freshworks.com");
await page.locator("#login-password input:not([type=hidden])").fill("se123");
await page.click('#login-submit');
await page.waitForSelector("#app-shell:not([hidden])");
await page.waitForTimeout(2000);

const dash = await page.locator("#view-dashboard").innerText();
// #sidebar-history-list was removed from the UI (recent-activity now lives
// in the launchpad's "Recent activity" side panel — see test-user-menu.mjs's
// "no sidebar recent work" check) — assert on that instead of dead markup.
const hasRecentActivityEmptyState = dash.includes("Generate a brief or analyze a recording to see activity here.");
const hasSyncedCall = dash.includes("Acme Corp");

console.log({ hasSyncedCall, hasRecentActivityEmptyState, noCalls: dash.includes("No calls yet") });
console.log(dash);

await browser.close();

if (!hasSyncedCall || hasRecentActivityEmptyState || dash.includes("No calls yet")) {
  console.error("FAIL: dashboard did not refresh after history sync");
  process.exit(1);
}
console.log("OK — dashboard refresh after history sync");
