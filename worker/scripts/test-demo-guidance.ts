/**
 * Demo guidance reconciliation — the deterministic guard around LLM output.
 * Pure, no network. Usage: tsx worker/scripts/test-demo-guidance.ts
 */

import assert from "node:assert/strict";

import {
  generateDemoGuidance,
  groundingAnchors,
  isScenarioLine,
  isGroundedUseCase,
  pruneLeadAssets,
  shapeGuidance,
  shapeUseCases,
} from "../src/prep/demo-guidance.ts";
import type { ConfirmedProspectProfile } from "../src/prep/merge-enrichment.ts";

const ASSETS = ["Demo script", "Customer reference", "Slide pack", "ROI slide pack"];

function profile(
  email: string,
  name: string,
  primary: "D" | "I" | "S" | "C" | "unknown",
  over: Partial<ConfirmedProspectProfile> = {},
): ConfirmedProspectProfile {
  return {
    email,
    profile: {
      name,
      role: "Head of Support",
      totalExperience: "12 years",
      priorEmployers: ["Globex"],
      summary: "s",
      skills: ["Zendesk"],
      languages: ["English"],
      education: ["University of Lincoln"],
      competitorTouchpoints: [],
    },
    disc: { primary, confidence: "medium", evidence: ["Led a turnaround"], inferred: true, source: "linkedin_pdf" },
    influence: { level: "high", decisionRole: "economic_buyer" },
    ...over,
  } as ConfirmedProspectProfile;
}

const rawFor = (emails: string[], over: Record<string, unknown> = {}) => ({
  perProspect: emails.map((email) => ({
    email,
    openWith: "Lead with the outcome",
    iceBreakers: ["Ask about Globex"],
    pacing: "Three clicks, no config tour",
    objections: [
      { objection: "How fast can this be live?", counter: "Two-week pilot" },
      { objection: "Prove the deflection number", counter: "Show the benchmark" },
    ],
    avoid: ["Long feature tour"],
    nextStep: "Ask for the pilot",
    leadAsset: "Slide pack",
  })),
  ...over,
});

// --- identity fields come from enrich, never from the model ---
{
  const profiles = [profile("a@co.com", "Ria Kelly", "C")];
  // The model returns a different name/disc — both must be ignored.
  const raw = rawFor(["a@co.com"]) as Record<string, unknown>;
  (raw.perProspect as Record<string, unknown>[])[0].name = "WRONG NAME";
  (raw.perProspect as Record<string, unknown>[])[0].disc = "D";
  (raw.perProspect as Record<string, unknown>[])[0].decisionRole = "janitor";

  const g = shapeGuidance(raw, profiles, ASSETS)!;
  assert.equal(g.perProspect.length, 1);
  assert.equal(g.perProspect[0].name, "Ria Kelly", "name comes from enrich, not the model");
  assert.equal(g.perProspect[0].disc, "C", "DISC comes from enrich, not the model");
  assert.equal(g.perProspect[0].decisionRole, "economic_buyer", "decisionRole comes from enrich");
  assert.equal(g.perProspect[0].confidence, "medium");
  assert.deepEqual(g.perProspect[0].evidence, ["Led a turnaround"], "evidence is passed through for audit");
}

// --- secondary trait renders as the display form ---
{
  const p = profile("a@co.com", "R", "C");
  p.disc.secondary = "S";
  assert.equal(shapeGuidance(rawFor(["a@co.com"]), [p], ASSETS)!.perProspect[0].disc, "C / S");
  // "unknown" secondary is not appended.
  const p2 = profile("b@co.com", "R", "C");
  p2.disc.secondary = "unknown";
  assert.equal(shapeGuidance(rawFor(["b@co.com"]), [p2], ASSETS)!.perProspect[0].disc, "C");
  // unknown primary yields an empty display string, never a guess.
  assert.equal(
    shapeGuidance(rawFor(["c@co.com"]), [profile("c@co.com", "R", "unknown")], ASSETS)!.perProspect[0].disc,
    "",
  );
}

