#!/usr/bin/env node
/**
 * Retro-rename legacy deal titles to the canonical scheme:
 *   "<Company> - New Business|Expansion - <yyyy-mm-dd>"
 *
 * A deal is renamed when its title is a legacy/default value ("New business",
 * "Expansion", "Account", empty, old "Deal N" scheme, or undated New Business/Expansion).
 * Meaningful custom titles are left untouched. Mirrors client-side ensureDealTitle().
 *
 * Usage:
 *   node worker/scripts/migrate-deal-titles.mjs --dry-run
 *   node worker/scripts/migrate-deal-titles.mjs
 *
 * Requires: GOOGLE_APPLICATION_CREDENTIALS or gcloud application-default login
 */

const LEGACY_DEAL_TITLES = new Set(["New business", "Expansion", "Account"]);
const OLD_DEAL_N_RE = / - Deal \d+ - \d{4}-\d{2}-\d{2}$/;
const NEW_BUSINESS_DATED_RE = / - New Business - \d{4}-\d{2}-\d{2}$/;
const EXPANSION_DATED_RE = / - Expansion - \d{4}-\d{2}-\d{2}$/;

function dealTypeTitleSegment(dealType) {
  return dealType === "expansion" ? "Expansion" : "New Business";
}

function isLegacyDealTitle(title, accountName) {
  const s = String(title || "").trim();
  const name = String(accountName || "").trim();
  if (!s) return true;
  if (LEGACY_DEAL_TITLES.has(s)) return true;
  if (name && (s === name || s === `${name} — New Business` || s === `${name} - New Business`)) return true;
  if (OLD_DEAL_N_RE.test(s)) return true;
  if (/ — (New Business|Expansion)$/.test(s)) return true;
  if (/ - New Business$/.test(s) && !NEW_BUSINESS_DATED_RE.test(s)) return true;
  if (/ - Expansion$/.test(s) && !EXPANSION_DATED_RE.test(s)) return true;
  return false;
}

function dealDateStr(ts) {
  const d = new Date(ts || Date.now());
  return Number.isNaN(d.getTime())
    ? new Date().toISOString().slice(0, 10)
    : d.toISOString().slice(0, 10);
}

function nextDealTitle(name, dealType, createdAt) {
  return `${name} - ${dealTypeTitleSegment(dealType)} - ${dealDateStr(createdAt)}`;
}

function parseArgs(argv) {
  const args = { dryRun: false };
  for (let i = 2; i < argv.length; i++) {
    if (argv[i] === "--dry-run") args.dryRun = true;
    else if (argv[i] === "--help" || argv[i] === "-h") {
      console.log("Usage:\n  node worker/scripts/migrate-deal-titles.mjs [--dry-run]");
      process.exit(0);
    }
  }
  return args;
}

async function loadAdmin(projectId) {
  let mod;
  try {
    mod = await import("firebase-admin");
  } catch {
    console.error("firebase-admin not installed. Run: cd worker && npm install");
    process.exit(1);
  }
  const admin = mod.default ?? mod;
  if (!admin.apps?.length) {
    admin.initializeApp(projectId ? { projectId } : undefined);
  }
  return admin;
}

async function main() {
  const args = parseArgs(process.argv);
  const projectId = process.env.FIREBASE_PROJECT_ID || process.env.GCLOUD_PROJECT || "";
  const admin = await loadAdmin(projectId || undefined);
  const db = admin.firestore();
  const ts = Date.now();

  const accountsSnap = await db.collection("accounts").get();
  const accountNameById = new Map();
  for (const doc of accountsSnap.docs) {
    const a = doc.data();
    accountNameById.set(doc.id, a.name || a.slug || "Account");
  }

  const dealsSnap = await db.collection("deals").get();

  let renamed = 0;
  for (const doc of dealsSnap.docs) {
    const deal = { id: doc.id, ref: doc.ref, ...doc.data() };
    if (!deal.accountId) continue;
    const name = accountNameById.get(deal.accountId) || "Account";
    if (!isLegacyDealTitle(deal.title, name)) continue;
    const title = nextDealTitle(name, deal.type || "new_business", deal.createdAt);
    if (title === deal.title) continue;
    renamed++;
    if (args.dryRun) {
      console.log(`[dry-run] deals/${deal.id}: "${deal.title || ""}" → "${title}"`);
    } else {
      await deal.ref.update({ title, updatedAt: ts });
      console.log(`Renamed deals/${deal.id}: "${deal.title || ""}" → "${title}"`);
    }
  }

  console.log(
    args.dryRun
      ? `Dry run complete. ${renamed} deal(s) would be renamed.`
      : `Migration complete. ${renamed} deal(s) renamed.`,
  );
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
