/**
 * Node HTTP server for VPS deployment (Docker / systemd).
 * Wraps the Cloudflare Worker fetch handler with file-based history when HISTORY_FILE_DIR is set.
 */

import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import worker from "./index";
import { createFileHistoryBackend } from "./history-file";
import { createFirestoreHistoryBackend } from "./history-firestore";
import { firestoreAdminBootStatus, firestoreAdminReady } from "./data/firestore-admin";
import { closePool, getPool, postgresReady, type PgPool } from "./data/persistence";
import { createPostgresHistoryBackend } from "./history-pg";
import { createPostgresTasksBackend } from "./tasks-pg";
import { logError, logInfo, logWarn } from "./logger";
import { logResolvedModels } from "./providers";
import { ffmpegAvailable, videoPassEnvEnabled } from "./video/capability";
import { sweepStaleVideoJobs } from "./video/job-sweep";
import { ffmpegMaxConcurrent } from "./video/ffmpeg-semaphore";
import type { HistoryEnv } from "./history";
import type { TasksEnv } from "./tasks";
import type { Env as PrepEnv } from "./prep";
import type { ZoomEnv } from "./zoom";

import type { CostControlEnv } from "./cost-control-config";
import type { RateLimitEnv } from "./rate-limit";

interface NodeEnv extends PrepEnv, ZoomEnv, HistoryEnv, TasksEnv, CostControlEnv, RateLimitEnv {
  ALLOWED_ORIGINS?: string;
  ALLOWED_EMAIL_DOMAIN?: string;
  FIREBASE_PROJECT_ID?: string;
  FIREBASE_AUTH_ENFORCED?: string;
  FIREBASE_SERVICE_ACCOUNT_JSON?: string;
  INTERNAL_CRON_SECRET?: string;
  IMPERSONATE_SECRET?: string;
  ALLOW_DEV_IMPERSONATE?: string;
  PG_SSL_INSECURE?: string;
  VIDEO_PASS_ENABLED?: string;
  SCORECARD_GOLDEN_PASS?: string;
  VIDEO_DATA_DIR?: string;
  DISPUTE_NOTIFY_ENABLED?: string;
  EMAIL_PROVIDER_API_KEY?: string;
  DISPUTE_NOTIFY_FROM?: string;
  FRESHDESK_API_KEY?: string;
  FRESHDESK_DOMAIN?: string;
  DATABASE_URL?: string;
  PERSISTENCE_MODE?: string;
  PERSISTENCE_READ_MODE?: string;
  HISTORY_BACKEND_MODE?: string;
  PG_POOL_MAX?: string;
}

const PORT = Number(process.env.PORT || 8787);
// Prefer :: so localhost resolves over IPv6 and IPv4 (macOS browsers often hit ::1 first).
const HOST = process.env.HOST || "::";

// The Firestore Admin SDK's gRPC transport can reject a credential-resolution
// promise outside the call chain a request handler is awaiting (observed:
// GoogleAuth.getApplicationDefaultAsync rejecting when no GCP credentials are
// configured). With no handler here, that's an unhandled rejection and Node
// terminates the whole process — every connected user's session dies for one
// request's missing config, not just that request. Log and keep serving;
// the request that triggered it still gets its own error response from the
// route handler's own try/catch.
process.on("unhandledRejection", (reason) => {
  logError("unhandled rejection (process kept alive)", {
    error: reason instanceof Error ? reason.message : String(reason),
    stack: reason instanceof Error ? reason.stack : undefined,
  });
});
// Re-entrancy guard. The handler's own console write can itself throw — the
// case that actually happens is EPIPE, when whoever was reading our logs has
// gone away. Node then reports THAT as a new uncaught exception, we log again
// down the same broken pipe, and the handler re-enters itself forever:
// 100% CPU, event loop starved, process deaf to SIGTERM, and silent about all
// of it.
//
// This is not hypothetical. Two orphaned worker processes were caught in
// exactly this state during `npm test` (2026-09-11) and `sample`-ed: a
// recursive TriggerUncaughtException -> InspectorConsoleCall ->
// ErrorStackGetter stack, 1300 samples deep, unresponsive to SIGTERM. It is
// intermittent (a race against whoever holds the read end of the pipe) and
// resisted isolated reproduction, so the guard is here on the strength of the
// captured stack rather than a regression test — a test that cannot reliably
// reproduce it would only report false confidence.
//
// The flag is cleared on the next tick rather than in a finally, because a
// synchronous throw inside logError would unwind straight through a finally
// and re-arm the loop.
let handlingUncaught = false;
process.on("uncaughtException", (err) => {
  if (handlingUncaught) return;
  handlingUncaught = true;
  setImmediate(() => {
    handlingUncaught = false;
  });
  logError("uncaught exception (process kept alive)", { error: err.message, stack: err.stack });
});

