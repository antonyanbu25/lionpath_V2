/**
 * Grounded company news. Pure, no network, no LLM.
 *
 * These assert the discipline rather than the happy path: the Recent news panel previously read
 * the SE's own typed context back to them as news, so each test names a way an unearned item could
 * reach the panel.
 *
 * Usage: tsx worker/scripts/test-company-news.ts
 */

import assert from "node:assert/strict";

import { buildNewsSources, shapeCompanyNews, MAX_NEWS_ITEMS } from "../src/prep/company-news.ts";
import { buildRecentNews } from "../src/prep/recent-news.ts";
import type { Citation } from "../src/providers/types.ts";
import type { ResearchFact, SourceRef } from "../src/prep/types.ts";

let checks = 0;
const ok = (c: unknown, m: string) => {
  assert.ok(c, m);
  checks++;
};
const eq = (a: unknown, b: unknown, m: string) => {
  assert.deepEqual(a, b, m);
  checks++;
};

const origWarn = console.warn;
console.warn = () => {};

const CITES: Citation[] = [
  { uri: "https://www.reuters.com/business/a", title: "Reuters" },
  { uri: "https://techcrunch.com/b", title: "TechCrunch" },
  { uri: "https://www.reuters.com/business/c", title: "Reuters" },
];

// ---------------------------------------------------------------------------
// The citation set is the ground truth every item is checked against.
// ---------------------------------------------------------------------------
{
  const { sources, byDomain } = buildNewsSources(CITES);
  eq(sources.map((s) => s.domain), ["reuters.com", "techcrunch.com"], "one source per publisher");
  eq(sources.map((s) => s.label), ["N1", "N2"], "labels are contiguous N1..Nn");
  ok(byDomain.get("reuters.com"), "indexed by bare domain");
  eq(buildNewsSources([]).sources, [], "no citations yields no sources");
  eq(buildNewsSources(undefined).sources, [], "undefined citations is not a crash");
}

const good = () => ({
  items: [
    { headline: "Raised $40M Series B", detail: "Led by an existing investor", sourceDomain: "reuters.com" },
    { headline: "Opened a Berlin office", detail: "Second European site", sourceDomain: "techcrunch.com" },
  ],
});

{
  const out = shapeCompanyNews(good(), CITES);
  ok(out, "a fully sourced result survives");
  eq(out!.items.length, 2, "both items kept");
  eq(out!.items[0].sourceLabel, "N1", "item cites the publisher it was read from");
  eq(out!.sources.map((s) => s.label), ["N1", "N2"], "only cited sources are returned");
}

// An invented domain cannot launder an item into the panel.
{
  const raw = good();
  raw.items[1].sourceDomain = "totally-made-up-wire.example";
  const out = shapeCompanyNews(raw, CITES);
  eq(out!.items.length, 1, "the unverifiable item is dropped");
  ok(
    out!.dropped.some((d) => d.includes("totally-made-up-wire.example")),
    "and is reported in dropped, not swallowed",
  );
  eq(out!.sources.length, 1, "its source does not linger in the chip list");
}

// www / subdomain drift is the same publisher, not a failed match.
{
  const raw = good();
  raw.items[0].sourceDomain = "www.reuters.com";
  raw.items[1].sourceDomain = "eu.techcrunch.com";
  eq(shapeCompanyNews(raw, CITES)!.items.length, 2, "prefix and subdomain still match");
}

// Nothing traceable means no panel at all.
eq(shapeCompanyNews(good(), []), null, "no citations means nothing is sourced");
eq(shapeCompanyNews({ items: [] }, CITES), null, "an empty answer yields no panel");
eq(shapeCompanyNews(null, CITES), null, "an unparsable answer yields no panel");
{
  const raw = { items: [{ headline: "X", detail: "y", sourceDomain: "nowhere.example" }] };
  eq(shapeCompanyNews(raw, CITES), null, "every item unverifiable means no panel");
}

// Caps and dedupe.
{
  const many = {
    items: Array.from({ length: 8 }, (_, i) => ({
      headline: `Event number ${i}`,
      detail: "d",
      sourceDomain: "reuters.com",
    })),
  };
  eq(shapeCompanyNews(many, CITES)!.items.length, MAX_NEWS_ITEMS, `capped at ${MAX_NEWS_ITEMS}`);
  const dupes = {
    items: [
      { headline: "Same event", detail: "a", sourceDomain: "reuters.com" },
      { headline: "Same event", detail: "b", sourceDomain: "techcrunch.com" },
    ],
  };
  eq(shapeCompanyNews(dupes, CITES)!.items.length, 1, "a repeated headline is collapsed");
}

// ---------------------------------------------------------------------------
// The fallback path must not leak SE context either.
// ---------------------------------------------------------------------------
{
  const SE_SRC: SourceRef = { label: "SE", title: "SE context", url: "se-context", confidence: 88 };
  const WEB: SourceRef = { label: "S1", title: "reuters.com", url: "https://reuters.com/x", confidence: 70 };

  const seFact = {
    key: "Acme business model",
    value: "European digital bank",
    sourceLabel: "SE",
    sourceUrl: "se-context",
    confidence: 88,
    category: "news",
  } as unknown as ResearchFact;
  const webFact = {
    key: "Acme raised $40M",
    value: "Series B led by an existing investor",
    sourceLabel: "S1",
    sourceUrl: "https://reuters.com/x",
    confidence: 70,
    category: "news",
  } as unknown as ResearchFact;

  // This is the exact shape of the reported bug: an SE-sourced fact stamped category "news",
  // whose confidence (88) sails past a gate written to catch UNSOURCED claims.
  const out = buildRecentNews([seFact, webFact], [SE_SRC, WEB]);
  eq(out.length, 1, "the SE-sourced item is excluded");
  eq(out[0].sourceLabel, "S1", "only the web-sourced item survives");
  eq(
    buildRecentNews([seFact], [SE_SRC]).length,
    0,
    "SE context alone produces no news, however confident",
  );
}

console.warn = origWarn;
console.log(`test-company-news.ts: ok (${checks} checks)`);