// --- leadAsset must exist in the catalog ---
{
  const raw = rawFor(["a@co.com"]) as Record<string, unknown>;
  (raw.perProspect as Record<string, unknown>[])[0].leadAsset = "Invented Deck That Does Not Exist";
  const g = shapeGuidance(raw, [profile("a@co.com", "R", "D")], ASSETS)!;
  assert.equal(g.perProspect[0].leadAsset, undefined, "an invented asset is dropped, not rendered");

  const ok = shapeGuidance(rawFor(["a@co.com"]), [profile("a@co.com", "R", "D")], ASSETS)!;
  assert.equal(ok.perProspect[0].leadAsset, "Slide pack", "a real asset survives");
}

// --- pruneLeadAssets: the catalog is offered, the actual prep is narrower ---
{
  const g = shapeGuidance(rawFor(["a@co.com"]), [profile("a@co.com", "R", "D")], ASSETS)!;
  assert.equal(g.perProspect[0].leadAsset, "Slide pack");
  // This account only got two assets attached.
  const pruned = pruneLeadAssets(g, ["Demo script", "Customer reference"]);
  assert.equal(pruned.perProspect[0].leadAsset, undefined, "recommendation dropped when the asset isn't attached");
  // Still present when it is attached.
  assert.equal(pruneLeadAssets(g, ["Slide pack"]).perProspect[0].leadAsset, "Slide pack");
}

// --- room read only for a genuine mix of KNOWN types ---
{
  const room = { read: "D wants speed, C wants proof", sequence: "Outcome first, then depth" };

  const mixed = shapeGuidance(
    rawFor(["a@co.com", "b@co.com"], { room }),
    [profile("a@co.com", "A", "D"), profile("b@co.com", "B", "C")],
    ASSETS,
  )!;
  assert.ok(mixed.room, "mixed D + C produces a room read");
  assert.equal(mixed.room!.read, room.read);

  const same = shapeGuidance(
    rawFor(["a@co.com", "b@co.com"], { room }),
    [profile("a@co.com", "A", "C"), profile("b@co.com", "B", "C")],
    ASSETS,
  )!;
  assert.equal(same.room, undefined, "two Cs are not a mixed room");

  // One known + one unknown is not a mix either — we will not guess the unknown.
  const partial = shapeGuidance(
    rawFor(["a@co.com", "b@co.com"], { room }),
    [profile("a@co.com", "A", "D"), profile("b@co.com", "B", "unknown")],
    ASSETS,
  )!;
  assert.equal(partial.room, undefined, "known + unknown is not a mixed room");

  // Single prospect never gets a room read, even if the model volunteers one.
  assert.equal(
    shapeGuidance(rawFor(["a@co.com"], { room }), [profile("a@co.com", "A", "D")], ASSETS)!.room,
    undefined,
  );

  // Mixed room but the model omitted `room` -> no fabrication.
  assert.equal(
    shapeGuidance(
      rawFor(["a@co.com", "b@co.com"]),
      [profile("a@co.com", "A", "D"), profile("b@co.com", "B", "C")],
      ASSETS,
    )!.room,
    undefined,
  );
}

// --- a prospect the model skipped is omitted, not stubbed ---
{
  const g = shapeGuidance(
    rawFor(["a@co.com"]),
    [profile("a@co.com", "A", "D"), profile("b@co.com", "B", "C")],
    ASSETS,
  )!;
  assert.equal(g.perProspect.length, 1, "only prospects the model covered are included");
  assert.equal(g.perProspect[0].email, "a@co.com");
}

// Email matching is case-insensitive (enrich emails are user-typed).
{
  const raw = rawFor(["A@Co.com"]);
  const g = shapeGuidance(raw, [profile("a@co.com", "A", "D")], ASSETS)!;
  assert.equal(g.perProspect.length, 1, "email match ignores case");
  assert.equal(g.perProspect[0].email, "a@co.com", "the canonical email is kept");
}