// EPIPE on stdout/stderr is not an application error: it means the log reader
// went away (container teardown, a test harness exiting, `npm start | head`).
// With no 'error' listener the stream emits an unhandled error, which lands
// in the handler above — so this listener is what stops a vanished log reader
// from becoming an unkillable process. Nothing to report it to, by
// definition: the pipe we would report it on is the broken one.
for (const stream of [process.stdout, process.stderr]) {
  stream.on("error", (err: NodeJS.ErrnoException) => {
    if (err.code === "EPIPE" || err.code === "ERR_STREAM_DESTROYED") return;
  });
}

function buildEnv(): NodeEnv {
  const env: NodeEnv = {
    LLM_PROVIDER: process.env.LLM_PROVIDER || "gemini",
    MODEL: process.env.MODEL || "gemini-3.1-flash-lite",
    RESEARCH_MODEL: process.env.RESEARCH_MODEL || "",
    RESEARCH_THINKING_LEVEL: process.env.RESEARCH_THINKING_LEVEL || "medium",
    SYNTHESIZE_MODEL: process.env.SYNTHESIZE_MODEL || "",
    EFFORT: process.env.EFFORT || "medium",
    POSTCALL_LLM_PROVIDER: process.env.POSTCALL_LLM_PROVIDER || "gemini",
    POSTCALL_MODEL: process.env.POSTCALL_MODEL || "gemini-3.1-flash-lite",
    POSTCALL_EFFORT: process.env.POSTCALL_EFFORT || "low",
    ALLOWED_ORIGINS:
      process.env.ALLOWED_ORIGINS ||
      "http://localhost:8788,http://127.0.0.1:8788,https://portal.benjaminsquare.com",
    ALLOWED_EMAIL_DOMAIN: process.env.ALLOWED_EMAIL_DOMAIN || "freshworks.com",
    FIREBASE_PROJECT_ID: process.env.FIREBASE_PROJECT_ID || "",
    FIREBASE_AUTH_ENFORCED: process.env.FIREBASE_AUTH_ENFORCED || "",
    FIREBASE_SERVICE_ACCOUNT_JSON: process.env.FIREBASE_SERVICE_ACCOUNT_JSON || "",
    INTERNAL_CRON_SECRET: process.env.INTERNAL_CRON_SECRET || "",
    IMPERSONATE_SECRET: process.env.IMPERSONATE_SECRET || "",
    ALLOW_DEV_IMPERSONATE: process.env.ALLOW_DEV_IMPERSONATE || "",
    PG_SSL_INSECURE: process.env.PG_SSL_INSECURE || "",
    GEMINI_API_KEY: process.env.GEMINI_API_KEY,
    ANTHROPIC_API_KEY: process.env.ANTHROPIC_API_KEY,
    ZOOM_ACCOUNT_ID: process.env.ZOOM_ACCOUNT_ID,
    ZOOM_CLIENT_ID: process.env.ZOOM_CLIENT_ID,
    ZOOM_CLIENT_SECRET: process.env.ZOOM_CLIENT_SECRET,
    ZOOM_REDIRECT_URI: process.env.ZOOM_REDIRECT_URI,
    VIDEO_PASS_ENABLED: process.env.VIDEO_PASS_ENABLED || "1",
    SCORECARD_GOLDEN_PASS: process.env.SCORECARD_GOLDEN_PASS || "1",
    VIDEO_DATA_DIR: process.env.VIDEO_DATA_DIR || "/data/video",
    DAILY_TOKEN_BUDGET_ENABLED: process.env.DAILY_TOKEN_BUDGET_ENABLED || "1",
    DAILY_TOKEN_BUDGET_PER_USER: process.env.DAILY_TOKEN_BUDGET_PER_USER || "",
    DAILY_TOKEN_BUDGET_RESERVE: process.env.DAILY_TOKEN_BUDGET_RESERVE || "",
    SUMMARISE_ANOMALY_ENABLED: process.env.SUMMARISE_ANOMALY_ENABLED || "1",
    SUMMARISE_ANOMALY_MULTIPLIER: process.env.SUMMARISE_ANOMALY_MULTIPLIER || "",
    SUMMARISE_ANOMALY_BASELINE_DAYS: process.env.SUMMARISE_ANOMALY_BASELINE_DAYS || "",
    COST_ALERT_WEBHOOK_URL: process.env.COST_ALERT_WEBHOOK_URL || "",
    RATE_LIMIT_ENABLED: process.env.RATE_LIMIT_ENABLED || "1",
    RATE_LIMIT_PER_MINUTE: process.env.RATE_LIMIT_PER_MINUTE || "120",
    RATE_LIMIT_BURST: process.env.RATE_LIMIT_BURST || "600",
    DISPUTE_NOTIFY_ENABLED: process.env.DISPUTE_NOTIFY_ENABLED || "",
    EMAIL_PROVIDER_API_KEY: process.env.EMAIL_PROVIDER_API_KEY || "",
    DISPUTE_NOTIFY_FROM: process.env.DISPUTE_NOTIFY_FROM || "",
    FRESHDESK_API_KEY: process.env.FRESHDESK_API_KEY || "",
    FRESHDESK_DOMAIN: process.env.FRESHDESK_DOMAIN || "janus.freshdesk.com",
    DATABASE_URL: process.env.DATABASE_URL || "",
    PERSISTENCE_MODE: process.env.PERSISTENCE_MODE || "sql",
    PERSISTENCE_READ_MODE: process.env.PERSISTENCE_READ_MODE || "",
    HISTORY_BACKEND_MODE: process.env.HISTORY_BACKEND_MODE || "",
    PG_POOL_MAX: process.env.PG_POOL_MAX || "",
  };

  // --- P0 SECURITY: hard-fail boot if Firebase auth is not configured in production.
  // When FIREBASE_PROJECT_ID is empty, requireUser() returns null (not an error),
  // silently trusting client-claimed identity. This is acceptable ONLY for local dev.
  {
    const isProduction = (process.env.NODE_ENV || "").toLowerCase() === "production";
    const firebaseProjectId = (env.FIREBASE_PROJECT_ID || "").trim();
    if (isProduction && !firebaseProjectId) {
      const msg =
        "[worker] FATAL: FIREBASE_PROJECT_ID is not set in a production environment (NODE_ENV=production). " +
        "Set FIREBASE_PROJECT_ID=se-singha-paathi in deploy/vps/.env or Cloud Run --set-env-vars, " +
        "or run with NODE_ENV unset for local dev. Refusing to boot — dummy auth is a " +
        "security hole in production (client-claimed identity is trusted without verification).";
      console.error(msg);
      throw new Error(msg);
    }
    // L3 fix: FIREBASE_AUTH_ENFORCED=0 also disables token verification (dummy
    // auth). The boot guard must catch this in production too, not just a
    // missing FIREBASE_PROJECT_ID.
    const authEnforced = (env.FIREBASE_AUTH_ENFORCED || "1").trim().toLowerCase();
    const authDisabled = authEnforced === "0" || authEnforced === "false" || authEnforced === "no";
    if (isProduction && firebaseProjectId && authDisabled) {
      const msg =
        "[worker] FATAL: FIREBASE_AUTH_ENFORCED=0 in a production environment (NODE_ENV=production). " +
        "This disables Firebase token verification and trusts client-claimed identity. " +
        "Remove FIREBASE_AUTH_ENFORCED or set it to 1. Refusing to boot.";
      console.error(msg);
      throw new Error(msg);
    }
    // C2 fix: PG_SSL_INSECURE=1 disables TLS certificate verification on the
    // Postgres connection. This is only acceptable for the QA public-IP path;
    // production must use verify-full with a real CA.
    const pgSslInsecure = (env.PG_SSL_INSECURE || "").trim().toLowerCase();
    if (isProduction && (pgSslInsecure === "1" || pgSslInsecure === "true")) {
      const msg =
        "[worker] FATAL: PG_SSL_INSECURE=1 in a production environment (NODE_ENV=production). " +
        "This disables TLS certificate verification on the database connection (MITM-vulnerable). " +
        "Remove PG_SSL_INSECURE and use sslmode=verify-full with a real CA. Refusing to boot.";
      console.error(msg);
      throw new Error(msg);
    }
    // NEW-8 fix: a wildcard CORS origin combined with credentialed requests
    // lets any website make authenticated cross-origin calls. Refuse to boot.
    const allowedOrigins = (env.ALLOWED_ORIGINS || "").split(",").map((o) => o.trim());
    if (isProduction && allowedOrigins.includes("*")) {
      const msg =
        "[worker] FATAL: ALLOWED_ORIGINS contains '*' in a production environment (NODE_ENV=production). " +
        "Wildcard CORS with credentialed requests allows any origin to make authenticated calls. " +
        "Set ALLOWED_ORIGINS to an explicit comma-separated origin list. Refusing to boot.";
      console.error(msg);
      throw new Error(msg);
    }
  }

  const historyDir = (process.env.HISTORY_FILE_DIR || "").trim();
  const historyBackendMode = (env.HISTORY_BACKEND_MODE || env.PERSISTENCE_READ_MODE || "")
    .trim()
    .toLowerCase();
  if (historyBackendMode === "pg" && postgresReady(env)) {
    const lazyPool = {
      connect: async () => (await getPool(env)).connect(),
      query: async (sql: string, params?: unknown[]) => (await getPool(env)).query(sql, params),
    } as unknown as PgPool;
    env.HISTORY_BACKEND = createPostgresHistoryBackend(lazyPool);
    env.TASKS_BACKEND = createPostgresTasksBackend(lazyPool);
  } else if (historyDir) {
    env.HISTORY_BACKEND = createFileHistoryBackend(historyDir);
  } else if (firestoreAdminReady(env)) {
    // Cloud Run: use Firestore as a persistent backend (file storage is ephemeral in containers).
    env.HISTORY_BACKEND = createFirestoreHistoryBackend();
  }

  return env;
}

