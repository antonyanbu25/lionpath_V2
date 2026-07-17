/**
 * Node HTTP server for VPS deployment (Docker / systemd).
 * Wraps the Cloudflare Worker fetch handler with file-based history when HISTORY_FILE_DIR is set.
 */

import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import worker from "./index";
import { createFileHistoryBackend } from "./history-file";
import type { HistoryEnv } from "./history";
import type { Env as PrepEnv } from "./prep";
import type { ZoomEnv } from "./zoom";

interface NodeEnv extends PrepEnv, ZoomEnv, HistoryEnv {
  ALLOWED_ORIGINS?: string;
  ALLOWED_EMAIL_DOMAIN?: string;
  FIREBASE_PROJECT_ID?: string;
}

const PORT = Number(process.env.PORT || 8787);
const HOST = process.env.HOST || "0.0.0.0";

function buildEnv(): NodeEnv {
  const env: NodeEnv = {
    LLM_PROVIDER: process.env.LLM_PROVIDER || "gemini",
    MODEL: process.env.MODEL || "gemini-3.1-flash-lite",
    EFFORT: process.env.EFFORT || "medium",
    POSTCALL_LLM_PROVIDER: process.env.POSTCALL_LLM_PROVIDER || "gemini",
    POSTCALL_MODEL: process.env.POSTCALL_MODEL || "gemini-3.1-flash-lite",
    POSTCALL_EFFORT: process.env.POSTCALL_EFFORT || "low",
    ALLOWED_ORIGINS:
      process.env.ALLOWED_ORIGINS ||
      "http://localhost:8788,http://127.0.0.1:8788,https://portal.benjaminsquare.com",
    ALLOWED_EMAIL_DOMAIN: process.env.ALLOWED_EMAIL_DOMAIN || "freshworks.com",
    FIREBASE_PROJECT_ID: process.env.FIREBASE_PROJECT_ID || "",
    GEMINI_API_KEY: process.env.GEMINI_API_KEY,
    GOOGLE_CLOUD_PROJECT: process.env.GOOGLE_CLOUD_PROJECT,
    VERTEX_PROJECT: process.env.VERTEX_PROJECT,
    VERTEX_LOCATION: process.env.VERTEX_LOCATION,
    GOOGLE_CLOUD_LOCATION: process.env.GOOGLE_CLOUD_LOCATION,
    ANTHROPIC_API_KEY: process.env.ANTHROPIC_API_KEY,
    ZOOMINFO_API_KEY: process.env.ZOOMINFO_API_KEY,
    ZOOM_CLIENT_ID: process.env.ZOOM_CLIENT_ID,
    ZOOM_CLIENT_SECRET: process.env.ZOOM_CLIENT_SECRET,
    ZOOM_REDIRECT_URI: process.env.ZOOM_REDIRECT_URI,
  };

  const historyDir = (process.env.HISTORY_FILE_DIR || "").trim();
  if (historyDir) {
    env.HISTORY_BACKEND = createFileHistoryBackend(historyDir);
  }

  return env;
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
  try {
    const host = req.headers.host || `localhost:${PORT}`;
    const url = `http://${host}${req.url || "/"}`;
    const body = await readBody(req);
    const headers = new Headers();
    for (const [key, value] of Object.entries(req.headers)) {
      if (!value) continue;
      headers.set(key, Array.isArray(value) ? value.join(", ") : value);
    }

    const request = new Request(url, {
      method: req.method,
      headers,
      body: body ? new Uint8Array(body) : undefined,
    });

    const response = await worker.fetch(request, env);
    applyResponseHeaders(res, response.headers);
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
    console.error("[worker]", err);
    if (!res.headersSent) res.statusCode = 500;
    res.end("Internal Server Error");
  }
}).listen(PORT, HOST, () => {
  const historyDir = (process.env.HISTORY_FILE_DIR || "").trim();
  console.log(`SE Paathai worker listening on http://${HOST}:${PORT}`);
  console.log(
    historyDir
      ? `History storage: file (${historyDir})`
      : "History storage: not configured (set HISTORY_FILE_DIR)",
  );
});
