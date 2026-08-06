#!/usr/bin/env node
/** NEW-001 — production bundle must not ship dev seed or dummy user tables. */

import { readFile, readdir, rm } from "node:fs/promises";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";

const WEB_ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const DIST = join(WEB_ROOT, "dist");

/** Dev-only markers that must not appear in PRODUCTION_BUILD output. */
const FORBIDDEN = [
  "DUMMY_USERS",
  "seedDevDomainIfNeeded",
  "dummy-users.js",
  "usr_dummy_se_freshworks_com",
  "sowrav.sunil@freshworks.com",
];

async function collectJsFiles(dir) {
  const out = [];
  let entries = [];
  try {
    entries = await readdir(dir, { withFileTypes: true });
  } catch {
    return out;
  }
  for (const entry of entries) {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) {
      out.push(...(await collectJsFiles(path)));
    } else if (entry.name.endsWith(".js")) {
      out.push(path);
    }
  }
  return out;
}

console.log("Building production bundle (PRODUCTION_BUILD=1)…");
await rm(DIST, { recursive: true, force: true });
const build = spawnSync(process.execPath, ["scripts/build.mjs"], {
  cwd: WEB_ROOT,
  env: { ...process.env, PRODUCTION_BUILD: "1" },
  stdio: "inherit",
});
if (build.status !== 0) {
  process.exit(build.status ?? 1);
}

const files = await collectJsFiles(DIST);
if (!files.length) {
  console.error("test-no-dev-seed-in-prod-bundle.mjs: no JS files in dist/");
  process.exit(1);
}

const hits = [];
for (const file of files) {
  const text = await readFile(file, "utf8");
  for (const needle of FORBIDDEN) {
    if (text.includes(needle)) {
      hits.push({ file, needle });
    }
  }
}

if (hits.length) {
  console.error("test-no-dev-seed-in-prod-bundle.mjs: forbidden dev seed in production bundle:");
  for (const { file, needle } of hits) {
    console.error(`  ${needle} in ${file.replace(WEB_ROOT, ".")}`);
  }
  process.exit(1);
}

console.log(`test-no-dev-seed-in-prod-bundle.mjs: ok (${files.length} files scanned)`);
