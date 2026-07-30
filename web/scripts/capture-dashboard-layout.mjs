/**
 * Capture dashboard layout metrics → debug-7bdfbc.log (NDJSON)
 */
import { chromium } from "playwright";
import { appendFileSync, mkdirSync, writeFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const WEB = process.env.WEB_URL || "http://127.0.0.1:8788";
const ROOT = join(dirname(fileURLToPath(import.meta.url)), "../..");
const LOG = join(ROOT, "debug-7bdfbc.log");

mkdirSync(dirname(LOG), { recursive: true });
writeFileSync(LOG, "");

function log(hypothesisId, message, data) {
  appendFileSync(
    LOG,
    `${JSON.stringify({ sessionId: "7bdfbc", runId: "playwright", hypothesisId, message, data, timestamp: Date.now() })}\n`,
  );
}

const browser = await chromium.launch({ headless: true });
const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });

await page.goto(`${WEB}/`, { waitUntil: "domcontentloaded", timeout: 60000 });

await page.evaluate(() => {
  const sample = [{
    id: "test-call-1",
    timestamp: Date.now() - 86400000 * 2,
    title: "Acme Corp · Discovery",
    analysis: {
      callHeader: { title: "Acme Corp · Discovery" },
      qualityCoach: { overallScore: 72, dimensions: [], missedOpportunities: [] },
      scorecard: {
        callType: "discovery",
        lines: [{ themeKey: "discovery", score: 72, applicable: true }],
        confidence: 0.9,
      },
      momentum: { status: "Advancing" },
    },
  }];
  localStorage.setItem("se-singha-history:se@freshworks.com", JSON.stringify(sample));
  localStorage.setItem(
    "se-sp-session-local",
    JSON.stringify({
      role: "se",
      email: "se@freshworks.com",
      name: "Alex SE",
      uid: "dummy-se@freshworks.com",
    }),
  );
  sessionStorage.setItem("se-sp-session", localStorage.getItem("se-sp-session-local"));
});

await page.reload({ waitUntil: "networkidle", timeout: 60000 }).catch(() =>
  page.reload({ waitUntil: "domcontentloaded", timeout: 60000 }),
);

await page.waitForSelector("#app-shell:not([hidden])", { timeout: 20000 }).catch(() => {});
await page.waitForSelector(".launch-kpi-grid, .launchpad", { timeout: 20000 }).catch(() => {});

const metrics = await page.evaluate(() => {
  const m = (el) => {
    if (!el) return null;
    const r = el.getBoundingClientRect();
    const cs = getComputedStyle(el);
    return {
      w: Math.round(r.width),
      h: Math.round(r.height),
      left: Math.round(r.left),
      top: Math.round(r.top),
      scrollW: el.scrollWidth,
      clientW: el.clientWidth,
      display: cs.display,
    };
  };

  const tabs = document.querySelector(".dash-tabs");
  const kpi = document.querySelector(".launch-kpi-grid");
  const hero = document.querySelector(".launch-hero");
  const rows = [...document.querySelectorAll("button.launch-activity-row, fw-button.launch-activity-row")].map(
    (btn, i) => {
      const status = btn.querySelector(".launch-activity-status");
      const inner = btn.querySelector(".launch-activity-inner");
      return {
        i,
        tag: btn.tagName.toLowerCase(),
        btn: m(btn),
        inner: m(inner),
        status: m(status),
        statusText: status?.textContent?.trim().slice(0, 40),
        statusClipped: status ? status.scrollWidth > status.clientWidth + 1 : null,
        hasInner: Boolean(inner),
      };
    },
  );

  const quickAdd = document.querySelector(".task-quick-add");
  const sidebarItem = document.querySelector(".sidebar-history-item");
  const topbar = document.querySelector(".main-topbar");

  return {
    tabsLeft: m(tabs)?.left,
    kpiLeft: m(kpi)?.left,
    heroLeft: m(hero)?.left,
    tabKpiDelta: m(tabs) && m(kpi) ? m(kpi).left - m(tabs).left : null,
    activityRows: rows,
    quickAdd: quickAdd
      ? { alignItems: getComputedStyle(quickAdd).alignItems, heights: [...quickAdd.children].map((c) => m(c)) }
      : null,
    sidebarItem: m(sidebarItem),
    sidebarClipped: sidebarItem ? sidebarItem.scrollWidth > sidebarItem.clientWidth + 1 : null,
    topbar: topbar
      ? { alignItems: getComputedStyle(topbar).alignItems, children: [...topbar.children].map((c) => m(c)) }
      : null,
  };
});

log("A", "activity-rows", { rows: metrics.activityRows });
log("B", "task-quick-add", metrics.quickAdd);
log("C", "sidebar", { item: metrics.sidebarItem, clipped: metrics.sidebarClipped });
log("D", "tab-alignment", {
  tabsLeft: metrics.tabsLeft,
  kpiLeft: metrics.kpiLeft,
  heroLeft: metrics.heroLeft,
  tabKpiDelta: metrics.tabKpiDelta,
});
log("E", "topbar", metrics.topbar);

await browser.close();

const failed = (metrics.activityRows || []).some((r) => r.statusClipped);
const tabMisaligned = metrics.tabKpiDelta != null && Math.abs(metrics.tabKpiDelta) > 2;
const quickAddHeights = (metrics.quickAdd?.heights || []).map((h) => h.h).filter(Boolean);
const quickAddSpread =
  quickAddHeights.length > 1 ? Math.max(...quickAddHeights) - Math.min(...quickAddHeights) : 0;
const quickAddBad = quickAddSpread > 8;
log("B", "task-quick-add-summary", { quickAddSpread, quickAddBad, heights: quickAddHeights });
console.log(failed || tabMisaligned || quickAddBad ? "LAYOUT ISSUES DETECTED" : "LAYOUT OK");
console.log("Log:", LOG);
process.exit(failed || tabMisaligned || quickAddBad ? 1 : 0);
