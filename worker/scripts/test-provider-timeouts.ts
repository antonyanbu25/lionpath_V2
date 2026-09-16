#!/usr/bin/env tsx
/**
 * P10 gate: provider calls must be bounded, cancellable, and correctly classified.
 *
 * Two defects this guards against, both astra-audit F-027:
 *
 *   1. Unbounded provider calls. `fetch` has no default timeout in Workers or
 *      Node, so a provider that accepts a connection and never answers holds a
 *      Cloud Run request slot until the service timeout. The audit named three
 *      such calls; a sweep found ten files, including the Firebase JWK fetch on
 *      the critical path for every authenticated request.
 *
 *   2. Silent pass misclassification. Five passes under worker/src/postcall/
 *      were missing from POSTCALL_PASS_NAMES, so they fell through to the
 *      "extraction" budget (45s) instead of "postcall" (75s). Nothing failed
 *      loudly — it surfaced only as an unexplained timeout on a slow pass.
 *
 * The hung-socket cases use a real loopback server that accepts the connection
 * and never responds, so the timeout is exercised against genuine socket
 * behaviour rather than a stubbed fetch. No external network is used.
 */
import assert from "node:assert/strict";
import { createServer, type Server } from "node:http";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import {
  fetchWithTimeout,
  ProviderTimeoutError,
  ProviderAbortedError,
  PROVIDER_TIMEOUT_MS,
} from "../src/providers/fetch-timeout.ts";
import {
  resolveGeminiWorkload,
  resolveGeminiTimeoutMs,
  isClassifiedPassName,
  GEMINI_TIMEOUT_MS,
} from "../src/providers/gemini-retry.ts";
import type { LlmRequest } from "../src/providers/types.ts";

let failures = 0;
function check(label: string, fn: () => void) {
  try {
    fn();
    console.log(`  PASS  ${label}`);
  } catch (err) {
    failures += 1;
    console.log(`  FAIL  ${label}\n          ${err instanceof Error ? err.message : String(err)}`);
  }
}

// --- a server that accepts and then goes silent, plus one that answers -------
const sockets: Array<{ destroy(): void }> = [];
const hung: Server = createServer((_req, _res) => {
  /* deliberately never respond */
});
hung.on("connection", (s) => sockets.push(s));
const ok: Server = createServer((_req, res) => {
  res.writeHead(200, { "content-type": "application/json" });
  res.end('{"ok":true}');
});
const listen = (s: Server) =>
  new Promise<number>((resolve) => s.listen(0, "127.0.0.1", () => resolve((s.address() as { port: number }).port)));
const hungPort = await listen(hung);
const okPort = await listen(ok);

console.log("\n1. a hung socket is bounded by our budget, not the platform's");
{
  const started = Date.now();
  let caught: unknown;
  try {
    await fetchWithTimeout(`http://127.0.0.1:${hungPort}/`, {}, { timeoutMs: 600, label: "test.hung" });
  } catch (err) {
    caught = err;
  }
  const elapsed = Date.now() - started;
  check("throws ProviderTimeoutError", () => assert.ok(caught instanceof ProviderTimeoutError, `got ${caught}`));
  check("gives up at roughly the budget, not later", () =>
    assert.ok(elapsed >= 550 && elapsed < 4000, `elapsed ${elapsed}ms`));
  check("the error identifies itself as OUR timeout (retryable for idempotent calls)", () =>
    assert.equal((caught as ProviderTimeoutError).timedOut, true));
  check("the error carries the label, so telemetry can name the provider", () =>
    assert.equal((caught as ProviderTimeoutError).label, "test.hung"));
}

console.log("\n2. caller cancellation propagates, and is distinguishable from a timeout");
{
  const controller = new AbortController();
  setTimeout(() => controller.abort(), 150);
  let caught: unknown;
  try {
    await fetchWithTimeout(
      `http://127.0.0.1:${hungPort}/`,
      {},
      { timeoutMs: 30_000, label: "test.cancel", signal: controller.signal },
    );
  } catch (err) {
    caught = err;
  }
  check("caller abort surfaces as ProviderAbortedError, not a timeout", () =>
    assert.ok(caught instanceof ProviderAbortedError, `got ${caught}`));
  check("an aborted call is NOT marked retryable", () =>
    assert.equal((caught as unknown as { timedOut?: boolean }).timedOut, undefined));
}

