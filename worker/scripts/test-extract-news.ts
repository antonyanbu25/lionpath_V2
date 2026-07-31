/**
 * News supplement helpers — focused Gemini pass on news-query snippets.
 * Usage: tsx worker/scripts/test-extract-news.ts
 */

import assert from "node:assert/strict";
import {
  hasNewsCategoryFacts,
  isNewsResearchQuery,
  newsResearchSnippets,
} from "../src/prep/extract-news.ts";

assert.equal(isNewsResearchQuery('"Acme" news OR funding'), true);
assert.equal(isNewsResearchQuery("site:acme.com support"), false);

const snippets = [
  { query: '"Acme" news OR funding', snippet: "Raised Series B", fetchedAt: 1 },
  { query: "site:acme.com about", snippet: "We make doors", fetchedAt: 1 },
];
assert.equal(newsResearchSnippets(snippets).length, 1);
assert.equal(hasNewsCategoryFacts([{ key: "Funding", value: "$45M", sourceLabel: "S1", category: "news" }]), true);
assert.equal(hasNewsCategoryFacts([{ key: "Industry", value: "Mfg", sourceLabel: "S1", category: "account" }]), false);

console.log("test-extract-news.ts: ok");
