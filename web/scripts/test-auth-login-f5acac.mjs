#!/usr/bin/env node
/** Auth + dashboard E2E — writes NDJSON to debug-f5acac.log via /debug-ingest */
import { appendFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
const LOG = join(ROOT, "debug-f5acac.log");
const BASE = process.env.WEB_URL || "http://127.0.0.1:8788";

function log(entry) {
  const line = JSON.stringify({ sessionId: "f5acac", runId: "auth-e2e", timestamp: Date.now(), ...entry });
  appendFileSync(LOG, `${line}\n`);
  console.log(line);
}

const browser = await chromium.launch({ headless: true });
const page = await browser.newPage();

page.on("console", (msg) => {
  const text = msg.text();
  if (text.includes("[agent:f5acac]")) {
    log({ hypothesisId: "console", location: "browser-console", message: text });
  }
});

try {
  // Case 1: stale local session without Firebase user should land on login (dummy mode localhost)
  await page.goto(`${BASE}/`, { waitUntil: "domcontentloaded" });
  await page.evaluate(() => {
    localStorage.setItem(
      "se-sp-session-local",
      JSON.stringify({ role: "se", email: "stale@freshworks.com", name: "Stale", userId: "u1", uid: "u1", teamId: "t1" }),
    );
    sessionStorage.setItem(
      "se-sp-session",
      JSON.stringify({ role: "se", email: "stale@freshworks.com", name: "Stale", userId: "u1", uid: "u1", teamId: "t1" }),
    );
  });
  await page.reload({ waitUntil: "networkidle" });
  await page.waitForTimeout(1500);
  const staleState = await page.evaluate(() => ({
    loginHidden: document.getElementById("login-view")?.hidden,
    appShellHidden: document.getElementById("app-shell")?.hidden,
    appLoadingHidden: document.getElementById("app-loading")?.hidden,
    dashLoading: !!document.querySelector(".launchpad--loading"),
  }));
  log({ hypothesisId: "D", location: "e2e:stale-session", message: "stale session boot state", data: staleState });

  // Case 2: inject valid session on dummy-only path, or skip when Firebase SSO hides login form
  await page.evaluate(() => {
    localStorage.clear();
    sessionStorage.clear();
  });
  await page.reload({ waitUntil: "networkidle" });
  const loginMode = await page.evaluate(() => ({
    firebaseBlock: !document.getElementById("firebase-signin-block")?.hidden,
    loginForm: !document.getElementById("login-form")?.hidden,
  }));
  log({ hypothesisId: "F", location: "e2e:login-mode", message: "login shell mode", data: loginMode });

  if (loginMode.firebaseBlock && !loginMode.loginForm) {
    log({ hypothesisId: "A", location: "e2e:SKIP", message: "Firebase SSO mode — dashboard covered by test-launchpad-render.mjs" });
  } else {
    await page.waitForSelector("#login-email", { timeout: 15000 });
    await page.locator("#login-email input:not([type=hidden])").fill("se@freshworks.com");
    await page.locator("#login-password input:not([type=hidden])").fill("se123");
    await page.click("#login-submit");
    await page.waitForSelector("#app-shell:not([hidden])", { timeout: 15000 });
    const dashDeadline = Date.now() + 15000;
    let loginState = {};
    while (Date.now() < dashDeadline) {
      loginState = await page.evaluate(() => ({
        loginHidden: document.getElementById("login-view")?.hidden,
        appLoadingHidden: document.getElementById("app-loading")?.hidden,
        dashLoading: !!document.querySelector(".launchpad--loading"),
        hasLaunchpad: !!document.querySelector(".launchpad:not(.launchpad--loading)"),
      }));
      if (loginState.hasLaunchpad) break;
      await page.waitForTimeout(250);
    }
    log({ hypothesisId: "A", location: "e2e:dummy-login", message: "post-login dashboard state", data: loginState });
    if (!loginState.hasLaunchpad) {
      log({ hypothesisId: "A", location: "e2e:FAIL", message: "dashboard stuck loading", data: loginState });
      process.exitCode = 1;
    }
  }
} finally {
  await browser.close();
}
