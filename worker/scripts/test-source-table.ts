/**
 * Deterministic source table + fact attribution. Pure, no network, no LLM.
 * Usage: tsx worker/scripts/test-source-table.ts
 */

import assert from "node:assert/strict";

import {
  buildSourceTable,
  formatSnippetSources,
  maxSourceOffset,
  padSources,
  pruneUnreferencedSources,
  SYNTHETIC_SOURCE_CONFIDENCE,
} from "../src/prep/source-table.ts";
import { isGroundingRedirect, resolveRedirectUrls } from "../src/prep/citations.ts";
import { sourceDisplayName, sourceDomainKey } from "../src/prep/source-display.ts";
import { attachVerifiedSources } from "../src/prep/extract-facts.ts";
import { SE_SOURCE } from "../src/prep/se-context-facts.ts";
import type { ResearchFact, ResearchSnippet } from "../src/prep/types.ts";

const t = 1_700_000_000_000;
const grounded = (query: string, citations: { uri: string; title: string }[]): ResearchSnippet => ({
  query,
  snippet: `text for ${query}`,
  fetchedAt: t,
  origin: "grounded",
  citations: citations.map((c) => ({ ...c, domain: c.title, confidence: 70 })),
});

// --- sequential labelling, one label per citation ---
const table = buildSourceTable([
  grounded("q1", [
    { uri: "https://acme.com/about", title: "acme.com" },
    { uri: "https://wikipedia.org/acme", title: "wikipedia.org" },
  ]),
  grounded("q2", [{ uri: "https://acme.com/careers", title: "acme.com" }]),
]);
assert.deepEqual(
  table.sources.map((s) => s.label),
  ["S1", "S2", "S3"],
);
assert.deepEqual(table.labelsForSnippet, [["S1", "S2"], ["S3"]]);
assert.equal(table.nextSourceOffset, 3);
assert.equal(table.sources[0].url, "https://acme.com/about", "url comes from the citation");

// The same URL cited by two snippets reuses one label rather than duplicating.
const shared = buildSourceTable([
  grounded("q1", [{ uri: "https://acme.com/about", title: "acme.com" }]),
  grounded("q2", [{ uri: "https://acme.com/about", title: "acme.com" }]),
]);
assert.equal(shared.sources.length, 1, "duplicate URL gets one source entry");
assert.deepEqual(shared.labelsForSnippet, [["S1"], ["S1"]], "both snippets point at S1");

// --- offset: a second round must not re-issue S1 ---
const round2 = buildSourceTable([grounded("q3", [{ uri: "https://new.com/x", title: "new.com" }])], {
  offset: 3,
});
assert.deepEqual(round2.sources.map((s) => s.label), ["S4"]);
assert.equal(round2.nextSourceOffset, 4);

// maxSourceOffset derives that offset from an existing source list, ignoring non-S labels.
assert.equal(
  maxSourceOffset([
    { label: "S1", title: "", url: "a", confidence: 70 },
    { label: "S7", title: "", url: "b", confidence: 70 },
    { label: "SE", title: "", url: "se-context", confidence: 88 },
    { label: "R1", title: "", url: "c", confidence: 60 },
  ]),
  7,
);
assert.equal(maxSourceOffset([]), 0);

// --- synthetic sources by origin ---
const pdfTable = buildSourceTable([
  { query: "linkedin-pdf:Profile (1).pdf", snippet: "cv text", fetchedAt: t, origin: "linkedin_pdf" },
]);
assert.equal(pdfTable.sources[0].url, "linkedin-pdf:Profile (1).pdf");
assert.match(pdfTable.sources[0].title, /LinkedIn PDF/);

const webTable = buildSourceTable([
  { query: "company_web:https://acme.com/about", snippet: "about", fetchedAt: t, origin: "company_web" },
]);
assert.equal(webTable.sources[0].url, "https://acme.com/about", "company_web url parsed from query");

// A grounded snippet with NO citations must produce no source — better none than a fake one.
const uncited = buildSourceTable([
  { query: "q", snippet: "text", fetchedAt: t, origin: "grounded" },
]);
assert.equal(uncited.sources.length, 0);
assert.deepEqual(uncited.labelsForSnippet, [[]]);

// --- SE context source ---
const withSe = buildSourceTable([grounded("q1", [{ uri: "https://a.com", title: "a.com" }])], {
  seContext: true,
});
assert.ok(withSe.byLabel.has("SE"), "SE source is present when context exists");
assert.equal(withSe.byLabel.get("SE")!.url, SE_SOURCE.url);
assert.ok(!buildSourceTable([]).byLabel.has("SE"), "no SE source without context");

