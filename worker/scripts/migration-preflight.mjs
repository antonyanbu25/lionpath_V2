#!/usr/bin/env node
/**
 * Migration preflight + parity verifier for the Firestore -> Cloud SQL backfill.
 *
 * migrate-firestore-to-sql.mjs drops rows silently (bare `continue` on unmapped
 * FKs), coerces out-of-range enums to defaults without warning, and does not
 * handle four collections at all. Its --dry-run counter is also wrong. This
 * script is the pre-flight that tells you what you are about to lose, and the
 * post-run check that tells you what you actually lost.
 *
 * READ-ONLY. Never writes to Postgres or Firestore.
 *
 * Usage:
 *   # before migrating — predict every drop
 *   node worker/scripts/migration-preflight.mjs --export ./firestore-export.json
 *
 *   # after migrating — diff the export against what landed
 *   DATABASE_URL=postgresql://postgres:... \
 *     node worker/scripts/migration-preflight.mjs --export ./firestore-export.json --verify
 *
 *   # fail CI / block a release when anything would be dropped
 *   node worker/scripts/migration-preflight.mjs --export ./e.json --strict
 */

import fs from "node:fs/promises";
import { createRequire } from "node:module";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const require = createRequire(join(__dirname, "../package.json"));

// Mirrors the guards in migrate-firestore-to-sql.mjs. Keep in sync.
const DEAL_STAGES = new Set(["prospecting", "discovery", "demo_poc", "proposal", "closing", "closed_won", "closed_lost"]);
const DEAL_STATUSES = new Set(["active", "nurture", "won", "lost"]);
const LIFECYCLE_STAGE_TO_DEAL = {
  research: "prospecting", discovery: "discovery", demo: "demo_poc",
  evaluation: "demo_poc", business_case: "proposal", closed_won: "closed_won",
  closed_lost: "closed_lost", nurture: "prospecting",
};

/** Collections the backfill script actually reads, and where each one lands. */
const HANDLED = {
  orgs: "org_unit", teams: "org_unit", users: "app_user + user_identity + user_role",
  accounts: "account", contacts: "contact", deals: "deal", lifecycles: "deal",
  dealContacts: "deal_contact", prepBriefs: "activity + pre_call",
  postCalls: "activity + post_call",
};
/** Collections with a Postgres target in the v9 schema that the script ignores. */
const UNHANDLED = {
  tasks: "task", scorecards: "scorecard", scorecardLines: "scorecard_line",
  productGaps: "product_signal", callParticipants: "call_participant",
};

function parseArgs(argv) {
  const a = { exportPath: "", verify: false, strict: false, json: false };
  for (let i = 2; i < argv.length; i++) {
    const v = argv[i];
    if (v === "--export") a.exportPath = argv[++i];
    else if (v === "--verify") a.verify = true;
    else if (v === "--strict") a.strict = true;
    else if (v === "--json") a.json = true;
  }
  if (!a.exportPath) {
    console.error("usage: migration-preflight.mjs --export <file> [--verify] [--strict] [--json]");
    process.exit(2);
  }
  return a;
}

const arr = (d, k) => (Array.isArray(d[k]) ? d[k] : []);

/**
 * Replay the backfill's mapping decisions without touching a database, so every
 * skip and every enum rewrite is reported instead of swallowed.
 */
