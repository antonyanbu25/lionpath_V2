/**
 * Load worker/.dev.vars into process.env (same parser as dev-node.mjs).
 * Does not overwrite keys already set in the environment.
 */

import { readFileSync, existsSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

export const WORKER_ROOT = join(dirname(fileURLToPath(import.meta.url)), "..", "..");

export function loadDevVarsFile(path = join(WORKER_ROOT, ".dev.vars")) {
  if (!existsSync(path)) return null;
  for (const line of readFileSync(path, "utf8").split(/\r?\n/)) {
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
  return path;
}

export function loadDevVars() {
  loadDevVarsFile();
}
