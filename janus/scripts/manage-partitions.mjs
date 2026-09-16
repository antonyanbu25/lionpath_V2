#!/usr/bin/env node
/**
 * Janus partition manager — Blocker 3.
 *
 * audit_log is partitioned monthly (last defined: 2026-09); webhook_event is
 * partitioned weekly (last defined: 2026-w34). Both have DEFAULT partitions,
 * so missing partitions do not error — rows silently land in *_default, and
 * once rows sit in DEFAULT you cannot add a covering partition without moving
 * them out first.
 *
 * This script:
 *   1. Creates the next N monthly partitions for audit_log
 *   2. Creates the next N weekly partitions for webhook_event
 *   3. Fails (exit 1) if any *_default partition contains rows
 *
 * Run weekly via cron / Cloud Scheduler. Requires DDL privileges — connect as
 * postgres or janus_owner, NOT janus_app.
 *
 * Usage:
 *   DATABASE_URL=postgresql://postgres:... node janus/scripts/manage-partitions.mjs
 *   DATABASE_URL=... node janus/scripts/manage-partitions.mjs --check   # verify only
 *   DATABASE_URL=... node janus/scripts/manage-partitions.mjs --ahead=3 # months/weeks ahead (default 2)
 */

import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadDevVars } from '../../worker/scripts/lib/load-dev-vars.mjs';
import { pgClientConfig } from '../../worker/scripts/lib/pg-client-config.mjs';

const require = createRequire(join(dirname(fileURLToPath(import.meta.url)), '../../worker/package.json'));
const pg = require('pg');

loadDevVars();

const { Client } = pg;

const args = process.argv.slice(2);
const CHECK_ONLY = args.includes('--check');
const aheadArg = args.find((a) => a.startsWith('--ahead='));
const AHEAD = aheadArg ? parseInt(aheadArg.split('=')[1], 10) : 2;

function monthPartitions(count) {
  const out = [];
  const now = new Date();
  for (let i = 0; i < count; i++) {
    const start = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + i, 1));
    const end = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + i + 1, 1));
    const label = `${start.getUTCFullYear()}_${String(start.getUTCMonth() + 1).padStart(2, '0')}`;
    out.push({
      name: `audit_log_${label}`,
      from: start.toISOString(),
      to: end.toISOString(),
    });
  }
  return out;
}

function weekPartitions(count) {
  const out = [];
  const now = new Date();
  // Start of current ISO week (Monday 00:00 UTC)
  const day = now.getUTCDay() || 7;
  const monday = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() - day + 1));
  for (let i = 0; i < count; i++) {
    const start = new Date(monday.getTime() + i * 7 * 86400000);
    const end = new Date(monday.getTime() + (i + 1) * 7 * 86400000);
    // ISO week number for the partition label
    const jan1 = new Date(Date.UTC(start.getUTCFullYear(), 0, 1));
    const week = Math.ceil((((start - jan1) / 86400000) + jan1.getUTCDay() + 1) / 7);
    const label = `${start.getUTCFullYear()}_w${String(week).padStart(2, '0')}`;
    out.push({
      name: `webhook_event_${label}`,
      from: start.toISOString(),
      to: end.toISOString(),
    });
  }
  return out;
}

async function existingPartitions(client, parent) {
  const r = await client.query(
    `SELECT c.relname AS name
     FROM pg_inherits i
     JOIN pg_class c ON c.oid = i.inhrelid
     JOIN pg_class p ON p.oid = i.inhparent
     WHERE p.relname = $1`,
    [parent]
  );
  return new Set(r.rows.map((row) => row.name));
}

async function ensurePartitions(client, parent, wanted) {
  const existing = await existingPartitions(client, parent);
  for (const p of wanted) {
    if (existing.has(p.name)) {
      console.log(`[ok] ${p.name} exists`);
      continue;
    }
    if (CHECK_ONLY) {
      console.log(`[missing] ${p.name} (${p.from} .. ${p.to})`);
      continue;
    }
    await client.query(
      `CREATE TABLE IF NOT EXISTS ${p.name} PARTITION OF ${parent} FOR VALUES FROM ('${p.from}') TO ('${p.to}')`
    );
    console.log(`[created] ${p.name} (${p.from} .. ${p.to})`);
  }
}

async function defaultPartitionCount(client, parent) {
  const r = await client.query(`SELECT count(*)::bigint AS n FROM ${parent}_default`);
  return Number(r.rows[0].n);
}

async function main() {
  const url =
    process.env.DATABASE_URL_MIGRATIONS ||
    process.env.DATABASE_URL ||
    '';
  if (!url) {
    console.error('DATABASE_URL_MIGRATIONS or DATABASE_URL required (postgres or janus_owner role).');
    process.exit(1);
  }
  const client = new Client(pgClientConfig(url));
  await client.connect();
  let failed = false;

  try {
    console.log(`== audit_log (monthly, ${AHEAD} ahead) ==`);
    await ensurePartitions(client, 'audit_log', monthPartitions(AHEAD));

    console.log(`== webhook_event (weekly, ${AHEAD} ahead) ==`);
    await ensurePartitions(client, 'webhook_event', weekPartitions(AHEAD));

    for (const parent of ['audit_log', 'webhook_event']) {
      const n = await defaultPartitionCount(client, parent);
      if (n > 0) {
        console.error(`[alert] ${parent}_default has ${n} rows — move them out before adding covering partitions`);
        failed = true;
      } else {
        console.log(`[ok] ${parent}_default is empty`);
      }
    }
  } finally {
    await client.end();
  }

  if (failed) {
    console.error('\nPartition check FAILED.');
    process.exit(1);
  }
  console.log('\nPartition check passed.');
}

main().catch((err) => {
  console.error('manage-partitions error:', err.message);
  process.exit(1);
});
