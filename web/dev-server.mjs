/**
 * Lightweight static dev server for the web portal (port 8788).
 * Avoids wrangler pages dev issues on Windows (npx EBUSY, bundle hangs).
 */

import { createServer } from "node:http";
import { readFile, appendFile } from "node:fs/promises";
import { join, extname, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = fileURLToPath(new URL(".", import.meta.url));
const REPO_ROOT = join(ROOT, "..");
const DEBUG_LOG = join(REPO_ROOT, "debug-f5acac.log");
const PORT = Number(process.env.PORT || 8788);
const HOST = process.env.HOST || "127.0.0.1";

const MIME = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".mjs": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".json": "application/json",
  ".ico": "image/x-icon",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".webp": "image/webp",
  ".webm": "video/webm",
  ".mp3": "audio/mpeg",
  ".ogg": "audio/ogg",
  ".wav": "audio/wav",
  ".webm": "audio/webm",
};

const server = createServer(async (req, res) => {
  try {
    let pathname = (req.url || "/").split("?")[0];

    if (req.method === "POST" && pathname === "/debug-ingest") {
      const chunks = [];
      for await (const chunk of req) chunks.push(chunk);
      const body = Buffer.concat(chunks).toString("utf8");
      await appendFile(DEBUG_LOG, `${body.trim()}\n`);
      res.writeHead(204);
      res.end();
      return;
    }

    if (pathname === "/") pathname = "/index.html";

    const filePath = join(ROOT, decodeURIComponent(pathname));
    if (!filePath.startsWith(ROOT)) {
      res.writeHead(403, { "Content-Type": "text/plain; charset=utf-8" });
      res.end("Forbidden");
      return;
    }

    const data = await readFile(filePath);
    const ext = extname(filePath).toLowerCase();
    res.writeHead(200, {
      "Content-Type": MIME[ext] || "application/octet-stream",
      "Cache-Control": "no-cache",
    });
    res.end(data);
  } catch (err) {
    if (err && err.code === "ENOENT") {
      res.writeHead(404, { "Content-Type": "text/plain; charset=utf-8" });
      res.end("Not found");
      return;
    }
    console.error("[web]", err);
    res.writeHead(500, { "Content-Type": "text/plain; charset=utf-8" });
    res.end("Server error");
  }
});

server.on("error", (err) => {
  if (err && err.code === "EADDRINUSE") {
    console.error(
      `Port ${PORT} is already in use (${HOST}). Stop the other process, e.g.:\n` +
        `  lsof -ti :${PORT} | xargs kill\n` +
        `Then run npm run dev again.`,
    );
    process.exit(1);
  }
  throw err;
});

server.listen(PORT, HOST, async () => {
  const url = `http://${HOST}:${PORT}`;
  console.log(`Web dev server ready on ${url}`);
  const workerPort = Number(process.env.WORKER_PORT || 8787);
  const workerUrl = `http://${HOST}:${workerPort}/api/config`;
  try {
    const res = await fetch(workerUrl, { signal: AbortSignal.timeout(2500) });
    if (res.ok) {
      console.log(`Worker API reachable at http://${HOST}:${workerPort}`);
    } else {
      console.warn(`Worker API returned HTTP ${res.status} — run: cd ../worker && npm run dev:node`);
    }
  } catch {
    console.warn(
      `Worker API not running on port ${workerPort}.\n` +
        `  → Second terminal: cd ../worker && npm run dev:node\n` +
        `  → Or one command: npm run dev:all`,
    );
  }
});
