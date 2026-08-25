/**
 * Harness for ai_run_insert.test.mjs — invokes insertAiRun against seeded fixtures.
 * Usage: CALL_ID=__ai_run_test_call__ npx tsx janus/tests/ai_run_insert.harness.ts
 */
import { loadDevVars } from "../../worker/scripts/lib/load-dev-vars.mjs";
import { insertAiRun } from "../../worker/src/data/persistence/ai-run.ts";
import { closePool } from "../../worker/src/data/persistence/postgres-pool.ts";

loadDevVars();

const callId = process.env.CALL_ID || "__ai_run_test_call__";
const ok = await insertAiRun(process.env, {
  callId,
  passName: "analyze",
  userId: null,
  model: "gemini-3.5-flash",
  promptTokens: 100,
  outputTokens: 50,
  cachedTokens: 0,
  groundingQueries: 0,
  latencyMs: 42,
  cacheHit: false,
  retryCount: 0,
  costUsd: 0.000045,
  errorCode: null,
});

await closePool().catch(() => {});

if (!ok) {
  console.error("[ai_run_insert.harness] insertAiRun returned false");
  process.exit(1);
}
console.log("[ai_run_insert.harness] insertAiRun succeeded");
process.exit(0);
