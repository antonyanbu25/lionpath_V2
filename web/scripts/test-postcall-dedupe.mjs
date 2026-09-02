import assert from "node:assert/strict";
import {
  savePostCallAnalysis,
  listPostCallAnalyses,
  storageKey,
} from "../history.js";

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

globalThis.AbortSignal = {
  timeout: () => ({}),
};

const remoteWrites = [];
globalThis.fetch = async (url, init = {}) => {
  remoteWrites.push({ url: String(url), init });
  return { ok: true, json: async () => ({ ok: true }) };
};

const EMAIL = "se.test@freshworks.com";
const ZOOM = "https://freshworks.zoom.us/rec/share/OngridUseCase123?pwd=secret";

function resultFixture(headline = "Use case discussion") {
  return {
    analysis: {
      callHeader: { title: headline, company: "Ongrid" },
      callSummary: { headline },
    },
    transcriptMeta: { wordCount: 2390 },
    analysisMeta: { callType: "discovery" },
    scorecard: { overall: 7, lines: [] },
  };
}

function delay(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

store.clear();
remoteWrites.length = 0;

let domainWrites = 0;
const first = savePostCallAnalysis(
  EMAIL,
  { recordingUrl: ZOOM, companyName: "Ongrid", callType: "discovery" },
  resultFixture(),
  {
    beforePersist: async () => {
      domainWrites += 1;
      await delay(25);
      return { postCall: { id: "call_domain_ongrid_1", dealId: "deal_1", accountId: "acct_1" }, accountId: "acct_1" };
    },
  },
);
const second = savePostCallAnalysis(
  EMAIL,
  { recordingUrl: ZOOM, companyName: "Ongrid", callType: "discovery" },
  resultFixture(),
  {
    beforePersist: async () => {
      domainWrites += 1;
      return { postCall: { id: "call_domain_ongrid_2" } };
    },
  },
);

const [a, b] = await Promise.all([first, second]);
assert.equal(domainWrites, 1, "double-submit should perform one domain write");
assert.equal(a.id, "call_domain_ongrid_1");
assert.equal(b.id, "call_domain_ongrid_1");
const saved = listPostCallAnalyses(EMAIL);
assert.equal(saved.length, 1, "double-submit should append one completed history record");
assert.equal(saved[0].id, "call_domain_ongrid_1");
assert.equal(saved[0].zoomLink, ZOOM);
assert.equal(remoteWrites.filter((c) => c.url.includes("/api/history")).length, 1);

store.clear();
remoteWrites.length = 0;

await assert.rejects(
  savePostCallAnalysis(
    EMAIL,
    { recordingUrl: ZOOM, companyName: "Ongrid", callType: "discovery" },
    resultFixture("Failed write"),
    {
      beforePersist: async () => {
        throw new Error("domain-write unavailable");
      },
    },
  ),
  /domain-write unavailable/,
);

assert.equal(listPostCallAnalyses(EMAIL).length, 0, "failed domain write must not append completed history");
assert.equal(localStorage.getItem(storageKey(EMAIL)), null);
assert.equal(remoteWrites.length, 0, "failed domain write must not push history blob");
assert.ok(
  [...store.keys()].some((k) => k.startsWith("lionpath:pending-call:")),
  "failed domain write should leave a pending local marker",
);

console.log("test-postcall-dedupe.mjs: ok");
