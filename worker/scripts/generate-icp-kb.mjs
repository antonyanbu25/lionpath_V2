#!/usr/bin/env node
// Embed worker/src/icp markdown into icp-kb.ts for Cloudflare Workers (no node:fs at runtime).

import { readFileSync, writeFileSync, readdirSync, existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const icpDir = join(root, "src", "icp");
const omniDir = join(icpDir, "omni");

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

const freshdesk = readMd(join(icpDir, "freshdesk.md"));
const omni = readMd(join(icpDir, "freshdesk-omni.md"));

let personas = "";
if (existsSync(omniDir)) {
  const files = readdirSync(omniDir)
    .filter((f) => f.endsWith(".md"))
    .sort();
  personas = files
    .map((f) => readMd(join(omniDir, f)))
    .filter(Boolean)
    .join("\n\n---\n\n");
}

const out = `// Auto-generated — run: npm run build:icp

export const FRESHDESK_ICP_KB = \`${escapeTemplate(freshdesk)}\`;

export const FRESHDESK_OMNI_ICP_KB = \`${escapeTemplate(omni)}\`;

export const FRESHDESK_OMNI_PERSONAS_KB = \`${escapeTemplate(personas || "(No persona cards extracted yet — run npm run build:icp with GEMINI_API_KEY)")}\`;
`;

writeFileSync(join(root, "src", "icp-kb.ts"), out, "utf8");
console.log(`Wrote src/icp-kb.ts (${out.length} bytes, personas: ${personas.length} chars)`);
