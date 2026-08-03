#!/usr/bin/env node
/**
 * E2E: cache / accounts / contacts / refresh — writes NDJSON to debug-c01ae9.log
 */
import { appendFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright";

const LOG = join(dirname(fileURLToPath(import.meta.url)), "..", "..", ".cursor", "debug-c01ae9.log");
const BASE = process.env.WEB_URL || "http://127.0.0.1:8788";
const sessionId = "c01ae9";

function log(location, message, data, hypothesisId, runId = "e2e-v4") {
  appendFileSync(
    LOG,
    `${JSON.stringify({ sessionId, location, message, data, hypothesisId, runId, timestamp: Date.now() })}\n`,
  );
}

const historyEntry = {
  id: "e2e-call-1",
  timestamp: Date.now(),
  prospectEmails: ["ceo@einhell.com"],
  title: "Discovery",
};

const briefEntry = {
  id: "e2e-brief-1",
  company: "Beta Corp",
  meta: { company: "Beta Corp", prospectEmails: ["pat@beta.com"] },
  prep: { version: 8, headline: "Test" },
};

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

page.on("console", (msg) => {
  if (msg.text().includes("[app]")) log("browser:console", msg.text(), {}, "H11");
});

try {
  await page.goto(`${BASE}/`, { waitUntil: "domcontentloaded", timeout: 30000 });

  await page.evaluate(
    ({ historyEntry, briefEntry, session }) => {
      localStorage.setItem("se-singha-history:se@freshworks.com", JSON.stringify([historyEntry]));
      localStorage.setItem("lionpath_briefs", JSON.stringify([briefEntry]));
      localStorage.setItem("se-sp-session-local", JSON.stringify(session));
      sessionStorage.setItem("se-sp-session", JSON.stringify(session));
    },
    { historyEntry, briefEntry, session },
  );

  await page.reload({ waitUntil: "domcontentloaded" });
  await page.waitForTimeout(3000);

  const bootState = await page.evaluate(() => ({
    build: document.querySelector('meta[name="portal-build"]')?.content,
    loginHidden: document.getElementById("login-view")?.hidden,
    loginVisible: !document.getElementById("login-view")?.hidden,
    appHidden: document.getElementById("app-shell")?.hidden,
    appVisible: !document.getElementById("app-shell")?.hidden,
    hasSession: !!(sessionStorage.getItem("se-sp-session") || localStorage.getItem("se-sp-session-local")),
    loginError: document.getElementById("login-error")?.textContent || "",
  }));
  log("e2e:afterBoot", "session restore on reload", bootState, "H6");

    if (!bootState.appVisible && bootState.loginVisible) {
      await page.evaluate(() => {
        const el = document.getElementById("login-email");
        const input = el?.shadowRoot?.querySelector("input");
        if (input) input.value = "se@freshworks.com";
        const pw = document.getElementById("login-password");
        const pwInput = pw?.shadowRoot?.querySelector("input");
        if (pwInput) pwInput.value = "se123";
      });
      await page.click('button[type="submit"]');
      await page.waitForTimeout(3000);
    }

  await page.waitForSelector("#app-shell:not([hidden])", { timeout: 15000 });
  await page.waitForTimeout(1000);

  const afterLogin = await page.evaluate(() => ({
    loginHidden: document.getElementById("login-view")?.hidden,
    appVisible: !document.getElementById("app-shell")?.hidden,
    hasSession: !!(sessionStorage.getItem("se-sp-session") || localStorage.getItem("se-sp-session-local")),
  }));
  log("e2e:afterLogin", "app shell visible", afterLogin, "H6");

  await page.click('.nav-item[data-view="contacts"]');
  await page.waitForTimeout(2000);

  const contactsState = await page.evaluate(() => ({
    panelText: document.getElementById("contacts-panel")?.innerText?.slice(0, 300) || "",
    contactCount: document.querySelectorAll("#contacts-view-list .contact-tile, #contacts-view-list fw-card").length,
    hasLoading: document.getElementById("contacts-panel")?.innerText?.includes("Loading contacts"),
    hasEmpty: document.getElementById("contacts-panel")?.innerText?.includes("No contacts yet"),
  }));
  log("e2e:contacts", "contacts panel", contactsState, "H11");

  await page.click('.nav-item[data-view="accounts"]');
  await page.waitForTimeout(2500);

  const accountsState = await page.evaluate(() => ({
    panelText: document.getElementById("account-panel")?.innerText?.slice(0, 400) || "",
    hasEmpty: document.getElementById("account-panel")?.innerText?.includes("No accounts yet"),
    listItems: document.querySelectorAll(".account-list-compact .lifecycle-list-item, .account-list-item").length,
  }));
  log("e2e:accounts", "accounts panel", accountsState, "H11");

  await page.reload({ waitUntil: "domcontentloaded" });
  await page.waitForTimeout(5000);

  const afterSecondReload = await page.evaluate(() => ({
    loginHidden: document.getElementById("login-view")?.hidden,
    appVisible: !document.getElementById("app-shell")?.hidden,
    hasSession: !!(sessionStorage.getItem("se-sp-session") || localStorage.getItem("se-sp-session-local")),
  }));
  log("e2e:afterSecondReload", "still signed in after refresh", afterSecondReload, "H6");

  const failed =
    !afterLogin.appVisible ||
    !afterLogin.hasSession ||
    contactsState.hasEmpty ||
    (contactsState.contactCount === 0 && !contactsState.panelText.includes("@")) ||
    accountsState.hasEmpty ||
    !afterSecondReload.appVisible;

  if (failed) {
    console.error("E2E FAIL", { bootState, afterLogin, contactsState, accountsState, afterSecondReload });
    process.exit(1);
  }
  console.log("E2E OK — accounts, contacts, and session survive reload");
} catch (err) {
  log("e2e:error", String(err?.message || err), {}, "H11");
  console.error(err);
  process.exit(1);
} finally {
  await browser.close();
}
