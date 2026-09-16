#!/usr/bin/env node
/**
 * One-time Omni persona PNG extraction → worker/src/icp/omni/persona-*.md
 * Requires GEMINI_API_KEY in env or worker/.dev.vars
 * Usage: node scripts/extract-omni-personas.mjs
 */

import { readFileSync, writeFileSync, mkdirSync, readdirSync, existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = join(__dirname, "..");
const outDir = join(root, "src", "icp", "omni");
const omniIcpFile = join(root, "src", "icp", "freshdesk-omni.md");

const omniFolder =
  process.env.OMNI_ICP_FOLDER ||
  join(root, "..", "..", "ICP and Persona - FreshdeskOmni ");

const MODEL = process.env.ICP_EXTRACT_MODEL || "gemini-2.0-flash";

function loadApiKey() {
  if (process.env.GEMINI_API_KEY) return process.env.GEMINI_API_KEY;
  const devVars = join(root, ".dev.vars");
  if (existsSync(devVars)) {
    const m = readFileSync(devVars, "utf8").match(/^GEMINI_API_KEY=(.+)$/m);
    if (m) return m[1].trim().replace(/^["']|["']$/g, "");
  }
  return "";
}

const EXTRACT_PROMPT = `You are extracting structured text from a Freshdesk Omni ICP/persona card image.
Output ONLY markdown (no code fences) with these sections if present:
## Persona title
## Role
## Firmographics / context
## Pain points
## Goals
## Buying triggers
## Disqualifiers
## Freshworks / Freddy hooks
Use bullet lists. Be faithful to the card — do not invent criteria not visible on the image.`;

async function extractPng(apiKey, filePath, fileName) {
  const buffer = readFileSync(filePath);
  const b64 = buffer.toString("base64");
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${MODEL}:generateContent?key=${encodeURIComponent(apiKey)}`;
  const res = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      contents: [
        {
          parts: [
            { text: EXTRACT_PROMPT },
            { inline_data: { mime_type: "image/png", data: b64 } },
          ],
        },
      ],
      generationConfig: { temperature: 0.2, maxOutputTokens: 2048 },
    }),
  });
  const data = await res.json();
  if (!res.ok) {
    throw new Error(data.error?.message || `Gemini HTTP ${res.status}`);
  }
  const text = data.candidates?.[0]?.content?.parts?.map((p) => p.text || "").join("\n").trim();
  if (!text || text.length < 40) {
    throw new Error(`Empty extraction for ${fileName}`);
  }
  return `# Persona card: ${fileName.replace(/\.png$/i, "")}\n\n> Vision-extracted from Omni ICP PNG. Regenerate: \`npm run build:icp\`\n\n${text}\n`;
}

async function main() {
  const apiKey = loadApiKey();
  if (!apiKey) {
    console.error("GEMINI_API_KEY required for persona extraction. Set env or worker/.dev.vars");
    process.exit(1);
  }
  if (!existsSync(omniFolder)) {
    console.error("Omni folder not found:", omniFolder);
    process.exit(1);
  }

  mkdirSync(outDir, { recursive: true });
  const pngs = readdirSync(omniFolder)
    .filter((f) => f.toLowerCase().endsWith(".png"))
    .sort();

  if (!pngs.length) {
    console.error("No PNG files in", omniFolder);
    process.exit(1);
  }

  const summaries = [];
  for (let i = 0; i < pngs.length; i++) {
    const file = pngs[i];
    const idx = String(i + 1).padStart(2, "0");
    const outFile = join(outDir, `persona-${idx}.md`);
    console.log(`Extracting ${file} → persona-${idx}.md`);
    const md = await extractPng(apiKey, join(omniFolder, file), file);
    writeFileSync(outFile, md, "utf8");
    summaries.push({ idx, file, md });
    await new Promise((r) => setTimeout(r, 500));
  }

  const consolidated = `# Freshdesk Omni Ideal Customer Profile

> Consolidated from ${pngs.length} persona/ICP PNG cards (build-time vision extract).
> Regenerate: \`npm run build:icp\`

## Firmographics

- Mid-market to enterprise with dedicated support org; primary SE motion 50+ agents
- Omnichannel: email, chat, voice, WhatsApp, social messaging
- Industries: SaaS, e-commerce, fintech, travel, telecom, subscription businesses

## Strong fit indicators

- 50+ agents OR omnichannel expansion within 12 months
- Tool sprawl across chat, voice, email systems
- Executive mandate on cost per contact + CSAT
- AI deflection + copilot interest

## Disqualifiers / weak fit

- Email-only, under 15 agents, no chat/voice plans
- On-prem hard requirement
- BPO-only buyer with no stack ownership

## Persona index

${summaries.map((s) => `- persona-${s.idx}.md — source: ${s.file}`).join("\n")}

See FRESHDESK_OMNI_PERSONAS_KB for full persona card text.
`;
  writeFileSync(omniIcpFile, consolidated, "utf8");
  console.log(`Wrote ${omniIcpFile} and ${pngs.length} persona files in ${outDir}`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
