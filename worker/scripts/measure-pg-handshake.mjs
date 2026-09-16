#!/usr/bin/env node
/**
 * Roadmap 4.5 — re-measure the PostgreSQL connection handshake.
 *
 * `09-latency-cost-capacity.md` §4 recorded a 2358ms auth handshake against
 * 65ms TCP — a ~36x gap — from a SINGLE sample, and flagged it as "a lead, not
 * a finding". It matters because of what it implies for capacity: if ~2.3s is
 * the PER-CONNECTION cost rather than a one-off, pool sizing versus Cloud Run
 * concurrency becomes the dominant latency factor, since every cold connection
 * pays it.
 *
 * That is the question this answers, and it is the only question worth asking
 * first. One-off costs (DNS, TLS session ticket, first-contact setup) are
 * amortised by a warm pool and are close to irrelevant; a true per-connection
 * cost is not.
 *
 * The measurement separates the phases the single sample conflated:
 *
 *   1. TCP     — raw socket connect, no TLS, no protocol. The network floor.
 *   2. FULL    — pg connect: TCP + TLS + startup + auth, to first usable
 *                connection. A fresh Client each time, so no pooling.
 *   3. QUERY   — SELECT 1 on an already-open connection. Isolates round-trip
 *                from setup.
 *   4. POOLED  — pool.connect() / release() after the pool is warm. This is
 *                what request latency actually pays.
 *
 * READ ONLY. It opens connections and runs `SELECT 1`. It writes nothing,
 * reads no application data, and runs sequentially so it never holds more than
 * one connection of its own open.
 *
 * Usage (from worker/):
 *   node scripts/measure-pg-handshake.mjs            # 20 connections
 *   node scripts/measure-pg-handshake.mjs --n=5
 *
 * The Auth Proxy comparison §4 asks for is NOT covered: the proxy is not
 * installed here, and installing it changes the host's network posture. Only
 * the direct public-IP path is measured. Stated rather than implied, because
 * "with and without the Auth Proxy" was half the original ask.
 */

import net from "node:net";
import { performance } from "node:perf_hooks";
import { createRequire } from "node:module";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { loadDevVars } from "./lib/load-dev-vars.mjs";
import { pgClientConfig } from "./lib/pg-client-config.mjs";

const require = createRequire(join(dirname(fileURLToPath(import.meta.url)), "../package.json"));
const pg = require("pg");

loadDevVars();

const N = Number(
  (process.argv.find((a) => a.startsWith("--n=")) || "--n=20").slice("--n=".length),
);

const URL_STR = (process.env.DATABASE_URL_MIGRATIONS || process.env.DATABASE_URL || "").trim();
if (!URL_STR) {
  console.error("Set DATABASE_URL_MIGRATIONS or DATABASE_URL.");
  process.exit(1);
}

const parsed = new URL(URL_STR.replace(/^postgres(ql)?:/, "http:"));
const host = parsed.hostname;
const port = Number(parsed.port || 5432);
const sslRequested = /sslmode=(require|verify-ca|verify-full|prefer)/i.test(URL_STR);

/** Never print the credential. */
console.log(`target    ${host}:${port}  (ssl ${sslRequested ? "requested" : "off"})`);
console.log(`samples   ${N} sequential connections\n`);

function stats(label, xs, unit = "ms") {
  if (!xs.length) return { label, n: 0 };
  const s = [...xs].sort((a, b) => a - b);
  const sum = s.reduce((a, b) => a + b, 0);
  const pct = (p) => s[Math.min(s.length - 1, Math.floor((p / 100) * s.length))];
  return {
    label,
    n: s.length,
    min: +s[0].toFixed(1),
    median: +pct(50).toFixed(1),
    p95: +pct(95).toFixed(1),
    max: +s[s.length - 1].toFixed(1),
    mean: +(sum / s.length).toFixed(1),
    unit,
  };
}

/** Raw TCP connect, no TLS. The network floor. */
function tcpConnectMs() {
  return new Promise((resolve, reject) => {
    const t0 = performance.now();
    const sock = net.connect({ host, port });
    sock.once("connect", () => {
      const ms = performance.now() - t0;
      sock.destroy();
      resolve(ms);
    });
    sock.once("error", reject);
    sock.setTimeout(15000, () => {
      sock.destroy();
      reject(new Error("TCP connect timed out"));
    });
  });
}

const cfg = pgClientConfig(URL_STR);

/** Fresh Client: TCP + TLS + startup + auth, plus one query round trip. */
async function fullConnectMs() {
  const client = new pg.Client(cfg);
  const t0 = performance.now();
  await client.connect();
  const connectMs = performance.now() - t0;
  const t1 = performance.now();
  await client.query("SELECT 1");
  const queryMs = performance.now() - t1;
  await client.end();
  return { connectMs, queryMs };
}

const tcp = [];
const full = [];
const query = [];