// --- prompt line ---
assert.match(formatSnippetSources(["S1", "S2"], table), /S1 = acme\.com \| S2 = wikipedia\.org/);
assert.match(formatSnippetSources([], table), /none/, "empty label list warns the model off");

// --- attachVerifiedSources: label resolution + sourceUrl:"unknown" fix ---
// Snippet bodies now must actually contain a fact's value, because the gate
// verifies the claim is in the named source's text (not just that the label
// resolves). The snippets below carry the values the facts assert.
const attachSnippets: ResearchSnippet[] = [
  {
    query: "q1",
    snippet: "Acme is a SaaS company; head office in London.",
    fetchedAt: t,
    origin: "grounded",
    citations: [
      { uri: "https://acme.com/about", title: "acme.com", domain: "acme.com", confidence: 70 },
      { uri: "https://wikipedia.org/acme", title: "wikipedia.org", domain: "wikipedia.org", confidence: 70 },
    ],
  },
  {
    query: "q2",
    snippet: "Acme has about 500 employees; head office in London across regions.",
    fetchedAt: t,
    origin: "grounded",
    citations: [{ uri: "https://acme.com/careers", title: "acme.com", domain: "acme.com", confidence: 70 }],
  },
];
const attachTable = buildSourceTable(attachSnippets);
const facts: ResearchFact[] = [
  { key: "Industry", value: "SaaS", sourceLabel: "S1", sourceUrl: "unknown", confidence: 90, category: "account" },
  { key: "Head office", value: "London", sourceLabel: "S3", sourceUrl: "https://hallucinated.example", confidence: 80, category: "account" },
  // Label the model invented — must be dropped, not silently kept.
  { key: "Company size", value: "500", sourceLabel: "S9", confidence: 70, category: "account" },
  // Valid label but the value is fabricated (not in S1's snippet) — must be
  // dropped by the claim-to-snippet check, the central new grounding gate.
  { key: "Industry", value: "Fintech", sourceLabel: "S1", confidence: 80, category: "account" },
];
const origWarn = console.warn;
console.warn = () => {};
const attached = attachVerifiedSources(facts, attachTable, attachSnippets);
console.warn = origWarn;

assert.equal(attached.length, 2, "fact with unknown label OR unsupported claim is dropped");
assert.equal(attached[0].sourceUrl, "https://acme.com/about", '"unknown" is overwritten from the table');
assert.equal(
  attached[1].sourceUrl,
  "https://acme.com/careers",
  "a model-invented URL is overwritten, not trusted",
);
assert.ok(
  attached.every((f) => f.sourceUrl && f.sourceUrl !== "unknown"),
  "no fact survives with an unknown sourceUrl",
);
assert.ok(
  !attached.some((f) => f.value === "Fintech"),
  "a fabricated value attached to a real label is dropped (claim-to-snippet gate)",
);
assert.deepEqual(attachVerifiedSources([], attachTable, attachSnippets), []);

// --- padSources: PREP_SCHEMA.sources minItems 3 ---
const padded = padSources([{ label: "S1", title: "acme.com", url: "https://acme.com/a", confidence: 70 }], {
  companyDomain: "acme.com",
  hasSeContext: true,
  pdfFileNames: ["Profile (1).pdf"],
});
assert.ok(padded.length >= 3, `expected >=3 sources, got ${padded.length}`);
assert.equal(new Set(padded.map((s) => s.label)).size, padded.length, "padded labels stay unique");
assert.ok(padded.some((s) => s.url === "https://acme.com"), "homepage added");
assert.ok(padded.some((s) => s.url.startsWith("linkedin-pdf:")), "pdf added");

// Already at the minimum: untouched.
const enough = [
  { label: "S1", title: "a", url: "https://a.com", confidence: 70 },
  { label: "S2", title: "b", url: "https://b.com", confidence: 70 },
  { label: "S3", title: "c", url: "https://c.com", confidence: 70 },
];
assert.deepEqual(padSources(enough, { companyDomain: "acme.com" }), enough, "no padding when already >= min");

// Padding must not duplicate a URL that is already present.
const dupeGuard = padSources([{ label: "S1", title: "acme.com", url: "https://acme.com", confidence: 70 }], {
  companyDomain: "acme.com",
  pdfFileNames: ["a.pdf", "b.pdf"],
});
assert.equal(dupeGuard.filter((s) => s.url === "https://acme.com").length, 1, "homepage not duplicated");

