/**
 * Unit tests for Kaia share URL parsing and legacy facade compat (no live network).
 * Subsumes former scripts/test-kaia-share.ts.
 * Run: tsx scripts/test-kaia-share-parse.ts
 */

import assert from "node:assert/strict";
import {
  extractTextFromSummaryJson,
  buildKaiaSummaryText,
  buildSharableLinkUrl,
} from "../src/kaia/fetchShareContent.js";
import {
  assertKaiaEngageUrl,
  decodeKaiaShareToken as decodeToken,
  isKaiaEngageShareUrl,
  kaiaShareRefFromPayload as refFromPayload,
  resolveKaiaShareTokenSegment,
} from "../src/kaia/shareLink.js";
import { formatSummaryJson } from "../src/kaia/summaryJsonFormat.js";
import { isKaiaShareUrl, parseKaiaShareUrl } from "../src/kaiaShare.ts";

const FIXTURE_TOKEN =
  "JTdCJTIydiUyMiUzQSU3QiUyMnAlMjIlM0ElMjIxQTNMVWJacCUyMiUyQyUyMm0lMjIlM0ElMjIwMjA2NTRiNC0xYzFkLTQzOWQtYTMwZi1mODUxMDI2MzQzZmUlM0EtMW9uR0hDZ1EzeWE3cjd5QjVLcDhBJTIyJTJDJTIyaSUyMiUzQSUyMjYxMDUlMjIlN0QlN0Q=";

const LEGACY_EXAMPLE_URL =
  "https://engage.freshworks.com/kaia/share/JTdCJTIydiUyMiUzQSU3QiUyMnAlMjIlM0ElMjJNNFdvSFd6OCUyMiUyQyUyMm0lMjIlM0ElMjIwMjA2NTRiNC0xYzFkLTQzOWQtYTMwZi1mODUxMDI2MzQzZmUlM0F4cVM3ZF9BM1FxMnYyZ3VBeEVtWGVnJTIyJTJDJTIyaSUyMiUzQSUyMjU5ODIlMjIlN0QlN0Q=?";

function testLegacyFacadeParse() {
  assert.equal(isKaiaShareUrl(LEGACY_EXAMPLE_URL), true);
  assert.equal(isKaiaShareUrl("https://zoom.us/rec/share/abc"), false);

  const parsed = parseKaiaShareUrl(LEGACY_EXAMPLE_URL);
  assert.equal(parsed.linkId, "5982");
  assert.equal(parsed.orgPassword, "M4WoHWz8");
  assert.equal(parsed.meetingId, "020654b4-1c1d-439d-a30f-f851026343fe:xqS7d_A3Qq2v2guAxEmXeg");
  assert.equal(parsed.bento, "app1f");
}

function testLegacyFormatSummaryJson() {
  const sampleJson = JSON.stringify([
    {
      type: "STRING",
      name: "Outcome",
      result: { stringOutput: "Discussed filters and plan limits." },
    },
    {
      type: "LIST_KEY_POINTS",
      name: "Key points",
      result: {
        listKeyPoints: [
          {
            title: "Portal filters",
            points: [
              {
                text: "Cannot find company filters",
                sources: [{ speaker: { name: "Fatema AlBasha" } }],
              },
            ],
          },
        ],
      },
    },
  ]);

  const formatted = formatSummaryJson(sampleJson);
  assert.match(formatted, /Outcome/);
  assert.match(formatted, /Discussed filters and plan limits/);
  assert.match(formatted, /Fatema AlBasha/);
  assert.match(formatted, /Cannot find company filters/);
}

function testDecodeFixtureToken() {
  const v = decodeToken(FIXTURE_TOKEN);
  assert.equal(v.p, "1A3LUbZp");
  assert.equal(v.m, "020654b4-1c1d-439d-a30f-f851026343fe:-1onGHCgQ3ya7r7yB5Kp8A");
  assert.equal(v.i, "6105");
  const ref = refFromPayload(v, "app1f");
  assert.equal(ref.linkId, "6105");
  assert.equal(ref.password, "1A3LUbZp");
  const apiUrl = buildSharableLinkUrl(ref);
  assert.ok(apiUrl.includes("app1f.kaiafrontdoor.outreach.io"));
  assert.ok(apiUrl.includes("password=1A3LUbZp"));
}

function testAllowlist() {
  assert.throws(() => assertKaiaEngageUrl("https://evil.com/s/x"), /engage\.freshworks/);
  assert.ok(isKaiaEngageShareUrl("https://engage.freshworks.com/s/p_abc"));
  assert.ok(isKaiaEngageShareUrl(`https://engage.freshworks.com/kaia/share/${FIXTURE_TOKEN}`));
  assert.ok(!isKaiaEngageShareUrl("https://zoom.us/rec/share/x"));
}

async function testShortLinkRedirectMock() {
  const input = "https://engage.freshworks.com/s/p_test123";
  const mockFetch: typeof fetch = async (inputUrl, init) => {
    assert.equal(init?.redirect, "manual");
    return new Response(null, {
      status: 307,
      headers: {
        Location: `https://engage.freshworks.com/kaia/share/${FIXTURE_TOKEN}`,
      },
    });
  };
  const url = assertKaiaEngageUrl(input);
  const { tokenSegment } = await resolveKaiaShareTokenSegment(url, mockFetch);
  assert.equal(tokenSegment, FIXTURE_TOKEN);
}

function testSummaryJsonExtract() {
  const sample = JSON.stringify([
    {
      type: "STRING",
      name: "Outcome",
      result: { stringOutput: "Demo focused on analytics upgrade." },
    },
    {
      type: "LIST_KEY_POINTS",
      name: "Key points",
      result: {
        listKeyPoints: [{ title: "Pricing", points: [{ text: "Client asked for add-on pricing." }] }],
      },
    },
  ]);
  const text = extractTextFromSummaryJson(sample);
  assert.ok(text.includes("Demo focused on analytics"));
  assert.ok(text.includes("Client asked for add-on"));

  const built = buildKaiaSummaryText({
    id: 1,
    title: "Acme <> Demo",
    meetingSummary: "",
    structuredSummary: {},
    summaryJson: sample,
  });
  assert.ok(built.includes("Meeting: Acme <> Demo"));
  assert.ok(built.includes("Outcome"));
}

async function main() {
  testLegacyFacadeParse();
  testLegacyFormatSummaryJson();
  testDecodeFixtureToken();
  testAllowlist();
  await testShortLinkRedirectMock();
  testSummaryJsonExtract();
  console.log("test-kaia-share-parse: ok");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
