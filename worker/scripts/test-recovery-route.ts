/**
 * Worker recovery route smoke test (file backend, no Firebase).
 */

import { createFileHistoryBackend } from "../src/history-file.ts";
import { handleRecoveryUpload, handleRecoveryStatus } from "../src/routes/recovery.ts";
import { loadHistory } from "../src/history.ts";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";

const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "recovery-test-"));
const backend = createFileHistoryBackend(tmpDir);
const env = {
  HISTORY_BACKEND: backend,
  ALLOWED_EMAIL_DOMAIN: "freshworks.com",
};

const email = "se.test@freshworks.com";
const postCall = {
  id: "postCall-test-1",
  timestamp: Date.now(),
  title: "Test Co - Discovery",
  analysis: { callSummary: { headline: "Test" } },
};

const uploadReq = new Request("http://localhost/api/recovery/upload", {
  method: "POST",
  headers: { "content-type": "application/json" },
  body: JSON.stringify({
    email,
    postCalls: [postCall],
    prepBriefs: [{ id: "brief-1", title: "Prep" }],
    clientMeta: { recoveryVersion: "1" },
  }),
});

const uploadRes = await handleRecoveryUpload(uploadReq, env, new URL(uploadReq.url), {});
const uploadJson = await uploadRes.json();
if (!uploadRes.ok || uploadJson.counts?.postCalls !== 1) {
  console.error("FAIL: upload", uploadRes.status, uploadJson);
  process.exit(1);
}

const stored = await loadHistory(env, email);
if (stored.length !== 1 || stored[0].id !== postCall.id) {
  console.error("FAIL: history not merged", stored);
  process.exit(1);
}

const statusReq = new Request("http://localhost/api/recovery/status", {
  method: "GET",
});
const statusRes = await handleRecoveryStatus(statusReq, env, new URL(statusReq.url), {});
if (statusRes.status !== 403) {
  console.error("FAIL: expected 403 without auth, got", statusRes.status);
  process.exit(1);
}

console.log("PASS: test-recovery-route.ts");
await fs.rm(tmpDir, { recursive: true, force: true });
