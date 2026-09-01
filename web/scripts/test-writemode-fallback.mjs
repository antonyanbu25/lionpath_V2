#!/usr/bin/env node
/**
 * Write-mode fallback regression.
 * Run: node web/scripts/test-writemode-fallback.mjs
 */

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const mem = new Map();
globalThis.localStorage = {
  getItem: (k) => mem.get(k) ?? null,
  setItem: (k, v) => mem.set(k, v),
  removeItem: (k) => mem.delete(k),
};
globalThis.sessionStorage = globalThis.localStorage;
globalThis.location = { hostname: "portal.test", search: "" };

const here = dirname(fileURLToPath(import.meta.url));
const storePath = join(here, "../domain/store.js");
const storeSource = readFileSync(storePath, "utf8");

function extractFunctionBody(source, name) {
  const start = source.indexOf(`function ${name}`);
  assert.notEqual(start, -1, `${name} is defined`);
  const open = source.indexOf("{", start);
  assert.notEqual(open, -1, `${name} has a body`);

  let depth = 0;
  for (let i = open; i < source.length; i += 1) {
    const ch = source[i];
    if (ch === "{") depth += 1;
    if (ch === "}") depth -= 1;
    if (depth === 0) return source.slice(open + 1, i);
  }
  throw new Error(`${name} body is not closed`);
}

function assertWriteModeSourceGuard() {
  const body = extractFunctionBody(storeSource, "resolveWriteMode");
  assert.match(
    body,
    /if\s*\(\s*!\s*useFirestore\s*\(\s*fb\s*\)\s*\)\s*\{[\s\S]*?if\s*\(\s*!!firebaseConfig\.projectId\s*\)\s*return\s+["']api["']\s*;[\s\S]*?return\s+["']local["']\s*;[\s\S]*?\}/,
    'resolveWriteMode must return "api" when Firebase is configured but fb.db is unavailable; missing guard: if (!!firebaseConfig.projectId) return "api";',
  );
}

async function assertWriteModeBehavior() {
  const { firebaseConfig } = await import("../firebase-config.js");
  const { resolveWriteMode } = await import("../domain/store.js");

  firebaseConfig.projectId = "test-project";
  assert.equal(
    resolveWriteMode({ auth: {}, db: null }),
    "api",
    'resolveWriteMode must return "api" when firebaseConfig.projectId is set and fb.db is null',
  );

  firebaseConfig.projectId = "";
  assert.equal(
    resolveWriteMode({ auth: {}, db: null }),
    "local",
    'resolveWriteMode must still return "local" when firebaseConfig.projectId is empty',
  );
}

const failures = [];
try {
  assertWriteModeSourceGuard();
} catch (err) {
  failures.push(err);
}

try {
  await assertWriteModeBehavior();
} catch (err) {
  failures.push(err);
}

if (failures.length > 0) {
  for (const err of failures) console.error(err.message);
  process.exit(1);
}

console.log("test-writemode-fallback.mjs: ok");
