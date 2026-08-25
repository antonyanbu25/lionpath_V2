/**
 * Start the Node worker (8787) with vars from .dev.vars — no wrangler bundler.
 */

import { existsSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { spawn } from "node:child_process";
import { WORKER_ROOT, loadDevVars } from "./lib/load-dev-vars.mjs";

loadDevVars();

// Auto-wire service account when dropped into worker/secrets/ (gitignored).
const secretsDir = join(WORKER_ROOT, "secrets");
if (
  !process.env.GOOGLE_APPLICATION_CREDENTIALS?.trim() &&
  !process.env.FIREBASE_SERVICE_ACCOUNT_JSON?.trim() &&
  existsSync(secretsDir)
) {
  const jsonFiles = readdirSync(secretsDir).filter((name) => name.endsWith(".json"));
  if (jsonFiles.length === 1) {
    process.env.GOOGLE_APPLICATION_CREDENTIALS = join(secretsDir, jsonFiles[0]);
  } else if (jsonFiles.length > 1) {
    const preferred =
      jsonFiles.find((name) => /adminsdk|service/i.test(name)) || jsonFiles[0];
    process.env.GOOGLE_APPLICATION_CREDENTIALS = join(secretsDir, preferred);
  }
}

await import("./check-local-firebase.mjs");

const child = spawn("npx", ["tsx", "src/node-server.ts"], {
  cwd: WORKER_ROOT,
  stdio: "inherit",
  shell: true,
  env: process.env,
});

child.on("exit", (code) => process.exit(code ?? 1));
