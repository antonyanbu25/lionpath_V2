/**
 * Start worker (8787) + web (8788) for local dev in one terminal.
 * Waits for worker /api/config before starting web to avoid false "API down" on first load.
 * Usage: cd web && npm run dev:all
 */
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
import { join, dirname } from "node:path";

const WEB_DIR = join(dirname(fileURLToPath(import.meta.url)), "..");
const REPO_DIR = join(WEB_DIR, "..");
const npmCmd = process.platform === "win32" ? "npm.cmd" : "npm";
const WORKER_PORT = Number(process.env.WORKER_PORT || 8787);

function run(label, cwd, args) {
  const child = spawn(npmCmd, args, { cwd, stdio: "inherit", shell: process.platform === "win32" });
  child.on("exit", (code) => {
    if (code && code !== 0) console.error(`[dev:all] ${label} exited with code ${code}`);
  });
  return child;
}

async function isWorkerReady() {
  const url = `http://127.0.0.1:${WORKER_PORT}/api/config`;
  try {
    const res = await fetch(url, { signal: AbortSignal.timeout(2500) });
    return res.ok;
  } catch {
    return false;
  }
}

async function waitForWorkerReady(maxMs = 120_000) {
  const deadline = Date.now() + maxMs;
  while (Date.now() < deadline) {
    if (await isWorkerReady()) return true;
    await new Promise((r) => setTimeout(r, 600));
  }
  return false;
}

console.log("Checking worker API on http://localhost:" + WORKER_PORT);

let worker = null;
const workerAlreadyRunning = await isWorkerReady();

if (workerAlreadyRunning) {
  console.log(`Worker already running on port ${WORKER_PORT} — not starting a second instance.\n`);
} else {
  console.log("Starting worker → http://localhost:" + WORKER_PORT);
  worker = run("worker", join(REPO_DIR, "worker"), ["run", "dev:node"]);
  const ready = await waitForWorkerReady();
  if (ready) {
    console.log(`Worker API ready at http://localhost:${WORKER_PORT}\n`);
  } else {
    console.warn(
      `[dev:all] Worker did not respond on port ${WORKER_PORT} within 120s.\n` +
        "  → Check worker terminal for errors (e.g. missing worker/.dev.vars GEMINI_API_KEY).\n" +
        "  → Web will start anyway; the UI rechecks every 5s until the worker is up.\n",
    );
  }
}

console.log("Starting web   → http://localhost:8788");
console.log("Open http://localhost:8788 in your browser. Press Ctrl+C to stop both.\n");

const web = run("web", WEB_DIR, ["run", "dev"]);

function shutdown() {
  web.kill("SIGTERM");
  if (worker) worker.kill("SIGTERM");
  process.exit(0);
}

process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);
