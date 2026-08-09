#!/usr/bin/env node
/**
 * Aggregating test runner — replaces the single `&&`-chained `npm test`
 * command (same rationale as web/scripts/run-tests.mjs). Reads
 * worker/scripts/test-manifest.mjs, runs every matching file as its own
 * subprocess (`.ts` via tsx, `.mjs` via node), prints a PASS/FAIL summary,
 * non-zero exit if anything failed.
 *
 * Usage:
 *   node scripts/run-tests.mjs                 # unit + emulator (everything except live-api)
 *   node scripts/run-tests.mjs --tag=unit       # fast/free tests only (deploy gate uses this)
 *   node scripts/run-tests.mjs --tag=emulator   # needs `firebase emulators:exec` wrapping this command
 *   node scripts/run-tests.mjs --tag=live-api   # needs a real GEMINI_API_KEY — costs money, run deliberately
 */

import { spawn } from "node:child_process";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { manifest } from "./test-manifest.mjs";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const SCRIPTS_DIR = join(ROOT, "scripts");

function parseTags(argv) {
  const arg = argv.find((a) => a.startsWith("--tag="));
  if (!arg) return null; // default: unit + emulator, never live-api
  return arg.slice("--tag=".length).split(",").map((t) => t.trim()).filter(Boolean);
}

const requestedTags = parseTags(process.argv.slice(2));

function matches(entry) {
  if (requestedTags) return entry.tags.some((t) => requestedTags.includes(t));
  return !entry.tags.includes("live-api") && !entry.tags.includes("manual-only");
}

const selected = manifest.filter(matches);
const needsServer = selected.some((e) => e.needsServer);
const PORT = process.env.WORKER_TEST_PORT || "8787";
const CONFIG_URL = `http://127.0.0.1:${PORT}/api/config`;

/** Poll until the worker's own HTTP server responds (or timeout). */
async function waitForServer(url, timeoutMs = 20000) {
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

function runFile(file) {
  return new Promise((resolve) => {
    const start = Date.now();
    let output = "";
    // Always run via tsx, even for .mjs files: several .mjs test files import
    // .ts modules that use TypeScript-only syntax (e.g. constructor parameter
    // properties in zoomShare.ts) that Node's native --experimental-strip-types
    // can't handle — confirmed by test-zoom.mjs failing under plain `node`
    // with ERR_UNSUPPORTED_TYPESCRIPT_SYNTAX. tsx handles both extensions.
    const child = spawn("npx", ["tsx", join(SCRIPTS_DIR, file)], { cwd: ROOT, env: process.env });
    child.stdout.on("data", (d) => (output += d));
    child.stderr.on("data", (d) => (output += d));
    child.on("close", (code) => resolve({ file, ok: code === 0, ms: Date.now() - start, output }));
    child.on("error", (err) => resolve({ file, ok: false, ms: Date.now() - start, output: String(err) }));
  });
}

function indent(text) {
  return text.split("\n").map((l) => `    ${l}`).join("\n");
}

async function main() {
  // test-history-api.mjs / test-tasks-api.mjs hit the worker's own HTTP API
  // (127.0.0.1:8787), not just Firestore — the `firebase emulators:exec`
  // wrapping this command only starts the Firestore emulator, so without
  // this the worker server never binds the port and both fail with
  // ECONNREFUSED (confirmed via an actual CI run, 2026-08-10). Start it once
  // for the whole batch — harmless for tests that don't need it.
  let serverProc = null;
  let historyDir = null;
  if (needsServer) {
    const alreadyUp = await isServerAlreadyUp(CONFIG_URL);
    if (!alreadyUp) {
      console.log(`\nStarting worker server on :${PORT} (needed by emulator API tests)...`);
      // history-api/tasks-api need HISTORY_FILE_DIR set (node-server.ts's
      // file-based history/task backend — gated separately from Firestore,
      // confirmed via an actual CI run: server started fine but both still
      // 503'd with "storage is not configured" because this was never set)
      historyDir = await mkdtemp(join(tmpdir(), "worker-test-history-"));
      // detached so we own the process GROUP, not just this one process:
      // dev-node.mjs spawns its actual server (`npx tsx src/node-server.ts`)
      // with shell:true and never forwards signals, so a plain kill() on
      // this process alone leaves that real server orphaned on the port
      // (confirmed — had to manually `kill -9` a leaked process during
      // testing). Killing the negative PID kills the whole group instead.
      serverProc = spawn("node", [join(SCRIPTS_DIR, "dev-node.mjs")], {
        cwd: ROOT,
        env: {
          ...process.env,
          PORT,
          HISTORY_FILE_DIR: historyDir,
          // CI sets FIREBASE_PROJECT_ID at the job-step level (for the
          // Firestore emulator), which flips auth.ts's firebaseAuthEnforced()
          // to true — these tests send no Bearer token, so the real project
          // id turned into a THIRD wall, "Sign-in required." (confirmed via
          // another actual CI run). Matches .dev.vars.example's documented
          // pattern: keep the project id, disable Bearer verification.
          FIREBASE_AUTH_ENFORCED: "0",
        },
        detached: true,
      });
      const up = await waitForServer(CONFIG_URL);
      if (!up) {
        console.error(`FAIL  worker server did not respond on :${PORT} within timeout`);
      }
    }
  }

  console.log(`\n=== Running ${selected.length} worker test(s) ===`);
  const results = [];
  for (const entry of selected) {
    const r = await runFile(entry.file);
    results.push(r);
    console.log(`${r.ok ? "PASS" : "FAIL"}  ${entry.file}  (${r.ms}ms)`);
    if (!r.ok) console.log(indent(r.output));
  }

  if (serverProc) {
    try {
      process.kill(-serverProc.pid, "SIGTERM");
    } catch {
      serverProc.kill(); // fallback if the group kill itself fails
    }
  }
  if (historyDir) {
    await rm(historyDir, { recursive: true, force: true }).catch(() => {});
  }

  const failed = results.filter((r) => !r.ok);
  console.log(`\n=== ${results.length - failed.length}/${results.length} passed ===`);
  if (failed.length) {
    console.log("Failed:");
    for (const f of failed) console.log(`  - ${f.file}`);
    process.exit(1);
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
