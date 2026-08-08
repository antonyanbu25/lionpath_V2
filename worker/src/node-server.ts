/**
 * Node HTTP server for VPS deployment (Docker / systemd).
 * Wraps the Cloudflare Worker fetch handler with file-based history when HISTORY_FILE_DIR is set.
 */

import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import worker from "./index";
import { createFileHistoryBackend } from "./history-file";
import { firestoreAdminBootStatus } from "./data/firestore-admin";
import { logError, logInfo } from "./logger";
import { logResolvedModels } from "./providers";
import { ffmpegAvailable, videoPassEnvEnabled } from "./video/capability";
import { sweepStaleVideoJobs } from "./video/job-sweep";
import { ffmpegMaxConcurrent } from "./video/ffmpeg-semaphore";
import type { HistoryEnv } from "./history";
import type { Env as PrepEnv } from "./prep";
import type { ZoomEnv } from "./zoom";

import type { CostControlEnv } from "./cost-control-config";

interface NodeEnv extends PrepEnv, ZoomEnv, HistoryEnv, CostControlEnv {
  ALLOWED_ORIGINS?: string;
  ALLOWED_EMAIL_DOMAIN?: string;
  FIREBASE_PROJECT_ID?: string;
  FIREBASE_SERVICE_ACCOUNT_JSON?: string;
  INTERNAL_CRON_SECRET?: string;
  VIDEO_PASS_ENABLED?: string;
  VIDEO_DATA_DIR?: string;
  DISPUTE_NOTIFY_ENABLED?: string;
  EMAIL_PROVIDER_API_KEY?: string;
  DISPUTE_NOTIFY_FROM?: string;
  FRESHDESK_API_KEY?: string;
  FRESHDESK_DOMAIN?: string;
}

const PORT = Number(process.env.PORT || 8787);
// Prefer :: so localhost resolves over IPv6 and IPv4 (macOS browsers often hit ::1 first).
const HOST = process.env.HOST || "::";

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
    FIREBASE_SERVICE_ACCOUNT_JSON: process.env.FIREBASE_SERVICE_ACCOUNT_JSON || "",
    INTERNAL_CRON_SECRET: process.env.INTERNAL_CRON_SECRET || "",
    GEMINI_API_KEY: process.env.GEMINI_API_KEY,
    ANTHROPIC_API_KEY: process.env.ANTHROPIC_API_KEY,
    ZOOM_ACCOUNT_ID: process.env.ZOOM_ACCOUNT_ID,
    ZOOM_CLIENT_ID: process.env.ZOOM_CLIENT_ID,
    ZOOM_CLIENT_SECRET: process.env.ZOOM_CLIENT_SECRET,
    ZOOM_REDIRECT_URI: process.env.ZOOM_REDIRECT_URI,
    VIDEO_PASS_ENABLED: process.env.VIDEO_PASS_ENABLED || "1",
    VIDEO_DATA_DIR: process.env.VIDEO_DATA_DIR || "/data/video",
    DAILY_TOKEN_BUDGET_ENABLED: process.env.DAILY_TOKEN_BUDGET_ENABLED || "1",
    DAILY_TOKEN_BUDGET_PER_USER: process.env.DAILY_TOKEN_BUDGET_PER_USER || "",
    DAILY_TOKEN_BUDGET_RESERVE: process.env.DAILY_TOKEN_BUDGET_RESERVE || "",
    SUMMARISE_ANOMALY_ENABLED: process.env.SUMMARISE_ANOMALY_ENABLED || "1",
    SUMMARISE_ANOMALY_MULTIPLIER: process.env.SUMMARISE_ANOMALY_MULTIPLIER || "",
    SUMMARISE_ANOMALY_BASELINE_DAYS: process.env.SUMMARISE_ANOMALY_BASELINE_DAYS || "",
    COST_ALERT_WEBHOOK_URL: process.env.COST_ALERT_WEBHOOK_URL || "",
    DISPUTE_NOTIFY_ENABLED: process.env.DISPUTE_NOTIFY_ENABLED || "",
    EMAIL_PROVIDER_API_KEY: process.env.EMAIL_PROVIDER_API_KEY || "",
    DISPUTE_NOTIFY_FROM: process.env.DISPUTE_NOTIFY_FROM || "",
    FRESHDESK_API_KEY: process.env.FRESHDESK_API_KEY || "",
    FRESHDESK_DOMAIN: process.env.FRESHDESK_DOMAIN || "janus-assist.freshdesk.com",
  };

  const historyDir = (process.env.HISTORY_FILE_DIR || "").trim();
  if (historyDir) {
    env.HISTORY_BACKEND = createFileHistoryBackend(historyDir);
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

createServer(async (req, res) => {
  const cors = corsHeadersFor(req, env);
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
}).listen(PORT, HOST, () => {
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
