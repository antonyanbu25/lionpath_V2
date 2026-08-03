/** Compare production vs local worker — is schema fix deployed? */
import { appendFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const LOG = join(dirname(fileURLToPath(import.meta.url)), "..", "..", "debug-d8cd23.log");

async function probe(label, url) {
  try {
    const res = await fetch(url, { signal: AbortSignal.timeout(8000) });
    const data = await res.json();
    return {
      label,
      url,
      ok: res.ok,
      workerBuild: data.workerBuild || null,
      schemaFix: data.geminiSchemaEnumFix || null,
      patched: !!data.geminiSchemaEnumFix,
    };
  } catch (err) {
    return { label, url, ok: false, error: err instanceof Error ? err.message : String(err), patched: false };
  }
}

const results = await Promise.all([
  probe("production", "https://portalapi.benjaminsquare.com/api/config"),
  probe("local", "http://127.0.0.1:8787/api/config"),
]);

for (const r of results) {
  console.log(`\n=== ${r.label} (${r.url}) ===`);
  if (r.error) {
    console.log("ERROR:", r.error);
    continue;
  }
  console.log("workerBuild:", r.workerBuild);
  console.log("geminiSchemaEnumFix:", r.schemaFix);
  console.log(r.patched ? "STATUS: PATCHED (postcall scorecard fix active)" : "STATUS: NOT PATCHED (Gemini 400 will occur on scorecard)");
}

const line = JSON.stringify({
  sessionId: "d8cd23",
  timestamp: Date.now(),
  runId: "env-check",
  hypothesisId: "F",
  location: "check-worker-fix.mjs",
  message: "environment comparison",
  data: { results },
});
appendFileSync(LOG, `${line}\n`, "utf8");
console.log("\nLog written to debug-d8cd23.log");

const prod = results.find((r) => r.label === "production");
const local = results.find((r) => r.label === "local");
if (local?.patched && !prod?.patched) {
  console.log("\n>>> Use http://localhost:8788 for testing NOW.");
  console.log(">>> Production needs VPS: bash upgrade-now.sh");
  process.exit(2);
}
if (prod?.patched) {
  console.log("\n>>> Production is patched.");
  process.exit(0);
}
process.exit(1);
