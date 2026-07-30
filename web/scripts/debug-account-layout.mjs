/**
 * Capture account detail layout metrics (debug session 161178).
 */
import { appendFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright";

const LOG = join(dirname(fileURLToPath(import.meta.url)), "../../../.cursor/debug-161178.log");
const WEB = process.env.WEB_URL || "http://127.0.0.1:8788";

async function probe() {
  try {
    const r = await fetch(WEB, { signal: AbortSignal.timeout(2000) });
    return r.ok;
  } catch {
    return false;
  }
}

if (!(await probe())) {
  console.error("Web dev server not reachable at", WEB);
  process.exit(1);
}

const browser = await chromium.launch({ headless: true });
const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
await page.goto(`${WEB}/#accounts`, { waitUntil: "networkidle", timeout: 60000 });

await page.waitForSelector(".account-list-item, .account-record, .muted", { timeout: 15000 }).catch(() => {});

const listBtn = page.locator(".account-list-item").first();
if (await listBtn.count()) {
  await listBtn.click();
  await page.waitForSelector(".account-record", { timeout: 15000 }).catch(() => {});
}

await page.waitForTimeout(800);

const data = await page.evaluate(() => {
  const root = document.querySelector(".account-record");
  if (!root) return { error: "no account-record" };
  const box = (sel) => {
    const el = root.querySelector(sel);
    if (!el) return null;
    const r = el.getBoundingClientRect();
    return { top: Math.round(r.top), h: Math.round(r.height), w: Math.round(r.width) };
  };
  const controls = root.querySelector(".account-pursuit-command__controls");
  const pipeline = root.querySelector(".account-pursuit-command__pipeline");
  const handoff = root.querySelector(".account-pursuit-command__handoff");
  const cTop = controls?.getBoundingClientRect().top ?? 0;
  const pTop = pipeline?.getBoundingClientRect().top ?? 0;
  const hTop = handoff?.getBoundingClientRect().top ?? 0;
  return {
    viewport: { w: window.innerWidth, h: window.innerHeight },
    chrome: box(".account-command-chrome"),
    pursuitBand: box(".account-pursuit-band"),
    controls: box(".account-pursuit-command__controls"),
    pipeline: box(".account-pursuit-command__pipeline"),
    handoff: box(".account-pursuit-command__handoff"),
    deck: box(".account-command-deck"),
    pursuitStackedRows: Math.abs(pTop - cTop) > 24,
    handoffSameRowAsPipeline: handoff ? Math.abs(hTop - pTop) < 20 : null,
    hasInlineTrack: Boolean(root.querySelector(".lifecycle-pipeline-track--inline")),
  };
});

const line = JSON.stringify({
  sessionId: "161178",
  runId: "playwright-post-fix",
  hypothesisId: "A-E",
  location: "debug-account-layout.mjs",
  message: "playwright layout capture",
  data,
  timestamp: Date.now(),
});

appendFileSync(LOG, `${line}\n`);
console.log(line);
await browser.close();
