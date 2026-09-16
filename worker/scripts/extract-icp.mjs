#!/usr/bin/env node
/**
 * One-time ICP PDF extraction → worker/src/icp/freshdesk.md
 * Usage: node scripts/extract-icp.mjs
 */

import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = join(__dirname, "..");
const outDir = join(root, "src", "icp");
const outFile = join(outDir, "freshdesk.md");

const pdfPath =
  process.env.FRESHDESK_ICP_PDF ||
  join(
    root,
    "..",
    "..",
    "ICP - Fresdhesk",
    "Freshdesk New Business Ideal Customer Profile _ CX _ ICP Card.pdf",
  );

async function extractPdfText(path) {
  const { PDFParse } = await import("pdf-parse");
  const buffer = readFileSync(path);
  const parser = new PDFParse({ data: buffer });
  const result = await parser.getText();
  await parser.destroy();
  return result.text || "";
}

function cleanText(text) {
  return String(text || "")
    .replace(/\r\n/g, "\n")
    .replace(/-- \d+ of \d+ --/g, "")
    .replace(/© \d{4} Freshworks Inc\. All rights reserved\./g, "")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

async function main() {
  mkdirSync(outDir, { recursive: true });
  let body;
  try {
    body = cleanText(await extractPdfText(pdfPath));
  } catch (err) {
    console.error("PDF extraction failed:", err.message || err);
    process.exit(1);
  }
  if (!body || body.length < 100) {
    console.error("Extracted text too short — check PDF path:", pdfPath);
    process.exit(1);
  }
  const md = `# Freshdesk Ideal Customer Profile (New Business)

> Extracted from Freshdesk New Business ICP Card PDF.
> Regenerate: \`node scripts/extract-icp.mjs\`

${body}
`;
  writeFileSync(outFile, md, "utf8");
  console.log(`Wrote ${outFile} (${body.length} chars from ${pdfPath})`);

  const { spawnSync } = await import("node:child_process");
  const gen = spawnSync(process.execPath, ["scripts/generate-icp-kb.mjs"], {
    cwd: root,
    stdio: "inherit",
  });
  if (gen.status !== 0) process.exit(gen.status ?? 1);
}

main();
