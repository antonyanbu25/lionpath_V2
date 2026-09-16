#!/usr/bin/env node
/**
 * Idempotent backfill: legacy history/KV/briefs → lifecycle domain JSON.
 *
 * Usage:
 *   node worker/scripts/migrate-to-lifecycle.mjs --history-dir ./data/history
 *   node worker/scripts/migrate-to-lifecycle.mjs --export ./migration-export.json
 *   node worker/scripts/migrate-to-lifecycle.mjs --history-dir ./data/history --out ./migration-output.json
 *
 * Import the output in the browser console via importMigrationData() from web/domain/migration-import.js
 * or upload to Firestore with Firebase Admin SDK.
 */

import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { randomUUID } from "node:crypto";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

function parseArgs(argv) {
  const args = { historyDir: "", exportPath: "", out: "migration-output.json", dryRun: false };
  for (let i = 2; i < argv.length; i++) {
    if (argv[i] === "--history-dir") args.historyDir = argv[++i];
    else if (argv[i] === "--export") args.exportPath = argv[++i];
    else if (argv[i] === "--out") args.out = argv[++i];
    else if (argv[i] === "--dry-run") args.dryRun = true;
  }
  return args;
}

function normalizeSlug(name) {
  return String(name || "account")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 48) || "account";
}

function dummyUid(email) {
  return `dummy-${String(email || "").trim().toLowerCase()}`;
}

