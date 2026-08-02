/**
 * ICP fitment criteria and the derived alignment tier. Pure, no network, no LLM.
 *
 * There is deliberately NO score. The invariant under test: the tier is the lowest band
 * across the two gating criteria, no other criterion can move it, and an unmet
 * disqualifier caps it at Weak. Every criterion and every band traces to a line in
 * src/icp/*.md.
 *
 * Usage: tsx worker/scripts/test-icp-criteria.ts
 */

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

import {
  ICP_CRITERIA,
  criteriaForProduct,
  criterionById,
  gatingCriteria,
  allCriteriaPromptBlock,
  criteriaPromptBlock,
  placeAccount,
  type IcpProduct,
} from "../src/prep/icp-criteria.ts";
import { normalizeIcpFit } from "../src/word-limits.ts";
import { validatePrep } from "../src/prep/validate-prep.ts";
import { PREP_SCHEMA } from "../src/schema.ts";
import type { IcpCriterionRow, Prep, PrepSource } from "../src/schema.ts";

let checks = 0;
const ok = (cond: unknown, msg: string) => {
  assert.ok(cond, msg);
  checks++;
};
const eq = (a: unknown, b: unknown, msg: string) => {
  assert.equal(a, b, msg);
  checks++;
};

const PRODUCTS: IcpProduct[] = ["Freshdesk", "Freshdesk Omni"];

// ---------------------------------------------------------------- definitions

// --- PROVENANCE: every criterion traces to a line in src/icp/*.md ---
//
// These are the documents generate-icp-kb.mjs builds icp-kb.ts from, i.e. the actual
// definition of the ICP. Greping each anchor out of its named file means a criterion
// cannot be invented here, and cannot silently survive a reword of the source doc.
{
  const here = dirname(fileURLToPath(import.meta.url));
  const docs = new Map<string, string>();
  const docText = (doc: string) => {
    if (!docs.has(doc)) docs.set(doc, readFileSync(join(here, "../src/icp", doc), "utf8"));
    return docs.get(doc)!;
  };

  for (const product of PRODUCTS) {
    for (const c of ICP_CRITERIA[product]) {
      ok(c.source?.doc, `${product}/${c.id} names its source document`);
      ok(c.source?.axis, `${product}/${c.id} names the trait axis it comes from`);
      ok(
        docText(c.source.doc).includes(c.source.anchor),
        `${product}/${c.id}: anchor "${c.source.anchor}" is no longer in ${c.source.doc} — the criterion has drifted from the ICP document`,
      );
    }
  }

  // Every bullet of the Omni disqualifier section must be represented. This is the gap
  // that let "seeking free tier only" go unmodelled.
  const omniDoc = docText("freshdesk-omni.md");
  const dqSection = omniDoc.slice(
    omniDoc.indexOf("## Disqualifiers / weak fit"),
    omniDoc.indexOf("## Discovery gaps to validate"),
  );
  const dqBullets = dqSection
    .split("\n")
    .filter((l) => l.trim().startsWith("- "))
    .map((l) => l.trim());
  eq(dqBullets.length, 5, "the Omni doc still lists 5 disqualifier bullets");
  const omniCriteria = ICP_CRITERIA["Freshdesk Omni"];
  for (const bullet of dqBullets) {
    ok(
      omniCriteria.some((c) => c.source.anchor && bullet.includes(c.source.anchor)),
      `no criterion covers the disqualifier bullet: ${bullet}`,
    );
  }

  // Every BAND name must also be the ICP document's own vocabulary, not ours. Without
  // this, "Disqualified" (our word) could sit beside "Disqualifiers" (the doc's) and the
  // zone label would stop being the framework's classification.
  for (const product of PRODUCTS) {
    for (const c of ICP_CRITERIA[product]) {
      if (!c.gating) continue;
      const doc = docText(c.source.doc).toLowerCase();
      for (const b of c.gating.bands) {
        ok(
          doc.includes(b.band.toLowerCase()),
          `${product}/${c.id}: band "${b.band}" is not vocabulary from ${c.source.doc}`,
        );
      }
    }
  }

  // Every named trait axis on the Freshdesk zone cards must be represented. "Use Cases"
  // is excluded on purpose: it names the play to run, not a test of fit.
  const fdAxes = [
    "Company Size",
    "Industry",
    "Pain points",
    "Support Maturity",
    "Tech Stack",
    "Buying Intent",
    "Incumbent Vendor",
    "Query Volume",
    "Growth Stage",
    "Decision Driver",
  ];
  const fdDoc = docText("freshdesk.md");
  const covered = new Set(ICP_CRITERIA.Freshdesk.map((c) => c.source.axis.replace(/ \(.*\)$/, "")));
  for (const axis of fdAxes) {
    ok(fdDoc.includes(`${axis}:`) || fdDoc.includes(`${axis} :`), `${axis} is still an axis in freshdesk.md`);
    ok(covered.has(axis), `Freshdesk axis "${axis}" has no criterion`);
  }
  ok(!covered.has("Use Cases"), "Use Cases is not treated as a fit criterion");
}

