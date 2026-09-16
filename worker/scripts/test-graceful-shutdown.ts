#!/usr/bin/env tsx
/**
 * Roadmap 3.6 gate: the Node worker must shut down gracefully on SIGTERM.
 *
 * Cloud Run sends SIGTERM on every revision change and SIGKILLs ~10s later.
 * With no SIGTERM listener, Node's default signal action terminates the
 * process immediately — a response already being generated is severed
 * mid-flight and the PostgreSQL pool is abandoned rather than ended. This
 * test pins the three properties that fix has to have.
 *
 * Method — a raw socket rather than fetch(), because the discriminating
 * question is what happens to a request the server has ALREADY ACCEPTED when
 * the signal lands. We send a POST with a truthful Content-Length but only
 * half the body, so the server is parked inside readBody(); then we SIGTERM;
 * then we send the rest. A server that drains answers it. A server that dies
 * on the default signal action resets the socket and we get no status line.
 *
 * Without the handler, 6 of the 8 checks below fail (verified by reverting
 * src/node-server.ts to its pre-change state):
 *   1. no HTTP response on the in-flight socket (no data at all)
 *   2. exit is by signal (code null / signal SIGTERM), not a clean code 0
 *   3. neither shutdown log line is ever emitted, and the repeat SIGTERM is
 *      not observed as a no-op
 * The two that pass either way are the timing bound (no handler means it dies
 * instantly, which is trivially "within budget") and the no-forced-close
 * assertion (no drain, nothing to force). They are bounds, not gates.
 *
 * Hermetic: binds a private high port on 127.0.0.1, no database (DATABASE_URL
 * is explicitly cleared so the pool is never constructed and closePool() is
 * the no-op path), no external network, no Firebase credentials.
 */
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { connect, type Socket } from "node:net";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const WORKER_ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const HOST = "127.0.0.1";
const PORT = 18991;

/** node-server.ts budgets 8s; allow a little slack for process teardown. */
const EXIT_BUDGET_MS = 9_000;
const BOOT_TIMEOUT_MS = 30_000;

let failures = 0;
function check(label: string, fn: () => void) {
  try {
    fn();
    console.log(`  PASS  ${label}`);
  } catch (err) {
    failures += 1;
    console.error(`  FAIL  ${label}`);
    console.error(`        ${err instanceof Error ? err.message : String(err)}`);
  }
}

const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

// Spawn the server the way `npm run start:node` does (tsx loading
// src/node-server.ts) but as a DIRECT child, not via the npx/tsx wrapper
// binary. That matters: a wrapper that does not forward signals would make
// this test measure the wrapper's behaviour instead of the server's.
function spawnServer(port: number) {
  return spawn(process.execPath, ["--import", "tsx", join(WORKER_ROOT, "src/node-server.ts")], {
    cwd: WORKER_ROOT,
    env: {
      ...process.env,
      GEMINI_API_KEY: "test-key",
      HOST,
      PORT: String(port),
      NODE_ENV: "development",
      FIREBASE_PROJECT_ID: "",
      // No database: keep the gate hermetic. closePool() must still be reached
      // and must still be harmless when no pool was ever created.
      DATABASE_URL: "",
      PERSISTENCE_MODE: "firestore",
      HISTORY_BACKEND_MODE: "",
    },
    stdio: ["ignore", "pipe", "pipe"],
  });
}

const child = spawnServer(PORT);

let stdout = "";
let stderr = "";
child.stdout.on("data", (d) => (stdout += String(d)));
child.stderr.on("data", (d) => (stderr += String(d)));

const exited = new Promise<{ code: number | null; signal: NodeJS.Signals | null }>((resolve) => {
  child.on("exit", (code, signal) => resolve({ code, signal }));
});

function fail(message: string): never {
  console.error(`FAIL — ${message}`);
  if (stdout) console.error(`stdout:\n${stdout}`);
  if (stderr) console.error(`stderr:\n${stderr}`);
  try {
    child.kill("SIGKILL");
  } catch {
    /* already gone */
  }
  process.exit(1);
}

async function waitForListening(): Promise<void> {
  const deadline = Date.now() + BOOT_TIMEOUT_MS;
  while (Date.now() < deadline) {
    if (stdout.includes("worker listening")) return;
    if (child.exitCode !== null) fail(`server exited during boot (code ${child.exitCode})`);
    await sleep(150);
  }
  fail(`server did not report "listening" within ${BOOT_TIMEOUT_MS}ms`);
}

await waitForListening();

// --- Park an accepted-but-incomplete request inside the server -------------
// Unknown path on purpose: the router answers 404 without touching auth,
// Firestore or the database. Any status line proves the request completed;
// we are testing transport survival, not routing.
const body = Buffer.from(JSON.stringify({ probe: "roadmap-3.6-graceful-shutdown" }), "utf8");
const firstHalf = body.subarray(0, Math.floor(body.length / 2));
const secondHalf = body.subarray(Math.floor(body.length / 2));

