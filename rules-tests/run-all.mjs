#!/usr/bin/env node
import { spawnSync } from "node:child_process";
import { readdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const rulesDir = join(root, "rules-tests");

// Discover every *.test.mjs file instead of a hand-maintained list — the
// hardcoded chain this replaced required remembering to add each new file
// here, which is exactly the "orphaned test" failure mode the rest of the
// eval harness exists to close (see docs/AUDIT_RECONCILIATION_2.1.md
// NEW-002/NEW-003). Sorted for stable, reproducible run order.
const testFiles = readdirSync(rulesDir)
  .filter((f) => f.endsWith(".test.mjs"))
  .sort();

if (testFiles.length === 0) {
  console.error("No *.test.mjs files found in rules-tests/ — nothing to run.");
  process.exit(1);
}

const inner = testFiles.map((f) => `node ${f}`).join(" && ");

const exec = spawnSync(
  "npx",
  [
    "firebase",
    "emulators:exec",
    "--only",
    "firestore",
    "--project",
    "lionpath-rules-test",
    inner,
  ],
  // No shell: the inner command must reach `firebase emulators:exec` as ONE
  // verbatim argument. With shell:true the args array is joined with spaces and
  // the quotes around `inner` are lost, so the `&&` chain splits into separate
  // args and firebase errors with "Too many arguments."
  { cwd: rulesDir, stdio: "inherit" },
);

process.exit(exec.status ?? 1);