function analyze(data) {
  const drops = [];   // rows the migration will discard
  const rewrites = []; // values the migration will silently change
  const drop = (collection, id, reason) => drops.push({ collection, id, reason });

  const orgIds = new Set();
  for (const o of arr(data, "orgs")) orgIds.add(o.id);

  const teamParentMissing = [];
  for (const t of arr(data, "teams")) {
    if (t.orgId && !orgIds.has(t.orgId)) {
      teamParentMissing.push({ team: t.id, missingOrg: t.orgId, resultingPath: `/${t.id}/` });
    }
    orgIds.add(t.id);
  }

  const userIds = new Set();
  for (const u of arr(data, "users")) {
    userIds.add(u.id);
    if (!u.authUid) {
      rewrites.push({ collection: "users", id: u.id, field: "authUid",
        from: "(absent)", to: u.id, note: "user_identity.auth_uid falls back to the doc id; sign-in only resolves if the Firebase UID equals it" });
    }
    if (!u.email) drop("users", u.id, "no email (NOT NULL on app_user.email)");
  }

  const accountIds = new Set();
  for (const a of arr(data, "accounts")) accountIds.add(a.id);

  const contactIds = new Set();
  for (const c of arr(data, "contacts")) {
    if (!accountIds.has(c.accountId)) { drop("contacts", c.id, `account ${c.accountId} not in export`); continue; }
    contactIds.add(c.id);
  }

  const dealIds = new Set();
  const dealRows = [...arr(data, "deals")];
  for (const lc of arr(data, "lifecycles")) {
    if (lc.dealId) continue;
    dealRows.push({ ...lc, title: lc.title || "New business",
      stage: LIFECYCLE_STAGE_TO_DEAL[lc.stage] || "prospecting", _fromLifecycle: true, _origStage: lc.stage });
    if (lc.stage && !LIFECYCLE_STAGE_TO_DEAL[lc.stage]) {
      rewrites.push({ collection: "lifecycles", id: lc.id, field: "stage",
        from: lc.stage, to: "prospecting", note: "unmapped lifecycle stage" });
    }
  }
  for (const d of dealRows) {
    const why = [];
    if (!accountIds.has(d.accountId)) why.push(`account ${d.accountId}`);
    if (!userIds.has(d.ownerId)) why.push(`owner ${d.ownerId}`);
    const org = (d.teamId && orgIds.has(d.teamId)) || (d.orgId && orgIds.has(d.orgId));
    if (!org) why.push(`org/team ${d.teamId || d.orgId}`);
    if (why.length) { drop(d._fromLifecycle ? "lifecycles" : "deals", d.id, `unmapped: ${why.join(", ")}`); continue; }
    dealIds.add(d.id);
    const stage = String(d.stage || "").trim();
    if (stage && !DEAL_STAGES.has(stage)) {
      rewrites.push({ collection: "deals", id: d.id, field: "stage", from: stage, to: "prospecting",
        note: "value not in deal_stage_enum — rewritten, not rejected" });
    }
    const status = String(d.status || "").trim();
    if (status && !DEAL_STATUSES.has(status)) {
      rewrites.push({ collection: "deals", id: d.id, field: "status", from: status, to: "active",
        note: "value not in deal_status_enum — rewritten, not rejected" });
    }
  }

  for (const dc of arr(data, "dealContacts")) {
    const why = [];
    if (!dealIds.has(dc.dealId)) why.push(`deal ${dc.dealId}`);
    if (!contactIds.has(dc.contactId)) why.push(`contact ${dc.contactId}`);
    if (why.length) drop("dealContacts", dc.id, `unmapped: ${why.join(", ")} (dropped with NO warning)`);
  }

  for (const [coll, label] of [["prepBriefs", "pre_call"], ["postCalls", "post_call"]]) {
    for (const p of arr(data, coll)) {
      const why = [];
      if (!userIds.has(p.ownerId)) why.push(`owner ${p.ownerId}`);
      if (!accountIds.has(p.accountId)) why.push(`account ${p.accountId}`);
      const org = (p.teamId && orgIds.has(p.teamId)) || (p.orgId && orgIds.has(p.orgId));
      if (!org) why.push(`org/team ${p.teamId || p.orgId}`);
      if (why.length) drop(coll, p.id, `unmapped: ${why.join(", ")} → no ${label} row (dropped with NO warning)`);
    }
  }

  const notHandled = [];
  for (const [coll, target] of Object.entries(UNHANDLED)) {
    const n = arr(data, coll).length;
    if (n > 0) notHandled.push({ collection: coll, docs: n, postgresTarget: target });
  }

  const unknown = Object.keys(data).filter(
    (k) => Array.isArray(data[k]) && !(k in HANDLED) && !(k in UNHANDLED),
  ).map((k) => ({ collection: k, docs: data[k].length }));

  return { drops, rewrites, teamParentMissing, notHandled, unknown };
}

