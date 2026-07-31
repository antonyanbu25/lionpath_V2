/**
 * Source provenance correctness. Several of these assertions FAIL against the
 * pre-canonicalisation build — that is the point.
 * Usage: tsx worker/scripts/test-canonicalize-sources.ts
 */

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

import { canonicalizePrepSources, MAX_PREP_SOURCES } from "../src/prep/canonicalize-sources.ts";
import {
  UNATTRIBUTED_LABEL,
  citationNumber,
  sourceDisplayName,
  sourceDomainKey,
  sourceKind,
} from "../src/prep/source-display.ts";
import { normalizePrepOutput } from "../src/word-limits.ts";
import type { Prep, PrepSource } from "../src/schema.ts";

const origWarn = console.warn;
console.warn = () => {};

const src = (label: string, url: string, confidence = 70, title = ""): PrepSource => ({
  label,
  title: title || label,
  url,
  confidence,
});

/** Minimal Prep skeleton; only the fields the canonicaliser touches matter. */
function prep(over: Partial<Prep>): Prep {
  return {
    description: "d",
    about: "a",
    incumbent: { incumbent_name: "unknown", displacement: "greenfield" },
    fitSnapshot: [],
    facts: [],
    signals: [],
    likelyPains: [],
    industryUseCases: [],
    checklist: [],
    companySizeAgents: { agents: "unknown", estimated: false },
    businessContext: {},
    discoveryKit: [],
    painCapabilityValue: [],
    prospects: [],
    sources: [],
    ...over,
  } as unknown as Prep;
}

// ---------------------------------------------------------------------------
// A. The positional guess. FAILS against the old pickSourceLabel.
// ---------------------------------------------------------------------------
{
  // 9 distinct-domain sources; the fact cites the 9th, which the old code sliced away.
  const sources = Array.from({ length: 9 }, (_, i) => src(`S${i + 1}`, `https://d${i + 1}.com/p`));
  const out = normalizePrepOutput(
    prep({
      sources,
      facts: [{ key: "Industry", value: "SaaS", sourceLabel: "S9" }],
    } as Partial<Prep>),
    { authoritative: sources },
  );

  const fact = out.facts[0];
  const resolved = out.sources.find((s) => s.label === fact.sourceLabel);
  assert.ok(resolved, "the fact's label resolves to a real source");
  assert.equal(
    resolved!.url,
    "https://d9.com/p",
    "fact keeps its TRUE source — old code returned sources[0] (d1.com) after slicing to 8",
  );
  assert.notEqual(fact.sourceLabel, "S1", "must not be positionally reassigned to the first source");
}

// A2. A row with a label that matches nothing must NOT inherit a neighbour's source.
{
  const sources = [src("S1", "https://a.com"), src("S2", "https://b.com"), src("S3", "https://c.com")];
  const out = normalizePrepOutput(
    prep({ sources, facts: [{ key: "Industry", value: "SaaS", sourceLabel: "S77" }] } as Partial<Prep>),
    { authoritative: sources },
  );
  assert.equal(
    out.facts[0].sourceLabel,
    UNATTRIBUTED_LABEL,
    "unresolvable label becomes unattributed, never a guess",
  );
  assert.ok(
    !["S1", "S2", "S3"].includes(out.facts[0].sourceLabel),
    "must not claim a real publisher it has no basis for",
  );
}

// A3. The two call sites that passed `preferred: undefined` fabricated a citation.
{
  const sources = [src("S1", "https://a.com"), src("S2", "https://b.com"), src("S3", "https://c.com")];
  // No facts -> the businessContext fallback path builds rows with no declared source.
  const out = normalizePrepOutput(
    prep({ sources, facts: [], businessContext: { market: "Retail" } } as Partial<Prep>),
    { authoritative: sources },
  );
  assert.ok(
    out.facts.every((f) => f.sourceLabel === UNATTRIBUTED_LABEL),
    "fallback rows with no declared source are unattributed, not credited to sources[i]",
  );
}