for (const product of PRODUCTS) {
  const defs = ICP_CRITERIA[product];
  eq(defs.length, 11, `${product} has 11 criteria`);

  const ids = defs.map((c) => c.id);
  eq(new Set(ids).size, ids.length, `${product} criterion ids are unique`);
  for (const c of defs) {
    ok(/^[a-zA-Z]+$/.test(c.id), `${product} id "${c.id}" is a plain identifier`);
    ok(c.label && c.label.length <= 45, `${product} ${c.id} label is short enough for the UI`);
    ok(c.hint && c.hint.length > 20, `${product} ${c.id} has a usable prompt hint`);
  }
  ok(
    defs.some((c) => c.disqualifying),
    `${product} has at least one disqualifier — the KB defines them`,
  );
}

// The Omni KB lists five explicit disqualifiers; they must all be represented.
{
  const omniDq = ICP_CRITERIA["Freshdesk Omni"].filter((c) => c.disqualifying).map((c) => c.id);
  assert.deepEqual(
    [...omniDq].sort(),
    ["commercialFit", "deployment", "serviceMotion", "stackOwnership"],
    // agentScale and channelMix are absent on purpose: they are GATING criteria, and
    // their bottom band already maps to Weak. Carrying the flag as well would state the
    // same thing twice. The doc bullets they cover are still checked below.
    "non-gating Omni disqualifiers match the KB list",
  );
  checks++;
}

eq(criteriaForProduct("Freshdesk Omni")[0].id, "agentScale", "product lookup");
eq(criteriaForProduct(undefined).length, 11, "unknown product falls back to Freshdesk");
eq(criteriaForProduct("nonsense")[0].id, "companySize", "garbage product falls back to Freshdesk");
eq(criterionById("Freshdesk", "companySize")?.label, "Company size", "lookup by id");
eq(criterionById("Freshdesk", "agentScale"), undefined, "Omni id is not a Freshdesk criterion");

// ---------------------------------------------------------------- placement

// There is no score. The invariant is now: the tier is the LOWEST band across the gating
// criteria, nothing else can move it, and a disqualifier caps it at Weak.

const row = (
  id: string,
  state: "met" | "unmet" | "unknown",
  extra: Partial<IcpCriterionRow> = {},
): IcpCriterionRow => ({ id, state, evidence: state === "unknown" ? "" : "e", ...extra });

// Exactly two gating criteria per product, and they are the ones the card places by.
assert.deepEqual(
  gatingCriteria("Freshdesk").map((c) => c.id),
  ["companySize", "industry"],
  "Freshdesk places by size and industry",
);
assert.deepEqual(
  gatingCriteria("Freshdesk Omni").map((c) => c.id),
  ["agentScale", "channelMix"],
  "Omni places by agent count and channel mix",
);
checks += 2;

