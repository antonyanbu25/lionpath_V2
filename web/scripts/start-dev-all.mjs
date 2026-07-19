/**
 * Start worker (8787) + web (8788) for local dev in one terminal.
 * Usage: cd web && npm run dev:all
 */
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
import { join, dirname } from "node:path";

const WEB_DIR = join(dirname(fileURLToPath(import.meta.url)), "..");
const REPO_DIR = join(WEB_DIR, "..");
const npmCmd = process.platform === "win32" ? "npm.cmd" : "npm";

function run(label, cwd, args) {
  const child = spawn(npmCmd, args, { cwd, stdio: "inherit", shell: process.platform === "win32" });
  child.on("exit", (code) => {
    if (code && code !== 0) console.error(`[dev:all] ${label} exited with code ${code}`);
  });
  return child;
}

console.log("Starting worker → http://localhost:8787");
console.log("Starting web   → http://localhost:8788");
console.log("Open http://localhost:8788 in your browser. Press Ctrl+C to stop both.\n");

const worker = run("worker", join(REPO_DIR, "worker"), ["run", "dev"]);
const web = run("web", WEB_DIR, ["run", "dev"]);

function shutdown() {
  worker.kill("SIGTERM");
  web.kill("SIGTERM");
  process.exit(0);
}

process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);