function corsHeadersFor(req: IncomingMessage, env: NodeEnv): Record<string, string> {
  const allowed = (env.ALLOWED_ORIGINS || "")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
  const origin = typeof req.headers.origin === "string" ? req.headers.origin : "";
  const allowOrigin = origin && allowed.includes(origin) ? origin : allowed[0] || "*";
  return {
    "Access-Control-Allow-Origin": allowOrigin,
    "Access-Control-Allow-Credentials": "true",
    "Access-Control-Allow-Headers": "Authorization, Content-Type",
    "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
  };
}

async function readBody(req: IncomingMessage): Promise<Buffer | undefined> {
  if (req.method === "GET" || req.method === "HEAD" || req.method === "OPTIONS") {
    return undefined;
  }
  const chunks: Buffer[] = [];
  for await (const chunk of req) chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
  return chunks.length ? Buffer.concat(chunks) : undefined;
}

function applyResponseHeaders(res: ServerResponse, headers: Headers): void {
  headers.forEach((value, key) => {
    if (key.toLowerCase() === "content-length") return;
    res.setHeader(key, value);
  });
}

const env = buildEnv();

// --- Graceful shutdown state; read by shutdown() further down this file ---
let inFlightRequests = 0;
let shuttingDown = false;

const server = createServer(async (req, res) => {
  const cors = corsHeadersFor(req, env);
  inFlightRequests += 1;
  res.on("close", () => {
    inFlightRequests -= 1;
    // A keep-alive socket becomes IDLE again the moment its response ends, and
    // server.close() will not resolve while it is still open. The
    // closeIdleConnections() call made when the signal arrived cannot help
    // here: this socket was mid-request at that point, so it was skipped.
    // Without this the drain always runs to its deadline and then force-closes
    // a connection that had in fact finished cleanly (measured: 6002ms and
    // drained:false for a request that completed in well under a second).
    // setImmediate so Node has finished its own keep-alive bookkeeping and
    // actually classifies this socket as idle.
    if (shuttingDown) setImmediate(() => server.closeIdleConnections());
  });
  // Once draining, tell the client not to reuse this socket. Without this a
  // keep-alive client can pipeline a *new* request onto an already-accepted
  // connection during the drain window and have it severed at the hard
  // deadline — the exact mid-flight failure the drain exists to avoid.
  if (shuttingDown && !res.headersSent) res.setHeader("Connection", "close");
  try {
    const host = req.headers.host || `localhost:${PORT}`;
    const url = new URL(req.url || "/", `http://${host}`);

    if (req.method === "OPTIONS") {
      res.statusCode = 204;
      for (const [k, v] of Object.entries(cors)) res.setHeader(k, v);
      res.end();
      return;
    }

    // Pass 2 with ffmpeg — Node only (keeps CF Worker bundle free of node:fs/child_process).
    if (req.method === "POST" && url.pathname === "/api/video-pass") {
      const { requireUser } = await import("./auth");
      const { handleVideoPassNode } = await import("./video/http");
      const raw = await readBody(req);
      const headers = new Headers();
      for (const [key, value] of Object.entries(req.headers)) {
        if (!value) continue;
        headers.set(key, Array.isArray(value) ? value.join(", ") : value);
      }
      const authReq = new Request(url.toString(), { method: "POST", headers });
      await requireUser(authReq, env);
      // --- P2-2: Per-request rate limiter for Node-intercepted routes ---
      const { checkRateLimit, clientIpFromRequest, extractUidForRateLimit } = await import(
        "./rate-limit"
      );
      const rateLimitResult = checkRateLimit(
        extractUidForRateLimit(authReq),
        clientIpFromRequest(authReq),
        env,
      );
      if (rateLimitResult) {
        res.statusCode = 429;
        for (const [k, v] of Object.entries(cors)) res.setHeader(k, v);
        res.setHeader("Retry-After", String(rateLimitResult.retryAfter));
        res.setHeader("X-RateLimit-Limit", String(rateLimitResult.limit));
        res.setHeader("X-RateLimit-Remaining", "0");
        res.setHeader("X-RateLimit-Reset", String(rateLimitResult.resetAt));
        res.setHeader("content-type", "application/json; charset=utf-8");
        res.end(
          JSON.stringify({
            error: "Rate limit exceeded. Too many requests. Please slow down and retry shortly.",
            code: "RATE_LIMIT_EXCEEDED",
            retryAfter: rateLimitResult.retryAfter,
          }),
        );
        return;
      }
      const parsed = raw?.length ? JSON.parse(Buffer.from(raw).toString("utf8")) : {};
      const { status, payload } = await handleVideoPassNode(parsed, env);
      const bodyOut = JSON.stringify(payload);
      res.statusCode = status;
      for (const [k, v] of Object.entries(cors)) res.setHeader(k, v);
      res.setHeader("content-type", "application/json; charset=utf-8");
      res.end(bodyOut);
      return;
    }

    const body = await readBody(req);
    const headers = new Headers();
    for (const [key, value] of Object.entries(req.headers)) {
      if (!value) continue;
      headers.set(key, Array.isArray(value) ? value.join(", ") : value);
    }

    const request = new Request(url.toString(), {
      method: req.method,
      headers,
      body: body ? new Uint8Array(body) : undefined,
    });

    const response = await worker.fetch(request, env);
    applyResponseHeaders(res, response.headers);
    // Ensure browser can read error bodies even if the Worker omitted CORS.
    for (const [k, v] of Object.entries(cors)) {
      if (!res.hasHeader(k)) res.setHeader(k, v);
    }
    res.statusCode = response.status;

    if (response.body) {
      const reader = response.body.getReader();
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        res.write(value);
      }
    }
    res.end();
  } catch (err) {
    logError("node-server request failed", { error: err instanceof Error ? err.message : String(err) });
    if (!res.headersSent) {
      res.statusCode = (err as { status?: number }).status || 500;
      for (const [k, v] of Object.entries(cors)) res.setHeader(k, v);
      res.setHeader("content-type", "application/json; charset=utf-8");
      res.end(JSON.stringify({ error: err instanceof Error ? err.message : "Internal Server Error" }));
      return;
    }
    res.end();
  }
});

