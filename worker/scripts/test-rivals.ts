/**
 * Rival comparison grounding rules. Pure, no network, no LLM.
 *
 * These assert the discipline rather than the happy path: the value of this feature is that an
 * SE can trust every number, so each test names a way a number could reach the UI unearned.
 *
 * Usage: tsx worker/scripts/test-rivals.ts
 */

import assert from "node:assert/strict";

import {
  buildRivalSources,
  parseMagnitude,
  shapeRivalComparison,
  MIN_RIVALS,
  MIN_SOURCED_VALUES_PER_AXIS,
} from "../src/prep/rivals.ts";
import type { Citation } from "../src/providers/types.ts";

let checks = 0;
function ok(cond: unknown, msg: string) {
  assert.ok(cond, msg);
  checks++;
}
function eq(actual: unknown, expected: unknown, msg: string) {
  assert.deepEqual(actual, expected, msg);
  checks++;
}

// Quiet the intentional console.warn calls; failures still surface through assertions.
const origWarn = console.warn;
console.warn = () => {};

// ---------------------------------------------------------------------------
// parseMagnitude — ordering only, so a wrong parse silently reorders a range.
// ---------------------------------------------------------------------------
eq(parseMagnitude("1,200"), 1200, "comma thousands");
eq(parseMagnitude("450"), 450, "bare integer");
eq(parseMagnitude("$450M"), 450e6, "currency + M suffix");
eq(parseMagnitude("$1.2B"), 1.2e9, "decimal + B suffix");
eq(parseMagnitude("2.5bn"), 2.5e9, "bn suffix");
eq(parseMagnitude("12k"), 12e3, "k suffix");
eq(parseMagnitude("3 trillion"), 3e12, "spelled-out trillion");
eq(parseMagnitude("1,000-1,200"), 1000, "a range takes its first endpoint, never an invented average");
eq(parseMagnitude("~800"), 800, "leading tilde is tolerated in the figure itself");
eq(parseMagnitude("450 million"), 450e6, "spelled-out million");

for (const empty of ["", "-", "–", "N/A", "n/a", "unknown", "undisclosed", "TBD", "?"]) {
  eq(parseMagnitude(empty), null, `"${empty}" is absence, not a figure`);
}
eq(parseMagnitude("several hundred"), null, "prose with no digits cannot be ordered");

// ---------------------------------------------------------------------------
// buildRivalSources — the citation set is the ground truth for every claim.
// ---------------------------------------------------------------------------
const CITES: Citation[] = [
  { uri: "https://www.reuters.com/tech/a", title: "Reuters" },
  { uri: "https://techcrunch.com/b", title: "TechCrunch" },
  { uri: "https://www.reuters.com/tech/c", title: "Reuters" },
  { uri: "https://crunchbase.com/d", title: "Crunchbase" },
];

{
  const { sources, byDomain } = buildRivalSources(CITES);
  eq(
    sources.map((s) => s.domain),
    ["reuters.com", "techcrunch.com", "crunchbase.com"],
    "one source per publisher domain, in first-seen order",
  );
  eq(sources.map((s) => s.label), ["R1", "R2", "R3"], "labels are contiguous R1..Rn");
  ok(byDomain.get("reuters.com"), "domain index is keyed by bare domain");
  eq(buildRivalSources([]).sources, [], "no citations yields no sources");
  eq(buildRivalSources(undefined).sources, [], "undefined citations is not a crash");
}

/** Two rivals with two sourced axes — the baseline a real result must clear. */
function goodRaw() {
  return {
    rivals: [
      {
        name: "Alpha Co",
        why: "same segment",
        sourceDomain: "reuters.com",
        values: [
          { axisId: "supportAgents", display: "300", sourceDomain: "reuters.com" },
          { axisId: "fundingRaised", display: "$120M", sourceDomain: "crunchbase.com" },
        ],
      },
      {
        name: "Beta Co",
        why: "same segment",
        sourceDomain: "techcrunch.com",
        values: [
          { axisId: "supportAgents", display: "900", sourceDomain: "techcrunch.com" },
          { axisId: "fundingRaised", display: "$450M", sourceDomain: "crunchbase.com" },
        ],
      },
    ],
    prospectValues: [{ axisId: "supportAgents", display: "500", sourceDomain: "reuters.com" }],
  };
}

