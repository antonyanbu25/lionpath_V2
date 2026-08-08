#!/usr/bin/env node
import { spawnSync } from "node:child_process";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const rulesDir = join(root, "rules-tests");

const inner = process.platform === "win32"
  ? "node accounts.test.mjs && node dealContacts.test.mjs && node users.test.mjs"
  : "node accounts.test.mjs && node dealContacts.test.mjs && node users.test.mjs";

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
  { cwd: rulesDir, shell: true, stdio: "inherit" },
);

process.exit(exec.status ?? 1);
