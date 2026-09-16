/**
 * List row column overlap check → append .cursor/debug-161178.log
 */
import { chromium } from "playwright";
import { appendFileSync, mkdirSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const WEB = process.env.WEB_URL || "http://127.0.0.1:8788";
const LOG = join(dirname(fileURLToPath(import.meta.url)), "../../../.cursor/debug-161178.log");

mkdirSync(dirname(LOG), { recursive: true });

const seed = {
  uid: "usr_dummy_se_freshworks_com",
  teamId: "team_test",
  email: "se@freshworks.com",
};

const browser = await chromium.launch({ headless: true });
const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
await page.goto(`${WEB}/`, { waitUntil: "domcontentloaded" });
await page.evaluate(({ uid, teamId, email }) => {
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
        id: "account_rota",
        name: "Rota Cloud",
        domain: "rotacloud.com",
        slug: "rota-cloud",
        seTeam: [{ seUserId: uid, role: "primary", addedAt: now }],
        primarySeUserId: uid,
        createdAt: now,
        updatedAt: now,
      },
      {
        id: "account_einhell",
        name: "",
        domain: "einhell.com",
        slug: "einhell",
        seTeam: [{ seUserId: uid, role: "primary", addedAt: now }],
        primarySeUserId: uid,
        createdAt: now - 86400000,
        updatedAt: now,
      },
    ]),
  );
  localStorage.setItem(
    `${prefix}lifecycles`,
    JSON.stringify([
      {
        id: "lc_rota",
        accountId: "account_rota",
        ownerId: uid,
        teamId,
        primaryContactId: "c1",
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
      {
        id: "lc_einhell",
        accountId: "account_einhell",
        ownerId: uid,
        teamId,
        primaryContactId: null,
        title: "einhell.com",
        stage: "research",
        status: "active",
        prepCount: 0,
        postCallCount: 0,
        openTaskCount: 0,
        lastActivityAt: now - 86400000,
        createdAt: now,
        updatedAt: now,
      },
    ]),
  );
  localStorage.setItem(`${prefix}contacts`, "[]");
  localStorage.setItem(`${prefix}deals`, "[]");
  localStorage.setItem(`${prefix}lifecycleEvents`, "[]");
  const session = { role: "se", email, name: "Alex SE", uid, teamId };
  localStorage.setItem("se-sp-session-local", JSON.stringify(session));
  sessionStorage.setItem("se-sp-session", JSON.stringify(session));
}, seed);

await page.reload({ waitUntil: "domcontentloaded" });
await page.goto(`${WEB}/#accounts`, { waitUntil: "networkidle" });
await page.waitForSelector(".account-list-row-grid", { timeout: 25000 });

const data = await page.evaluate(() => {
  const rows = [...document.querySelectorAll(".account-list-row-grid")];
  if (!rows.length) return { error: "no list row" };
  const measureRow = (row) => {
    const cols = [...row.querySelectorAll(".account-list-col")].map((el) => {
      const r = el.getBoundingClientRect();
      return {
        cls: el.className.split(" ").pop(),
        left: Math.round(r.left),
        right: Math.round(r.right),
        w: Math.round(r.width),
      };
    });
    let overlap = false;
    for (let i = 0; i < cols.length - 1; i++) {
      if (cols[i].right > cols[i + 1].left + 2) overlap = true;
    }
    const rowBtn = row.closest(".account-list-item");
    return {
      colCount: cols.length,
      cols,
      columnsOverlap: overlap,
      rowTag: rowBtn?.tagName?.toLowerCase() ?? null,
      gridWidth: Math.round(row.getBoundingClientRect().width),
    };
  };
  const main = document.querySelector(".main-content");
  return {
    rowCount: rows.length,
    firstRow: measureRow(rows[0]),
    secondRow: rows[1] ? measureRow(rows[1]) : null,
    mainWidth: main ? Math.round(main.getBoundingClientRect().width) : null,
    hasCompactList: Boolean(document.querySelector(".account-list-view--compact")),
    metaRailCellCount: document.querySelectorAll(".account-meta-rail__cell").length,
  };
});

const line = JSON.stringify({
  sessionId: "161178",
  runId: "list-layout-v2",
  hypothesisId: "V-W",
  location: "capture-account-list-layout.mjs",
  message: "account list column metrics",
  data: {
    ...data,
    listOk:
      data.firstRow &&
      !data.firstRow.columnsOverlap &&
      data.firstRow.rowTag === "button" &&
      data.firstRow.colCount === 5,
  },
  timestamp: Date.now(),
});
appendFileSync(LOG, `${line}\n`);
console.log(line);
await browser.close();