// A gating criterion must NOT also carry the disqualifier flag — its bottom band already
// maps to Weak, so the flag would state the same thing twice.
for (const product of PRODUCTS) {
  for (const c of gatingCriteria(product)) {
    ok(!c.disqualifying, `${product}/${c.id} is gating, so it carries no disqualifier flag`);
  }
}

// Every band's tier must be one of the three real tiers, and bands must be unique.
for (const product of PRODUCTS) {
  for (const c of gatingCriteria(product)) {
    const names = c.gating!.bands.map((b) => b.band);
    eq(new Set(names).size, names.length, `${product}/${c.id} band names are unique`);
    for (const b of c.gating!.bands) {
      ok(["Strong", "Medium", "Weak"].includes(b.tier), `${product}/${c.id} band "${b.band}" has a real tier`);
      ok(b.when.length > 5, `${product}/${c.id} band "${b.band}" tells the model when to pick it`);
    }
  }
}

// --- the rule ---

// Both gating facts at the top band -> Strong, and the zone is the document's own name.
{
  const p = placeAccount(
    [
      row("companySize", "met", { band: "Winning Zone", evidence: "220 employees", sourceLabel: "S1" }),
      row("industry", "met", { band: "Winning Zone", evidence: "Retail & ecommerce", sourceLabel: "S1" }),
    ],
    "Freshdesk",
  );
  eq(p.tier, "Strong", "both gating facts in the Winning Zone reads Strong");
  eq(p.zone, "Winning Zone", "the zone is the framework's own label");
  eq(p.gating.length, 2, "both gating facts are reported");
  eq(p.missingGating.length, 0, "nothing missing");
  // Gating rows must not also appear in the evidence groups.
  ok(
    ![...p.supports, ...p.contradicts, ...p.unknown].some((r) => r.id === "companySize"),
    "a gating row is never also an evidence row",
  );
}

// Lowest band wins.
{
  const p = placeAccount(
    [
      row("companySize", "met", { band: "Winning Zone", evidence: "220 employees", sourceLabel: "S1" }),
      row("industry", "met", { band: "Losing Zone", evidence: "Retail banking", sourceLabel: "S1" }),
    ],
    "Freshdesk",
  );
  eq(p.tier, "Weak", "a 220-employee bank is capped by its industry, not lifted by its size");
  eq(p.zone, "Losing Zone", "the zone reported is the one that decided the tier");
}
{
  const p = placeAccount(
    [
      row("companySize", "met", { band: "Battle Zone", evidence: "2,400 employees", sourceLabel: "S1" }),
      row("industry", "met", { band: "Winning Zone", evidence: "Manufacturing", sourceLabel: "S1" }),
    ],
    "Freshdesk",
  );
  eq(p.tier, "Medium", "mid-market size caps an otherwise ideal industry at Medium");
  eq(p.zone, "Battle Zone", "zone follows the lowest band");
}

// Industry can cap but never promote — freshdesk.md gives Winning and Battle identical
// industry lists, so there is no Battle-only industry band to promote a large account with.
{
  const industryBands = criterionById("Freshdesk", "industry")!.gating!.bands.map((b) => b.band);
  ok(!industryBands.includes("Battle Zone"), "industry has no Battle-only band");
  const p = placeAccount(
    [
      row("companySize", "met", { band: "Losing Zone", evidence: "12,000 employees", sourceLabel: "S1" }),
      row("industry", "met", { band: "Winning Zone", evidence: "Retail", sourceLabel: "S1" }),
    ],
    "Freshdesk",
  );
  eq(p.tier, "Weak", "a target industry cannot promote a 12,000-employee enterprise");
}

// Micro-SMB finally has a representation — it previously had none at all.
{
  const p = placeAccount(
    [
      row("companySize", "met", { band: "Lower Priority", evidence: "18 employees", sourceLabel: "S1" }),
      row("industry", "met", { band: "Winning Zone", evidence: "Retail", sourceLabel: "S1" }),
    ],
    "Freshdesk",
  );
  eq(p.tier, "Weak", "0-50 employees reads Weak");
  eq(p.zone, "Lower Priority", "and names the Lower Priority segment, not a generic Weak");
}

