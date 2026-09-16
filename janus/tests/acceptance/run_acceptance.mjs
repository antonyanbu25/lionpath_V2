#!/usr/bin/env node
/**
 * Run AT-1..AT-5 in order and report.
 *
 * Each test is a separate process so one crash cannot take the suite with it,
 * and so each gets its own fixture prefix and its own teardown.
 *
 * Preconditions, checked and reported rather than assumed:
 *   - DATABASE_URL            janus_app  (every assertion runs as this role)
 *   - DATABASE_URL_MIGRATIONS superuser  (fixtures and teardown only)
 *   - schema 00..29 applied   node worker/scripts/apply-janus-schema.mjs
 *   - rubric catalog loaded   node janus/scripts/load-rubric-catalog.mjs
 *
 * Usage:
 *   node janus/tests/acceptance/run_acceptance.mjs
 *   node janus/tests/acceptance/run_acceptance.mjs at3
 */

import { spawn } from "node:child_process";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { loadDevVars } from "../../../worker/scripts/lib/load-dev-vars.mjs";

loadDevVars();

const HERE = dirname(fileURLToPath(import.meta.url));

const TESTS = [
  ["AT-1 pre-call", "at1_precall.test.mjs"],
  ["AT-2 post-call", "at2_postcall.test.mjs"],
  ["AT-3 scores", "at3_scores.test.mjs"],
  ["AT-4 ranking", "at4_ranking.test.mjs"],
  ["AT-5 adoption", "at5_adoption.test.mjs"],
  ["AT-6 remaining collections", "at6_remaining_collections.test.mjs"],
  ["AT-7 call participants", "at7_call_participants.test.mjs"],
];

const filter = process.argv[2];
const selected = filter
  ? TESTS.filter(([, file]) => file.startsWith(filter.toLowerCase()))
  : TESTS;

if (selected.length === 0) {
  console.error(`No test matches "${filter}". Available: ${TESTS.map(([, f]) => f.slice(0, 3)).join(", ")}`);
  process.exit(1);
}

if (!process.env.DATABASE_URL || !process.env.DATABASE_URL_MIGRATIONS) {
  console.log(
    "DATABASE_URL and DATABASE_URL_MIGRATIONS must both be set in " +
      "worker/.dev.vars or the environment.\n\n" +
      "  DATABASE_URL             janus_app  — every assertion runs as this role, " +
      "under RLS. A superuser bypasses every policy, so a suite run as postgres " +
      "proves nothing.\n" +
      "  DATABASE_URL_MIGRATIONS  superuser  — fixture provisioning and teardown only.\n\n" +
      "Skipping.",
  );
  process.exit(0);
}

function run(file) {
  return new Promise((resolve) => {
    const p = spawn(process.execPath, [join(HERE, file)], { stdio: "inherit" });
    p.on("close", (code) => resolve(code ?? 1));
  });
}

const outcomes = [];
for (const [name, file] of selected) {
  console.log(`\n${"=".repeat(70)}\n${name}  (${file})\n${"=".repeat(70)}`);
  outcomes.push([name, await run(file)]);
}

console.log(`\n${"=".repeat(70)}\nAcceptance summary\n${"=".repeat(70)}`);
for (const [name, code] of outcomes) {
  console.log(`  ${code === 0 ? "PASS" : "FAIL"}  ${name}`);
}

const failed = outcomes.filter(([, c]) => c !== 0);
console.log(
  failed.length
    ? `\n${failed.length} of ${outcomes.length} failed.`
    : `\nAll ${outcomes.length} passed.`,
);
process.exit(failed.length ? 1 : 0);