// ---------------------------------------------------------------------------
// Graceful shutdown (roadmap 3.6)
//
// Cloud Run sends SIGTERM to the container on every revision change, then
// SIGKILLs it after its grace period (10s by default). Before this handler
// existed there was no SIGTERM listener anywhere in the worker, so Node's
// DEFAULT signal action applied: terminate immediately. That severs every
// in-flight response mid-body (the client sees a truncated/reset connection,
// not a 503 it can retry on) and abandons the pooled PostgreSQL connections
// without ending them, leaving the server side to discover the dead sockets
// on its own. Both are silent, deploy-shaped failures.
//
// Budget: 8s total, deliberately 2s under Cloud Run's 10s default. The
// headroom is not padding — the 10s clock starts when Cloud Run *sends* the
// signal, not when this handler starts running, and the final log lines still
// have to be flushed to stdout before the process leaves. A handler that
// overruns is SIGKILLed and takes its own diagnostics with it, which is
// strictly worse than having no handler at all: you lose both the requests
// AND the evidence. Every step below is therefore individually bounded, and
// nothing here is allowed to block the exit.
// ---------------------------------------------------------------------------
const SHUTDOWN_BUDGET_MS = 8_000;
/** In-flight requests get most of the budget; they are the user-visible part. */
const DRAIN_BUDGET_MS = 6_000;
const POOL_CLOSE_BUDGET_MS = 1_500;
const STDIO_FLUSH_BUDGET_MS = 250;