// ---------------------------------------------------------------------------
// The derived numbers must come from the sourced set, never the model.
// ---------------------------------------------------------------------------
{
  const out = shapeRivalComparison(goodRaw(), CITES);
  ok(out, "a fully sourced two-rival result must survive");
  eq(out!.rivals.length, 2, "both sourced rivals are kept");

  const agents = out!.axes.find((a) => a.id === "supportAgents");
  ok(agents, "supportAgents cleared the bar with two values");
  eq(agents!.min.numeric, 300, "min comes from the lowest sourced rival");
  eq(agents!.min.rivalName, "Alpha Co", "min names the rival it came from");
  eq(agents!.max.numeric, 900, "max comes from the highest sourced rival");
  eq(agents!.max.rivalName, "Beta Co", "max names the rival it came from");
  eq(agents!.sourcedCount, 2, "sourcedCount reports how thin the range is");
  eq(agents!.verdict, "within", "500 between 300 and 900 is within");
  eq(agents!.prospect!.display, "500", "the prospect's figure is shown as reported");

  const funding = out!.axes.find((a) => a.id === "fundingRaised");
  ok(funding, "fundingRaised cleared the bar too");
  eq(funding!.verdict, undefined, "no verdict without the prospect's own sourced figure");
  eq(funding!.prospect, undefined, "and no prospect block either");
}

// The verdict is a position in a range, so both open ends must be reachable.
{
  const below = goodRaw();
  below.prospectValues = [{ axisId: "supportAgents", display: "50", sourceDomain: "reuters.com" }];
  const out = shapeRivalComparison(below, CITES);
  eq(out!.axes.find((a) => a.id === "supportAgents")!.verdict, "below", "under the min is below");
}
{
  const above = goodRaw();
  above.prospectValues = [{ axisId: "supportAgents", display: "5,000", sourceDomain: "reuters.com" }];
  const out = shapeRivalComparison(above, CITES);
  eq(out!.axes.find((a) => a.id === "supportAgents")!.verdict, "above", "over the max is above");
}
{
  const edge = goodRaw();
  edge.prospectValues = [{ axisId: "supportAgents", display: "300", sourceDomain: "reuters.com" }];
  const out = shapeRivalComparison(edge, CITES);
  eq(
    out!.axes.find((a) => a.id === "supportAgents")!.verdict,
    "within",
    "sitting exactly on the min is within, not below — the bound is inclusive",
  );
}

// ---------------------------------------------------------------------------
// A domain the search never returned cannot launder a figure into the UI.
// ---------------------------------------------------------------------------
{
  const raw = goodRaw();
  raw.rivals[0].values[0].sourceDomain = "totally-made-up-blog.example";
  const out = shapeRivalComparison(raw, CITES);
  const agents = out!.axes.find((a) => a.id === "supportAgents");
  eq(agents, undefined, "with one value invented, supportAgents drops below the two-value bar");
  ok(
    out!.dropped.some((d) => d.includes("totally-made-up-blog.example")),
    "the invented domain is reported in dropped, not swallowed",
  );
}

// A rival is itself a claim: unsourced, it must not appear at all.
{
  const raw = goodRaw();
  raw.rivals.push({
    name: "Ghost Co",
    why: "invented",
    sourceDomain: "nowhere.example",
    values: [{ axisId: "supportAgents", display: "700", sourceDomain: "reuters.com" }],
  });
  const out = shapeRivalComparison(raw, CITES);
  ok(!out!.rivals.some((r) => r.name === "Ghost Co"), "an unsourced rival never reaches the payload");
  eq(
    out!.axes.find((a) => a.id === "supportAgents")!.max.numeric,
    900,
    "and its figure does not stretch the range it was excluded from",
  );
}

// Subdomain / www drift is the same publisher, not a failed match.
{
  const raw = goodRaw();
  raw.rivals[0].sourceDomain = "www.reuters.com";
  raw.rivals[1].values[0].sourceDomain = "blog.techcrunch.com";
  const out = shapeRivalComparison(raw, CITES);
  eq(out!.rivals.length, 2, "www. prefix still matches its publisher");
  ok(out!.axes.find((a) => a.id === "supportAgents"), "a subdomain still matches its publisher");
}

// ---------------------------------------------------------------------------
// The sourcing bars: too few rivals, or too few values, means no section.
// ---------------------------------------------------------------------------
{
  const raw = goodRaw();
  raw.rivals = [raw.rivals[0]];
  eq(
    shapeRivalComparison(raw, CITES),
    null,
    `${MIN_RIVALS} rivals are required — one company is not a comparison`,
  );
}
{
  const raw = goodRaw();
  // Strip Beta's figures: each axis now has a single sourced point.
  raw.rivals[1].values = [];
  eq(
    shapeRivalComparison(raw, CITES),
    null,
    `every axis fell under ${MIN_SOURCED_VALUES_PER_AXIS} sourced values, so there is nothing to show`,
  );
}
eq(shapeRivalComparison(goodRaw(), []), null, "no citations means nothing is traceable");
eq(shapeRivalComparison(null, CITES), null, "an unparsable answer yields no section");
eq(shapeRivalComparison({}, CITES), null, "an empty answer yields no section");