// Omni bands.
{
  const strong = placeAccount(
    [
      row("agentScale", "met", { band: "Strong fit", evidence: "80 agents", sourceLabel: "S1" }),
      row("channelMix", "met", { band: "Strong fit", evidence: "email, chat, voice live", sourceLabel: "S1" }),
    ],
    "Freshdesk Omni",
  );
  eq(strong.tier, "Strong", "50+ agents on full omnichannel is Strong");
  eq(strong.zone, "Strong fit", "Omni zone vocabulary");

  const capped = placeAccount(
    [
      row("agentScale", "met", { band: "Strong fit", evidence: "80 agents", sourceLabel: "S1" }),
      row("channelMix", "met", { band: "Disqualifier", evidence: "email only, no plans", sourceLabel: "S1" }),
    ],
    "Freshdesk Omni",
  );
  eq(capped.tier, "Weak", "email-only caps a large agent team at Weak");

  const moderate = placeAccount(
    [
      row("agentScale", "met", { band: "Moderate fit", evidence: "30 agents", sourceLabel: "S1" }),
      row("channelMix", "met", { band: "Strong fit", evidence: "omnichannel roadmap Q3", sourceLabel: "S1" }),
    ],
    "Freshdesk Omni",
  );
  eq(moderate.tier, "Medium", "20-49 agents reads Medium");
}

// The 15-19 agent doc gap: the Moderate band must cover it, or an account in that range
// cannot be placed at all.
{
  const band = criterionById("Freshdesk Omni", "agentScale")!.gating!.bands.find(
    (b) => b.tier === "Medium",
  )!;
  ok(/\b15\b/.test(band.when), `the Moderate agent band covers 15-19: "${band.when}"`);
}

// Unknown gating -> Unknown tier, and we report WHICH fact is missing.
{
  const none = placeAccount(
    [row("companySize", "unknown"), row("industry", "unknown")],
    "Freshdesk",
  );
  eq(none.tier, "Unknown", "no gating evidence means no tier");
  eq(none.zone, "", "and no zone is claimed");
  eq(none.missingGating.length, 2, "both missing facts are named");
  assert.deepEqual(
    none.missingGating.map((m) => m.id),
    ["companySize", "industry"],
    "missing gating facts are identified by id",
  );
  checks++;

  // One placed is enough to give a tier.
  const one = placeAccount(
    [
      row("companySize", "met", { band: "Winning Zone", evidence: "220 employees", sourceLabel: "S1" }),
      row("industry", "unknown"),
    ],
    "Freshdesk",
  );
  eq(one.tier, "Strong", "one placed gating fact still yields a tier");
  eq(one.missingGating.length, 1, "the unsourced one is still reported");
}

// A band the criterion does not define cannot place anything.
{
  const p = placeAccount(
    [
      row("companySize", "met", { band: "Amazing Zone", evidence: "220 employees", sourceLabel: "S1" }),
      row("industry", "met", { band: "Strong fit", evidence: "Retail", sourceLabel: "S1" }),
    ],
    "Freshdesk",
  );
  eq(p.tier, "Unknown", "an invented band and an Omni band both fail to place a Freshdesk account");
  eq(p.missingGating.length, 2, "both are reported as unplaced");
}

// A gating row with a band but state unknown does not place either.
eq(
  placeAccount([row("companySize", "unknown", { band: "Winning Zone" })], "Freshdesk").tier,
  "Unknown",
  "a band on an unknown row is ignored",
);

// --- non-gating criteria are evidence only ---
{
  const allMet = criteriaForProduct("Freshdesk")
    .filter((c) => !c.gating && !c.disqualifying)
    .map((c) => row(c.id, "met", { sourceLabel: "S1" }));
  const p = placeAccount(allMet, "Freshdesk");
  eq(p.tier, "Unknown", "every non-gating criterion met cannot produce a tier on its own");
  ok(p.supports.length >= 8, "they are all reported as supporting evidence");

  const withGating = placeAccount(
    [...allMet, row("companySize", "met", { band: "Battle Zone", evidence: "3,000", sourceLabel: "S1" })],
    "Freshdesk",
  );
  eq(withGating.tier, "Medium", "the gating fact alone sets the tier");
  eq(
    withGating.supports.length,
    p.supports.length,
    "adding a gating row does not change the evidence groups",
  );
}

