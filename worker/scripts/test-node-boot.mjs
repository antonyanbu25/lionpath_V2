/** Smoke test: Node worker entrypoint imports without crash (catches missing exports). */
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const workerRoot = join(dirname(fileURLToPath(import.meta.url)), "..");
const npx = process.platform === "win32" ? "npx.cmd" : "npx";

const child = spawn(npx, ["tsx", "src/node-server.ts"], {
  cwd: workerRoot,
  env: { ...process.env, GEMINI_API_KEY: "test-key", HOST: "127.0.0.1", PORT: "18788" },
  stdio: ["ignore", "pipe", "pipe"],
});

let stderr = "";
child.stderr?.on("data", (d) => { stderr += String(d); });

const done = (ok) => {
  try { child.kill("SIGTERM"); } catch { /* gone */ }
  if (ok) {
    console.log("OK — worker boot smoke test passed");
    process.exit(0);
  }
  console.error("Worker boot failed:\n", stderr);
  process.exit(1);
};

const timer = setTimeout(() => done(false), 12000);

child.stdout?.on("data", (d) => {
  if (String(d).includes("listening")) {
    clearTimeout(timer);
    done(true);
  }
});

child.on("exit", (code) => {
  clearTimeout(timer);
  if (stderr.includes("SyntaxError") || stderr.includes("does not provide an export")) {
    done(false);
  }
  if (code !== 0 && code !== null) done(false);
});
