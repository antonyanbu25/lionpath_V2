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

import { buildNewsSources, shapeCompanyNews, mergeCompanyNews, MAX_NEWS_ITEMS } from "../src/prep/company-news.ts";
import { buildRecentNews } from "../src/prep/recent-news.ts";
import {
  cleanDdgText,
  companyNewsFromHits,
  extractNewsHitsFromHtml,
  isNewsLikeUrl,
} from "../src/research/providers/company-news-search.ts";
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

{
  const raw = {
    items: [{ headline: "Raised $40M Series B", detail: "Led by investor", sourceDomain: "reuters.com", publishedAt: "March 2026" }],
  };
  const out = shapeCompanyNews(raw, CITES);
  eq(out!.items[0].publishedAt, "March 2026", "preserves LLM publishedAt");
}

{
  const merged = mergeCompanyNews(
    shapeCompanyNews(
      {
        items: [{ headline: "Alpha launch", detail: "New product", sourceDomain: "reuters.com", publishedAt: "2026-01-15" }],
      },
      CITES,
    ),
    companyNewsFromHits([
      { title: "Beta funding round announced", snippet: "Details", url: "https://techcrunch.com/beta-funding", publishedAt: "2026-02-01" },
    ]),
  );
  ok(merged?.items.some((i) => i.publishedAt === "2026-01-15"), "merge keeps gemini publishedAt");
  ok(merged?.items.some((i) => i.publishedAt === "2026-02-01"), "merge keeps RSS publishedAt");
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

// Merge gemini + DDG without duplicate headlines.
{
  const gemini = {
    items: [{ headline: "Raised Series B", detail: "a", sourceLabel: "N1" }],
    sources: [{ label: "N1", domain: "reuters.com", url: "https://reuters.com/a", title: "Reuters" }],
    dropped: [],
  };
  const ddg = {
    items: [
      { headline: "Raised Series B", detail: "dup", sourceLabel: "N1", articleUrl: "https://reuters.com/a" },
      { headline: "Opened Berlin office", detail: "b", sourceLabel: "N1", articleUrl: "https://tc.com/b" },
    ],
    sources: [{ label: "N1", domain: "techcrunch.com", url: "https://tc.com/b", title: "TC" }],
    dropped: [],
  };
  const merged = mergeCompanyNews(gemini, ddg);
  eq(merged!.items.length, 2, "dedupes headline then adds ddg item");
}

// ---------------------------------------------------------------------------
// DDG HTML parser — real article URLs, no careers/login pages.
// ---------------------------------------------------------------------------
{
  ok(isNewsLikeUrl("https://techcrunch.com/foo"), "techcrunch is news-like");
  ok(!isNewsLikeUrl("https://www.linkedin.com/company/acme"), "linkedin excluded");

  const fixture = `
    <a class="result__a" href="https://techcrunch.com/acme-funding">Acme raises $40M Series B</a>
    <a class="result__snippet">Led by an existing investor with expansion plans</a>
    <a class="result__a" href="https://www.linkedin.com/jobs/view/123">Acme careers</a>
  `;
  const hits = extractNewsHitsFromHtml(fixture, 5);
  eq(hits.length, 1, "linkedin careers row skipped");
  eq(hits[0].url, "https://techcrunch.com/acme-funding", "article url kept");
  const shaped = companyNewsFromHits(hits);
  ok(shaped, "DDG hits shape into company news");
  eq(shaped!.items[0].articleUrl, "https://techcrunch.com/acme-funding", "articleUrl on item");
}

// Google News RSS descriptions embed HTML entities — must not leak into detail line.
{
  const rssDesc =
    '&lt;a href="" target="_blank"&gt;Freshworks to Deepen its IT Service&lt;/a&gt;&nbsp;&nbsp;&lt;font color="#6f6f6f"&gt;GlobeNewswire&lt;/font&gt;';
  const plain = cleanDdgText(rssDesc);
  ok(!/&lt;|<a\s|href=/i.test(plain), "entity-encoded HTML is stripped to plain text");
  const shaped = companyNewsFromHits([
    {
      title: "Freshworks to Deepen its IT Service",
      snippet: rssDesc,
      url: "https://news.google.com/rss/articles/example",
    },
  ]);
  ok(shaped?.items[0].headline, "headline kept");
  eq(shaped!.items[0].detail, "", "RSS duplicate snippet yields empty detail");
}

// ---------------------------------------------------------------------------
// T2.1 claim-in-source: a headline/detail must appear in the citation's snippet.
// The base CITES fixture carries no snippets, so the gate's `if (snippet &&...)`
// guard short-circuits and only domain-resolves is exercised. These use
// snippet-bearing citations to reach the claim-to-citation text check.
{
  const SNIPPET_CITES: Citation[] = [
    { uri: "https://www.reuters.com/business/a", title: "Reuters", snippet: "Acme raised $40M in a Series B round led by an existing investor." },
    { uri: "https://techcrunch.com/b", title: "TechCrunch", snippet: "Acme opened its second European office in Berlin this quarter." },
  ];
  // Happy path: headline content is in the snippet -> kept.
  {
    const out = shapeCompanyNews(
      {
        items: [
          { headline: "Raised $40M Series B", detail: "Led by an existing investor", sourceDomain: "reuters.com" },
          { headline: "Opened Berlin office", detail: "Second European site", sourceDomain: "techcrunch.com" },
        ],
      },
      SNIPPET_CITES,
    );
    ok(out, "snippet-supported news survives");
    eq(out!.items.length, 2, "both items kept — content is in their snippets");
  }
  // A real domain + an invented event the snippet never mentions -> dropped.
  {
    const out = shapeCompanyNews(
      {
        items: [{ headline: "Acquired rival Globex", detail: "All-stock deal", sourceDomain: "reuters.com" }],
      },
      SNIPPET_CITES,
    );
    eq(out, null, "a fabricated event on a real domain is dropped (no snippet support)");
  }
  // A headline whose figure IS in the snippet survives even if rephrased.
  {
    const out = shapeCompanyNews(
      {
        items: [{ headline: "$40M funding round", detail: "Series B led by an existing investor", sourceDomain: "reuters.com" }],
      },
      SNIPPET_CITES,
    );
    ok(out?.items.length === 1, "a figure present in the snippet survives rephrasing");
  }
}

console.warn = origWarn;
console.log(`test-company-news.ts: ok (${checks} checks)`);