const socket: Socket = await new Promise((resolve, reject) => {
  const s = connect(PORT, HOST);
  s.once("connect", () => resolve(s));
  s.once("error", reject);
});

let responseText = "";
let socketError = "";
socket.on("data", (d) => (responseText += String(d)));
socket.on("error", (err) => (socketError = err.message));

socket.write(
  `POST /api/__graceful_shutdown_probe HTTP/1.1\r\n` +
    `Host: ${HOST}:${PORT}\r\n` +
    `Content-Type: application/json\r\n` +
    `Content-Length: ${body.length}\r\n` +
    `\r\n`,
);
socket.write(firstHalf);

// Let the server accept the connection and block in readBody() awaiting the
// remaining Content-Length bytes.
await sleep(400);

const signalledAt = Date.now();
child.kill("SIGTERM");

// Idempotence probe: a second SIGTERM lands mid-drain. It must be logged and
// ignored, not run the sequence again (which would double-close the pool).
await sleep(150);
child.kill("SIGTERM");

// Now complete the in-flight request, comfortably inside the 6s drain window.
await sleep(400);
socket.write(secondHalf);

const exit = await Promise.race([
  exited,
  sleep(EXIT_BUDGET_MS).then(() => "timeout" as const),
]);
const exitElapsedMs = Date.now() - signalledAt;

if (exit === "timeout") {
  fail(`server did not exit within ${EXIT_BUDGET_MS}ms of SIGTERM (hung handler)`);
}

socket.destroy();

console.log("\n1. in-flight request survives SIGTERM");
check("already-accepted request received an HTTP response", () => {
  assert.ok(
    /^HTTP\/1\.1 \d{3}/.test(responseText),
    `expected an HTTP status line on the in-flight socket, got ${
      responseText ? JSON.stringify(responseText.slice(0, 120)) : `no data (socket error: ${socketError || "none"})`
    }`,
  );
});
check("response is the router's answer, not a truncated stream", () => {
  assert.ok(
    responseText.includes("\r\n\r\n"),
    `response headers were not terminated: ${JSON.stringify(responseText.slice(0, 200))}`,
  );
});

console.log("\n2. exit is clean and inside the budget");
check(`exited within ${EXIT_BUDGET_MS}ms`, () => {
  assert.ok(exitElapsedMs < EXIT_BUDGET_MS, `took ${exitElapsedMs}ms`);
});
check("exited by its own choice, not by the signal's default action", () => {
  assert.equal(exit.signal, null, `exited on signal ${exit.signal} — no handler ran`);
  assert.equal(exit.code, 0, `exit code ${exit.code}; stderr:\n${stderr}`);
});

console.log("\n3. shutdown is observable and idempotent");
const combined = `${stdout}\n${stderr}`;
const countOf = (needle: string) => combined.split(needle).length - 1;
check("logged that it received the signal", () => {
  assert.equal(
    countOf("graceful shutdown: signal received"),
    1,
    "expected exactly one shutdown-start log line",
  );
});
check("logged completion (so the log survives the exit)", () => {
  assert.equal(countOf("graceful shutdown: complete"), 1, "expected exactly one completion line");
});
check("second SIGTERM was ignored, not re-run", () => {
  assert.ok(
    countOf("graceful shutdown: signal ignored") >= 1,
    "the repeated SIGTERM was not observed as a no-op",
  );
});
check("drained cleanly rather than force-closing connections", () => {
  assert.ok(
    !combined.includes("drain deadline hit"),
    "drain deadline was hit — the in-flight request was not given its grace period",
  );
  assert.ok(!combined.includes("budget exceeded"), "shutdown watchdog fired");
});

// NOT asserted here, deliberately: "SIGTERM while the log pipe's reader has
// gone away must still exit". node-server.ts carries EPIPE hardening for that
// case (an uncaught EPIPE re-enters the uncaughtException handler forever,
// which was caught in the wild and `sample`-ed — see the comment there), but
// five attempts to reproduce it on demand all exited cleanly, because
// stream.destroy() and even killing an intermediate parent do not close the
// underlying fd the way the real race does. A check that passes whether or
// not the hardening is present is not a gate, it is a false positive waiting
// to be trusted, so it is left out rather than left in.
console.log("");
if (failures > 0) {
  console.error(`FAIL — ${failures} graceful-shutdown check(s) failed.`);
  if (stdout) console.error(`stdout:\n${stdout}`);
  if (stderr) console.error(`stderr:\n${stderr}`);
  process.exit(1);
}
console.log(`OK — SIGTERM drains in-flight work and exits cleanly (${exitElapsedMs}ms).`);