// --- displayName per origin ---
assert.equal(table.sources[0].displayName, "acme.com", "grounded citation -> domain");
assert.equal(pdfTable.sources[0].displayName, "LinkedIn PDF", "linkedin_pdf origin");
assert.equal(webTable.sources[0].displayName, "acme.com", "company_web http url -> domain");
assert.equal(withSe.byLabel.get("SE")!.displayName, "From your input", "SE source");

// --- sourceDisplayName / sourceDomainKey ---
assert.equal(sourceDisplayName({ url: "https://www.acme.com/a/b" }), "acme.com");
assert.equal(sourceDisplayName({ label: "SE", url: "se-context" }), "From your input");
assert.equal(sourceDisplayName({ label: "Kaia", url: "kaia-meeting" }), "Kaia");
assert.equal(sourceDisplayName({ url: "linkedin-pdf:Profile (1).pdf" }), "LinkedIn PDF");
assert.equal(sourceDisplayName({ url: "company-web" }), "Company website");
assert.equal(sourceDisplayName({ url: "orchestrator" }), "Web research");
// Gemini puts a hostname in web.title, so a bare title can be a domain.
assert.equal(sourceDisplayName({ title: "thegrocer.co.uk", url: "unknown" }), "thegrocer.co.uk");
// A prose title is truncated, not treated as a domain.
assert.equal(
  sourceDisplayName({ title: "Some Very Long Page Title Here", url: "unknown" }),
  "Some Very Long",
);
// Never empty as long as anything is set — historical sources must still render.
assert.equal(sourceDisplayName({ label: "S4", url: "unknown", title: "" }), "S4");
assert.equal(sourceDisplayName({}), "Source");
// An explicit displayName always wins.
assert.equal(sourceDisplayName({ displayName: "custom", url: "https://a.com" }), "custom");

// Domain key collapses paths and www, keeps sentinels distinct.
assert.equal(
  sourceDomainKey("https://www.acme.com/a"),
  sourceDomainKey("https://acme.com/b/c"),
  "same domain, different paths -> one key",
);
assert.notEqual(sourceDomainKey("se-context"), sourceDomainKey("company-web"));
assert.notEqual(
  sourceDomainKey("linkedin-pdf:a.pdf"),
  sourceDomainKey("linkedin-pdf:b.pdf"),
  "two PDFs are two sources",
);
assert.equal(sourceDomainKey(""), "");

// --- padSources label monotonicity (regression: old code emitted S2 after S7) ---
{
  const padded = padSources([{ label: "S7", title: "a", url: "https://a.com", confidence: 70 }], {
    companyDomain: "acme.com",
    pdfFileNames: ["p.pdf"],
  });
  const added = padded.slice(1);
  assert.ok(added.length >= 2, "padded up to the minimum");
  for (const s of added) {
    const n = Number(/^S(\d+)$/.exec(s.label)?.[1] ?? 0);
    assert.ok(n > 7, `padded label ${s.label} must be > S7, not backfilled below it`);
  }
  assert.ok(
    added.every((s) => s.displayName),
    "padded sources carry a displayName",
  );
}

// --- pruneUnreferencedSources ---
// A grounded round cites far more pages than it draws facts from; unreferenced
// entries are noise in the SE-facing citation list.
const wide = [
  { label: "S1", title: "a", url: "https://a.com", confidence: 70 },
  { label: "S2", title: "b", url: "https://b.com", confidence: 70 },
  { label: "S3", title: "c", url: "https://c.com", confidence: 70 },
  { label: "S4", title: "d", url: "https://d.com", confidence: 70 },
];
const citedFacts: ResearchFact[] = [
  { key: "k1", value: "v", sourceLabel: "S2", confidence: 70, category: "account" },
  { key: "k2", value: "v", sourceLabel: "S4", confidence: 70, category: "account" },
];
assert.deepEqual(
  pruneUnreferencedSources(wide, citedFacts).map((s) => s.label),
  ["S2", "S4"],
  "only cited sources survive",
);
// SE facts keep the SE source.
assert.deepEqual(
  pruneUnreferencedSources([...wide, SE_SOURCE], [
    { key: "k", value: "v", sourceLabel: "SE", confidence: 88, category: "signal" },
  ]).map((s) => s.label),
  ["SE"],
);
// No facts at all -> keep everything rather than returning an empty citation list.
assert.equal(pruneUnreferencedSources(wide, []).length, 4, "no facts means no pruning");