// An axis that clears the bar survives even when a sibling axis does not.
{
  const raw = goodRaw();
  raw.rivals[0].values[1].display = ""; // Alpha has no funding figure
  raw.rivals[1].values[1].display = "";
  const out = shapeRivalComparison(raw, CITES);
  ok(out, "the result stands on its surviving axis");
  eq(out!.axes.map((a) => a.id), ["supportAgents"], "only the sourced axis renders");
  ok(
    out!.dropped.some((d) => d.includes("Funding raised")),
    "the dropped axis is named, so a thinned comparison is never silent",
  );
}

// ---------------------------------------------------------------------------
// The industry-specific third axis.
// ---------------------------------------------------------------------------
{
  const raw = goodRaw() as ReturnType<typeof goodRaw> & { thirdAxis?: unknown };
  raw.thirdAxis = { id: "fleetSize", label: "Fleet size", unit: "vehicles", rationale: "scale of a mobility operator" };
  raw.rivals[0].values.push({ axisId: "fleetSize", display: "1,200", sourceDomain: "reuters.com" });
  raw.rivals[1].values.push({ axisId: "fleetSize", display: "9,000", sourceDomain: "techcrunch.com" });

  const out = shapeRivalComparison(raw, CITES);
  const fleet = out!.axes.find((a) => a.id === "fleetSize");
  ok(fleet, "a sourced third axis renders");
  eq(fleet!.label, "Fleet size", "with the model's label");
  eq(fleet!.unit, "vehicles", "and its unit");
  eq(fleet!.rationale, "scale of a mobility operator", "and its stated reasoning, so the choice is inspectable");
  eq(fleet!.max.numeric, 9000, "third-axis range is derived like any other");
}

// A value on an axis the model never declared has nowhere to go.
{
  const raw = goodRaw();
  raw.rivals[0].values.push({ axisId: "inventedAxis", display: "5", sourceDomain: "reuters.com" });
  const out = shapeRivalComparison(raw, CITES);
  ok(!out!.axes.some((a) => a.id === "inventedAxis"), "an undeclared axis id is ignored");
}

// A third axis colliding with a fixed id must not shadow it.
{
  const raw = goodRaw() as ReturnType<typeof goodRaw> & { thirdAxis?: unknown };
  raw.thirdAxis = { id: "supportAgents", label: "Agents again", rationale: "duplicate" };
  const out = shapeRivalComparison(raw, CITES);
  eq(
    out!.axes.filter((a) => a.id === "supportAgents").length,
    1,
    "a third axis reusing a fixed id is rejected rather than duplicating it",
  );
  eq(
    out!.axes.find((a) => a.id === "supportAgents")!.label,
    "Support agents",
    "and the fixed label stands",
  );
}

// ---------------------------------------------------------------------------
// The source list must match the figures actually shown.
// ---------------------------------------------------------------------------
{
  const out = shapeRivalComparison(goodRaw(), CITES);
  const cited = new Set<string>();
  for (const r of out!.rivals) {
    cited.add(r.sourceLabel);
    for (const v of Object.values(r.values)) cited.add(v.sourceLabel);
  }
  for (const a of out!.axes) if (a.prospect) cited.add(a.prospect.sourceLabel);
  eq(
    out!.sources.map((s) => s.label).sort(),
    [...cited].sort(),
    "every returned source is cited by something, and everything cited is returned",
  );
  for (const rival of out!.rivals) {
    for (const [axisId, value] of Object.entries(rival.values)) {
      ok(
        out!.sources.some((s) => s.label === value.sourceLabel),
        `${rival.name}/${axisId} cites ${value.sourceLabel}, which must exist in sources`,
      );
    }
  }
}

// Duplicate rival names would double-count a company inside the range.
{
  const raw = goodRaw();
  raw.rivals.push({ ...raw.rivals[0], name: "alpha co" });
  const out = shapeRivalComparison(raw, CITES);
  eq(out!.rivals.length, 2, "a repeated rival name is collapsed case-insensitively");
}

console.warn = origWarn;
console.log(`test-rivals.ts: ok (${checks} checks)`);
