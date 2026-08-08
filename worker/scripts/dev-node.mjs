/**
 * Start the Node worker (8787) with vars from .dev.vars — no wrangler bundler.
 */

import { readFileSync, existsSync, readdirSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { spawn } from "node:child_process";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const devVarsPath = join(ROOT, ".dev.vars");

if (existsSync(devVarsPath)) {
  for (const line of readFileSync(devVarsPath, "utf8").split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const eq = trimmed.indexOf("=");
    if (eq <= 0) continue;
    const key = trimmed.slice(0, eq).trim();
    let value = trimmed.slice(eq + 1).trim();
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }
    if (!(key in process.env)) process.env[key] = value;
  }
}

// Auto-wire service account when dropped into worker/secrets/ (gitignored).
const secretsDir = join(ROOT, "secrets");
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
  cwd: ROOT,
  stdio: "inherit",
  shell: true,
  env: process.env,
});

child.on("exit", (code) => process.exit(code ?? 1));
