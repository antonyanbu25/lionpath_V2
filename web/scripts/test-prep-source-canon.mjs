#!/usr/bin/env node
/**
 * Mirror-drift guard: runs the SAME fixture as
 * worker/scripts/test-canonicalize-sources.ts against the web implementations.
 * If web/prep-source-canon.js or web/prep-source-display.js drifts from the worker,
 * one of the two suites fails.
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

import { canonicalizePrepSources } from "../prep-source-canon.js";
import {
  sourceDisplayName,
  sourceDomainKey,
  sourceKind,
  citationNumber,
  isLinkableSource,
  UNATTRIBUTED_LABEL,
} from "../prep-source-display.js";

const here = dirname(fileURLToPath(import.meta.url));
const cases = JSON.parse(
  readFileSync(join(here, "../../worker/testdata/source-canon/cases.json"), "utf8"),
);

for (const c of cases.displayName) {
  assert.equal(sourceDisplayName(c.in), c.out, `displayName ${JSON.stringify(c.in)}`);
}
for (const c of cases.sourceKind) {
  assert.equal(sourceKind(c.in), c.out, `sourceKind ${JSON.stringify(c.in)}`);
}
for (const c of cases.citationNumber) {
  assert.equal(citationNumber(c.label), c.out, `citationNumber ${c.label}`);
}
for (const c of cases.domainKey) {
  assert.equal(sourceDomainKey(c.a) === sourceDomainKey(c.b), c.same, `domainKey ${c.a} vs ${c.b}`);
}

for (const c of cases.canonicalize) {
  const { prep: out } = canonicalizePrepSources(c.prep);
  const e = c.expect;
  if (e.sourceLabels) assert.deepEqual(out.sources.map((s) => s.label), e.sourceLabels, c.name);
  if (e.factLabels) assert.deepEqual(out.facts.map((f) => f.sourceLabel), e.factLabels, c.name);
  if (e.signalLabels) assert.deepEqual(out.signals.map((s) => s.sourceLabel), e.signalLabels, c.name);
  if (e.prospectLabels) assert.deepEqual(out.prospects.map((p) => p.sourceLabel), e.prospectLabels, c.name);
  if (e.displayNames) {
    for (const want of e.displayNames) {
      assert.ok(out.sources.some((s) => s.displayName === want), `${c.name}: displayName ${want}`);
    }
  }
  if (e.hasSourceLabel) {
    assert.ok(out.sources.some((s) => s.label === e.hasSourceLabel), `${c.name}: has ${e.hasSourceLabel}`);
  }
  if (e.mergedConfidence !== undefined) {
    const cited = out.sources.find((s) => s.label === out.facts[0].sourceLabel);
    assert.equal(cited.confidence, e.mergedConfidence, `${c.name}: merged confidence`);
  }
}

// --- historical-brief repair: the exact case users are seeing today ---
{
  const historical = {
    sources: [
      { label: "S23", title: "Gamersheek Help Desk", url: "https://gamersheek.co.uk/help", confidence: 85 },
      { label: "S28", title: "Venditan Case Study", url: "https://venditan.com/gamersheek", confidence: 92 },
      { label: "S15", title: "WhatsOnGlasgow", url: "https://whatsonglasgow.co.uk/x", confidence: 70 },
    ],
    facts: [
      { key: "Industry", value: "Retail & E-commerce", sourceLabel: "S28" },
      { key: "Head office", value: "Glasgow", sourceLabel: "S15" },
      // R1 was never in sources[] -> rendered UNVERIFIED with a dash.
      { key: "Company size", value: "Gaming Consumers", sourceLabel: "R1" },
    ],
    signals: [{ label: "Support portal", value: "Help desk", sourceLabel: "S23" }],
    prospects: [],
  };
  const { prep: out, unresolved } = canonicalizePrepSources(historical);
  assert.deepEqual(out.sources.map((s) => s.label), ["S1", "S2", "S3", UNATTRIBUTED_LABEL]);
  assert.deepEqual(
    out.sources.slice(0, 3).map((s) => s.displayName),
    ["venditan.com", "whatsonglasgow.co.uk", "gamersheek.co.uk"],
    "chips become domains in reference order",
  );
  assert.deepEqual(unresolved, ["R1"], "R1 is reported as unresolvable, not silently reassigned");
  assert.equal(out.facts[2].sourceLabel, UNATTRIBUTED_LABEL, "R1 fact is unattributed, not credited to S1");
  const known = new Set(out.sources.map((s) => s.label));
  for (const f of out.facts) assert.ok(known.has(f.sourceLabel), `${f.sourceLabel} resolves`);
}

// --- graceful degradation: sources with no displayName still render ---
{
  const legacy = {
    sources: [{ label: "S1", title: "Acme About", url: "https://acme.com/about", confidence: 70 }],
    facts: [{ key: "Industry", value: "SaaS", sourceLabel: "S1" }],
    signals: [],
    prospects: [],
  };
  const { prep: out } = canonicalizePrepSources(legacy);
  assert.equal(out.sources[0].displayName, "acme.com", "displayName derived when absent");
  assert.ok(sourceDisplayName({ label: "S9", url: "unknown", title: "" }), "never empty");
}

// --- isLinkableSource ---
assert.equal(isLinkableSource("https://a.com"), true);
assert.equal(isLinkableSource("se-context"), false);
assert.equal(isLinkableSource("linkedin-pdf:a.pdf"), false);
assert.equal(isLinkableSource("unknown"), false);
assert.equal(isLinkableSource(""), false);

console.log(
  `test-prep-source-canon.mjs: ok (${cases.displayName.length} displayName, ${cases.canonicalize.length} canonicalize cases shared with worker)`,
);
