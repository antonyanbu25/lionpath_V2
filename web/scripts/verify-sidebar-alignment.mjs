import { chromium } from "playwright";
import { appendFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "../..");
const LOG = join(ROOT, "debug-0a6d10.log");
const ENDPOINT = "http://127.0.0.1:7865/ingest/46e458f7-44ce-49a5-87ef-1bb8839e9c5e";
const WEB = process.env.WEB_URL || "http://127.0.0.1:8788";

function log(payload) {
  const line = JSON.stringify({ sessionId: "0a6d10", timestamp: Date.now(), ...payload });
  appendFileSync(LOG, `${line}\n`);
  fetch(ENDPOINT, {
    method: "POST",
    headers: { "Content-Type": "application/json", "X-Debug-Session-Id": "0a6d10" },
    body: line,
  }).catch(() => {});
}

const browser = await chromium.launch({ headless: true });
const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
await page.goto(`${WEB}/`, { waitUntil: "domcontentloaded" });
await page.evaluate(() => {
  localStorage.setItem(
    "se-sp-session-local",
    JSON.stringify({ role: "se", email: "se@freshworks.com", name: "Test User" }),
  );
  localStorage.setItem("lionpath_sidebar_collapsed", "1");
});
await page.reload({ waitUntil: "domcontentloaded" });
await page.waitForSelector("#app-shell:not([hidden])", { timeout: 15000 });
await page.waitForTimeout(800);
await page.evaluate(() => new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r))));

const collapsed = await page.evaluate(() => {
  const sidebar = document.getElementById("sidebar");
  const sidebarRect = sidebar.getBoundingClientRect();
  const sidebarCenter = sidebarRect.left + sidebarRect.width / 2;
  const navBtn = sidebar.querySelector("fw-button.nav-item");
  const navBtnRect = navBtn?.getBoundingClientRect();
  const icon = navBtn?.querySelector("[data-nav-icon], .nav-icon");
  const iconRect = icon?.getBoundingClientRect();
  const svg = icon?.querySelector("svg") || icon;
  const svgRect = svg?.getBoundingClientRect();
  const logo = sidebar.querySelector(".sidebar-brand-logo");
  const logoRect = logo?.getBoundingClientRect();
  const shadowBtn = navBtn?.shadowRoot?.querySelector(".fw-btn");
  const stylesHref = [...document.querySelectorAll('link[rel="stylesheet"]')]
    .map((l) => l.href)
    .find((h) => h.includes("styles.css"));
  return {
    collapsed: sidebar.classList.contains("sidebar-collapsed"),
    sidebarWidth: Math.round(sidebarRect.width),
    navBtnWidth: navBtnRect ? Math.round(navBtnRect.width) : null,
    navBtnLeft: navBtnRect ? Math.round(navBtnRect.left) : null,
    navBtnCenterOffset: navBtnRect
      ? Math.round(Math.abs(navBtnRect.left + navBtnRect.width / 2 - sidebarCenter))
      : null,
    iconOffset: iconRect ? Math.round(Math.abs(iconRect.left + iconRect.width / 2 - sidebarCenter)) : null,
    svgOffset: svgRect ? Math.round(Math.abs(svgRect.left + svgRect.width / 2 - sidebarCenter)) : null,
    logoOffset: logoRect ? Math.round(Math.abs(logoRect.left + logoRect.width / 2 - sidebarCenter)) : null,
    logoClipped: logoRect
      ? logoRect.left < sidebarRect.left - 0.5 || logoRect.right > sidebarRect.right + 0.5
      : null,
    navBtnSize: navBtn?.getAttribute("size") || null,
    shadowBtnClass: shadowBtn?.className || null,
    stylesHref: stylesHref || null,
  };
});

log({
  runId: "post-fix-local",
  hypothesisId: "B-collapsed",
  location: "verify-sidebar-alignment.mjs",
  message: "collapsed alignment",
  data: collapsed,
});

await page.click("#sidebar-collapse");
await page.waitForTimeout(400);

const expanded = await page.evaluate(() => {
  const navBtn = document.querySelector("fw-button.nav-item");
  return {
    collapsed: document.getElementById("sidebar").classList.contains("sidebar-collapsed"),
    navBtnSize: navBtn?.getAttribute("size") || null,
  };
});

log({
  runId: "post-fix-local",
  hypothesisId: "E-expanded",
  location: "verify-sidebar-alignment.mjs",
  message: "expanded state",
  data: expanded,
});

const ok =
  collapsed.collapsed &&
  collapsed.navBtnSize === "icon" &&
  (collapsed.iconOffset ?? 99) <= 4 &&
  (collapsed.logoOffset ?? 99) <= 4 &&
  !collapsed.logoClipped &&
  !expanded.collapsed &&
  expanded.navBtnSize === "normal";

console.log("COLLAPSED", JSON.stringify(collapsed));
console.log("EXPANDED", JSON.stringify(expanded));
console.log(ok ? "VERIFY_OK" : "VERIFY_FAIL");
await browser.close();
process.exit(ok ? 0 : 1);
