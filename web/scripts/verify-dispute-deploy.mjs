/**
 * Verify dispute UI markers on localhost vs production URLs.
 * Writes NDJSON to debug log for deploy mismatch diagnosis.
 */
import { appendFile, writeFile } from "node:fs/promises";

const LOG_PATH = "/Users/ssunil/Documents/init/Se Prep Portal/.cursor/debug-161178.log";
const URLS = [
  "http://127.0.0.1:8788/",
  "https://lionpath.benjaminsquare.com/",
  "https://portal.benjaminsquare.com/",
];

async function log(entry) {
  const line = `${JSON.stringify({ sessionId: "161178", timestamp: Date.now(), ...entry })}\n`;
  await appendFile(LOG_PATH, line).catch(async () => writeFile(LOG_PATH, line));
}

async function probe(url) {
  try {
    const res = await fetch(url, { redirect: "follow" });
    const html = await res.text();
    const title = html.match(/<title>([^<]*)</i)?.[1] || "";
    return {
      url,
      ok: res.ok,
      status: res.status,
      prepDisputeCount: (html.match(/prep-dispute/g) || []).length,
      staticV11Count: (html.match(/static-v11/g) || []).length,
      buildBadgeCount: (html.match(/se-build-badge/g) || []).length,
      title,
      hasFix: html.includes('data-dispute-ui-version="static-v11"') && html.includes("se-build-badge"),
    };
  } catch (err) {
    return { url, ok: false, error: err.message, hasFix: false };
  }
}

const results = [];
for (const url of URLS) {
  const row = await probe(url);
  results.push(row);
  await log({
    hypothesisId: "M",
    location: "verify-dispute-deploy.mjs",
    message: "Deploy probe",
    data: row,
    runId: "static-v11",
  });
}

const local = results.find((r) => r.url.includes("127.0.0.1"));
const prod = results.filter((r) => !r.url.includes("127.0.0.1"));
const localOk = local?.hasFix === true;
const prodOk = prod.every((r) => r.hasFix === true);

console.log(JSON.stringify({ results, localOk, prodOk }, null, 2));

if (!localOk) {
  console.error("FAIL: localhost missing static-v11 dispute UI — run npm run dev in web/");
  process.exit(1);
}

if (!prodOk) {
  console.warn("WARN: production URL(s) missing static-v11 — deploy web/ to VPS before testing there.");
}
