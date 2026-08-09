#!/usr/bin/env node
/**
 * Aggregating test runner — replaces the single `&&`-chained `npm test`
 * command, which hid every failure after the first one and silently excluded
 * any file someone forgot to add to the chain (docs/AUDIT_RECONCILIATION_2.1.md
 * NEW-002/NEW-003). Reads web/scripts/test-manifest.mjs, runs every matching
 * file as its own subprocess so one crash can't take down the run, and prints
 * a clear PASS/FAIL summary at the end with a non-zero exit if anything failed.
 *
 * Usage:
 *   node scripts/run-tests.mjs                 # everything except manual-only
 *   node scripts/run-tests.mjs --tag=unit       # fast/free tests only (deploy gate uses this)
 *   node scripts/run-tests.mjs --tag=unit,e2e   # everything automatable
 *
 * e2e handling: most e2e-tagged files expect a dev server already running at
 * 127.0.0.1:8788 (checked by grepping every test-*.mjs for a playwright import
 * and its target URL — see the comment in test-manifest.mjs). This runner
 * starts ONE shared `dev-server.mjs` before running that batch and tears it
 * down after. Files marked `server: "self-managed"` (currently just
 * test-org-hierarchy-e2e.mjs) spawn/kill their own server and run in a
 * separate pass so they don't collide with the shared one on the same port.
 */

import { spawn } from "node:child_process";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { manifest } from "./test-manifest.mjs";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const SCRIPTS_DIR = join(ROOT, "scripts");
const PORT = process.env.WEB_TEST_PORT || "8788";
const BASE_URL = `http://127.0.0.1:${PORT}`;

function parseTags(argv) {
  const arg = argv.find((a) => a.startsWith("--tag="));
  if (!arg) return null; // null = default set (everything except manual-only)
  return arg.slice("--tag=".length).split(",").map((t) => t.trim()).filter(Boolean);
}

const requestedTags = parseTags(process.argv.slice(2));

function matches(entry) {
  if (requestedTags) return entry.tags.some((t) => requestedTags.includes(t));
  return !entry.tags.includes("manual-only"); // default: run everything automatable
}

const selected = manifest.filter(matches);
const unitAndOther = selected.filter((e) => !e.tags.includes("e2e"));
const e2eShared = selected.filter((e) => e.tags.includes("e2e") && e.server !== "self-managed");
const e2eSelfManaged = selected.filter((e) => e.tags.includes("e2e") && e.server === "self-managed");

/** Run one test file as a subprocess. Resolves { file, ok, ms, output }. */
function runFile(file, extraEnv = {}) {
  return new Promise((resolve) => {
    const start = Date.now();
    let output = "";
    const child = spawn(process.execPath, [join(SCRIPTS_DIR, file)], {
      cwd: ROOT,
      env: { ...process.env, ...extraEnv },
    });
    child.stdout.on("data", (d) => (output += d));
    child.stderr.on("data", (d) => (output += d));
    child.on("close", (code) => {
      resolve({ file, ok: code === 0, ms: Date.now() - start, output });
    });
    child.on("error", (err) => {
      resolve({ file, ok: false, ms: Date.now() - start, output: String(err) });
    });
  });
}

/** Poll until the dev server responds or timeout. */
async function waitForServer(url, timeoutMs = 15000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try {
      const res = await fetch(url);
      if (res.ok || res.status < 500) return true;
    } catch {
      // not up yet
    }
    await new Promise((r) => setTimeout(r, 300));
  }
  return false;
}

async function isServerAlreadyUp(url) {
  try {
    const res = await fetch(url, { signal: AbortSignal.timeout(1000) });
    return res.ok || res.status < 500;
  } catch {
    return false;
  }
}

async function main() {
  const results = [];

  console.log(`\n=== Running ${unitAndOther.length} unit test(s) ===`);
  for (const entry of unitAndOther) {
    const r = await runFile(entry.file);
    results.push(r);
    console.log(`${r.ok ? "PASS" : "FAIL"}  ${entry.file}  (${r.ms}ms)`);
    if (!r.ok) console.log(indent(r.output));
  }

  if (e2eShared.length) {
    console.log(`\n=== Running ${e2eShared.length} e2e test(s) against a shared dev server ===`);
    const alreadyUp = await isServerAlreadyUp(BASE_URL);
    let serverProc = null;
    if (!alreadyUp) {
      serverProc = spawn(process.execPath, [join(ROOT, "dev-server.mjs")], {
        cwd: ROOT,
        env: { ...process.env, PORT },
      });
      const up = await waitForServer(BASE_URL);
      if (!up) {
        console.error(`FAIL  could not start dev server on ${BASE_URL} for e2e tests`);
        for (const entry of e2eShared) results.push({ file: entry.file, ok: false, ms: 0, output: "dev server did not start" });
        serverProc?.kill();
      }
    }
    if (alreadyUp || results.every((r) => r.ok)) {
      for (const entry of e2eShared) {
        const r = await runFile(entry.file, { WEB_URL: BASE_URL, E2E_BASE_URL: BASE_URL });
        results.push(r);
        console.log(`${r.ok ? "PASS" : "FAIL"}  ${entry.file}  (${r.ms}ms)`);
        if (!r.ok) console.log(indent(r.output));
      }
    }
    if (serverProc) serverProc.kill();
  }

  if (e2eSelfManaged.length) {
    console.log(`\n=== Running ${e2eSelfManaged.length} self-managed e2e test(s) ===`);
    for (const entry of e2eSelfManaged) {
      const r = await runFile(entry.file);
      results.push(r);
      console.log(`${r.ok ? "PASS" : "FAIL"}  ${entry.file}  (${r.ms}ms)`);
      if (!r.ok) console.log(indent(r.output));
    }
  }

  const failed = results.filter((r) => !r.ok);
  console.log(`\n=== ${results.length - failed.length}/${results.length} passed ===`);
  if (failed.length) {
    console.log("Failed:");
    for (const f of failed) console.log(`  - ${f.file}`);
    process.exit(1);
  }
}

function indent(text) {
  return text
    .split("\n")
    .map((l) => `    ${l}`)
    .join("\n");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