// Evidence rows partition into exactly three groups.
for (const product of PRODUCTS) {
  const nonGating = criteriaForProduct(product).filter((c) => !c.gating);
  const p = placeAccount(
    nonGating.map((c, i) =>
      row(c.id, i % 3 === 0 ? "met" : i % 3 === 1 ? "unmet" : "unknown", { sourceLabel: "S1" }),
    ),
    product,
  );
  eq(
    p.supports.length + p.contradicts.length + p.unknown.length,
    nonGating.length,
    `${product}: evidence rows partition the non-gating criteria`,
  );
}

// --- disqualifiers override the placement ---
{
  const p = placeAccount(
    [
      row("agentScale", "met", { band: "Strong fit", evidence: "80 agents", sourceLabel: "S1" }),
      row("channelMix", "met", { band: "Strong fit", evidence: "omnichannel live", sourceLabel: "S1" }),
      row("deployment", "unmet", { evidence: "on-prem mandate", sourceLabel: "S1" }),
    ],
    "Freshdesk Omni",
  );
  eq(p.tier, "Weak", "an unmet disqualifier caps a Strong placement at Weak");
  assert.deepEqual(p.disqualifiers, ["Cloud deployment is acceptable"], "the disqualifier is named");
  checks++;
}
// unknown on a disqualifier is not a hit.
{
  const p = placeAccount(
    [
      row("agentScale", "met", { band: "Strong fit", evidence: "80 agents", sourceLabel: "S1" }),
      row("channelMix", "met", { band: "Strong fit", evidence: "omnichannel live", sourceLabel: "S1" }),
      row("deployment", "unknown"),
    ],
    "Freshdesk Omni",
  );
  eq(p.tier, "Strong", "an unknown disqualifier does not cap anything");
  eq(p.disqualifiers.length, 0, "and is not reported as a hit");
}

// Hostile input.
for (const bad of [undefined, null, [], [null], [{}], "x", 7, [{ id: "nope", state: "met" }]]) {
  const p = placeAccount(bad as never, "Freshdesk");
  eq(p.tier, "Unknown", `hostile input ${JSON.stringify(bad)} yields no tier`);
  eq(p.zone, "", `hostile input ${JSON.stringify(bad)} claims no zone`);
}

// No arithmetic survives anywhere in the placement result.
{
  const p = placeAccount(
    [row("companySize", "met", { band: "Winning Zone", evidence: "220", sourceLabel: "S1" })],
    "Freshdesk",
  ) as unknown as Record<string, unknown>;
  for (const gone of ["score", "met", "unmet", "countable", "total", "metCount"]) {
    eq(p[gone], undefined, `placement carries no "${gone}" field`);
  }
}

// ---------------------------------------------------------------- normalizeIcpFit

const SRC: PrepSource[] = [
  { label: "S1", title: "Acme About", url: "https://acme.com/about", confidence: 80 } as PrepSource,
  { label: "S2", title: "Case study", url: "https://vendor.com/acme", confidence: 90 } as PrepSource,
];

const prepWith = (icpFit: unknown): Prep => ({ icpFit } as unknown as Prep);

