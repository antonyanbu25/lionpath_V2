#!/usr/bin/env node
/**
 * Where is data NOT reaching Postgres?
 *
 * One question, three answers:
 *
 *   1. Which domain-write methods fell back to Firestore, and why
 *      (from sql_fallback_log — see 30_fallback_telemetry.sql)
 *   2. Which tables the app should be filling but are empty
 *   3. Whether Firestore still holds rows Postgres does not
 *
 * Read-only. Run it before and after each module to see the gap close.
 *
 * The cutover gate is the "last 24h" column going to zero: while a method is
 * still logging fallbacks, it is not wired, whatever the code looks like.
 *
 * Usage:
 *   node janus/scripts/coverage-report.mjs
 *   node janus/scripts/coverage-report.mjs --module postcall
 *   node janus/scripts/coverage-report.mjs --no-firestore   # skip the FS compare
 */

import { createRequire } from "node:module";
import { join } from "node:path";
import { loadDevVars, WORKER_ROOT } from "../../worker/scripts/lib/load-dev-vars.mjs";
import { pgClientConfig } from "../../worker/scripts/lib/pg-client-config.mjs";

const require = createRequire(join(WORKER_ROOT, "package.json"));
loadDevVars();

const argv = process.argv.slice(2);
const noFirestore = argv.includes("--no-firestore");
const moduleArg = (() => {
  const i = argv.indexOf("--module");
  return i === -1 ? null : argv[i + 1];
})();

/**
 * The modules, in the agreed order. Each names the tables the app must be
 * filling and the domain-write methods that fill them.
 */
const MODULES = {
  precall: {
    label: "1. Pre-call",
    tables: ["pre_call", "activity"],
    methods: ["createPrepBrief"],
  },
  postcall: {
    label: "2. Post-call",
    tables: ["post_call", "activity", "call_participant"],
    methods: ["upsertPostCallWithSummary", "upsertPostCall", "upsertCallSummary"],
  },
  scoring: {
    label: "3. Scoring",
    tables: ["scorecard", "scorecard_theme", "scorecard_line", "score_override",
             "scorecard_deal_risk"],
    methods: ["upsertScorecard", "upsertScorecardLine", "deleteScorecard"],
  },
  identity: {
    label: "4. User / usage",
    tables: ["app_user", "org_unit", "user_identity", "user_role", "org_unit_leader"],
    methods: ["upsertUser", "createTask", "updateTask"],
  },
  crm: {
    label: "5. Deal / account",
    tables: ["account", "contact", "deal", "deal_contact"],
    methods: ["createAccount", "updateAccount", "createContact", "updateContact",
              "createDeal", "updateDeal", "createDealContact", "createLifecycle"],
  },
  newtables: {
    label: "6. Last collections (5 tables, not 13)",
    // Eight of the original thirteen are stored INSIDE post_call.detail and
    // read via detailArray() in the browser -- they need a read projection
    // (v_post_call_detail_items), not tables. Verified: 1,873 items across the
    // 288 real post_calls. Only these five had nowhere to live.
    tables: ["contact_event", "deal_summary", "account_summary",
             "technical_commit", "arr_override"],
    methods: ["addContactEvent", "upsertDealSummary", "upsertAccountSummary",
              "upsertTechnicalCommit", "upsertArrOverride"],
  },
  detailprojection: {
    label: "6b. jsonb-projected (no tables needed)",
    tables: ["post_call"],
    methods: ["listFollowUpsByCall", "listMomDraftsByCall", "listDealSignalsByCall",
              "listTimelineSegmentsByCall", "listTimelineMarkersByCall",
              "getVideoFactsByCall", "listWhatWorksByPostCall", "listArrLinesByCall"],
  },
};

const url = process.env.DATABASE_URL_MIGRATIONS || process.env.DATABASE_URL;
if (!url) {
  console.error("Set DATABASE_URL_MIGRATIONS (or DATABASE_URL) in worker/.dev.vars.");
  process.exit(1);
}

const pg = require("pg");
const c = new pg.Client(pgClientConfig(url));
await c.connect();
// Every core table is FORCE ROW LEVEL SECURITY, which subjects the owner too,
// and managed Postgres does not grant rolbypassrls. Without this, every count
// reads zero and the report is worse than useless -- it lies in the direction
// of "nothing is wired".
await c.query(`SELECT set_config('app.is_admin', 'true', false)`);

const hr = (t) => console.log(`\n${"=".repeat(74)}\n${t}\n${"=".repeat(74)}`);
const has = async (t) =>
  (await c.query(`SELECT to_regclass($1) IS NOT NULL ok`, [t])).rows[0].ok;
const count = async (t) =>
  (await c.query(`SELECT count(*)::int n FROM ${t}`)).rows[0].n;

// ---------------------------------------------------------------------------
// 1. Fallbacks — the direct answer to "where is data not reaching Postgres"
// ---------------------------------------------------------------------------
hr("1. Writes that did NOT reach Postgres");