// ---------------------------------------------------------------------------
// B. Contiguity. FAILS against the old build (gaps passed straight through).
// ---------------------------------------------------------------------------
{
  // The real observed output: sparse labels from prune + gap-round offsets.
  const sources = [
    src("S15", "https://saviuk.co.uk/about"),
    src("S23", "https://help.saviuk.co.uk/"),
    src("S26", "https://updates.saviuk.co.uk/"),
    src("S28", "https://venditan.com/case"),
    src("S31", "https://privacy.example.com/"),
  ];
  const { prep: out } = canonicalizePrepSources(
    prep({
      sources,
      facts: [
        { key: "Industry", value: "Retail", sourceLabel: "S28" },
        { key: "Head office", value: "Glasgow", sourceLabel: "S15" },
      ],
      signals: [{ label: "Support portal", value: "Help desk", sourceLabel: "S23" }],
    } as Partial<Prep>),
  );

  const labels = out.sources.map((s) => s.label);
  assert.deepEqual(labels, ["S1", "S2", "S3", "S4", "S5"], "labels are contiguous S1..Sn");
  assert.equal(new Set(labels).size, labels.length, "no duplicate labels");

  // Numbering follows reference order: S28 was cited first, so it becomes S1.
  assert.equal(out.facts[0].sourceLabel, "S1");
  assert.equal(
    out.sources.find((s) => s.label === "S1")!.url,
    "https://venditan.com/case",
    "S1 is the first-referenced source, and keeps its real url",
  );

  const known = new Set(labels);
  for (const f of out.facts) assert.ok(known.has(f.sourceLabel), `fact label ${f.sourceLabel} in sources`);
  for (const s of out.signals) assert.ok(known.has(s.sourceLabel), `signal label ${s.sourceLabel} in sources`);
}

// ---------------------------------------------------------------------------
// C. Orphan promotion. FAILS today — these labels were never in sources[].
// ---------------------------------------------------------------------------
for (const orphan of ["Kaia", "Zoom", "LinkedIn + Kaia", "LinkedIn PDF", "Orchestrator", "SE"]) {
  const { prep: out } = canonicalizePrepSources(
    prep({
      sources: [src("S1", "https://a.com"), src("S2", "https://b.com"), src("S3", "https://c.com")],
      prospects: [{ name: "Emma", role: "CS Manager", sourceLabel: orphan }],
    } as Partial<Prep>),
  );
  const entry = out.sources.find((s) => s.label === orphan);
  assert.ok(entry, `${orphan} is promoted into sources[]`);
  // Mirrors web/precall-render.js isUnverifiedSource: needs a non-empty, non-"unknown"
  // url and confidence >= 55 to avoid rendering as UNVERIFIED.
  assert.ok(entry!.url && entry!.url !== "unknown", `${orphan} has a resolvable url`);
  assert.ok(entry!.confidence >= 55, `${orphan} confidence ${entry!.confidence} avoids UNVERIFIED`);
  assert.equal(out.prospects[0].sourceLabel, orphan, `${orphan} label is preserved verbatim`);
  assert.ok(entry!.displayName, `${orphan} has a displayName`);
}

// R-labels are NOT reserved — they merge by domain into a normal S-label.
{
  const { prep: out } = canonicalizePrepSources(
    prep({
      sources: [src("R1", "https://linkedin.com/in/emma", 60), src("S1", "https://a.com"), src("S2", "https://b.com")],
      prospects: [{ name: "Emma", role: "CS", sourceLabel: "R1" }],
    } as Partial<Prep>),
  );
  assert.equal(out.prospects[0].sourceLabel, "S1", "R1 is renumbered, not kept");
  assert.equal(out.sources.find((s) => s.label === "S1")!.displayName, "linkedin.com");
}

// ---------------------------------------------------------------------------
// D. Domain merge — many URLs on one host collapse to one chip.
// ---------------------------------------------------------------------------
{
  const many: PrepSource[] = [];
  const domains = ["saviuk.co.uk", "thegrocer.co.uk", "venditan.com", "retailx.events", "bizibl.com", "loyaltycentral.works"];
  domains.forEach((d, di) => {
    for (let i = 0; i < 3; i++) many.push(src(`S${di * 3 + i + 1}`, `https://${d}/page-${i}`, 60 + i * 5));
  });
  assert.equal(many.length, 18);

  const { prep: out } = canonicalizePrepSources(
    prep({ sources: many, facts: [{ key: "Industry", value: "Retail", sourceLabel: "S2" }] } as Partial<Prep>),
  );
  assert.equal(out.sources.length, domains.length, "18 urls over 6 domains -> 6 sources");
  const cited = out.sources.find((s) => s.label === out.facts[0].sourceLabel)!;
  assert.equal(cited.displayName, "saviuk.co.uk", "the fact resolves to its own domain, not an index");
  assert.equal(cited.confidence, 70, "merged group takes the max confidence of its members");
}

