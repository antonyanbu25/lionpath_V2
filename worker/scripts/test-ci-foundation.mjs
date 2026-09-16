#!/usr/bin/env node
/**
 * P15 gate: the things that make the rest of the suite trustworthy.
 *
 * astra-audit F-038 found that CI provisioned no PostgreSQL, never type-checked,
 * had gates that exited 0 without a database, and left 13 test files in no
 * manifest. An untracked test file is worse than a missing one: it looks like
 * coverage while running never.
 *
 * Asserts:
 *   1. Every worker/scripts/test-*.{ts,mjs} is in the worker manifest, or is in
 *      the explicit NOT_A_TEST list below with a reason.
 *   2. Every web/scripts/test-*.mjs is in the web manifest, likewise.
 *   3. Every tag used in either manifest is runnable — no tag exists that no
 *      lane would ever select.
 *   4. The two schema-application paths (janus/schema/init_all.sql and
 *      apply-janus-schema.mjs PHASE_FILES) list the SAME files in the SAME
 *      order. Divergence here is what left three migrations unapplied (J-004).
 *   5. Every janus/tests/*.test.mjs fails loudly when DATABASE_URL is unset,
 *      rather than exiting 0 and looking green.
 *
 * Pure filesystem + text analysis. No database, no network, no server.
 */