// Legacy brief: no criteria -> keep the stored verdict, mapping the old "Moderate" label.
{
  const out = normalizeIcpFit(
    prepWith({ product: "Freshdesk", verdict: "Moderate", score: 62, gaps: [] }),
    SRC,
  );
  assert.deepEqual(out.criteria, [], "legacy brief carries no criteria rows");
  eq(out.verdict, "Medium", 'stored "Moderate" renders as the current "Medium" label');
  eq(out.zone, undefined, "no zone is claimed for a brief that was never placed");
  eq((out as Record<string, unknown>).score, undefined, "the unrubriced number is not carried forward");
  eq((out as Record<string, unknown>).metCount, undefined, "no met count either");
  eq(
    normalizeIcpFit(prepWith({ product: "Freshdesk", verdict: "Strong", gaps: [] }), SRC).verdict,
    "Strong",
    "other legacy verdicts pass through",
  );
  eq(
    normalizeIcpFit(prepWith({ product: "Freshdesk", verdict: "nonsense", gaps: [] }), SRC).verdict,
    "Unknown",
    "an off-enum legacy verdict becomes Unknown",
  );
}

// Criteria present -> the tier is derived, and the model's own verdict is ignored.
{
  const out = normalizeIcpFit(
    prepWith({
      product: "Freshdesk",
      verdict: "Strong", // the model's guess, which must not survive
      score: 95,
      criteria: [
        { id: "companySize", state: "met", evidence: "3,000 employees", sourceLabel: "S1", band: "Battle Zone" },
        { id: "industry", state: "met", evidence: "Manufacturing", sourceLabel: "S2", band: "Winning Zone" },
      ],
      gaps: [],
    }),
    SRC,
  );
  eq(out.criteria.length, 11, "criteria padded to the full definition list");
  eq(out.verdict, "Medium", "tier derived from the lowest band, not the model's Strong");
  eq(out.zone, "Battle Zone", "zone follows the deciding band");
  eq((out as Record<string, unknown>).score, undefined, "no score is produced");
  eq(
    out.criteria.filter((c) => c.state === "unknown").length,
    9,
    "criteria the model omitted are unknown, not missing",
  );
  eq(out.criteria[0].id, "companySize", "criteria come back in definition order");
  // The gating flag travels on the row so the browser needs no mirror of the definitions.
  eq(out.criteria[0].gating, true, "gating rows are marked for the renderer");
  eq(out.criteria.find((c) => c.id === "painFit")?.gating, undefined, "non-gating rows are not");
}

// A band the criterion does not define is discarded, so it cannot place the account.
{
  const out = normalizeIcpFit(
    prepWith({
      product: "Freshdesk",
      verdict: "Strong",
      criteria: [
        { id: "companySize", state: "met", evidence: "220 employees", sourceLabel: "S1", band: "Amazing Zone" },
      ],
      gaps: [],
    }),
    SRC,
  );
  eq(out.criteria.find((c) => c.id === "companySize")?.band, undefined, "invented band dropped");
  eq(out.verdict, "Unknown", "and with no usable band there is no tier");
}

// A band on a NON-gating criterion is discarded too — only gating rows place anything.
{
  const out = normalizeIcpFit(
    prepWith({
      product: "Freshdesk",
      verdict: "Strong",
      criteria: [
        { id: "painFit", state: "met", evidence: "Repetitive queries", sourceLabel: "S1", band: "Winning Zone" },
      ],
      gaps: [],
    }),
    SRC,
  );
  eq(out.criteria.find((c) => c.id === "painFit")?.band, undefined, "band on a non-gating row dropped");
  eq(out.verdict, "Unknown", "a non-gating criterion cannot place the account");
}

// Unknown ids are dropped; the other product's ids do not leak in.
{
  const out = normalizeIcpFit(
    prepWith({
      product: "Freshdesk",
      verdict: "Strong",
      criteria: [
        { id: "companySize", state: "met", evidence: "220 employees", sourceLabel: "S1", band: "Winning Zone" },
        { id: "agentScale", state: "met", evidence: "Omni criterion", sourceLabel: "S1", band: "Strong fit" },
        { id: "totallyMadeUp", state: "met", evidence: "invented", sourceLabel: "S1" },
      ],
      gaps: [],
    }),
    SRC,
  );
  eq(out.criteria.length, 11, "still exactly 11 rows");
  ok(!out.criteria.some((c) => c.id === "agentScale"), "Omni id rejected on a Freshdesk brief");
  ok(!out.criteria.some((c) => c.id === "totallyMadeUp"), "invented id rejected");
  eq(out.verdict, "Strong", "the one valid gating row places the account");
}