if (!(await has("sql_fallback_log"))) {
  console.log("  sql_fallback_log does not exist — apply 30_fallback_telemetry.sql.");
  console.log("  Until then a fallback leaves no trace and this cannot be measured.");
} else {
  const total = await count("sql_fallback_log");
  if (total === 0) {
    console.log("  No fallbacks recorded.");
    console.log("  NOTE: that means either everything is wired, OR the app has not run");
    console.log("  since the telemetry was added. Check the app has served traffic.");
  } else {
    const rows = (await c.query(`SELECT * FROM v_sql_coverage`)).rows;
    console.log("  method                          total  24h  LOST  reasons");
    console.log("  " + "-".repeat(70));
    for (const r of rows) {
      const flag = r.lost_writes > 0 ? " <-- LOST WRITES" : "";
      console.log(
        `  ${r.method.padEnd(30)} ${String(r.fallbacks).padStart(5)} ` +
          `${String(r.last_24h).padStart(4)} ${String(r.lost_writes).padStart(5)}  ` +
          `${r.reasons.join(", ")}${flag}`,
      );
    }
    const lost = rows.reduce((a, r) => a + r.lost_writes, 0);
    if (lost > 0) {
      console.log(
        `\n  ${lost} LOST WRITE(S): logged while PERSISTENCE_MODE=sql, so Firestore was\n` +
          `  not there to catch them. That data is gone. Fix before continuing.`,
      );
    }
    const byReason = (await c.query(
      `SELECT reason, count(*)::int n FROM sql_fallback_log
        WHERE occurred_at > now() - interval '24 hours'
        GROUP BY 1 ORDER BY 2 DESC`)).rows;
    if (byReason.length) {
      console.log("\n  Last 24h by reason:");
      for (const r of byReason) console.log(`    ${r.reason.padEnd(26)} ${r.n}`);
    }
  }
}

// ---------------------------------------------------------------------------
// 2. Per module: do the tables exist, and are they filling?
// ---------------------------------------------------------------------------
hr("2. Module coverage");

const mods = moduleArg ? { [moduleArg]: MODULES[moduleArg] } : MODULES;
if (moduleArg && !MODULES[moduleArg]) {
  console.log(`  Unknown module "${moduleArg}". One of: ${Object.keys(MODULES).join(", ")}`);
} else {
  for (const [key, mod] of Object.entries(mods)) {
    console.log(`\n  ${mod.label}`);
    let missing = 0, empty = 0, filled = 0;
    for (const t of mod.tables) {
      if (!(await has(t))) { console.log(`    ${t.padEnd(24)} TABLE DOES NOT EXIST`); missing++; continue; }
      const n = await count(t);
      if (n === 0) { console.log(`    ${t.padEnd(24)} ${String(n).padStart(7)}  empty`); empty++; }
      else { console.log(`    ${t.padEnd(24)} ${String(n).padStart(7)}`); filled++; }
    }
    // Fallbacks attributable to this module's methods.
    let fb = 0;
    if (await has("sql_fallback_log")) {
      fb = (await c.query(
        `SELECT count(*)::int n FROM sql_fallback_log
          WHERE method = ANY($1) AND occurred_at > now() - interval '24 hours'`,
        [mod.methods])).rows[0].n;
    }
    const verdict = missing > 0 ? "BLOCKED — tables missing"
      : fb > 0 ? `NOT WIRED — ${fb} fallback(s) in 24h`
      : filled > 0 && empty === 0 ? "wired and filling"
      : filled > 0 ? "partly filling"
      : "no data yet";
    console.log(`    -> ${verdict}   (${filled} filling, ${empty} empty, ${missing} missing)`);
  }
}

// ---------------------------------------------------------------------------
// 3. Firestore still ahead of Postgres?
// ---------------------------------------------------------------------------
if (!noFirestore && process.env.GOOGLE_APPLICATION_CREDENTIALS) {
  hr("3. Firestore vs Postgres");
  try {
    const admin = require("firebase-admin");
    if (!admin.apps.length) {
      admin.initializeApp({
        projectId: process.env.FIREBASE_PROJECT_ID || "se-singha-paathi",
      });
    }
    const fdb = admin.firestore();
    const PAIRS = [
      ["users", "app_user"], ["accounts", "account"], ["contacts", "contact"],
      ["deals", "deal"], ["prepBriefs", "pre_call"], ["postCalls", "post_call"],
      ["scorecards", "scorecard"], ["scorecardLines", "scorecard_line"],
      ["productGaps", "product_signal"], ["tasks", "task"],
    ];
    console.log("  collection          firestore   postgres   gap");
    console.log("  " + "-".repeat(50));
    for (const [col, tbl] of PAIRS) {
      let f = "?";
      try { f = (await fdb.collection(col).count().get()).data().count; } catch { f = "err"; }
      const p = (await has(tbl)) ? await count(tbl) : "-";
      const gap = typeof f === "number" && typeof p === "number" ? f - p : "";
      const note = typeof gap === "number" && gap > 0 ? `  ${gap} only in Firestore` : "";
      console.log(`  ${col.padEnd(18)} ${String(f).padStart(9)}  ${String(p).padStart(9)}${note}`);
    }
  } catch (err) {
    console.log(`  Firestore compare skipped: ${err instanceof Error ? err.message : err}`);
  }
}

hr("Cutover gate");
console.log("  A module is wired when its tables exist, are filling, and its methods");
console.log("  logged ZERO fallbacks in the last 24 hours with the app serving traffic.");
console.log("  Firestore comes out only when that is true for every module.");

await c.end();
process.exit(0);
