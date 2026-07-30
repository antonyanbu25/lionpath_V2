#!/usr/bin/env node
// Embed benchmark markdown into benchmark-kb.ts for Cloudflare Workers (no node:fs at runtime).

import { readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const mdPath = join(root, "src", "benchmark", "customer-service-benchmark-2025.md");

function escapeTemplate(s) {
  return String(s).replace(/\\/g, "\\\\").replace(/`/g, "\\`").replace(/\$/g, "\\$");
}

function readMd(path, fallback = "") {
  try {
    return readFileSync(path, "utf8");
  } catch {
    return fallback;
  }
}

const body = readMd(
  mdPath,
  "(No benchmark extracted yet — run npm run build:benchmark)",
);

const out = `// Auto-generated — run: npm run build:benchmark

export const CUSTOMER_SERVICE_BENCHMARK_KB = \`${escapeTemplate(body)}\`;
`;

writeFileSync(join(root, "src", "benchmark-kb.ts"), out, "utf8");
console.log(`Wrote src/benchmark-kb.ts (${out.length} bytes)`);