// --- nothing usable -> null, so the UI shows its empty state ---
assert.equal(shapeGuidance({ perProspect: [] }, [profile("a@co.com", "A", "D")], ASSETS), null);
assert.equal(shapeGuidance({}, [profile("a@co.com", "A", "D")], ASSETS), null);

// --- caps are enforced against an over-generous model ---
{
  const raw = rawFor(["a@co.com"]) as Record<string, unknown>;
  const p = (raw.perProspect as Record<string, unknown>[])[0];
  p.iceBreakers = ["one", "two", "three", "four"];
  p.avoid = ["a", "b", "c"];
  p.objections = [
    { objection: "o1", counter: "c1" },
    { objection: "o2", counter: "c2" },
    { objection: "o3", counter: "c3" },
    { objection: "o4", counter: "c4" },
  ];
  const g = shapeGuidance(raw, [profile("a@co.com", "A", "D")], ASSETS)!;
  assert.equal(g.perProspect[0].iceBreakers.length, 2, "ice breakers capped at 2");
  assert.equal(g.perProspect[0].avoid.length, 2, "anti-patterns capped at 2");
  assert.equal(g.perProspect[0].objections.length, 3, "objections capped at 3");
  // Half-formed objections are dropped rather than rendered with a blank side.
  const raw2 = rawFor(["a@co.com"]) as Record<string, unknown>;
  (raw2.perProspect as Record<string, unknown>[])[0].objections = [
    { objection: "only one side" },
    { objection: "o", counter: "c" },
  ];
  const g2 = shapeGuidance(raw2, [profile("a@co.com", "A", "D")], ASSETS)!;
  assert.equal(g2.perProspect[0].objections.length, 1, "objection without a counter is dropped");
}

// --- no profiles -> no LLM call at all ---
{
  const env = {} as never;
  assert.equal(await generateDemoGuidance(env, { companyName: "X" }, []), null, "no profiles -> null");
  // A profile object missing `profile` is not usable either.
  assert.equal(
    await generateDemoGuidance(env, { companyName: "X" }, [{ email: "a@co.com" } as ConfirmedProspectProfile]),
    null,
    "profile without enrich data -> null",
  );
}

