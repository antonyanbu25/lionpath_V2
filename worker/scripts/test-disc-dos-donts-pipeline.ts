/**
 * Integration: enrich → strip synthesized discHint → merge → assert donts present.
 */
import assert from "node:assert/strict";
import { readFileSync, appendFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { enrichContact } from "../src/contact/enrich.ts";
import {
  mergeEnrichmentsIntoPrep,
  stripProspectDiscHints,
  enrichResponsesToConfirmed,
} from "../src/prep/merge-enrichment.ts";
import type { Prep } from "../src/schema.ts";

const LOG = join(dirname(fileURLToPath(import.meta.url)), "../../.cursor/debug-8a8233.log");
const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");

function log(message: string, data: Record<string, unknown>) {
  appendFileSync(
    LOG,
    `${JSON.stringify({ sessionId: "8a8233", message, data, timestamp: Date.now(), runId: "integration-test" })}\n`,
  );
}

for (const line of readFileSync(join(ROOT, ".dev.vars"), "utf8").split(/\r?\n/)) {
  const t = line.trim();
  if (!t || t.startsWith("#")) continue;
  const eq = t.indexOf("=");
  if (eq <= 0) continue;
  process.env[t.slice(0, eq).trim()] = t
    .slice(eq + 1)
    .trim()
    .replace(/^["']|["']$/g, "");
}

async function pdfText(path: string): Promise<string> {
  const pdfjs = await import("pdfjs-dist/legacy/build/pdf.mjs");
  const data = new Uint8Array(readFileSync(path));
  const doc = await pdfjs.getDocument({ data }).promise;
  const parts: string[] = [];
  for (let i = 1; i <= doc.numPages; i++) {
    const page = await doc.getPage(i);
    const content = await page.getTextContent();
    parts.push(content.items.map((it: { str: string }) => it.str).join(" "));
  }
  return parts.join("\n");
}

const env = { GEMINI_API_KEY: process.env.GEMINI_API_KEY! };
const emails = ["rick@vivid-pix.com", "howard@duckdiverllc.com"];
const pdfs = [
  "/Users/ssunil/Downloads/Profile (8).pdf",
  "/Users/ssunil/Downloads/Profile (9).pdf",
];
const notes =
  "Freshdesk Omni AI support. Howard leads implementation. Team 3 agents. Website chat, email, Facebook, Instagram, Pinterest.";

const enrichResponses = [];
for (let i = 0; i < emails.length; i++) {
  const text = await pdfText(pdfs[i]);
  const r = await enrichContact(env, {
    email: emails[i],
    companyName: "Vivid-Pix",
    companyDomain: "vivid-pix.com",
    sources: {
      linkedinPdf: { fileName: pdfs[i].split("/").pop()!, text },
      additionalNotes: notes,
    },
  });
  enrichResponses.push(r);
  log("enrichContact", { email: emails[i], dos: r.disc?.dos?.length ?? 0, donts: r.disc?.donts?.length ?? 0 });
  assert.ok((r.disc?.donts?.length ?? 0) >= 3, `${emails[i]}: expected 3 donts`);
}

const synthHallucination: Prep = {
  description: "test",
  prospects: emails.map((email, i) => ({
    name: i === 0 ? "Rick Voight" : "Howard Ehrenberg",
    role: "CEO",
    totalExperience: "unknown",
    priorEmployers: [],
    competitorTouchpoints: ["Freshdesk"],
    sourceLabel: "LinkedIn PDF",
    discHint: {
      primary: "D",
      confidence: "medium",
      evidence: ["fake"],
      dos: ["Focus on ROI", "Present data-driven outcomes"],
      donts: [],
      inferred: true,
      source: "linkedin_pdf",
    },
  })),
  facts: [],
  signals: [],
  sources: [{ label: "LinkedIn PDF", title: "PDF", url: "unknown", confidence: 80 }],
};

const stripped = stripProspectDiscHints(synthHallucination);
assert.equal(stripped.prospects?.[0]?.discHint, undefined, "strip removes hallucinated discHint");

const confirmed = enrichResponsesToConfirmed(enrichResponses);
const merged = mergeEnrichmentsIntoPrep(stripped, emails, confirmed);

for (let i = 0; i < emails.length; i++) {
  const p = merged.prospects?.[i];
  const donts = p?.discHint?.donts?.length ?? 0;
  const dos = p?.discHint?.dos?.length ?? 0;
  log("merged prospect", { email: emails[i], dos, donts });
  assert.ok(donts >= 3, `${emails[i]}: merged donts=${donts}`);
  assert.ok(dos >= 3, `${emails[i]}: merged dos=${dos}`);
}

console.log("test-disc-dos-donts-pipeline: ok");
log("pipeline complete", { ok: true });
