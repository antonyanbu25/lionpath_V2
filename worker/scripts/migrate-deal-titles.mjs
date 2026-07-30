#!/usr/bin/env node
/**
 * Retro-rename legacy deal titles to the canonical scheme:
 *   "<Account> - Deal <N> - <yyyy-mm-dd>"
 *
 * A deal is renamed when its title is a legacy/default value ("New business",
 * "Expansion", "Account", or empty). N is the deal's 1-based position within its
 * account, ordered by createdAt. Meaningful titles (e.g. "Acme. Expansion") are
 * left untouched. Mirrors the client-side ensureDealTitle() lazy rename.
 *
 * Usage:
 *   node worker/scripts/migrate-deal-titles.mjs --dry-run
 *   node worker/scripts/migrate-deal-titles.mjs
 *
 * Requires: GOOGLE_APPLICATION_CREDENTIALS or gcloud application-default login
 */

const LEGACY_DEAL_TITLES = new Set(["New business", "Expansion", "Account"]);

function isLegacyDealTitle(title) {
  const s = String(title || "").trim();
  return !s || LEGACY_DEAL_TITLES.has(s);
}

function dealDateStr(ts) {
  const d = new Date(ts || Date.now());
  return Number.isNaN(d.getTime())
    ? new Date().toISOString().slice(0, 10)
    : d.toISOString().slice(0, 10);
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
  const dealsByAccount = new Map();
  for (const doc of dealsSnap.docs) {
    const deal = { id: doc.id, ref: doc.ref, ...doc.data() };
    if (!deal.accountId) continue;
    if (!dealsByAccount.has(deal.accountId)) dealsByAccount.set(deal.accountId, []);
    dealsByAccount.get(deal.accountId).push(deal);
  }

  let renamed = 0;
  for (const [accountId, deals] of dealsByAccount.entries()) {
    const name = accountNameById.get(accountId) || "Account";
    const sorted = [...deals].sort((a, b) => (a.createdAt || 0) - (b.createdAt || 0));
    for (let i = 0; i < sorted.length; i++) {
      const deal = sorted[i];
      if (!isLegacyDealTitle(deal.title)) continue;
      const title = `${name} - Deal ${i + 1} - ${dealDateStr(deal.createdAt)}`;
      if (title === deal.title) continue;
      renamed++;
      if (args.dryRun) {
        console.log(`[dry-run] deals/${deal.id}: "${deal.title || ""}" → "${title}"`);
      } else {
        await deal.ref.update({ title, updatedAt: ts });
        console.log(`Renamed deals/${deal.id}: "${deal.title || ""}" → "${title}"`);
      }
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
