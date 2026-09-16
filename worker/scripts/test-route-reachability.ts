#!/usr/bin/env tsx
/**
 * Structural check (P6/T8, astra-audit F-012/F-013): every exported `handle*`
 * symbol under worker/src/routes/*.ts must be reachable from the router --
 * either as a value in the `routes` map (worker/src/routes.ts), a hardcoded
 * branch or regex-dispatch call in worker/src/index.ts, or an internal
 * dispatch table inside its own defining module (e.g. domainReadRoutes,
 * healthRoutes, dispatchDomainReadById, dispatchReadModelsById).
 *
 * This can't do live import-graph analysis without a bundler, so it's a
 * source-text reachability check like test-postcall-hydration-sequencing.mjs:
 * a handler is "reachable" if its identifier appears more than once across
 * {its own defining file, routes.ts, index.ts} with all `import { ... } from`
 * statements stripped first -- once for the `export function handleFoo(`
 * declaration, and at least once more where a real dispatcher references it.
 * Import lines are stripped because merely importing a handler (without
 * placing it in a route map or dispatch call) does not make it reachable --
 * that exact gap (import present, registration commented out) was caught
 * while writing this test.
 */
import { readFileSync, readdirSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import assert from "node:assert/strict";

const WORKER_SRC = join(dirname(fileURLToPath(import.meta.url)), "..", "src");
const ROUTES_DIR = join(WORKER_SRC, "routes");

const routeFiles = readdirSync(ROUTES_DIR)
  .filter((f) => f.endsWith(".ts"))
  .map((f) => join(ROUTES_DIR, f));

const routesTsPath = join(WORKER_SRC, "routes.ts");
const indexTsPath = join(WORKER_SRC, "index.ts");

function stripImports(src: string): string {
  // Multi-line `import { ... } from "...";` and `import type { ... } from "...";` blocks.
  return src.replace(/^import\s+(?:type\s+)?\{[^}]*\}\s*from\s*["'][^"']+["'];?/gms, "");
}

const routesTsSrc = stripImports(readFileSync(routesTsPath, "utf8"));
const indexTsSrc = stripImports(readFileSync(indexTsPath, "utf8"));

const HANDLE_EXPORT_RE = /export\s+(?:async\s+)?function\s+(handle[A-Z]\w*)\s*\(|export\s+const\s+(handle[A-Z]\w*)\s*[:=]/g;

interface Candidate {
  name: string;
  file: string;
}

const candidates: Candidate[] = [];
for (const file of routeFiles) {
  const src = readFileSync(file, "utf8");
  for (const m of src.matchAll(HANDLE_EXPORT_RE)) {
    const name = m[1] || m[2];
    if (name) candidates.push({ name, file });
  }
}

assert.ok(candidates.length > 10, `expected many handle* exports under routes/, found ${candidates.length} -- did the directory move?`);

function countOccurrences(haystack: string, name: string): number {
  const re = new RegExp(`\\b${name}\\b`, "g");
  return [...haystack.matchAll(re)].length;
}

const unreachable: Candidate[] = [];
for (const c of candidates) {
  const ownFileSrc = stripImports(readFileSync(c.file, "utf8"));
  const combined = ownFileSrc + "\n" + routesTsSrc + "\n" + indexTsSrc;
  const count = countOccurrences(combined, c.name);
  if (count < 2) unreachable.push(c);
}

if (unreachable.length) {
  console.error("Unreachable route handlers (declared, never dispatched to):");
  for (const c of unreachable) {
    console.error(`  ${c.name}  (${c.file.replace(WORKER_SRC, "worker/src")})`);
  }
}

assert.deepEqual(
  unreachable.map((c) => c.name),
  [],
  `${unreachable.length} handler(s) exist under worker/src/routes/ but are never referenced by ` +
    `routes.ts, index.ts, or their own defining module's internal dispatch table (import ` +
    `statements don't count). Register the route or delete the dead handler.`,
);

console.log(`test-route-reachability: ok (${candidates.length} handlers checked, all reachable)`);
