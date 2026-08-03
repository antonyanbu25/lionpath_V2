/** Debug-mode NDJSON logger — POST to ingest, fall back to workspace log file on Node. */
import { appendFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const INGEST =
  "http://127.0.0.1:7865/ingest/46e458f7-44ce-49a5-87ef-1bb8839e9c5e";
const SESSION_ID = "d8cd23";
const REPO_ROOT = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
const LOG_FILE = join(REPO_ROOT, "debug-d8cd23.log");

export function debugLog(payload: {
  runId?: string;
  hypothesisId: string;
  location: string;
  message: string;
  data?: Record<string, unknown>;
}): void {
  const line = JSON.stringify({
    sessionId: SESSION_ID,
    timestamp: Date.now(),
    ...payload,
  });
  try {
    appendFileSync(LOG_FILE, `${line}\n`, "utf8");
  } catch {
    // ignore — Workers / read-only FS
  }
  if (typeof fetch === "function") {
    fetch(INGEST, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-Debug-Session-Id": SESSION_ID,
      },
      body: line,
    }).catch(() => {});
  }
}