for (let i = 0; i < N; i++) {
  try {
    tcp.push(await tcpConnectMs());
  } catch (err) {
    console.error(`  TCP sample ${i + 1} failed: ${err.message}`);
  }
  try {
    const r = await fullConnectMs();
    full.push(r.connectMs);
    query.push(r.queryMs);
    // Print the first few individually: the whole point is whether sample 1
    // differs from the rest, which an aggregate would hide.
    if (i < 5 || i === N - 1) {
      console.log(
        `  #${String(i + 1).padStart(2)}  tcp ${tcp[tcp.length - 1]?.toFixed(1).padStart(7)}ms` +
          `   connect ${r.connectMs.toFixed(1).padStart(8)}ms` +
          `   select1 ${r.queryMs.toFixed(1).padStart(6)}ms`,
      );
    }
  } catch (err) {
    console.error(`  connect sample ${i + 1} failed: ${err.message}`);
  }
}

// Pooled acquisition, which is what a warm request actually pays.
const pooled = [];
{
  const pool = new pg.Pool({ ...cfg, max: 4 });
  const warm = await pool.connect();
  await warm.query("SELECT 1");
  warm.release();
  for (let i = 0; i < N; i++) {
    const t0 = performance.now();
    const c = await pool.connect();
    await c.query("SELECT 1");
    pooled.push(performance.now() - t0);
    c.release();
  }
  await pool.end();
}

const rows = [
  stats("TCP connect (network floor)", tcp),
  stats("FULL connect (TCP+TLS+auth)", full),
  stats("SELECT 1 on open conn", query),
  stats("POOLED acquire + SELECT 1", pooled),
];

console.log("\n| phase | n | min | median | p95 | max | mean |");
console.log("|---|---|---|---|---|---|---|");
for (const r of rows) {
  if (!r.n) continue;
  console.log(
    `| ${r.label} | ${r.n} | ${r.min} | ${r.median} | ${r.p95} | ${r.max} | ${r.mean} |`,
  );
}

// The finding hinges on first-vs-rest, so compute it explicitly.
if (full.length > 2) {
  const first = full[0];
  const rest = full.slice(1);
  const restMedian = [...rest].sort((a, b) => a - b)[Math.floor(rest.length / 2)];
  const tcpMedian = tcp.length
    ? [...tcp].sort((a, b) => a - b)[Math.floor(tcp.length / 2)]
    : null;
  console.log(`\nfirst connect      ${first.toFixed(1)}ms`);
  console.log(`median of the rest ${restMedian.toFixed(1)}ms`);
  console.log(`ratio first/rest   ${(first / restMedian).toFixed(2)}x`);
  if (tcpMedian) {
    console.log(`handshake over TCP ${(restMedian / tcpMedian).toFixed(1)}x (median connect / median tcp)`);
  }
  // The discriminator is NOT first-vs-rest, which is what the original single
  // sample invited. Two independent questions:
  //   (a) is the cost a one-off?         -> first / rest
  //   (b) does pooling amortise it?      -> pooled / tcp
  // (b) is the one that decides whether pool sizing matters, and only (b)
  // reflects what a warm request actually pays.
  const pooledMedian = pooled.length
    ? [...pooled].sort((a, b) => a - b)[Math.floor(pooled.length / 2)]
    : null;
  const oneOff = first / restMedian > 3;
  console.log(`\nis it a one-off?   ${oneOff ? "yes" : "NO — every cold connection pays it"}`);
  if (pooledMedian && tcpMedian) {
    const amortised = pooledMedian < tcpMedian * 1.5;
    console.log(
      `pooled vs tcp      ${(pooledMedian / tcpMedian).toFixed(2)}x — ` +
        `${amortised ? "pooling AMORTISES the handshake to about one round trip" : "pooling does NOT amortise it"}`,
    );
    console.log(
      `\nverdict: cold connections pay ~${(restMedian - tcpMedian).toFixed(0)}ms over TCP, ` +
        `${amortised
          ? "but a WARM pool pays roughly one round trip — so the exposure is connection CHURN " +
            "(cold starts, pool thrash, max too low), not steady-state latency"
          : "and pooling does not help — pool sizing is the dominant latency factor"}`,
    );
  }
  console.log(
    `\nCAVEAT: measured from this host over the public internet. SELECT 1 (${
      query.length ? [...query].sort((a, b) => a - b)[Math.floor(query.length / 2)].toFixed(0) : "?"
    }ms) is ~one RTT, so these ABSOLUTE numbers are dominated by distance to the instance, ` +
      `not by Cloud SQL. A Cloud Run instance in the same region sees a far smaller RTT. ` +
      `What transfers is the RATIO: handshake ~= ${(restMedian / tcpMedian).toFixed(1)}x RTT, pooled ~= ${
        pooledMedian && tcpMedian ? (pooledMedian / tcpMedian).toFixed(1) : "?"
      }x RTT.`,
  );
}
