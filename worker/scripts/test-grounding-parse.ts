/**
 * Grounding capture, tested against a REAL recorded gemini-3.6-flash response.
 * Fixture: worker/testdata/grounding/gemini-3.6-flash-grounded.json
 * Usage: tsx worker/scripts/test-grounding-parse.ts
 */

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

import { extractCitations } from "../src/providers/gemini.ts";
import {
  citationDomain,
  dedupeCitations,
  isGroundingRedirect,
  normalizeCitations,
  GROUNDED_CONFIDENCE,
} from "../src/prep/citations.ts";

const here = dirname(fileURLToPath(import.meta.url));
const fixture = JSON.parse(
  readFileSync(join(here, "../testdata/grounding/gemini-3.6-flash-grounded.json"), "utf8"),
);

// --- the fixture is what we think it is ---
const cand = fixture.candidates[0];
assert.ok(cand.groundingMetadata, "fixture carries groundingMetadata on candidates[0]");
const meta = cand.groundingMetadata;
assert.ok(meta.groundingChunks?.length, "fixture has groundingChunks");
assert.ok(meta.groundingSupports?.length, "fixture has groundingSupports");

// --- extractCitations over the real payload ---
const cites = extractCitations(meta);
assert.equal(cites.length, meta.groundingChunks.length, "one citation per chunk with a uri");
assert.ok(cites.length >= 5, `expected several citations, got ${cites.length}`);
assert.ok(
  cites.every((c) => c.uri && c.title),
  "every citation has a uri and title",
);
assert.ok(
  cites.some((c) => c.snippet),
  "supporting text is attached to at least one citation",
);
assert.ok(
  cites.every((c) => !c.snippet || c.snippet.length <= 300),
  "snippets are capped at 300 chars",
);

// Real responses return grounding redirects, not publisher URLs.
assert.ok(
  cites.every((c) => isGroundingRedirect(c.uri)),
  "gemini returns vertexaisearch redirects — resolution is required, not optional",
);
// And the title is a hostname rather than a page title.
assert.match(cites[0].title, /^[a-z0-9.-]+\.[a-z]{2,}$/i, "title is a hostname");

// --- degenerate inputs ---
assert.deepEqual(extractCitations(undefined), [], "no metadata -> no citations");
assert.deepEqual(extractCitations({}), [], "empty metadata -> no citations");
assert.deepEqual(
  extractCitations({ groundingChunks: [{ web: {} }, {}] }),
  [],
  "chunks without a uri are dropped",
);

// A support pointing at a chunk index that does not exist must not throw.
assert.deepEqual(
  extractCitations({
    groundingChunks: [{ web: { uri: "https://a.com", title: "a.com" } }],
    groundingSupports: [{ segment: { text: "x" }, groundingChunkIndices: [7] }],
  }),
  [{ uri: "https://a.com", title: "a.com" }],
  "out-of-range chunk index is ignored",
);

// Segment cap: 3 supports on one chunk keeps only 2.
const capped = extractCitations({
  groundingChunks: [{ web: { uri: "https://a.com", title: "a.com" } }],
  groundingSupports: [
    { segment: { text: "one" }, groundingChunkIndices: [0] },
    { segment: { text: "two" }, groundingChunkIndices: [0] },
    { segment: { text: "three" }, groundingChunkIndices: [0] },
  ],
});
assert.equal(capped[0].snippet, "one … two", "at most 2 segments are joined");

// Duplicate supporting text is not repeated.
const dupSegments = extractCitations({
  groundingChunks: [{ web: { uri: "https://a.com", title: "a.com" } }],
  groundingSupports: [
    { segment: { text: "same" }, groundingChunkIndices: [0] },
    { segment: { text: "same" }, groundingChunkIndices: [0] },
  ],
});
assert.equal(dupSegments[0].snippet, "same", "identical segments are deduped");

// --- normalizeCitations ---
const normalized = normalizeCitations(cites);
assert.equal(normalized.length, cites.length);
assert.ok(
  normalized.every((c) => c.confidence === GROUNDED_CONFIDENCE),
  "confidence is a constant — gemini returns no confidenceScores",
);
assert.deepEqual(normalizeCitations(undefined), [], "undefined -> []");

// A resolved URL wins over the redirect, and sets a real domain.
const withResolved = normalizeCitations([
  {
    uri: "https://vertexaisearch.cloud.google.com/grounding-api-redirect/ABC",
    title: "freshworks.com",
    resolvedUrl: "https://www.freshworks.com/company/about/",
  },
]);
assert.equal(withResolved[0].uri, "https://www.freshworks.com/company/about/");
assert.equal(withResolved[0].domain, "freshworks.com", "www. is stripped");

// An unresolved redirect must not report Google's hostname as the domain.
const unresolved = normalizeCitations([
  { uri: "https://vertexaisearch.cloud.google.com/grounding-api-redirect/XYZ", title: "bbc.co.uk" },
]);
assert.equal(unresolved[0].domain, "bbc.co.uk", "falls back to the provider title, not Google");

// --- citationDomain ---
assert.equal(citationDomain("https://www.acme.com/a/b"), "acme.com");
assert.equal(citationDomain("not a url", "acme.com"), "acme.com");
assert.equal(citationDomain("not a url", "Some Page Title"), "", "a prose title is not a domain");

// --- dedupeCitations ---
const deduped = dedupeCitations([
  { uri: "https://acme.com/about", domain: "acme.com", title: "acme.com", confidence: 70 },
  { uri: "https://www.acme.com/about/", domain: "acme.com", title: "acme.com", confidence: 70 },
  { uri: "https://acme.com/careers", domain: "acme.com", title: "acme.com", confidence: 70 },
]);
assert.equal(deduped.length, 2, "www and trailing slash collapse to one page");

// Dedupe keeps the resolved URL and the longer snippet.
const mergedPair = dedupeCitations([
  {
    uri: "https://vertexaisearch.cloud.google.com/grounding-api-redirect/A",
    domain: "acme.com",
    title: "acme.com",
    snippet: "short",
    confidence: 70,
  },
  {
    uri: "https://vertexaisearch.cloud.google.com/grounding-api-redirect/A",
    domain: "acme.com",
    title: "acme.com",
    snippet: "a much longer supporting segment",
    confidence: 70,
  },
]);
assert.equal(mergedPair.length, 1);
assert.equal(mergedPair[0].snippet, "a much longer supporting segment", "longer snippet wins");

// Two distinct unresolved redirects must NOT be merged — they are opaque.
assert.equal(
  dedupeCitations([
    { uri: "https://vertexaisearch.cloud.google.com/grounding-api-redirect/A", domain: "", title: "a.com", confidence: 70 },
    { uri: "https://vertexaisearch.cloud.google.com/grounding-api-redirect/B", domain: "", title: "b.com", confidence: 70 },
  ]).length,
  2,
  "distinct redirects stay distinct",
);

console.log(`test-grounding-parse.ts: ok (${cites.length} citations from fixture)`);