// ---------------------------------------------------------------------------
// E. Idempotency — a second pass must change nothing.
// ---------------------------------------------------------------------------
{
  const input = prep({
    sources: [src("S15", "https://a.com"), src("S23", "https://b.com")],
    facts: [{ key: "Industry", value: "X", sourceLabel: "S23" }],
    prospects: [{ name: "E", role: "R", sourceLabel: "Kaia" }],
  } as Partial<Prep>);
  const once = canonicalizePrepSources(input).prep;
  const twice = canonicalizePrepSources(once).prep;
  assert.deepEqual(twice, once, "canonicalisation is idempotent");
  assert.equal(twice.prospects[0].sourceLabel, "Kaia", "reserved label survives both passes");
}

// ---------------------------------------------------------------------------
// F. Cap honesty — referenced sources are never dropped to satisfy the cap.
// ---------------------------------------------------------------------------
{
  const n = MAX_PREP_SOURCES + 3;
  const sources = Array.from({ length: n }, (_, i) => src(`S${i + 1}`, `https://d${i + 1}.com/p`));
  const facts = sources.map((s, i) => ({ key: `k${i}`, value: "v", sourceLabel: s.label }));
  const { prep: out, unresolved } = canonicalizePrepSources(prep({ sources, facts } as Partial<Prep>));
  assert.equal(out.sources.length, n, `all ${n} cited sources survive a cap of ${MAX_PREP_SOURCES}`);
  assert.deepEqual(unresolved, [], "nothing unresolved");
  const known = new Set(out.sources.map((s) => s.label));
  for (const f of out.facts) assert.ok(known.has(f.sourceLabel));
}

// Unreferenced sources ARE trimmed to the cap.
{
  const sources = Array.from({ length: 20 }, (_, i) => src(`S${i + 1}`, `https://d${i + 1}.com/p`));
  const { prep: out } = canonicalizePrepSources(
    prep({ sources, facts: [{ key: "k", value: "v", sourceLabel: "S1" }] } as Partial<Prep>),
  );
  assert.ok(out.sources.length <= MAX_PREP_SOURCES, "unreferenced tail is capped");
  assert.ok(out.sources.some((s) => s.label === out.facts[0].sourceLabel), "the cited one is kept");
}

// G. minItems: domain merge must not push sources below 3.
{
  const { prep: out } = canonicalizePrepSources(
    prep({
      sources: [src("S1", "https://a.com/x"), src("S2", "https://a.com/y")],
      facts: [{ key: "k", value: "v", sourceLabel: "S1" }],
    } as Partial<Prep>),
  );
  assert.ok(out.sources.length >= 3, `padded back to minItems 3, got ${out.sources.length}`);
  assert.equal(new Set(out.sources.map((s) => s.label)).size, out.sources.length, "padded labels unique");
}

// ---------------------------------------------------------------------------
// H. Shared fixture — the same cases run in web/scripts/test-prep-source-canon.mjs.
//    If the two mirrors drift, one side fails here.
// ---------------------------------------------------------------------------
{
  const cases = JSON.parse(
    readFileSync(join(dirname(fileURLToPath(import.meta.url)), "../testdata/source-canon/cases.json"), "utf8"),
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
    assert.equal(
      sourceDomainKey(c.a) === sourceDomainKey(c.b),
      c.same,
      `domainKey ${c.a} vs ${c.b}`,
    );
  }
  for (const c of cases.canonicalize) {
    const { prep: out } = canonicalizePrepSources(prep(c.prep as Partial<Prep>));
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
      const cited = out.sources.find((s) => s.label === out.facts[0].sourceLabel)!;
      assert.equal(cited.confidence, e.mergedConfidence, `${c.name}: merged confidence`);
    }
  }
  console.log(
    `  shared fixture: ${cases.displayName.length} displayName, ${cases.sourceKind.length} sourceKind, ${cases.citationNumber.length} citationNumber, ${cases.domainKey.length} domainKey, ${cases.canonicalize.length} canonicalize cases`,
  );
}

console.warn = origWarn;
console.log("test-canonicalize-sources.ts: ok");
