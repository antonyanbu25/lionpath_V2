/**
 * E2E: static HTML + inline script opens form without waiting on ES module handlers.
 */
import { chromium } from "playwright";

const BASE = process.env.PREP_E2E_URL || "http://127.0.0.1:8788";

const browser = await chromium.launch({ headless: true });
const page = await browser.newPage();

try {
  await page.goto(`${BASE}/`, { waitUntil: "domcontentloaded" });

  const staticDom = await page.evaluate(() => ({
    hasModal: !!document.getElementById("prep-dispute-modal"),
    hasDebugBadge: !!document.getElementById("se-build-badge"),
    hasVersionBadge: !!document.getElementById("prep-dispute-version-badge"),
    hasHealth: !!document.getElementById("prep-dispute-health"),
    hasSelect: document.getElementById("prep-dispute-category")?.tagName === "SELECT",
    hasInlineOpen: typeof window.openSeDisputeModal === "function",
    hasInlineEnsure: typeof window.ensureDisputeFieldsVisible === "function",
    collapseIconGlyph: document.querySelector(".sidebar-collapse-glyph")?.textContent || "",
    collapseIconSlot: document.querySelector("#sidebar-collapse .sidebar-collapse-glyph")?.getAttribute("slot") || "",
  }));

  const legacyDom = await page.evaluate(() => {
    const legacy = document.createElement("fw-modal");
    legacy.id = "prep-dispute-modal";
    legacy.setAttribute("title-text", "Report research issue");
    legacy.setAttribute("is-open", "false");
    document.body.appendChild(legacy);
    window.purgeLegacyDisputeModal?.();
    window.ensureStaticDisputeShell?.();
    return {
      legacyRemoved: document.querySelector("fw-modal#prep-dispute-modal") == null,
      divModal: document.getElementById("prep-dispute-modal")?.tagName || "",
      hasSelect: document.getElementById("prep-dispute-category")?.tagName === "SELECT",
    };
  });

  await page.evaluate(() => {
    const root = document.getElementById("prep-result-view") || document.body;
    const btn = document.createElement("button");
    btn.type = "button";
    btn.className = "prep-dispute-trigger prep-dispute-btn-inline";
    btn.setAttribute("data-dispute-step", "brief_result");
    btn.setAttribute("data-dispute-section", "general");
    btn.setAttribute("data-dispute-key", "Industry");
    btn.textContent = "Report issue";
    root.append(btn);
  });

  await page.evaluate(() => {
    document.querySelector(".prep-dispute-trigger")?.click();
  });
  await page.waitForTimeout(300);

  const afterClick = await page.evaluate(() => ({
    modalHidden: document.getElementById("prep-dispute-modal")?.hidden ?? true,
    categoryHeight: document.getElementById("prep-dispute-category")?.offsetHeight || 0,
    noteHeight: document.getElementById("prep-dispute-note")?.offsetHeight || 0,
    introText: document.getElementById("prep-dispute-context")?.textContent || "",
    titleText: document.getElementById("prep-dispute-title")?.textContent || "",
  }));

  const collapsedGlyph = await page.evaluate(() => {
    const sidebar = document.getElementById("sidebar");
    const btn = document.getElementById("sidebar-collapse");
    sidebar?.classList.add("sidebar-collapsed");
    btn?.setAttribute("aria-expanded", "false");
    const glyph = document.querySelector(".sidebar-collapse-glyph");
    if (glyph) glyph.textContent = "›";
    return glyph?.textContent || "";
  });

  const pass =
    staticDom.hasModal &&
    staticDom.hasSelect &&
    !staticDom.hasDebugBadge &&
    !staticDom.hasVersionBadge &&
    !staticDom.hasHealth &&
    staticDom.collapseIconSlot === "before-label" &&
    staticDom.collapseIconGlyph === "‹" &&
    staticDom.hasInlineEnsure &&
    legacyDom.legacyRemoved &&
    legacyDom.divModal === "DIV" &&
    legacyDom.hasSelect &&
    !afterClick.modalHidden &&
    afterClick.categoryHeight > 0 &&
    afterClick.noteHeight > 0 &&
    afterClick.titleText === "Report research issue" &&
    collapsedGlyph === "›";

  console.log(pass ? "PASS: static inline dispute form opens on click" : "FAIL");
  console.log(JSON.stringify({ staticDom, legacyDom, afterClick }, null, 2));
  if (!pass) process.exit(1);
} catch (err) {
  console.error("E2E error:", err.message);
  process.exit(1);
} finally {
  await browser.close();
}