async function verifyAgainstPostgres(data, analysis) {
  if (!process.env.DATABASE_URL) {
    console.error("\n--verify needs DATABASE_URL (postgres / janus_owner — RLS would hide rows from janus_app).");
    process.exit(2);
  }
  const pg = require("pg");
  const { pgClientConfig } = await import("./lib/pg-client-config.mjs");
  const client = new pg.Client(pgClientConfig(process.env.DATABASE_URL));
  await client.connect();
  const one = async (sql) => Number((await client.query(sql)).rows[0].n);

  const droppedBy = (coll) => analysis.drops.filter((d) => d.collection === coll).length;
  const lifecycleDeals = arr(data, "lifecycles").filter((l) => !l.dealId).length;

  const rows = [
    ["org_unit", arr(data, "orgs").length + arr(data, "teams").length, await one("SELECT count(*)::int n FROM org_unit")],
    ["app_user", arr(data, "users").length - droppedBy("users"), await one("SELECT count(*)::int n FROM app_user WHERE public_id <> 'usr_janus_ai'")],
    ["user_identity", arr(data, "users").length - droppedBy("users"), await one("SELECT count(*)::int n FROM user_identity")],
    ["account", arr(data, "accounts").length, await one("SELECT count(*)::int n FROM account")],
    ["contact", arr(data, "contacts").length - droppedBy("contacts"), await one("SELECT count(*)::int n FROM contact")],
    ["deal", arr(data, "deals").length + lifecycleDeals - droppedBy("deals") - droppedBy("lifecycles"), await one("SELECT count(*)::int n FROM deal")],
    ["deal_contact", arr(data, "dealContacts").length - droppedBy("dealContacts"), await one("SELECT count(*)::int n FROM deal_contact")],
    ["pre_call", arr(data, "prepBriefs").length - droppedBy("prepBriefs"), await one("SELECT count(*)::int n FROM pre_call")],
    ["post_call", arr(data, "postCalls").length - droppedBy("postCalls"), await one("SELECT count(*)::int n FROM post_call")],
    ["task", arr(data, "tasks").length, await one("SELECT count(*)::int n FROM task")],
    ["scorecard", arr(data, "scorecards").length, await one("SELECT count(*)::int n FROM scorecard")],
    ["scorecard_line", arr(data, "scorecardLines").length, await one("SELECT count(*)::int n FROM scorecard_line")],
    ["product_signal", arr(data, "productGaps").length, await one("SELECT count(*)::int n FROM product_signal")],
  ];

  console.log("\n=== PARITY: expected (after known drops) vs actual in Postgres ===");
  console.table(rows.map(([table, expected, actual]) => ({
    table, expected, actual, delta: actual - expected,
    ok: actual === expected ? "yes" : "NO",
  })));

  const refData = await client.query(
    "SELECT (SELECT count(*)::int FROM app_role) app_role, (SELECT count(*)::int FROM rubric) rubric",
  );
  const rd = refData.rows[0];
  console.log(`\nreference data: app_role=${rd.app_role} rubric=${rd.rubric}` +
    (rd.app_role === 0 || rd.rubric === 0
      ? "  <-- BLOCKER: user_role cannot be inserted and every scorecard insert will fail the rubric FK"
      : "  (ok)"));

  await client.end();
  return rows.filter(([, e, a]) => e !== a).length;
}

async function main() {
  const args = parseArgs(process.argv);
  const data = JSON.parse(await fs.readFile(args.exportPath, "utf8"));
  const a = analyze(data);

  if (args.json) {
    console.log(JSON.stringify({ ...a, inventory: Object.fromEntries(
      Object.keys(data).filter((k) => Array.isArray(data[k])).map((k) => [k, data[k].length])) }, null, 2));
  } else {
    console.log("=== INVENTORY (source export) ===");
    console.table(Object.keys(data).filter((k) => Array.isArray(data[k])).map((k) => ({
      collection: k, docs: data[k].length,
      handled: k in HANDLED ? "yes" : k in UNHANDLED ? "NO — has a PG target" : "unknown collection",
      postgresTarget: HANDLED[k] || UNHANDLED[k] || "-",
    })));

    if (a.notHandled.length) {
      console.log("\n=== NOT MIGRATED AT ALL (silent, no warning at runtime) ===");
      console.table(a.notHandled);
    }
    if (a.unknown.length) {
      console.log("\n=== UNRECOGNISED COLLECTIONS (no mapping defined) ===");
      console.table(a.unknown);
    }
    if (a.drops.length) {
      console.log(`\n=== ROWS THAT WILL BE DROPPED (${a.drops.length}) ===`);
      console.table(a.drops);
    }
    if (a.rewrites.length) {
      console.log(`\n=== VALUES THAT WILL BE SILENTLY REWRITTEN (${a.rewrites.length}) ===`);
      console.table(a.rewrites);
    }
    if (a.teamParentMissing.length) {
      console.log("\n=== BROKEN ORG HIERARCHY (root-level path => manager RLS cannot see this team) ===");
      console.table(a.teamParentMissing);
    }

    const lost = a.drops.length + a.notHandled.reduce((s, x) => s + x.docs, 0);
    console.log(`\nSUMMARY: ${lost} source document(s) will not reach Postgres; ` +
      `${a.rewrites.length} value(s) will be changed without warning.`);
  }

  let mismatches = 0;
  if (args.verify) mismatches = await verifyAgainstPostgres(data, a);

  if (args.strict) {
    const lost = a.drops.length + a.notHandled.reduce((s, x) => s + x.docs, 0);
    if (lost > 0 || a.rewrites.length > 0 || mismatches > 0) {
      console.error("\nSTRICT: refusing to certify this migration.");
      process.exit(1);
    }
  }
}

main().catch((e) => { console.error("preflight error:", e.message); process.exit(2); });
