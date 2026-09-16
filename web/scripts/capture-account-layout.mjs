/**
 * Capture account detail layout metrics → web/.debug/debug-161178.log
 */
import { chromium } from "playwright";
import { appendFileSync, mkdirSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const WEB = process.env.WEB_URL || "http://127.0.0.1:8788";
const LOG = join(dirname(fileURLToPath(import.meta.url)), "../.debug/debug-161178.log");

mkdirSync(dirname(LOG), { recursive: true });

const browser = await chromium.launch({ headless: true });
const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });

const seed = {
  uid: "usr_dummy_se_freshworks_com",
  teamId: "team_test",
  email: "se@freshworks.com",
  accountId: "account_acme",
};

await page.goto(`${WEB}/`, { waitUntil: "domcontentloaded" });
await page.evaluate(({ uid, teamId, email, accountId }) => {
  const now = Date.now();
  const prefix = "se-singha-domain:";
  localStorage.setItem(
    `${prefix}users`,
    JSON.stringify([
      {
        id: uid,
        email,
        authUid: null,
        displayName: "Alex SE",
        role: "se",
        teamId,
        orgId: null,
        managerId: null,
        jobTitle: "Solution Engineer",
        status: "active",
        createdAt: now,
        updatedAt: now,
      },
    ]),
  );
  localStorage.setItem(
    `${prefix}accounts`,
    JSON.stringify([
      {
        id: accountId,
        name: "Rota Cloud",
        domain: "rotacloud.com",
        slug: "rota-cloud",
        seTeam: [{ seUserId: uid, role: "primary", addedAt: now }],
        primarySeUserId: uid,
        createdAt: now,
        updatedAt: now,
      },
    ]),
  );
  localStorage.setItem(
    `${prefix}lifecycles`,
    JSON.stringify([
      {
        id: "lc_rota",
        accountId,
        ownerId: uid,
        teamId,
        primaryContactId: "contact_1",
        title: "Rota Cloud",
        stage: "research",
        status: "active",
        prepCount: 2,
        postCallCount: 0,
        openTaskCount: 0,
        lastActivityAt: now,
        createdAt: now,
        updatedAt: now,
      },
    ]),
  );
  localStorage.setItem(
    `${prefix}contacts`,
    JSON.stringify([
      {
        id: "contact_1",
        accountId,
        email: "ethan@rotacloud.com",
        name: "Ethan Rylett",
        title: "VP Support",
        metadata: { disc: { primary: "C" }, influence: { level: "high" } },
        createdAt: now,
        updatedAt: now,
      },
    ]),
  );
  localStorage.setItem("se-singha-domain:deals", "[]");
  localStorage.setItem("se-singha-domain:lifecycleEvents", "[]");
  const session = {
    role: "se",
    email,
    name: "Alex SE",
    uid,
    teamId,
  };
  localStorage.setItem("se-sp-session-local", JSON.stringify(session));
  sessionStorage.setItem("se-sp-session", JSON.stringify(session));
}, seed);

await page.reload({ waitUntil: "domcontentloaded" });
await page.goto(`${WEB}/#accounts/${seed.accountId}`, { waitUntil: "networkidle" });
await page.waitForSelector(".account-record", { timeout: 25000 });
await page.waitForTimeout(600);

const data = await page.evaluate(() => {
  const scope = document.querySelector(".account-record");
  if (!scope) return { error: "no account-record" };
  const box = (sel) => {
    const el = scope.querySelector(sel);
    if (!el) return null;
    const r = el.getBoundingClientRect();
    return { top: Math.round(r.top), bottom: Math.round(r.bottom), h: Math.round(r.height), w: Math.round(r.width) };
  };
  const mainContent = document.querySelector(".main-content");
  const recordBottom = Math.round(scope.getBoundingClientRect().bottom);
  const recordHeight = Math.round(scope.getBoundingClientRect().height);
  const mainBottom = mainContent ? Math.round(mainContent.getBoundingClientRect().bottom) : null;
  const mainH = mainContent ? Math.round(mainContent.getBoundingClientRect().height) : null;
  const vh = window.innerHeight;
  const controls = scope.querySelector(".account-pursuit-command__controls");
  const pipeline = scope.querySelector(".account-pursuit-command__pipeline");
  const meta = scope.querySelector(".account-meta-rail");
  const band = scope.querySelector(".account-pursuit-band");
  const deck = scope.querySelector(".account-command-deck");
  const cTop = controls?.getBoundingClientRect().top ?? 0;
  const pTop = pipeline?.getBoundingClientRect().top ?? 0;
  const metaBottom = meta ? Math.round(meta.getBoundingClientRect().bottom) : null;
  const bandTop = band ? Math.round(band.getBoundingClientRect().top) : null;
  const bandBottom = band ? Math.round(band.getBoundingClientRect().bottom) : null;
  const deckTop = deck ? Math.round(deck.getBoundingClientRect().top) : null;
  return {
    viewport: { w: window.innerWidth, h: window.innerHeight },
    metaRail: box(".account-meta-rail"),
    pursuitBand: box(".account-pursuit-band"),
    controls: box(".account-pursuit-command__controls"),
    pipeline: box(".account-pursuit-command__pipeline"),
    deck: box(".account-command-deck"),
    gapMetaToPursuit: metaBottom != null && bandTop != null ? bandTop - metaBottom : null,
    gapPursuitToDeck: bandBottom != null && deckTop != null ? deckTop - bandBottom : null,
    pursuitStackedRows: Math.abs(pTop - cTop) > 24,
    hasRecordTop: Boolean(scope.querySelector(".account-record-top")),
    hasInlineTrack: Boolean(scope.querySelector(".lifecycle-pipeline-track--inline")),
    pursuitUsesLegacyRowClass: Boolean(scope.querySelector(".account-pursuit-row--controls")),
    mainContentHeight: mainH,
    gapRecordToMainBottom: mainBottom != null ? mainBottom - recordBottom : null,
    gapRecordToViewport: Math.round(vh - recordBottom),
    gapMainToViewport: mainBottom != null ? Math.round(vh - mainBottom) : null,
    recordHeight,
    accountPanelHeight: (() => {
      const el = document.getElementById("account-panel");
      return el ? Math.round(el.getBoundingClientRect().height) : null;
    })(),
    layoutOk:
      Math.round(vh - recordBottom) < 48 &&
      (deck ? Math.round(deck.getBoundingClientRect().height) : 0) > 400 &&
      (mainBottom != null ? Math.round(vh - mainBottom) : -1) >= -2,
  };
});

const line = JSON.stringify({
  sessionId: "161178",
  runId: "playwright-capture",
  hypothesisId: "R-P",
  location: "capture-account-layout.mjs",
  message: "live layout metrics",
  data: {
    ...data,
    gapRecordToViewport: data.gapRecordToViewport,
    gapMainToViewport: data.gapMainToViewport,
    deckHeight: data.deck?.h,
    recordHeight: data.recordHeight,
  },
  timestamp: Date.now(),
});

appendFileSync(LOG, `${line}\n`);
const workspaceLog = join(dirname(fileURLToPath(import.meta.url)), "../../../.cursor/debug-161178.log");
try {
  appendFileSync(workspaceLog, `${line}\n`);
} catch {
  /* workspace log optional */
}
console.log(line);
await browser.close();
