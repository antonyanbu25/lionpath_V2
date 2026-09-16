/**
 * Harness for ai_run_insert.test.mjs — invokes insertAiRun against seeded fixtures.
 * Usage: CALL_ID=__ai_run_test_call__ npx tsx janus/tests/ai_run_insert.harness.ts
 *
 * astra-audit F-038 / P15: this file previously used top-level `await`, which
 * esbuild rejects with "Top-level await is currently not supported with the
 * cjs output format". `janus/` has no package.json declaring `"type": "module"`,
 * so tsx transforms a `.ts` file here to CJS, where top-level await is invalid.
 * The harness therefore ALWAYS failed to start, and the two checks in
 * ai_run_insert.test.mjs that depend on it could never pass — recorded in the
 * merge audit as "2 of 12 checks cannot run" and carried as a known limitation.
 *
 * Fixed by moving the awaits inside an async main() and driving it with
 * .then/.catch. Chosen over renaming to `.mts` (which would force ESM output)
 * because it keeps the path referenced by ai_run_insert.test.mjs:132 intact, and
 * over adding `janus/package.json` with `"type": "module"`, which would change
 * module resolution for every file in the directory to fix one.
 */
import { loadDevVars } from "../../worker/scripts/lib/load-dev-vars.mjs";
import { insertAiRun } from "../../worker/src/data/persistence/ai-run.ts";
import { closePool } from "../../worker/src/data/persistence/postgres-pool.ts";

loadDevVars();

async function main(): Promise<number> {
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
    return 1;
  }
  console.log("[ai_run_insert.harness] insertAiRun succeeded");
  return 0;
}

main()
  .then((code) => process.exit(code))
  .catch(async (err) => {
    console.error("[ai_run_insert.harness]", err instanceof Error ? err.message : err);
    await closePool().catch(() => {});
    process.exit(1);
  });
