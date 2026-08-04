#!/usr/bin/env node
/** E2E: enrich HTTP → synthesize HTTP → assert donts in prep.prospects */
import { readFileSync, appendFileSync, mkdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const LOG = join(ROOT, "../.cursor/debug-8a8233.log");
const API = "http://127.0.0.1:8787";

function log(message, data) {
  mkdirSync(dirname(LOG), { recursive: true });
  appendFileSync(
    LOG,
    `${JSON.stringify({ sessionId: "8a8233", message, data, timestamp: Date.now(), runId: "e2e-http" })}\n`,
  );
}

for (const line of readFileSync(join(ROOT, ".dev.vars"), "utf8").split(/\n/)) {
  const t = line.trim();
  if (!t || t.startsWith("#")) continue;
  const eq = t.indexOf("=");
  if (eq > 0) process.env[t.slice(0, eq).trim()] = t.slice(eq + 1).trim().replace(/^["']|["']$/g, "");
}

async function pdfText(path) {
  const pdfjs = await import("pdfjs-dist/legacy/build/pdf.mjs");
  const data = new Uint8Array(readFileSync(path));
  const doc = await pdfjs.getDocument({ data }).promise;
  let out = "";
  for (let i = 1; i <= doc.numPages; i++) {
    const page = await doc.getPage(i);
    const c = await page.getTextContent();
    out += c.items.map((x) => x.str).join(" ") + "\n";
  }
  return out;
}

const emails = ["rick@vivid-pix.com", "howard@duckdiverllc.com"];
const pdfs = ["/Users/ssunil/Downloads/Profile (8).pdf", "/Users/ssunil/Downloads/Profile (9).pdf"];
const notes = "Freshdesk Omni AI support. Howard leads implementation. 3 agents.";

const confirmed = [];
for (let i = 0; i < emails.length; i++) {
  const text = await pdfText(pdfs[i]);
  const res = await fetch(`${API}/api/contact/enrich`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      email: emails[i],
      companyName: "Vivid-Pix",
      companyDomain: "vivid-pix.com",
      sources: { linkedinPdf: { fileName: "p.pdf", text }, additionalNotes: notes },
    }),
  });
  const data = await res.json();
  log("http enrich", {
    email: emails[i],
    status: res.status,
    dos: data.disc?.dos?.length,
    donts: data.disc?.donts?.length,
  });
  if (!res.ok) throw new Error(`enrich failed: ${data.error}`);
  confirmed.push({ email: data.email, profile: data.profile, disc: data.disc, influence: data.influence });
}

const synthRes = await fetch(`${API}/api/prep/synthesize`, {
  method: "POST",
  headers: { "content-type": "application/json" },
  body: JSON.stringify({
    companyName: "Vivid-Pix",
    companyDomain: "vivid-pix.com",
    prospectEmails: emails,
    additionalContext: notes,
    confirmedProspectProfiles: confirmed,
    confirmedFacts: [
      { key: "Industry", value: "Software", sourceLabel: "S1", sourceUrl: "https://example.com", confidence: 80 },
      { key: "Team size", value: "3 agents", sourceLabel: "SE", sourceUrl: "se-context", confidence: 90 },
      { key: "Product interest", value: "Freshdesk Omni", sourceLabel: "SE", sourceUrl: "se-context", confidence: 90 },
      { key: "Channels", value: "Chat and email", sourceLabel: "SE", sourceUrl: "se-context", confidence: 85 },
      { key: "AI need", value: "Documentation Q&A", sourceLabel: "SE", sourceUrl: "se-context", confidence: 85 },
      { key: "Incumbent", value: "Freshdesk", sourceLabel: "SE", sourceUrl: "se-context", confidence: 80 },
      { key: "Implementation", value: "Howard leads", sourceLabel: "SE", sourceUrl: "se-context", confidence: 85 },
      { key: "Social", value: "Facebook Instagram", sourceLabel: "SE", sourceUrl: "se-context", confidence: 80 },
    ],
    researchBundle: {
      sources: [
        { label: "S1", title: "Site", url: "https://vivid-pix.com", confidence: 80 },
        { label: "SE", title: "SE notes", url: "se-context", confidence: 90 },
        { label: "LinkedIn PDF", title: "LinkedIn", url: "linkedin-pdf", confidence: 85 },
      ],
    },
  }),
});

const synth = await synthRes.json();
log("http synthesize", {
  status: synthRes.status,
  prospects: (synth.prep?.prospects || []).map((p, i) => ({
    i,
    name: p.name,
    dos: p.discHint?.dos?.length ?? 0,
    donts: p.discHint?.donts?.length ?? 0,
  })),
});

if (!synthRes.ok) throw new Error(`synthesize failed: ${synth.error}`);

for (let i = 0; i < emails.length; i++) {
  const donts = synth.prep?.prospects?.[i]?.discHint?.donts?.length ?? 0;
  if (donts < 3) throw new Error(`prospect ${i} donts=${donts}, expected >= 3`);
}

console.log("test-e2e-http-prep-donts: ok");
