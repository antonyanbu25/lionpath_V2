/**
 * Lightweight static dev server for the web portal (port 8788).
 * Avoids wrangler pages dev issues on Windows (npx EBUSY, bundle hangs).
 */

import { createServer } from "node:http";
import { readFile } from "node:fs/promises";
import { join, extname } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = fileURLToPath(new URL(".", import.meta.url));
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
  ".mp3": "audio/mpeg",
  ".ogg": "audio/ogg",
  ".wav": "audio/wav",
  ".webm": "audio/webm",
};

createServer(async (req, res) => {
  try {
    let pathname = (req.url || "/").split("?")[0];
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
}).listen(PORT, HOST, async () => {
  const url = `http://${HOST}:${PORT}`;
  console.log(`Web dev server ready on ${url}`);
  const workerPort = Number(process.env.WORKER_PORT || 8787);
  const workerUrl = `http://${HOST}:${workerPort}/api/config`;
  try {
    const res = await fetch(workerUrl, { signal: AbortSignal.timeout(2500) });
    if (res.ok) {
      console.log(`Worker API reachable at http://${HOST}:${workerPort}`);
    } else {
      console.warn(`Worker API returned HTTP ${res.status} — run: cd ../worker && npm run dev`);
    }
  } catch {
    console.warn(
      `Worker API not running on port ${workerPort}.\n` +
      `  → Second terminal: cd ../worker && npm run dev\n` +
      `  → Or one command: npm run dev:all`,
    );
  }
});