/** Resolve `fallback` if `p` has not settled within `ms`. Never rejects. */
function withDeadline<T>(p: Promise<T>, ms: number, fallback: T): Promise<T> {
  return new Promise<T>((resolve) => {
    const timer = setTimeout(() => resolve(fallback), ms);
    p.then(
      (v) => {
        clearTimeout(timer);
        resolve(v);
      },
      () => {
        clearTimeout(timer);
        resolve(fallback);
      },
    );
  });
}

/**
 * process.exit() discards data still buffered in stdout/stderr when they are
 * pipes (which they are under Cloud Run, Docker and any test harness), so the
 * shutdown log lines can vanish at the moment they matter most. Give the
 * kernel a bounded chance to take them first.
 */
function flushStdio(): Promise<void> {
  const flushOne = (stream: NodeJS.WriteStream) =>
    new Promise<void>((resolve) => {
      try {
        if (stream.destroyed || !stream.writableLength) {
          resolve();
          return;
        }
        stream.write("", () => resolve());
      } catch {
        resolve(); // nothing is reading; that is not worth delaying the exit
      }
    });
  return withDeadline(
    Promise.all([flushOne(process.stdout), flushOne(process.stderr)]).then(() => undefined),
    STDIO_FLUSH_BUDGET_MS,
    undefined,
  );
}