// --- resolveRedirectUrls: cap must cover a whole research round ---
{
  const origFetch = globalThis.fetch;
  let calls = 0;
  let inFlight = 0;
  let peak = 0;
  globalThis.fetch = (async (uri: string) => {
    calls++;
    inFlight++;
    peak = Math.max(peak, inFlight);
    await new Promise((r) => setTimeout(r, 1));
    inFlight--;
    const id = String(uri).split("/").pop();
    return {
      headers: { get: (h: string) => (h === "location" ? `https://real.com/${id}` : null) },
      url: uri,
    };
  }) as unknown as typeof fetch;

  try {
    // 57 citations — the count a real single round produced.
    const many = Array.from({ length: 57 }, (_, i) => ({
      uri: `https://vertexaisearch.cloud.google.com/grounding-api-redirect/A${i}`,
      domain: "",
      title: "acme.com",
      confidence: 70,
    }));
    const resolved = await resolveRedirectUrls(many);
    const stillRedirect = resolved.filter((c) => isGroundingRedirect(c.uri));
    assert.equal(stillRedirect.length, 0, "every redirect in a full round is resolved");
    assert.ok(peak <= 8, `concurrency capped, saw ${peak}`);
    assert.ok(peak > 1, "requests run in parallel");
    assert.equal(resolved[0].domain, "real.com", "domain recomputed from the resolved URL");

    // Repeats of one URI cost a single request.
    calls = 0;
    const dupes = Array.from({ length: 5 }, () => ({
      uri: "https://vertexaisearch.cloud.google.com/grounding-api-redirect/SAME",
      domain: "",
      title: "acme.com",
      confidence: 70,
    }));
    const dupeResolved = await resolveRedirectUrls(dupes);
    assert.equal(calls, 1, `identical redirects are fetched once, saw ${calls}`);
    assert.ok(dupeResolved.every((c) => c.uri === "https://real.com/SAME"));

    // Non-redirect URLs are left alone and cost nothing.
    calls = 0;
    const direct = [{ uri: "https://acme.com/a", domain: "acme.com", title: "acme.com", confidence: 70 }];
    assert.deepEqual(await resolveRedirectUrls(direct), direct);
    assert.equal(calls, 0, "no requests for already-resolved URLs");
  } finally {
    globalThis.fetch = origFetch;
  }
}

// A failing HEAD must leave the citation intact rather than dropping it.
{
  const origFetch = globalThis.fetch;
  globalThis.fetch = (async () => {
    throw new Error("network down");
  }) as unknown as typeof fetch;
  try {
    const one = [
      {
        uri: "https://vertexaisearch.cloud.google.com/grounding-api-redirect/Z",
        domain: "",
        title: "acme.com",
        confidence: 70,
      },
    ];
    assert.deepEqual(await resolveRedirectUrls(one), one, "resolution failure is non-destructive");
  } finally {
    globalThis.fetch = origFetch;
  }
}

// A padded source is constructed from the domain, never fetched. Four modules ask "is this claim
// sourced?" by comparing confidence against 55 — validate-prep (x2), recent-news, and
// word-limits' band. The synthetic entry must fail all of them, or an unverified claim renders
// with a Medium-confidence source it was never read from. This is a cross-module coupling with
// no single owner, so it is pinned here.
{
  const EVIDENCE_GATE = 55;
  assert.ok(
    SYNTHETIC_SOURCE_CONFIDENCE < EVIDENCE_GATE,
    `synthetic sources must sit below the ${EVIDENCE_GATE} evidence gate, got ${SYNTHETIC_SOURCE_CONFIDENCE}`,
  );

  const padded = padSources([], { companyDomain: "acme.com" });
  const homepage = padded.find((s) => s.url === "https://acme.com");
  assert.ok(homepage, "padSources should mint a company homepage when short of the minimum");
  assert.ok(
    (homepage.confidence ?? 0) < EVIDENCE_GATE,
    `the padded homepage must not clear the evidence gate, got ${homepage.confidence}`,
  );
  // The LinkedIn PDF is a real artefact the SE supplied, so it stays above the gate.
  const withPdf = padSources([], { companyDomain: "acme.com", pdfFileNames: ["dana.pdf"] });
  const pdf = withPdf.find((s) => String(s.url).startsWith("linkedin-pdf:"));
  assert.ok(pdf && (pdf.confidence ?? 0) >= EVIDENCE_GATE, "a supplied PDF is real evidence and must stay above the gate");
}

console.log("test-source-table.ts: ok");
