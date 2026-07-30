#!/usr/bin/env node
/**
 * Static audit: MEDDPICC must not be written to Account (ADR 005).
 */
import { readFileSync, readdirSync, statSync } from "fs";
import { join, relative } from "path";
import { fileURLToPath } from "url";

const __dir = fileURLToPath(new URL(".", import.meta.url));
const webRoot = join(__dir, "..");

function walk(dir, files = []) {
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) {
      if (name === "node_modules") continue;
      walk(p, files);
    } else if (p.endsWith(".js") || p.endsWith(".mjs")) {
      files.push(p);
    }
  }
  return files;
}

const allowMergeAccount = new Set([
  relative(webRoot, join(webRoot, "domain/contact-service.js")),
  relative(webRoot, join(webRoot, "scripts/test-contact-service.mjs")),
  relative(webRoot, join(webRoot, "scripts/test-deal-meddpicc.mjs")),
]);

const allowImportMergeAccount = new Set([
  ...allowMergeAccount,
  relative(webRoot, join(webRoot, "domain/migrate-meddpicc-to-deals.js")),
]);

const errors = [];

for (const file of walk(join(webRoot, "domain"))) {
  const rel = relative(webRoot, file);
  if (rel.includes("migrate-meddpicc")) continue;
  const src = readFileSync(file, "utf8");
  if (src.includes("mergeAccountMeddpicc") && !allowMergeAccount.has(rel)) {
    errors.push(`${rel}: must not call mergeAccountMeddpicc`);
  }
}

for (const file of walk(webRoot)) {
  const rel = relative(webRoot, file);
  if (!rel.startsWith("domain/") && !rel.startsWith("scripts/")) continue;
  if (rel.includes("check-meddpicc-writes")) continue;
  const src = readFileSync(file, "utf8");
  if (!src.includes("import") || !src.includes("mergeAccountMeddpicc")) continue;
  if (!allowImportMergeAccount.has(rel)) {
    errors.push(`${rel}: must not import mergeAccountMeddpicc`);
  }
}

const accountService = readFileSync(join(webRoot, "domain/account-service.js"), "utf8");
if (accountService.includes("mergeAccountMeddpicc")) {
  errors.push("account-service.js: must not use mergeAccountMeddpicc");
}

if (errors.length) {
  console.error("check-meddpicc-writes: FAIL\n" + errors.map((e) => `  - ${e}`).join("\n"));
  process.exit(1);
}

console.log("check-meddpicc-writes: ok");
