/** E2E smoke: director login sees SEs from both teams (Playwright). */

import { spawn } from "node:child_process";
import { setTimeout as delay } from "node:timers/promises";
import { fileURLToPath } from "node:url";
import path from "node:path";

const WEB_ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");
const BASE = process.env.E2E_BASE_URL || "http://127.0.0.1:8788";

let webProc = null;

async function startDevServer() {
  if (process.env.E2E_BASE_URL) return;
  webProc = spawn("node", ["dev-server.mjs"], {
    cwd: WEB_ROOT,
    stdio: ["ignore", "pipe", "pipe"],
    env: { ...process.env, PORT: "8788" },
  });
  for (let i = 0; i < 40; i++) {
    try {
      const res = await fetch(BASE);
      if (res.ok) return;
    } catch {
      // wait
    }
    await delay(250);
  }
  throw new Error("Dev server did not start on " + BASE);
}

async function stopDevServer() {
  if (webProc) {
    webProc.kill("SIGTERM");
    webProc = null;
  }
}

async function main() {
  let playwright;
  try {
    playwright = await import("playwright");
  } catch {
    console.log("SKIP: playwright not installed — run npm install in web/");
    return;
  }

  await startDevServer();

  const browser = await playwright.chromium.launch({ headless: true });
  const page = await browser.newPage();

  try {
    await page.goto(BASE, { waitUntil: "networkidle" });
    await page.waitForTimeout(800);

    await page.evaluate(() => {
      const email = document.getElementById("login-email");
      const pass = document.getElementById("login-password");
      if (email) email.value = "vipin.thomas@freshworks.com";
      if (pass) pass.value = "vipin123";
      document.getElementById("login-form")?.requestSubmit?.();
    });
    await page.waitForTimeout(2000);

    const title = await page.textContent(".one-pager-title");
    if (!title?.includes("Org dashboard")) {
      throw new Error(`Expected Org dashboard title, got: ${title}`);
    }

    const tableText = await page.textContent(".manager-se-table");
    if (!tableText?.includes("Saketh Poruri") && !tableText?.includes("Vivehanandan Agoram")) {
      throw new Error("Director dashboard missing Antony-branch squad SEs");
    }
    if (!tableText?.includes("Meera Iyer") && !tableText?.includes("Vikram Singh")) {
      throw new Error("Director dashboard missing Preethi Sri squad SE");
    }
    if (!tableText?.includes("Team")) {
      throw new Error("Director dashboard missing Team column header");
    }

    console.log("ok: director login E2E — org dashboard shows both teams");
  } finally {
    await browser.close();
    await stopDevServer();
  }
}

main().catch(async (err) => {
  console.error("FAIL:", err.message);
  await stopDevServer();
  process.exit(1);
});