function callIdentityKey(record) {
  const zoomLink = record.zoomLink || record.result?.recordingUrl || "";
  const m = String(zoomLink).match(/rec\/(?:share|play)\/([^/?#]+)/i);
  if (m) return `zoom:${m[1].toLowerCase()}`;
  const header = record.analysis?.callHeader || {};
  if (header.title) return `title:${header.title}|${header.date || ""}`;
  return `id:${record.id}`;
}

async function readHistoryDir(dir) {
  const results = [];
  let files;
  try {
    files = await fs.readdir(dir);
  } catch {
    return results;
  }
  for (const file of files) {
    if (!file.endsWith(".json")) continue;
    const key = file.replace(/\.json$/, "");
    const email = key.startsWith("history_") ? key.slice("history_".length) : key.replace(/^history/, "");
    if (!email.includes("@")) continue;
    const raw = await fs.readFile(path.join(dir, file), "utf8");
    let entries = [];
    try {
      entries = JSON.parse(raw);
    } catch {
      continue;
    }
    if (!Array.isArray(entries)) continue;
    results.push({ email, entries });
  }
  return results;
}

async function readExport(exportPath) {
  const raw = await fs.readFile(exportPath, "utf8");
  const data = JSON.parse(raw);
  const out = [];

  if (data.historyByEmail) {
    for (const [email, entries] of Object.entries(data.historyByEmail)) {
      out.push({ email, entries });
    }
  }
  if (data.briefs) {
    out.push({ email: data.email || "unknown@freshworks.com", briefs: data.briefs });
  }
  return out;
}

function migrateSources(sources, teamId = "demo-team") {
  const accounts = new Map();
  const contacts = [];
  const lifecycles = new Map();
  const prepBriefs = [];
  const postCalls = [];
  const events = [];
  const postCallKeys = new Set();

  const ts = Date.now();

  function ensureAccount(company, domain) {
    const slug = normalizeSlug(company, domain);
    if (accounts.has(slug)) return accounts.get(slug);
    const account = {
      id: randomUUID(),
      name: company || slug,
      domain: domain || null,
      slug,
      createdAt: ts,
      updatedAt: ts,
    };
    accounts.set(slug, account);
    return account;
  }

  function ensureLifecycle(ownerId, accountId, title) {
    const key = `${ownerId}:${accountId}`;
    if (lifecycles.has(key)) return lifecycles.get(key);
    const lifecycle = {
      id: randomUUID(),
      ownerId,
      teamId,
      accountId,
      primaryContactId: null,
      stage: "research",
      status: "active",
      title: title || "Account",
      createdAt: ts,
      updatedAt: ts,
      lastActivityAt: ts,
      prepCount: 0,
      postCallCount: 0,
      openTaskCount: 0,
      latestQualityScore: null,
    };
    lifecycles.set(key, lifecycle);
    events.push({
      id: randomUUID(),
      lifecycleId: lifecycle.id,
      type: "artifact_imported",
      actorId: ownerId,
      timestamp: ts,
      payload: { source: "migration" },
    });
    return lifecycle;
  }

  for (const source of sources) {
    const email = source.email;
    const ownerId = dummyUid(email);

    for (const entry of source.entries || []) {
      const company =
        entry.analysis?.callHeader?.company ||
        entry.analysis?.callHeader?.account ||
        entry.title?.split("—")[0]?.trim() ||
        "Unknown";
      const account = ensureAccount(company);
      const lifecycle = ensureLifecycle(ownerId, account.id, account.name);

      const identity = callIdentityKey(entry);
      const dedupeKey = `${ownerId}:${identity}`;
      if (postCallKeys.has(dedupeKey)) continue;
      postCallKeys.add(dedupeKey);

      const qualityScore = entry.analysis?.qualityCoach?.overall ?? entry.analysis?.qualityCoach?.overallScore ?? null;
      postCalls.push({
        id: entry.id || randomUUID(),
        lifecycleId: lifecycle.id,
        ownerId,
        teamId,
        accountId: account.id,
        zoomLink: entry.zoomLink,
        title: entry.title,
        callIdentityKey: identity,
        analysis: entry.analysis || entry.result?.analysis || {},
        transcriptMeta: entry.transcriptMeta || entry.result?.transcriptMeta,
        qualityScore: typeof qualityScore === "number" ? qualityScore : null,
        createdAt: entry.timestamp || ts,
        updatedAt: entry.timestamp || ts,
      });
      lifecycle.postCallCount += 1;
      lifecycle.lastActivityAt = Math.max(lifecycle.lastActivityAt, entry.timestamp || ts);
      if (typeof qualityScore === "number") lifecycle.latestQualityScore = qualityScore;
      if (lifecycle.postCallCount === 1 && lifecycle.stage === "research") lifecycle.stage = "discovery";
    }

    for (const brief of source.briefs || []) {
      const company = brief.meta?.company || brief.company || brief.input?.companyName || "Unknown";
      const account = ensureAccount(company, brief.meta?.domain);
      const lifecycle = ensureLifecycle(ownerId, account.id, account.name);
      prepBriefs.push({
        id: brief.id || randomUUID(),
        lifecycleId: lifecycle.id,
        ownerId,
        teamId,
        accountId: account.id,
        input: brief.input || {},
        prep: brief.prep,
        meta: brief.meta || { company },
        createdAt: brief.createdAt || ts,
      });
      lifecycle.prepCount += 1;
      lifecycle.lastActivityAt = Math.max(lifecycle.lastActivityAt, brief.createdAt || ts);
    }
  }

  return {
    accounts: [...accounts.values()],
    contacts,
    lifecycles: [...lifecycles.values()],
    prepBriefs,
    postCalls,
    events,
    summary: {
      accounts: accounts.size,
      lifecycles: lifecycles.size,
      prepBriefs: prepBriefs.length,
      postCalls: postCalls.length,
      events: events.length,
    },
  };
}

async function main() {
  const args = parseArgs(process.argv);
  const sources = [];

  if (args.historyDir) {
    const histories = await readHistoryDir(args.historyDir);
    sources.push(...histories);
  }
  if (args.exportPath) {
    sources.push(...(await readExport(args.exportPath)));
  }

  if (!sources.length) {
    console.error("No input. Use --history-dir or --export.");
    process.exit(1);
  }

  const result = migrateSources(sources);
  console.log("Migration summary:", result.summary);

  if (args.dryRun) {
    console.log("Dry run — no file written.");
    return;
  }

  const outPath = path.resolve(process.cwd(), args.out);
  await fs.writeFile(outPath, JSON.stringify(result, null, 2), "utf8");
  console.log(`Wrote ${outPath}`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
