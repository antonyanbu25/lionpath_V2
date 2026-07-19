/**
 * E2E: Report click from inside open prep-facts-modal (fw-modal).
 */
import { chromium } from "playwright";

const BASE = process.env.PREP_E2E_URL || "http://127.0.0.1:8788";

const browser = await chromium.launch({ headless: true });
const page = await browser.newPage();

try {
  await page.goto(`${BASE}/`, { waitUntil: "domcontentloaded" });
  await page.waitForTimeout(500);

  await page.evaluate(() => {
    const modal = document.getElementById("prep-facts-modal");
    const list = document.getElementById("prep-facts-list");
    if (!modal || !list) throw new Error("prep-facts-modal missing");
    list.innerHTML = `<div class="prep-facts-row" data-fact-idx="0">
      <span class="prep-facts-key">Industry</span>
      <span class="prep-facts-val">Manufacturing</span>
      <button type="button" class="prep-dispute-trigger prep-dispute-btn-inline prep-facts-report" data-fact-idx="0" data-dispute-step="facts_review" data-dispute-section="facts" data-dispute-key="Industry">Report</button>
    </div>`;
    modal.isOpen = true;
  });

  await page.waitForTimeout(200);

  await page.evaluate(() => {
    document.querySelector(".prep-facts-report")?.click();
  });
  await page.waitForTimeout(400);

  const afterClick = await page.evaluate(() => ({
    disputeHidden: document.getElementById("prep-dispute-modal")?.hidden ?? true,
    modalTag: document.getElementById("prep-dispute-modal")?.tagName || "",
    categoryHeight: document.getElementById("prep-dispute-category")?.offsetHeight || 0,
    noteHeight: document.getElementById("prep-dispute-note")?.offsetHeight || 0,
    hasHealth: !!document.getElementById("prep-dispute-health"),
    legacyFwOpen: Array.from(document.querySelectorAll("fw-modal")).some((m) => {
      const t = (m.getAttribute("title-text") || "").trim();
      return /report research/i.test(t) && m.isOpen;
    }),
  }));

  const pass =
    !afterClick.disputeHidden &&
    afterClick.modalTag === "DIV" &&
    afterClick.categoryHeight > 0 &&
    afterClick.noteHeight > 0 &&
    !afterClick.hasHealth &&
    !afterClick.legacyFwOpen;

  console.log(pass ? "PASS: facts modal Report opens dispute form" : "FAIL");
  console.log(JSON.stringify({ afterClick }, null, 2));
  if (!pass) process.exit(1);
} catch (err) {
  console.error("E2E error:", err.message);
  process.exit(1);
} finally {
  await browser.close();
}
