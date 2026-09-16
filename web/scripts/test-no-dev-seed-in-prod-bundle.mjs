#!/usr/bin/env node
/** NEW-001 — production boot path must not ship dev seed or dummy user tables. */

import { readFile, readdir, rm } from "node:fs/promises";
import { join, dirname, basename } from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";

const WEB_ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const DIST = join(WEB_ROOT, "dist");

/** Dev-only markers forbidden in the production boot graph. */
const FORBIDDEN = [
  "DUMMY_USERS",
  "seedDevDomainIfNeeded",
  "dummy-users.js",
  "usr_dummy_se_freshworks_com",
  "sowrav.sunil@freshworks.com",
];

/** Lazy dev chunks may exist on disk but must not be linked from boot entries. */
const LAZY_DEV_CHUNK = /(?:^|\/)(?:seed-dev|dummy-users)-[A-Z0-9]+\.js$/;

/** @param {string} dir @param {Set<string>} seen */
async function collectJsFiles(dir, seen = new Set()) {
  let entries = [];
  try {
    entries = await readdir(dir, { withFileTypes: true });
  } catch {
    return seen;
  }
  for (const entry of entries) {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) {
      await collectJsFiles(path, seen);
    } else if (entry.name.endsWith(".js")) {
      seen.add(path);
    }
  }
  return seen;
}

/** @param {string} file @param {Set<string>} graph @param {Set<string>} allFiles */
async function traceStaticImports(file, graph, allFiles) {
  if (graph.has(file)) return;
  graph.add(file);
  const text = await readFile(file, "utf8");
  for (const match of text.matchAll(/from\s+"(\.\/[^"]+\.js)"/g)) {
    const rel = match[1].replace(/^\.\//, "");
    const target = join(DIST, rel.replace(/\//g, "\\"));
    const normalized = [...allFiles].find((f) => f.endsWith(rel.replace(/\//g, "\\")) || f.endsWith(rel));
    if (normalized) await traceStaticImports(normalized, graph, allFiles);
  }
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

const manifest = JSON.parse(await readFile(join(DIST, "manifest.json"), "utf8"));
const bootJs = join(DIST, "boot.js");
const allFiles = await collectJsFiles(DIST);

/** @type {Set<string>} */
const bootGraph = new Set([bootJs]);
for (const rel of Object.values(manifest)) {
  const entry = join(DIST, rel.replace(/^\.\//, ""));
  await traceStaticImports(entry, bootGraph, allFiles);
}

const lazyDevChunks = [...allFiles].filter((f) => LAZY_DEV_CHUNK.test(f.replace(/\\/g, "/")));
for (const lazy of lazyDevChunks) {
  const rel = lazy.replace(DIST, "").replace(/\\/g, "/");
  for (const bootFile of bootGraph) {
    const text = await readFile(bootFile, "utf8");
    if (text.includes(basename(lazy)) || text.includes(rel)) {
      console.error(`test-no-dev-seed-in-prod-bundle.mjs: boot graph imports lazy dev chunk ${rel}`);
      process.exit(1);
    }
  }
}

const hits = [];
for (const file of bootGraph) {
  const text = await readFile(file, "utf8");
  for (const needle of FORBIDDEN) {
    if (text.includes(needle)) {
      hits.push({ file, needle });
    }
  }
}

if (hits.length) {
  console.error("test-no-dev-seed-in-prod-bundle.mjs: forbidden dev seed in production boot graph:");
  for (const { file, needle } of hits) {
    console.error(`  ${needle} in ${file.replace(WEB_ROOT, ".")}`);
  }
  process.exit(1);
}

console.log(
  `test-no-dev-seed-in-prod-bundle.mjs: ok (${bootGraph.size} boot-graph files, ${lazyDevChunks.length} isolated dev chunks)`,
);