// unknown rows must not carry stale evidence, a citation, or a band.
{
  const out = normalizeIcpFit(
    prepWith({
      product: "Freshdesk",
      verdict: "Unknown",
      criteria: [
        {
          id: "companySize",
          state: "unknown",
          evidence: "leftover text",
          sourceLabel: "S1",
          band: "Winning Zone",
        },
      ],
      gaps: [],
    }),
    SRC,
  );
  const r = out.criteria.find((c) => c.id === "companySize")!;
  eq(r.evidence, "", "unknown row carries no evidence");
  eq(r.sourceLabel, undefined, "unknown row carries no citation");
  eq(r.band, undefined, "unknown row carries no band");
}

// ---------------------------------------------------------------- validate gate

// A criterion resting on an unsourced or low-confidence claim is demoted, and the tier
// re-derived so it still matches the surviving rows.
{
  const prep = {
    sources: [
      { label: "S1", title: "Good", url: "https://acme.com/about", confidence: 80 },
      { label: "S9", title: "Weak", url: "https://rumor.example", confidence: 20 },
    ],
    facts: [],
    signals: [],
    prospects: [],
    fitSnapshot: [],
    icpFit: {
      product: "Freshdesk",
      verdict: "Strong",
      zone: "Winning Zone",
      criteria: [
        // The gating fact rests on a source too weak to trust.
        { id: "companySize", state: "met", evidence: "220 employees", sourceLabel: "S9", band: "Winning Zone", gating: true },
        { id: "industry", state: "met", evidence: "Retail", sourceLabel: "S1", band: "Winning Zone", gating: true },
        { id: "queryVolume", state: "met", evidence: "12k monthly", sourceLabel: "R7" },
      ],
      gaps: [],
    },
  } as unknown as Prep;

  const { prep: out, lowConfidence } = validatePrep(prep);
  const fit = out.icpFit;
  eq(
    fit.criteria.find((c) => c.id === "companySize")?.state,
    "unknown",
    "a gating fact on a weak source is demoted",
  );
  eq(
    fit.criteria.find((c) => c.id === "companySize")?.band,
    undefined,
    "and loses its band, so it can no longer place the account",
  );
  eq(fit.criteria.find((c) => c.id === "queryVolume")?.state, "unknown", "R7 does not resolve");
  eq(fit.criteria.find((c) => c.id === "industry")?.state, "met", "the well-sourced gating row survives");
  eq(fit.verdict, "Strong", "the surviving gating row still places it");
  eq(fit.zone, "Winning Zone", "and names its zone");
  ok(lowConfidence.some((l) => l.startsWith("icpFit:")), "the demotion is reported, not silent");
}

// Both gating facts unsourced -> Unknown, not a stale Strong.
{
  const prep = {
    sources: [{ label: "S9", title: "Weak", url: "https://rumor.example", confidence: 20 }],
    facts: [],
    signals: [],
    prospects: [],
    fitSnapshot: [],
    icpFit: {
      product: "Freshdesk",
      verdict: "Strong",
      zone: "Winning Zone",
      criteria: [
        { id: "companySize", state: "met", evidence: "220", sourceLabel: "S9", band: "Winning Zone", gating: true },
        { id: "industry", state: "met", evidence: "Retail", sourceLabel: "S9", band: "Winning Zone", gating: true },
      ],
      gaps: [],
    },
  } as unknown as Prep;
  const { prep: out } = validatePrep(prep);
  eq(out.icpFit.verdict, "Unknown", "no sourceable gating fact means no tier");
  eq(out.icpFit.zone, undefined, "and the stale zone is cleared");
}