async function shutdown(signal: string): Promise<void> {
  // Idempotence: Cloud Run can repeat SIGTERM, and a local Ctrl-C is easy to
  // hit twice. A second signal must be an observable no-op, not a second
  // drain (which would double-close the pool and throw).
  if (shuttingDown) {
    logWarn("graceful shutdown: signal ignored, already draining", { signal });
    return;
  }
  shuttingDown = true;
  const startedAt = Date.now();
  logInfo("graceful shutdown: signal received", {
    signal,
    inFlightRequests,
    budgetMs: SHUTDOWN_BUDGET_MS,
  });

  // Hard watchdog. If any step below wedges (a socket that never closes, a
  // pool client stuck in a query), exit anyway with a non-zero code and a log
  // line rather than waiting for SIGKILL to erase both.
  const watchdog = setTimeout(() => {
    try {
      logError("graceful shutdown: budget exceeded, forcing exit", {
        signal,
        elapsedMs: Date.now() - startedAt,
        inFlightRequests,
      });
    } catch {
      /* nowhere left to log; exiting is still the right move */
    }
    void flushStdio().then(
      () => process.exit(1),
      () => process.exit(1),
    );
  }, SHUTDOWN_BUDGET_MS);

  let exitCode = 0;
  let drained = false;
  try {
    // Stop accepting new connections. server.close() only waits for existing
    // ones, so idle keep-alive sockets must be released explicitly or the
    // close callback would sit there until their timeout — long past SIGKILL.
    const closed = new Promise<void>((resolve) => server.close(() => resolve()));
    server.closeIdleConnections();
    drained = await withDeadline(closed.then(() => true), DRAIN_BUDGET_MS, false);
    if (!drained) {
      // Bounded grace is the contract, so this is degraded-but-expected, not
      // an error: the alternative is being SIGKILLed with the pool still open.
      logWarn("graceful shutdown: drain deadline hit, closing remaining connections", {
        signal,
        inFlightRequests,
        drainBudgetMs: DRAIN_BUDGET_MS,
      });
      server.closeAllConnections();
    }

    // Drain the PostgreSQL pool last, once no request can still need a client.
    const poolClosed = await withDeadline(
      closePool().then(() => true),
      POOL_CLOSE_BUDGET_MS,
      false,
    );
    if (!poolClosed) {
      logError("graceful shutdown: postgres pool did not close within budget", {
        signal,
        poolCloseBudgetMs: POOL_CLOSE_BUDGET_MS,
      });
      exitCode = 1;
    }
  } catch (err) {
    logError("graceful shutdown failed", {
      signal,
      error: err instanceof Error ? err.message : String(err),
      stack: err instanceof Error ? err.stack : undefined,
    });
    exitCode = 1;
  }

  clearTimeout(watchdog);
  try {
    logInfo("graceful shutdown: complete", {
      signal,
      elapsedMs: Date.now() - startedAt,
      drained,
      exitCode,
    });
    await flushStdio();
  } catch {
    // A broken log pipe must never be the reason we fail to exit.
  }
  process.exit(exitCode);
}

