/** Smoke tests for pre-call dispute logging helpers. */

import { readFile } from "node:fs/promises";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import {
  STORAGE_KEY,
  buildDisputeEntry,
  summarizeFactsSnapshot,
  DISPUTE_CATEGORIES,
  mountDisputeOverlay,
  ensureDisputeFieldsVisible,
  purgeLegacyDisputeModals,
} from "../prep-disputes.js";

const WEB_ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const indexHtml = await readFile(join(WEB_ROOT, "index.html"), "utf8");

const facts = [
  { key: "Industry", value: "Manufacturing", sourceLabel: "S1" },
  { key: "Head office", value: "Chicago, IL", sourceLabel: "S2" },
];

const entry = buildDisputeEntry(
  {
    userEmail: "se@example.com",
    companyName: "Acme Corp",
    companyDomain: "acme.com",
    step: "facts_review",
    section: "facts",
    factIndices: [0],
    facts,
    researchInputHash: "habc123",
    briefId: null,
  },
  "wrong_data",
  "Industry should be SaaS, not manufacturing",
);

const checks = [
  ["storage key", STORAGE_KEY === "se-prep-disputes"],
  ["static overlay html", indexHtml.includes('id="prep-dispute-modal"') && indexHtml.includes("prep-dispute-overlay")],
  ["critical css", indexHtml.includes("prep-dispute-critical-css")],
  ["no debug badge", !indexHtml.includes('id="se-build-badge"')],
  ["no health strip", !indexHtml.includes("prep-dispute-health")],
  ["no version badge", !indexHtml.includes("prep-dispute-version-badge")],
  ["inline boot script", indexHtml.includes("initDisputeShell")],
  ["inline ensure heal", indexHtml.includes("window.ensureDisputeFieldsVisible = function")],
  ["mount export", typeof mountDisputeOverlay === "function"],
  ["ensure export", typeof ensureDisputeFieldsVisible === "function"],
  ["purge export", typeof purgeLegacyDisputeModals === "function"],
  ["boot script", indexHtml.includes("prep-disputes-boot.mjs")],
  ["category label", entry.categoryLabel === DISPUTE_CATEGORIES.wrong_data],
  ["captures company", entry.companyName === "Acme Corp" && entry.companyDomain === "acme.com"],
  ["captures fact key", entry.factKeys[0] === "Industry"],
  ["facts snapshot", entry.factsSnapshot.length === 1 && entry.factsSnapshot[0].key === "Industry"],
  ["note preserved", entry.note.includes("SaaS")],
  ["input hash", entry.researchInputHash === "habc123"],
  ["summarize all facts", summarizeFactsSnapshot(facts).length === 2],
  ["summarize subset", summarizeFactsSnapshot(facts, [1])[0].key === "Head office"],
];

let failed = 0;
for (const [name, ok] of checks) {
  if (!ok) {
    console.error("FAIL:", name);
    failed++;
  } else {
    console.log("ok:", name);
  }
}

if (failed) process.exit(1);
console.log(`\n${checks.length} prep dispute checks passed.`);
