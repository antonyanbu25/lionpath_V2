/**
 * Unit tests for local-storage sync (scan, diff, idempotent upload mock).
 */

import {
  scanLocalData,
  diffAgainstRemote,
  needsSyncUpdate,
  runLocalSync,
  SYNC_VERSION,
} from "../recovery/local-recovery.js";
import { storageKey } from "../history.js";

const store = new Map();
globalThis.localStorage = {
  getItem: (k) => store.get(k) ?? null,
  setItem: (k, v) => store.set(k, v),
  removeItem: (k) => store.delete(k),
};

globalThis.sessionStorage = {
  getItem: () => null,
  setItem: () => {},
  removeItem: () => {},
};

const EMAIL = "se.test@freshworks.com";
const REMOTE_ID = "postCall-remote-1";
const LOCAL_ONLY_ID = "postCall-local-aug10";

function sampleRecord(id, headline) {
  return {
    id,
    timestamp: Date.now(),
    zoomLink: "https://zoom.us/rec/test",
    title: `Acme - ${headline}`,
    analysis: {
      callSummary: { headline },
      callHeader: { company: "Acme" },
    },
    scorecard: { overall: 4, lines: [] },
  };
}

const fetchCalls = [];
let remoteEntries = [sampleRecord(REMOTE_ID, "Remote call")];

globalThis.fetch = async (url, init) => {
  fetchCalls.push({ url: String(url), init });
  const u = String(url);
  if (u.includes("/api/history?")) {
    return {
      ok: true,
      json: async () => ({ entries: remoteEntries }),
    };
  }
  if (u.includes("/api/history") && init?.method === "POST") {
    const body = JSON.parse(init.body);
    if (Array.isArray(body.entries)) {
      const byId = new Map(remoteEntries.map((r) => [r.id, r]));
      for (const e of body.entries) if (e?.id) byId.set(e.id, e);
      remoteEntries = [...byId.values()];
    }
    return {
      ok: true,
      json: async () => ({ email: body.email, count: body.entries?.length || 0 }),
      text: async () => JSON.stringify({ email: body.email, count: body.entries?.length || 0 }),
    };
  }
  if (u.includes("/api/recovery/upload")) {
    return {
      ok: true,
      json: async () => ({ counts: {}, recordIds: [] }),
      text: async () => JSON.stringify({ counts: {}, recordIds: [] }),
    };
  }
  return {
    ok: false,
    status: 404,
    json: async () => ({ error: "not found" }),
    text: async () => JSON.stringify({ error: "not found" }),
  };
};

globalThis.AbortSignal = {
  timeout: () => ({ }),
};

store.clear();
fetchCalls.length = 0;

store.set(storageKey(EMAIL), JSON.stringify([
  sampleRecord(LOCAL_ONLY_ID, "Aug10 local"),
  sampleRecord(REMOTE_ID, "Also local copy"),
]));

const bundle = scanLocalData(EMAIL);
if (bundle.postCalls.length !== 2) {
  console.error("FAIL: scanLocalData expected 2 post calls, got", bundle.postCalls.length);
  process.exit(1);
}

const localOnly = diffAgainstRemote(bundle.postCalls, [sampleRecord(REMOTE_ID, "Remote")]);
if (localOnly.length !== 1 || localOnly[0].id !== LOCAL_ONLY_ID) {
  console.error("FAIL: diffAgainstRemote", localOnly);
  process.exit(1);
}

const needed = await needsSyncUpdate(EMAIL);
if (!needed) {
  console.error("FAIL: needsSyncUpdate should be true when local-only records exist");
  process.exit(1);
}

const session = { email: EMAIL, name: "Test SE", role: "se", userId: "usr_test_se", uid: "usr_test_se", teamId: "team_test" };
const result = await runLocalSync(session, {
  onProgress: () => {},
});

if (!result.ok) {
  console.error("FAIL: runLocalSync", result);
  process.exit(1);
}

const historyPosts = fetchCalls.filter((c) => c.url.includes("/api/history") && c.init?.method === "POST");
if (!historyPosts.length) {
  console.error("FAIL: expected POST /api/history");
  process.exit(1);
}

const second = await runLocalSync(session, { onProgress: () => {} });
if (second.postCallsUploaded > 0) {
  console.error("FAIL: second run should upload 0 duplicates, got", second.postCallsUploaded);
  process.exit(1);
}

const statusRaw = localStorage.getItem(`lionpath_sync_status:${EMAIL}`);
const status = JSON.parse(statusRaw);
if (!status.completed || status.version !== SYNC_VERSION) {
  console.error("FAIL: sync status not written", status);
  process.exit(1);
}

console.log("PASS: test-local-recovery.mjs");