// A brief whose criteria all resolve must pass through untouched.
{
  const criteria = criteriaForProduct("Freshdesk").map((c) => ({
    id: c.id,
    state: "met" as const,
    evidence: "cited",
    sourceLabel: "S1",
    ...(c.gating ? { band: c.gating.bands[0].band, gating: true } : {}),
  }));
  const prep = {
    sources: [{ label: "S1", title: "Good", url: "https://acme.com/about", confidence: 80 }],
    facts: [],
    signals: [],
    prospects: [],
    fitSnapshot: [],
    icpFit: { product: "Freshdesk", verdict: "Strong", zone: "Winning Zone", criteria, gaps: [] },
  } as unknown as Prep;
  const { prep: out, lowConfidence } = validatePrep(prep);
  eq(out.icpFit.verdict, "Strong", "fully sourced criteria survive the gate");
  eq(out.icpFit.zone, "Winning Zone", "zone survives");
  ok(!lowConfidence.some((l) => l.startsWith("icpFit:")), "nothing reported when nothing demoted");
}

// Legacy briefs must survive the gate untouched — no criteria means nothing to demote.
{
  const prep = {
    sources: [],
    facts: [],
    signals: [],
    prospects: [],
    fitSnapshot: [],
    icpFit: { product: "Freshdesk", verdict: "Medium", criteria: [], gaps: [] },
  } as unknown as Prep;
  const { prep: out } = validatePrep(prep);
  eq(out.icpFit.verdict, "Medium", "legacy verdict untouched by the gate");
}

// ---------------------------------------------------------------- prompt + schema

for (const product of PRODUCTS) {
  const block = criteriaPromptBlock(product);
  for (const c of ICP_CRITERIA[product]) {
    ok(block.includes(c.id), `${product} prompt block lists ${c.id}`);
  }
  const dq = ICP_CRITERIA[product].filter((c) => c.disqualifying);
  for (const c of dq) {
    ok(
      new RegExp(`${c.id}:[^\\n]*\\[DISQUALIFIER\\]`).test(block),
      `${product} prompt marks ${c.id} as a disqualifier`,
    );
  }
}
{
  const all = allCriteriaPromptBlock();
  ok(all.includes("Freshdesk criteria ids:"), "combined block labels Freshdesk");
  ok(all.includes("Freshdesk Omni criteria ids:"), "combined block labels Omni");
  // Every id the model may emit must be in the prompt, or it cannot comply.
  for (const product of PRODUCTS) {
    for (const c of ICP_CRITERIA[product]) ok(all.includes(c.id), `combined block has ${c.id}`);
  }
}

// The model cannot fill a field the schema does not ask for.
{
  const icp = (PREP_SCHEMA as never as { properties: Record<string, never> }).properties
    .icpFit as unknown as {
    required: string[];
    properties: Record<string, { items?: { properties: Record<string, unknown>; required: string[] } }>;
  };
  ok(icp.required.includes("criteria"), "criteria is required, so the model must emit it");
  const row = icp.properties.criteria.items!;
  assert.deepEqual(
    Object.keys(row.properties).sort(),
    ["band", "evidence", "id", "sourceLabel", "state"],
    "criterion row shape",
  );
  checks++;
  ok(row.required.includes("state"), "state is required on every row");
  // label / gating / disqualifying are attached server-side from the definitions, so the
  // model is never asked to echo them and cannot invent them.
  for (const serverOnly of ["label", "gating", "disqualifying"]) {
    ok(!(serverOnly in row.properties), `${serverOnly} is not in the model's schema`);
  }
  // The removed fields must stay removed.
  for (const gone of ["score", "metCount", "frameworkRefs"]) {
    ok(!(gone in icp.properties), `icpFit no longer declares "${gone}"`);
  }
  ok(!icp.required.includes("frameworkRefs"), "frameworkRefs is not required");
  assert.deepEqual(
    (icp.properties.verdict as unknown as { enum: string[] }).enum,
    ["Strong", "Medium", "Weak", "Unknown"],
    "verdict enum uses Medium, not Moderate",
  );
  checks++;
}

console.log(`test-icp-criteria.ts: ok (${checks} checks)`);
