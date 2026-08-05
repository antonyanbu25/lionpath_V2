/** Debug session logging — NDJSON ingest + sessionStorage ring buffer (survives prod hosts). */
const KEY = "debug-f5acac";
const REMOTE_ENDPOINT = "http://127.0.0.1:7865/ingest/46e458f7-44ce-49a5-87ef-1bb8839e9c5e";
const SESSION = "f5acac";

function ingestEndpoint() {
  if (typeof location === "undefined") return REMOTE_ENDPOINT;
  const host = location.hostname;
  if (host === "localhost" || host === "127.0.0.1") {
    return `${location.origin}/debug-ingest`;
  }
  return REMOTE_ENDPOINT;
}

/** @param {{ location: string, message: string, data?: object, hypothesisId?: string, runId?: string }} payload */
export function agentLog(payload) {
  const entry = { sessionId: SESSION, timestamp: Date.now(), ...payload };
  try {
    const arr = JSON.parse(sessionStorage.getItem(KEY) || "[]");
    arr.push(entry);
    sessionStorage.setItem(KEY, JSON.stringify(arr.slice(-100)));
  } catch {
    // private mode
  }
  if (typeof console !== "undefined" && console.info) {
    console.info("[agent:f5acac]", entry.location, entry.message, entry.data || "");
  }
  fetch(ingestEndpoint(), {
    method: "POST",
    headers: { "Content-Type": "application/json", "X-Debug-Session-Id": SESSION },
    body: JSON.stringify(entry),
  }).catch(() => {});
}

export function flushAgentLogs() {
  try {
    return JSON.parse(sessionStorage.getItem(KEY) || "[]");
  } catch {
    return [];
  }
}