console.log("\n3. an already-aborted signal fails fast without opening a socket");
{
  const controller = new AbortController();
  controller.abort();
  let caught: unknown;
  const started = Date.now();
  try {
    await fetchWithTimeout(`http://127.0.0.1:${hungPort}/`, {}, { timeoutMs: 30_000, label: "test.pre", signal: controller.signal });
  } catch (err) {
    caught = err;
  }
  check("pre-aborted signal throws immediately", () => {
    assert.ok(caught instanceof ProviderAbortedError, `got ${caught}`);
    assert.ok(Date.now() - started < 1000, "should not have waited");
  });
}

console.log("\n4. a successful response is unaffected, and leaves no pending timer");
{
  const res = await fetchWithTimeout(`http://127.0.0.1:${okPort}/`, {}, { timeoutMs: 30_000, label: "test.ok" });
  const body = (await res.json()) as { ok: boolean };
  check("success passes through", () => {
    assert.equal(res.status, 200);
    assert.equal(body.ok, true);
  });
  // If the 30s timer were not cleared in `finally`, Node would keep the event
  // loop alive for 30s after the work finished. Asserted by the fact that this
  // process exits promptly — see the exit note at the end.
  check("no long-lived handle is left behind (timer cleared in finally)", () => {
    const handles = (process as unknown as { _getActiveHandles?: () => unknown[] })._getActiveHandles?.() ?? [];
    const timers = handles.filter((h) => h && h.constructor?.name === "Timeout");
    assert.ok(timers.length === 0, `${timers.length} pending Timeout handle(s) remain`);
  });
}

console.log("\n5. the five previously-misclassified post-call passes now get the postcall budget");
{
  const req = (passName: string) => ({ passName } as unknown as LlmRequest);
  for (const pass of ["scorecard-verify", "scorecard-calibrate", "deck-validate", "speaker-attribution", "linkedin-identity"]) {
    check(`"${pass}" resolves to the postcall workload`, () =>
      assert.equal(resolveGeminiWorkload(req(pass)), "postcall"));
    check(`"${pass}" gets ${GEMINI_TIMEOUT_MS.postcall}ms, not ${GEMINI_TIMEOUT_MS.extraction}ms`, () =>
      assert.equal(resolveGeminiTimeoutMs(req(pass)), GEMINI_TIMEOUT_MS.postcall));
  }
  check("synthesize and vision keep their own budgets", () => {
    assert.equal(resolveGeminiWorkload(req("synthesize")), "synthesize");
    assert.equal(resolveGeminiWorkload(req("video/vision")), "vision");
  });
}

console.log("\n6. drift guard — every pass name used in worker/src is explicitly classified");
{
  // Scan the source for pass names rather than trusting a hand-kept list: the
  // whole defect was a hand-kept list falling behind the code.
  const found = new Set<string>();
  const walk = (dir: string) => {
    for (const name of readdirSync(dir)) {
      const full = join(dir, name);
      if (statSync(full).isDirectory()) walk(full);
      else if (full.endsWith(".ts")) {
        for (const m of readFileSync(full, "utf8").matchAll(/pass(?:Name)?:\s*"([a-z0-9/-]+)"/g)) {
          found.add(m[1]);
        }
      }
    }
  };
  walk(join(import.meta.dirname, "..", "src"));
  const unclassified = [...found].filter((p) => !isClassifiedPassName(p)).sort();
  console.log(`      scanned ${found.size} distinct pass name(s) in worker/src`);
  check("no pass name falls through unclassified", () =>
    assert.deepEqual(
      unclassified,
      [],
      `unclassified: ${unclassified.join(", ")} — add each to POSTCALL_PASS_NAMES or EXTRACTION_PASS_NAMES in gemini-retry.ts`,
    ));
}

console.log("\n7. the shared budget table is sane");
{
  check("every provider budget is positive and under 5 minutes", () => {
    for (const [k, v] of Object.entries(PROVIDER_TIMEOUT_MS)) {
      assert.ok(v > 0 && v <= 300_000, `${k}=${v}`);
    }
  });
  check("auth is the tightest budget — it blocks every authenticated request", () => {
    const others = Object.entries(PROVIDER_TIMEOUT_MS).filter(([k]) => k !== "auth").map(([, v]) => v);
    assert.ok(PROVIDER_TIMEOUT_MS.auth <= Math.min(...others), "auth should not be looser than any other class");
  });
}

hung.close();
ok.close();
for (const s of sockets) s.destroy();

console.log("");
if (failures > 0) {
  console.error(`FAIL — ${failures} provider-timeout check(s) failed.`);
  process.exit(1);
}
console.log("OK — provider calls are bounded, cancellable, and classified.");
