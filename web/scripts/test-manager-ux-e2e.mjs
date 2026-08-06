#!/usr/bin/env node
/** E2E: manager login landing, profile menu UX — writes to debug-8a8233.log */

import { appendFileSync, mkdirSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright";

const LOG = join(dirname(fileURLToPath(import.meta.url)), "..", "..", ".cursor", "debug-8a8233.log");
const BASE = process.env.WEB_URL || "http://127.0.0.1:8788";
const SESSION_ID = "8a8233";

function log(hypothesisId, location, message, data, runId = "manager-ux-e2e") {
  mkdirSync(dirname(LOG), { recursive: true });
  appendFileSync(
    LOG,
    `${JSON.stringify({ sessionId: SESSION_ID, hypothesisId, location, message, data, runId, timestamp: Date.now() })}\n`,
  );
  console.log(message, data);
}

const browser = await chromium.launch({ headless: true });
const page = await browser.newPage();

try {
  await page.goto(`${BASE}/`, { waitUntil: "domcontentloaded", timeout: 30000 });

  const build = await page.evaluate(
    () => document.querySelector('meta[name="portal-build"]')?.content || null,
  );
  log("BOOT", "test-manager-ux-e2e.mjs", "portal build", { build });

  const managerSession = {
    role: "manager",
    email: "antony.sagayaraj@freshworks.com",
    name: "Antony Sagayaraj",
    jobTitle: "Senior Manager - Solution Engineering",
    orgId: "org_demo",
    teamId: null,
    isOrgDirector: true,
  };

  await page.evaluate((session) => {
    localStorage.setItem("se-sp-session-local", JSON.stringify(session));
    sessionStorage.setItem("se-sp-session", JSON.stringify(session));
  }, managerSession);

  await page.goto(`${BASE}/`, { waitUntil: "domcontentloaded" });
  await page.waitForSelector("#app-shell:not([hidden])", { timeout: 25000 });
  await page.waitForTimeout(2500);

  const landing = await page.evaluate(() => ({
    hash: location.hash.replace(/^#/, "") || "(empty)",
    dashboardActive: document.querySelector('.nav-item[data-view="dashboard"]')?.classList.contains("active"),
    managerActive: document.querySelector('.nav-item[data-view="manager"]')?.classList.contains("active"),
    dashboardVisible: !document.getElementById("view-dashboard")?.hidden,
    managerVisible: !document.getElementById("view-manager")?.hidden,
    teamNavVisible: !document.querySelector('.nav-item[data-view="manager"]')?.hidden,
    rollupVisible: !document.querySelector(".nav-grp--rollup")?.hidden,
  }));
  log("MGR-LANDING", "test-manager-ux-e2e.mjs", "manager login landing", landing);

  await page.click("#sidebar-user");
  await page.waitForTimeout(300);

  const menu = await page.evaluate(() => {
    const item = document.querySelector(".user-menu-panel--sidebar .user-menu-item");
    const style = item ? getComputedStyle(item) : null;
    return {
      hasProfileItem: !!document.getElementById("user-menu-profile"),
      hasTheme: !!document.getElementById("user-menu-theme-toggle"),
      hasSignOut: !!document.getElementById("user-menu-signout"),
      menuFont: style?.fontFamily || null,
      menuFontSize: style?.fontSize || null,
      menuFontWeight: style?.fontWeight || null,
      nameFontSize: getComputedStyle(document.getElementById("user-menu-name")).fontSize,
    };
  });
  log("MENU-UX", "test-manager-ux-e2e.mjs", "account menu UX", menu);

  const failed = [];
  if (landing.managerVisible && !landing.dashboardVisible) failed.push("landed on Team not dashboard");
  if (!landing.dashboardActive && landing.managerActive) failed.push("Team nav active on login");
  if (menu.hasProfileItem) failed.push("profile settings still in popup");
  if (!menu.menuFont?.includes("Figtree")) failed.push(`menu font not Figtree: ${menu.menuFont}`);

  if (failed.length) {
    console.error("FAILED:", failed.join("; "));
    process.exit(1);
  }

  console.log("test-manager-ux-e2e.mjs: ok");
} finally {
  await browser.close();
}
