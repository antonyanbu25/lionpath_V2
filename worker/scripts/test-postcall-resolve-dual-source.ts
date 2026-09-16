#!/usr/bin/env tsx
/**
 * v2.3 (Agent 6) — end-to-end coverage for the dual-ingest fix (Agent 1): resolve must fetch
 * a Kaia link even when a transcript was already supplied, keep the real transcript as the
 * scoring text, and never silently discard the Kaia roster/title/startTime.
 *
 * Mocks the full Kaia fetch chain (bento-page scrape + sharable-link content API) behind
 * globalThis.fetch — see mockKaiaApi() below — so this stays a fast, deterministic, no-network
 * unit test while still exercising runPostCallResolve()'s real Kaia code path end to end.
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { runPostCallResolve } from "../src/postcall/resolve.ts";

const here = dirname(fileURLToPath(import.meta.url));
const KAIA_URL =
  "https://engage.freshworks.com/kaia/share/JTdCJTIydiUyMiUzQSU3QiUyMnAlMjIlM0ElMjJNNFdvSFd6OCUyMiUyQyUyMm0lMjIlM0ElMjIwMjA2NTRiNC0xYzFkLTQzOWQtYTMwZi1mODUxMDI2MzQzZmUlM0F4cVM3ZF9BM1FxMnYyZ3VBeEVtWGVnJTIyJTJDJTIyaSUyMiUzQSUyMjU5ODIlMjIlN0QlN0Q=?";

function loadKaiaFixture(name: string) {
  return JSON.parse(readFileSync(join(here, "../testdata/kaia-fixtures", name), "utf8"));
}

const originalFetch = globalThis.fetch;

/** Mocks the bento-page scrape (soft-fails to DEFAULT_KAIA_BENTO) + the sharable-link content API. */
function mockKaiaApi(apiBody: unknown) {
  globalThis.fetch = (async (url: string) => {
    const u = String(url);
    if (u.includes("/api/public/recordings/")) {
      return new Response(JSON.stringify(apiBody), { status: 200 });
    }
    // Bento-scrape GET to the share page itself — 404 so parseKaiaShareUrl falls back to
    // DEFAULT_KAIA_BENTO, exactly like a real page that doesn't expose OUTREACH_BENTO.
    return new Response("not found", { status: 404 });
  }) as typeof fetch;
}

function restoreFetch() {
  globalThis.fetch = originalFetch;
}

const ownerId = "user_se_1";

async function testBothSourcesTogether() {
  mockKaiaApi(loadKaiaFixture("kaia-api-response-roster.json"));
  const transcript = "SE: Thanks for joining today.\nCustomer: Happy to be here, let's dig into pricing.";

  const result = await runPostCallResolve(
    {
      transcript,
      recordingUrl: KAIA_URL,
      ownerId,
    },
    {},
  );
  restoreFetch();

  assert.equal(result.transcript, transcript, "the pasted transcript is scored, never the Kaia summary");
  assert.equal(result.summaryOnly, false, "not summary-only when a real transcript is present");
  assert.ok(result.sources.kaia, "Kaia source populated even though a transcript was also supplied");
  assert.equal(result.sources.kaia!.title, "Acme Corp <> Freshworks Demo", "Kaia title kept");
  assert.equal(result.sources.kaia!.startTime, "2026-08-10T15:00:00Z", "Kaia startTime kept");
  assert.equal(result.sources.kaia!.participants.length, 3, "Kaia roster kept");
  assert.deepEqual(
    [...result.sourcesUsed].sort(),
    ["kaia_api", "pasted"].sort(),
    "sourcesUsed lists both the transcript origin and Kaia",
  );
  // Metadata merge — meetingTitle/callTime were not supplied directly, so they fall back to Kaia's.
  assert.equal(result.meetingTitle, "Acme Corp <> Freshworks Demo");
  assert.equal(result.callTime, "2026-08-10T15:00:00Z");
  console.log("testBothSourcesTogether: ok");
}

async function testSummaryOnlyCallBelowHighConfidenceThreshold() {
  mockKaiaApi(loadKaiaFixture("kaia-api-response-summary-only.json"));

  const result = await runPostCallResolve(
    {
      recordingUrl: KAIA_URL,
      ownerId,
    },
    {},
  );
  restoreFetch();

  assert.equal(result.transcript, "", "no scoring transcript when only a Kaia summary exists");
  assert.equal(result.summaryOnly, true, "flagged summaryOnly");
  assert.deepEqual(result.sourcesUsed, ["kaia_api"]);
  // Mirrors rubric-profiles.ts analysisConfidenceForVideo(false) — no video, no transcript
  // timestamps, well under HIGH_CONFIDENCE_THRESHOLD (0.7) so this call is excluded from
  // coaching aggregates until a transcript is attached.
  assert.ok(result.analysisConfidence < 0.7, `analysisConfidence ${result.analysisConfidence} must be below 0.7`);
  console.log("testSummaryOnlyCallBelowHighConfidenceThreshold: ok");
}

async function testKaiaRosterWithNoEmailsStillProducesIdentityOptions() {
  // Regression for the emailsFromKaiaParticipants bug: a roster of bare display names, no
  // emails anywhere (no participantEmails input either) — identityOptions must still surface
  // every Kaia participant, and the host must be picked up as the seIdentity hint.
  mockKaiaApi(loadKaiaFixture("kaia-api-response-roster.json"));

  const result = await runPostCallResolve(
    {
      recordingUrl: KAIA_URL,
      ownerId,
    },
    {},
  );
  restoreFetch();

  assert.equal(result.participantEmails.length, 0, "no emails anywhere in this fixture");
  for (const name of ["Priyal Shah", "Ravi Kumar", "Sunil Prasad"]) {
    assert.ok(result.identityOptions?.includes(name), `${name} present in identityOptions despite no email`);
  }
  assert.equal(result.seIdentity, "Priyal Shah", "Kaia host (isHost) wins seIdentity with no other signal");
  console.log("testKaiaRosterWithNoEmailsStillProducesIdentityOptions: ok");
}

async function main() {
  await testBothSourcesTogether();
  await testSummaryOnlyCallBelowHighConfidenceThreshold();
  await testKaiaRosterWithNoEmailsStillProducesIdentityOptions();
  console.log("test-postcall-resolve-dual-source: ok");
}

main().catch((err) => {
  restoreFetch();
  console.error(err);
  process.exit(1);
});
