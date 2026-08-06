#!/usr/bin/env node
/** Browser E2E for plan-2 fixes — prep purge, menu scroll, sign-out. */

import { appendFileSync, mkdirSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright";

const LOG = join(dirname(fileURLToPath(import.meta.url)), "..", "..", ".cursor", "debug-8a8233.log");
const BASE = process.env.WEB_URL || "http://127.0.0.1:8788";
const SESSION_ID = "8a8233";
const EMAIL = "se@freshworks.com";
const TASKS_KEY = `se-singha-tasks:${EMAIL}`;

function log(hypothesisId, location, message, data, runId = "browser-e2e") {
  mkdirSync(dirname(LOG), { recursive: true });
  appendFileSync(
    LOG,
    `${JSON.stringify({ sessionId: SESSION_ID, hypothesisId, location, message, data, runId, timestamp: Date.now() })}\n`,
  );
  console.log(message, data);
}

const legacyPrep = Array.from({ length: 56 }, (_, i) => ({
  id: `prep-${i}`,
  title: "Configure Omniroute. Inefficient manual escalation",
  status: i < 3 ? "recommended" : "completed",
  source: i % 2 === 0 ? "prep" : undefined,
  sourceKey: i % 2 === 0 ? `prep:gogreen:${i}` : undefined,
  company: "gogreen.co.uk",
  createdAt: Date.now() - i * 1000,
}));

const session = {
  role: "se",
  email: EMAIL,
  name: "Alex SE",
  userId: "usr_se_demo",
  uid: "usr_se_demo",
  teamId: "team_demo",
};

const browser = await chromium.launch({ headless: true });
const page = await browser.newPage();

try {
  await page.goto(`${BASE}/`, { waitUntil: "domcontentloaded", timeout: 30000 });

  const build = await page.evaluate(
    () => document.querySelector('meta[name="portal-build"]')?.content || null,
  );
  log("BOOT", "test-plan2-browser-e2e.mjs", "portal build", { build });

  await page.evaluate(
    ({ legacyPrep, session, TASKS_KEY }) => {
      localStorage.setItem(TASKS_KEY, JSON.stringify(legacyPrep));
      localStorage.setItem("se-sp-session-local", JSON.stringify(session));
      sessionStorage.setItem("se-sp-session", JSON.stringify(session));
    },
    { legacyPrep, session, TASKS_KEY },
  );

  await page.reload({ waitUntil: "domcontentloaded" });
  await page.waitForSelector("#app-shell:not([hidden])", { timeout: 20000 });
  await page.waitForTimeout(2500);

  const taskState = await page.evaluate(() => {
    const board = document.querySelector("#task-board-mount");
    const text = board?.innerText || "";
    const recommendedMatch = text.match(/Recommended\s*\((\d+)\)/);
    return {
      boardText: text.slice(0, 800),
      recommendedCount: recommendedMatch ? Number(recommendedMatch[1]) : null,
      hasConfigure: /Configure Omniroute/i.test(text),
      hasPrepLabel: /\bPrep\b/.test(text),
      localTasks: JSON.parse(localStorage.getItem("se-singha-tasks:se@freshworks.com") || "[]").length,
      prepInStorage: JSON.parse(localStorage.getItem("se-singha-tasks:se@freshworks.com") || "[]").filter(
        (t) =>
          t.source === "prep" ||
          String(t.sourceKey || "").startsWith("prep:") ||
          (!t.callId && /^Configure .+\.\s/.test(String(t.title || ""))),
      ).length,
    };
  });
  log("PREP-PURGE", "test-plan2-browser-e2e.mjs", "dashboard task board", taskState);

  await page.click("#sidebar-user");
  await page.waitForTimeout(300);

  const menuOpen = await page.evaluate(() => {
    const panel = document.getElementById("user-menu-panel");
    return panel ? !panel.hidden : false;
  });
  log("MENU-SCROLL", "test-plan2-browser-e2e.mjs", "menu opened", { menuOpen });

  await page.evaluate(() => {
    const nav = document.querySelector(".sidebar-nav");
    if (nav) nav.scrollTop = 120;
  });
  await page.mouse.wheel(0, 240);
  await page.waitForTimeout(400);

  const menuAfterScroll = await page.evaluate(() => {
    const panel = document.getElementById("user-menu-panel");
    return panel ? panel.hidden : true;
  });
  log("MENU-SCROLL", "test-plan2-browser-e2e.mjs", "menu after scroll/wheel", {
    menuHidden: menuAfterScroll,
  });

  await page.click("#sidebar-user");
  await page.waitForTimeout(300);
  await page.click("#user-menu-signout");
  await page.waitForTimeout(1500);

  const signOutState = await page.evaluate(() => ({
    loginVisible: !document.getElementById("login-view")?.hidden,
    appHidden: document.getElementById("app-shell")?.hidden,
    hasSession: !!(sessionStorage.getItem("se-sp-session") || localStorage.getItem("se-sp-session-local")),
  }));
  log("SIGNOUT", "test-plan2-browser-e2e.mjs", "after sign out", signOutState);

  const failed = [];
  if (taskState.hasConfigure || taskState.hasPrepLabel) failed.push("prep tasks visible");
  if (taskState.prepInStorage > 0) failed.push(`prep in storage (${taskState.prepInStorage})`);
  if (!menuAfterScroll) failed.push("menu did not close on scroll");
  if (!signOutState.loginVisible || signOutState.hasSession) failed.push("sign out failed");

  if (failed.length) {
    console.error("FAILED:", failed.join("; "));
    process.exit(1);
  }

  console.log("test-plan2-browser-e2e.mjs: ok");
} finally {
  await browser.close();
}