import assert from "node:assert/strict";
import { readdirSync, readFileSync, existsSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const SCRIPTS = dirname(fileURLToPath(import.meta.url));
const WORKER = join(SCRIPTS, "..");
const REPO = join(WORKER, "..");

let failures = 0;
function check(label, fn) {
  try {
    fn();
    console.log(`  PASS  ${label}`);
  } catch (err) {
    failures += 1;
    console.log(`  FAIL  ${label}\n          ${err instanceof Error ? err.message : String(err)}`);
  }
}

/**
 * Files matching the test-* glob that are NOT tests. Each needs a reason — the
 * point of this gate is that nothing is excluded silently.
 */
const NOT_A_TEST = {
  "test-manifest.mjs": "the manifest itself — data, not a test",
  "test-zoom.mjs": "operator tool: takes a share link + passcode at runtime and prints what Zoom returns",
  "test-zoom-api.ts": "operator tool for the Zoom S2S API; asserts nothing",
  "test-zoom-share-media.ts": "operator tool for share-link media probing",
  "test-zoom-share-network.ts": "operator tool for share-link network probing",
  "test-prep-payloads.mjs": "operator tool: prints prep payloads for eyeballing",
};

function testFilesIn(dir, exts) {
  if (!existsSync(dir)) return [];
  return readdirSync(dir)
    .filter((f) => f.startsWith("test-") && exts.some((e) => f.endsWith(e)))
    .sort();
}

async function loadManifest(path) {
  const mod = await import(path);
  return mod.manifest;
}

console.log("\n1. worker manifest completeness");
{
  const files = testFilesIn(SCRIPTS, [".ts", ".mjs"]);
  const manifest = await loadManifest(join(SCRIPTS, "test-manifest.mjs"));
  const registered = new Set(manifest.map((e) => e.file));
  const unregistered = files.filter((f) => !registered.has(f) && !NOT_A_TEST[f]);
  const phantom = [...registered].filter((f) => !files.includes(f));
  console.log(`      ${files.length} test-* files, ${registered.size} manifest entries`);
  check("every worker test file is registered or explicitly classified", () =>
    assert.deepEqual(unregistered, [], `unregistered: ${unregistered.join(", ")}`));
  check("no manifest entry points at a file that does not exist", () =>
    assert.deepEqual(phantom, [], `phantom entries: ${phantom.join(", ")}`));
}

console.log("\n2. web manifest completeness");
{
  const webScripts = join(REPO, "web", "scripts");
  const files = testFilesIn(webScripts, [".mjs"]);
  const manifest = await loadManifest(join(webScripts, "test-manifest.mjs"));
  const registered = new Set(manifest.map((e) => e.file));
  const unregistered = files.filter((f) => !registered.has(f) && !NOT_A_TEST[f]);
  const phantom = [...registered].filter((f) => !files.includes(f));
  console.log(`      ${files.length} test-* files, ${registered.size} manifest entries`);
  check("every web test file is registered or explicitly classified", () =>
    assert.deepEqual(unregistered, [], `unregistered: ${unregistered.join(", ")}`));
  check("no web manifest entry points at a missing file", () =>
    assert.deepEqual(phantom, [], `phantom entries: ${phantom.join(", ")}`));
}

console.log("\n3. every manifest tag is runnable by some lane");
{
  const workerManifest = await loadManifest(join(SCRIPTS, "test-manifest.mjs"));
  const webManifest = await loadManifest(join(REPO, "web", "scripts", "test-manifest.mjs"));
  const tags = new Set([...workerManifest, ...webManifest].flatMap((e) => e.tags));
  // Lanes that exist: the default run, and anything selectable by --tag=.
  // A tag is runnable if some npm script or CI step selects it, or it is in the
  // default set. manual-only and live-api are deliberately never in CI.
  const KNOWN = new Set(["unit", "e2e", "emulator", "sql", "live-api", "manual-only"]);
  const unknown = [...tags].filter((t) => !KNOWN.has(t)).sort();
  console.log(`      tags in use: ${[...tags].sort().join(", ")}`);
  check("no tag exists that no lane knows about", () =>
    assert.deepEqual(unknown, [], `unknown tags: ${unknown.join(", ")} — add a lane or remove the tag`));
}

console.log("\n4. the two schema-application paths agree (J-004)");
{
  const initAll = readFileSync(join(REPO, "janus", "schema", "init_all.sql"), "utf8");
  const applier = readFileSync(join(SCRIPTS, "apply-janus-schema.mjs"), "utf8");
  const initFiles = [...initAll.matchAll(/\\ir\s+(\S+\.sql)/g)].map((m) => m[1]);
  // Only the PHASE_FILES array, not any .sql mentioned in a comment.
  const phaseBlock = applier.slice(applier.indexOf("PHASE_FILES"), applier.indexOf("];", applier.indexOf("PHASE_FILES")));
  const phaseFiles = [...phaseBlock.matchAll(/"(\d[\w.]*\.sql)"/g)].map((m) => m[1]);

  console.log(`      init_all.sql: ${initFiles.length} files · PHASE_FILES: ${phaseFiles.length} files`);
  const onlyInit = initFiles.filter((f) => !phaseFiles.includes(f));
  const onlyPhase = phaseFiles.filter((f) => !initFiles.includes(f));
  check("no file is applied by init_all.sql but not by the programmatic path", () =>
    assert.deepEqual(onlyInit, [], `only in init_all: ${onlyInit.join(", ")}`));
  check("no file is applied by the programmatic path but not by init_all.sql", () =>
    assert.deepEqual(onlyPhase, [], `only in PHASE_FILES: ${onlyPhase.join(", ")}`));
  check("both paths apply the shared files in the SAME order", () =>
    assert.deepEqual(phaseFiles, initFiles, "ordering differs between the two paths"));

  // Every .sql in the directory is either applied, or explicitly known-dead.
  const KNOWN_UNAPPLIED = {
    "init_all.sql": "the driver itself",
  };
  const onDisk = readdirSync(join(REPO, "janus", "schema")).filter((f) => f.endsWith(".sql")).sort();
  const unaccounted = onDisk.filter((f) => !phaseFiles.includes(f) && !KNOWN_UNAPPLIED[f]);
  check("every .sql in janus/schema is applied or explicitly known-unapplied", () =>
    assert.deepEqual(unaccounted, [], `unaccounted: ${unaccounted.join(", ")}`));
}

console.log("\n5. database-backed gates fail loudly without a database (F-038)");
{
  const janusTests = join(REPO, "janus", "tests");
  const files = readdirSync(janusTests).filter((f) => f.endsWith(".test.mjs")).sort();
  console.log(`      ${files.length} janus/tests gate(s)`);
  for (const f of files) {
    const src = readFileSync(join(janusTests, f), "utf8");
    if (!/process\.env\.DATABASE_URL/.test(src)) continue;
    check(`${f} does not exit 0 on an unset DATABASE_URL`, () => {
      // Brace-shape-agnostic: find where the file tests for a missing
      // DATABASE_URL, then require a non-zero exit within the following window.
      // Two shapes exist here — a guard on process.env.DATABASE_URL directly,
      // and one on a local `url` bound from it (view_rls.test.mjs), whose
      // closing brace sits at column 0 rather than indented.
      const at = [/if\s*\(!process\.env\.DATABASE_URL\)/, /if\s*\(!url\)/]
        .map((re) => src.search(re))
        .filter((i) => i >= 0)
        .sort((a, b) => a - b)[0];
      assert.ok(at !== undefined, "could not locate a missing-DATABASE_URL guard");
      const window = src.slice(at, at + 1600); // generous: these guards carry long explanatory comments
      assert.ok(
        /process\.exitCode\s*=\s*1|process\.exit\(1\)/.test(window),
        "guard returns without a non-zero exit — an unset DATABASE_URL would look like a pass",
      );
      // An explicit opt-out is required only where a skip path exists at all.
      // view_rls.test.mjs has always hard-failed and offers none, which is
      // stricter than P15 asks for, so it is acceptable as-is.
      if (/\bSKIP\b|skipping/i.test(window)) {
        assert.ok(/--allow-skip/.test(window), "a skip path exists but has no explicit flag");
      }
    });
  }
}

console.log("");
if (failures > 0) {
  console.error(`FAIL — ${failures} CI-foundation check(s) failed.`);
  process.exit(1);
}
console.log("OK — manifests complete, tags runnable, schema paths agree, DB gates fail loudly.");
