#!/usr/bin/env node
/**
 * Idempotent backfill: lifecycles without dealId → Deal records + artifact dealId.
 *
 * Usage:
 *   node worker/scripts/migrate-lifecycle-to-deals.mjs --export ./firestore-export.json
 *   node worker/scripts/migrate-lifecycle-to-deals.mjs --export ./firestore-export.json --out ./deals-migration-output.json
 *   node worker/scripts/migrate-lifecycle-to-deals.mjs --export ./firestore-export.json --dry-run
 *
 * Export shape: { lifecycles: [], prepBriefs: [], postCalls: [], tasks: [] }
 * Import via web/domain/migration-import.js or Firebase Admin batch writes.
 */

import fs from "node:fs/promises";
import path from "node:path";
import { randomUUID } from "node:crypto";

function parseArgs(argv) {
  const args = { exportPath: "", out: "deals-migration-output.json", dryRun: false };
  for (let i = 2; i < argv.length; i++) {
    if (argv[i] === "--export") args.exportPath = argv[++i];
    else if (argv[i] === "--out") args.out = argv[++i];
    else if (argv[i] === "--dry-run") args.dryRun = true;
  }
  return args;
}

function newDealId() {
  return `deal_${randomUUID()}`;
}

/**
 * @param {object} data
 */
function buildMigration(data) {
  const lifecycles = Array.isArray(data.lifecycles) ? data.lifecycles : [];
  const prepBriefs = Array.isArray(data.prepBriefs) ? data.prepBriefs : [];
  const postCalls = Array.isArray(data.postCalls) ? data.postCalls : [];
  const tasks = Array.isArray(data.tasks) ? data.tasks : [];

  /** @type {object[]} */
  const deals = [];
  /** @type {object[]} */
  const lifecycleUpdates = [];
  /** @type {object[]} */
  const prepUpdates = [];
  /** @type {object[]} */
  const postCallUpdates = [];
  /** @type {object[]} */
  const taskUpdates = [];
  for (const lc of lifecycles) {
    if (lc.dealId) continue;

    const dealId = newDealId();
    const ts = Date.now();
    deals.push({
      id: dealId,
      accountId: lc.accountId,
      type: "new_business",
      stage: lc.stage || "research",
      status: lc.status || "active",
      ownerId: lc.ownerId,
      teamId: lc.teamId,
      orgId: lc.orgId ?? null,
      primaryContactId: lc.primaryContactId ?? null,
      title: lc.title || "New business",
      prepCount: lc.prepCount || 0,
      postCallCount: lc.postCallCount || 0,
      openTaskCount: lc.openTaskCount || 0,
      latestQualityScore: lc.latestQualityScore ?? null,
      createdAt: lc.createdAt || ts,
      updatedAt: ts,
      lastActivityAt: lc.lastActivityAt || ts,
    });

    lifecycleUpdates.push({ ...lc, dealId });

    for (const p of prepBriefs.filter((x) => x.lifecycleId === lc.id && !x.dealId)) {
      prepUpdates.push({ ...p, dealId });
    }
    for (const c of postCalls.filter((x) => x.lifecycleId === lc.id && !x.dealId)) {
      postCallUpdates.push({ ...c, dealId });
    }
    for (const t of tasks.filter((x) => x.lifecycleId === lc.id && !x.dealId)) {
      taskUpdates.push({ ...t, dealId });
    }
  }

  return {
    deals,
    lifecycles: lifecycleUpdates,
    prepBriefs: prepUpdates,
    postCalls: postCallUpdates,
    tasks: taskUpdates,
    summary: {
      dealsCreated: deals.length,
      lifecyclesPatched: lifecycleUpdates.length,
      prepBriefsPatched: prepUpdates.length,
      postCallsPatched: postCallUpdates.length,
      tasksPatched: taskUpdates.length,
    },
  };
}

async function main() {
  const args = parseArgs(process.argv);
  if (!args.exportPath) {
    console.error("Usage: migrate-lifecycle-to-deals.mjs --export <json> [--out file] [--dry-run]");
    process.exit(1);
  }

  const raw = await fs.readFile(path.resolve(args.exportPath), "utf8");
  const data = JSON.parse(raw);
  const result = buildMigration(data);

  console.log(JSON.stringify(result.summary, null, 2));

  if (args.dryRun) {
    console.log("[dry-run] no file written");
    return;
  }

  await fs.writeFile(path.resolve(args.out), JSON.stringify(result, null, 2));
  console.log(`Wrote ${args.out}`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
