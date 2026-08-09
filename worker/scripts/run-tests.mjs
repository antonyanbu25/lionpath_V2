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
  console.log(`\n=== Running ${selected.length} worker test(s) ===`);
  const results = [];
  for (const entry of selected) {
    const r = await runFile(entry.file);
    results.push(r);
    console.log(`${r.ok ? "PASS" : "FAIL"}  ${entry.file}  (${r.ms}ms)`);
    if (!r.ok) console.log(indent(r.output));
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
