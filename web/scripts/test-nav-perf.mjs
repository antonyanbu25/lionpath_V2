#!/usr/bin/env node
/**
 * Measure login + nav view switch timings; writes NDJSON to debug-e10083.log
 */
import { appendFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
const LOG = join(ROOT, "debug-e10083.log");
const BASE = process.env.WEB_URL || "http://127.0.0.1:8788";

function log(entry) {
  const line = JSON.stringify({ sessionId: "e10083", runId: "nav-perf-e2e", timestamp: Date.now(), ...entry });
  appendFileSync(LOG, `${line}\n`);
  console.log(line);
}

const session = {
  role: "se",
  email: "se@freshworks.com",
  name: "Alex SE",
  userId: "usr_se_test",
  uid: "usr_se_test",
  teamId: "team_demo",
};

const browser = await chromium.launch({ headless: true });
const page = await browser.newPage();

try {
  await page.goto(`${BASE}/`, { waitUntil: "domcontentloaded", timeout: 30000 });
  await page.evaluate((s) => {
    localStorage.setItem("se-sp-session-local", JSON.stringify(s));
    sessionStorage.setItem("se-sp-session", JSON.stringify(s));
    localStorage.setItem(
      "se-singha-history:se@freshworks.com",
      JSON.stringify([{ id: "c1", timestamp: Date.now(), title: "Acme · Discovery", prospectEmails: ["a@acme.com"] }]),
    );
  }, session);

  const bootStart = Date.now();
  await page.reload({ waitUntil: "domcontentloaded" });
  await page.waitForSelector(".launchpad:not(.launchpad--loading), .account-list-view:not(.account-list-view--loading)", {
    timeout: 20000,
  }).catch(() => {});
  log({ hypothesisId: "H4-loginBoot", location: "e2e:boot", message: "boot to dashboard", data: { ms: Date.now() - bootStart } });

  for (const view of ["accounts", "deals", "calls", "dashboard"]) {
    const t0 = Date.now();
    await page.click(`.nav-item[data-view="${view}"]`, { timeout: 5000 }).catch(() => {});
    await page.waitForTimeout(300);
    const state = await page.evaluate(() => ({
      view: document.querySelector(".nav-item.active")?.dataset?.view,
      dashLoading: !!document.querySelector(".launchpad--loading"),
      acctLoading: !!document.querySelector(".account-list-view--loading"),
    }));
    log({
      hypothesisId: "H5-navSwitch",
      location: `e2e:${view}`,
      message: "nav switch timing",
      data: { ms: Date.now() - t0, ...state },
    });
  }

  const perf = await page.evaluate(() => {
    try {
      return JSON.parse(sessionStorage.getItem("lionpath:perf:last") || "null");
    } catch {
      return null;
    }
  });
  if (perf) log({ hypothesisId: "H4-loginBoot", location: "e2e:sessionStorage", message: "browser perf payload", data: perf.data || perf });
} finally {
  await browser.close();
}