// SIGINT as well as SIGTERM: local dev runs this under Ctrl-C, and leaking a
// pool there is how you find out the hard way that the handler never worked.
//
// The .catch is not decoration. `void shutdown(signal)` would route a throw
// in here to the unhandledRejection handler above, which by design keeps the
// process ALIVE — so the one bug that handler cannot absorb is a failure in
// the code whose job is to exit. Exit non-zero instead of lingering.
for (const signal of ["SIGTERM", "SIGINT"] as const) {
  process.on(signal, () => {
    shutdown(signal).catch((err) => {
      try {
        logError("graceful shutdown handler threw, exiting anyway", {
          signal,
          error: err instanceof Error ? err.message : String(err),
        });
      } catch {
        /* nowhere left to log */
      }
      process.exit(1);
    });
  });
}

server.listen(PORT, HOST, () => {
  const historyDir = (process.env.HISTORY_FILE_DIR || "").trim();
  logResolvedModels(env);
  logInfo("SE Paathai worker listening", { host: HOST, port: PORT });
  logInfo(
    historyDir ? "History storage configured" : "History storage not configured",
    historyDir ? { historyDir } : { hint: "set HISTORY_FILE_DIR" },
  );
  const passEnabled = videoPassEnvEnabled(env);
  void ffmpegAvailable().then((ffmpegOk) => {
    logInfo("Video Pass 2 status", {
      enabled: passEnabled,
      videoDataDir: process.env.VIDEO_DATA_DIR || "/data/video",
      ffmpeg: ffmpegOk ? "ok" : "MISSING",
      ffmpegMaxConcurrent: ffmpegMaxConcurrent(),
    });
  });
  void sweepStaleVideoJobs().then(({ removed, scanned }) => {
    if (removed > 0) {
      logInfo("Video job sweep completed", { removed, scanned });
    }
  });
  void firestoreAdminBootStatus(env).then((line) => logInfo(line));
});
