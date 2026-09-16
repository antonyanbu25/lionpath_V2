/**
 * Recent news builder — company events from Gemini research, not tech signals.
 * Usage: tsx worker/scripts/test-recent-news.ts
 */

import assert from "node:assert/strict";
import { buildRecentNews } from "../src/prep/recent-news.ts";

const sources = [
  { label: "S1", title: "TechCrunch", url: "https://techcrunch.com/acme", confidence: 80 },
  { label: "S2", title: "unknown", url: "unknown", confidence: 40 },
];

const facts = [
  { key: "Series B funding", value: "Raised $45M led by Accel", sourceLabel: "S1", confidence: 80, category: "news" as const },
  { key: "Incumbent tool", value: "Zendesk Suite", sourceLabel: "S1", confidence: 80, category: "signal" as const },
  { key: "Zendesk migration", value: "Moving off legacy stack", sourceLabel: "S1", confidence: 80, category: "news" as const },
  { key: "CEO appointment", value: "New chief executive from Salesforce", sourceLabel: "S2", confidence: 40, category: "news" as const },
  { key: "Partnership", value: "Strategic alliance with Microsoft", sourceLabel: "S1", confidence: 80, category: "news" as const },
];

const news = buildRecentNews(facts, sources);
assert.equal(news.length, 2, "keeps verified news only, drops signal-like keys and low-confidence");
assert.equal(news[0].headline, "Series B funding");
assert.equal(news[0].detail, "Raised $45M led by Accel");
assert.ok(!news.some((n) => /zendesk/i.test(n.headline)), "signal-like news keys excluded");

const remappedSources = [{ label: "S1", title: "News", url: "https://techcrunch.com/acme", confidence: 80 }];
const afterCanon = buildRecentNews(
  [{ key: "Series B funding", value: "Raised $45M", sourceLabel: "S5", confidence: 80, category: "news" as const }],
  remappedSources,
);
assert.equal(afterCanon.length, 0, "prep.sources after canonicalize must not be used for lookup");

const beforeCanon = buildRecentNews(
  [{ key: "Series B funding", value: "Raised $45M", sourceLabel: "S5", confidence: 80, category: "news" as const }],
  [{ label: "S5", title: "News", url: "https://techcrunch.com/acme", confidence: 80 }],
);
assert.equal(beforeCanon.length, 1, "authoritative research sources resolve news facts");

console.log("test-recent-news.ts: ok");