// --- industry use cases (item 8) ---
// These were pulled once for being generic, so the guard is enforced in code, not just
// in the prompt. Every assertion below is about rejecting filler.
{
  const ANCHORS = groundingAnchors({
    industry: "Retail & ecommerce",
    likelyPains: ["Incumbent tool: Zendesk", "Web chat widget: Intercom on checkout"],
    signals: ["Shopify storefront"],
    incumbentName: "Zendesk",
    companyName: "Gamersheek",
  });

  // Anchors must be specific tokens, not boilerplate that any account would match.
  assert.ok(ANCHORS.includes("retail"), "industry token becomes an anchor");
  assert.ok(ANCHORS.includes("ecommerce"), "industry token becomes an anchor");
  assert.ok(ANCHORS.includes("zendesk"), "incumbent becomes an anchor");
  assert.ok(ANCHORS.includes("shopify"), "signal token becomes an anchor");
  for (const generic of ["support", "customer", "team", "tickets", "agents", "channel", "tool"]) {
    assert.ok(!ANCHORS.includes(generic), `"${generic}" is too generic to anchor on`);
  }
  for (const short of ["a", "of", "the", "in"]) {
    assert.ok(!ANCHORS.includes(short), `short word "${short}" is not an anchor`);
  }

  // --- scenario-line shape: reject click paths, benefits and product pitch ---
  assert.equal(
    isScenarioLine("Retail partners query mismatched redemption totals at campaign close."),
    true,
    "a real scenario line passes",
  );
  assert.equal(
    isScenarioLine("Each dispute spans finance and support across five languages."),
    true,
    "a real scenario line passes",
  );

  // This is the exact failure the first build shipped.
  for (const clickPath of [
    "Open the unified inbox dashboard",
    "Click on the email and live chat channel settings",
    "Show the combined view of customer interactions",
    "Navigate to the reporting tab to show metrics",
    "Select the language settings for English and Deutsch",
    "Create a linked Jira issue from the ticket",
    "Display a sample chat conversation in a non-English language",
    "Configure the routing rules editor",
  ]) {
    assert.equal(isScenarioLine(clickPath), false, `click path rejected: "${clickPath}"`);
  }

  for (const benefit of [
    "Improve customer satisfaction across all channels",
    "Reduce first response time significantly",
    "Streamline the support workflow end to end",
    "Empower agents with better context always",
  ]) {
    assert.equal(isScenarioLine(benefit), false, `benefit prose rejected: "${benefit}"`);
  }

  // Naming our own product means the line has stopped describing the customer.
  for (const pitch of [
    "Freddy AI can deflect these voucher queries automatically",
    "The platform unifies these channels into one workspace",
    "Freshdesk handles the multilingual routing for them",
  ]) {
    assert.equal(isScenarioLine(pitch), false, `product pitch rejected: "${pitch}"`);
  }

  assert.equal(isScenarioLine("Show the ROI dashboard clearly"), false, "marketing filler rejected");
  assert.equal(isScenarioLine("Disputes arrive daily"), false, "a three-word line is not a scenario");
  assert.equal(isScenarioLine(""), false, "empty line rejected");
  assert.equal(isScenarioLine(undefined as never), false, "nullish line rejected");

  // --- grounding ---
  const grounded = {
    name: "Voucher redemption disputes at campaign close",
    scenario: [
      "Retail partners query mismatched redemption totals when a promotion ends.",
      "Each dispute spans finance and support and arrives in five languages.",
      "Disputes land in the Zendesk queue with per-retailer tagging today.",
    ],
  };
  const generic = {
    name: "Faster customer support",
    scenario: [
      "Customers get in touch and expect a quick answer.",
      "The team has more requests than it can handle.",
    ],
  };
  assert.equal(isGroundedUseCase(grounded, ANCHORS), true, "account-specific case is grounded (2+ anchors)");
  assert.equal(isGroundedUseCase(generic, ANCHORS), false, "case that fits any company is not");
  assert.equal(isGroundedUseCase(grounded, []), false, "no anchors -> nothing can be grounded");

  // A single anchor alone is no longer enough (T2.5): one industry word plus
  // fabricated detail used to pass. Now it needs >=2 anchors, or 1 anchor plus
  // a number literal that also appears in the research facts.
  const oneAnchorOnly = {
    name: "Retail returns handling",
    scenario: [
      "Retail partners send return requests in bulk after campaigns.",
      "Each request is triaged manually by a small team today.",
    ],
  };
  assert.equal(
    isGroundedUseCase(oneAnchorOnly, ANCHORS),
    false,
    "one anchor alone is too weak — invented detail rides on it",
  );
  // One anchor plus a number from the research facts IS specific enough.
  assert.equal(
    isGroundedUseCase(oneAnchorOnly, ANCHORS, ["500", "120"]),
    false,
    "the number must appear in the scenario text, not just the facts",
  );
  const oneAnchorPlusFactNumber = {
    name: "Retail returns handling",
    scenario: [
      "Retail partners send about 500 return requests after each campaign.",
      "Each request is triaged manually by a small team today.",
    ],
  };
  assert.equal(
    isGroundedUseCase(oneAnchorPlusFactNumber, ANCHORS, ["500", "120"]),
    true,
    "one anchor plus a number from the research facts is grounded",
  );
  assert.equal(
    isGroundedUseCase(oneAnchorPlusFactNumber, ANCHORS, ["120"]),
    false,
    "an invented number not in the research facts does not count",
  );

  // --- shapeUseCases: the generic one is dropped, the specific ones survive ---
  const shaped = shapeUseCases(
    [
      grounded,
      generic,
      {
        name: "Zendesk migration of historic partner tickets",
        scenario: [
          "Years of partner correspondence sits in Zendesk with per-market tagging.",
          "Account managers still search it when a retailer disputes an old campaign.",
          "Nobody owns the tagging scheme since the last reorganisation.",
        ],
      },
    ],
    ANCHORS,
  );
  assert.equal(shaped.length, 2, "the generic case is dropped, the two specific ones kept");
  assert.ok(!shaped.some((u) => u.name === "Faster customer support"), "generic case is gone");
  assert.equal(shaped[1].scenario.length, 3, "all scenario lines retained");
  assert.ok(
    shaped.every((u) => u.scenario.every(isScenarioLine)),
    "every surviving line is a scenario, not an instruction",
  );

  // One line is a headline, not a scenario.
  assert.deepEqual(
    shapeUseCases(
      [{ name: "Zendesk disputes", scenario: ["Retail partners query redemption totals monthly."] }],
      ANCHORS,
    ),
    [],
    "a single line is not a scenario",
  );
  // Lines stripped as click paths can push a case below the floor — this is the whole
  // point: a use case made of demo steps is discarded entirely.
  assert.deepEqual(
    shapeUseCases(
      [
        {
          name: "Consolidation of multiple tools",
          scenario: [
            "Open the unified inbox dashboard",
            "Click on the email and live chat channel settings",
            "Navigate to the reporting tab to show cross-channel metrics",
          ],
        },
      ],
      ANCHORS,
    ),
    [],
    "the exact click-path output the first build shipped is now discarded",
  );
  // Cap at 3, drop duplicates, and survive junk.
  const many = Array.from({ length: 6 }, (_, i) => ({
    name: `Zendesk case ${i}`,
    scenario: [
      "Retail partners raise redemption queries every campaign cycle.",
      "Zendesk queues the disputes with no per-retailer tagging today.",
    ],
  }));
  assert.equal(shapeUseCases(many, ANCHORS).length, 3, "capped at 3");
  assert.equal(
    shapeUseCases([grounded, { ...grounded }], ANCHORS).length,
    1,
    "duplicate names collapse",
  );
  for (const bad of [undefined, null, [], [null], [{}], "x", 7, [{ name: "x" }]]) {
    assert.deepEqual(shapeUseCases(bad as never, ANCHORS), [], `hostile input ${JSON.stringify(bad)}`);
  }

  // --- shapeGuidance integration ---
  const withUC = shapeGuidance(
    { ...(rawFor(["a@co.com"]) as object), useCases: [grounded, generic] } as never,
    [profile("a@co.com", "A", "D")],
    ASSETS,
    ANCHORS,
  )!;
  assert.equal(withUC.useCases?.length, 1, "only the grounded case reaches the brief");
  assert.equal(
    withUC.useCases?.[0].name,
    "Voucher redemption disputes at campaign close",
    "the right one survived",
  );

  // No anchors (industry and signals unknown) -> no use cases at all, rather than filler.
  const noAnchors = shapeGuidance(
    { ...(rawFor(["a@co.com"]) as object), useCases: [grounded, generic] } as never,
    [profile("a@co.com", "A", "D")],
    ASSETS,
    [],
  )!;
  assert.equal(noAnchors.useCases, undefined, "nothing to ground against -> no use cases key");
  assert.ok(noAnchors.perProspect.length, "the rest of the guidance is unaffected");

  // Omitting the anchors argument must not throw for existing callers.
  const legacy = shapeGuidance(rawFor(["a@co.com"]) as never, [profile("a@co.com", "A", "D")], ASSETS)!;
  assert.equal(legacy.useCases, undefined, "no useCases in, none out");
}

console.log("test-demo-guidance.ts: ok");
