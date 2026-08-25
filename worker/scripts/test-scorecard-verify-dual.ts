#!/usr/bin/env tsx
/**
 * v2.3 — B1: verifyScorecardForLeadershipCap must audit the QIP scorecard AND the
 * qualityCoach dimensions in a single LLM call when both are passed in, not two separate
 * calls, and the resulting `verified` flag must gate both scores identically (see
 * generate.ts, which is the only production caller passing both at once).
 */
import assert from "node:assert/strict";
import { verifyScorecardForLeadershipCap } from "../src/postcall/scorecard-verify.ts";
import { QIP_PROFILES } from "../src/rubric-profiles.ts";
import type { ScorecardDraft, ScorecardLineDraft } from "../src/postcall/scorecard.ts";
import type { QualityCoachDraft } from "../src/postcall/scorecard-verify.ts";

const originalFetch = globalThis.fetch;
function mockFetch(handler: (url: string, init?: RequestInit) => Promise<Response>) {
  globalThis.fetch = handler as typeof fetch;
}
function restoreFetch() {
  globalThis.fetch = originalFetch;
}

function geminiTextResponse(json: unknown): Response {
  return new Response(
    JSON.stringify({
      candidates: [{ content: { parts: [{ text: JSON.stringify(json) }] }, finishReason: "STOP" }],
      usageMetadata: { promptTokenCount: 100, candidatesTokenCount: 50 },
    }),
    { status: 200 },
  );
}

const demo = QIP_PROFILES.find((p) => p.key === "demo")!;

function buildAllTwosScorecard(): ScorecardDraft {
  const lines: ScorecardLineDraft[] = demo.themes.map((theme) => ({
    themeKey: theme.key,
    subParameters: Array.from({ length: 5 }, () => ({
      score: 2 as const,
      evidence: [{ atS: 60, quote: "Solid, specific, evidenced moment.", source: "transcript" as const }],
    })),
    grade: 10,
    credit: theme.credit,
    category: theme.category,
    evidenceUnavailable: false,
    confidence: 0.95,
    coachingNote: null,
  }));
  return {
    rubricId: `${demo.key}-${demo.version}`,
    callType: demo.key,
    rubricVersion: demo.version,
    provisional: false,
    overall: 10,
    totalCredits: demo.totalCredits,
    includedCredits: demo.totalCredits,
    categoryScores: {},
    confidence: 0.95,
    lines,
  };
}

function buildAllFivesQualityCoach(): QualityCoachDraft {
  const names = ["Discovery", "Demo alignment", "Objections", "Value articulation", "Next-step clarity", "Talk balance"];
  return {
    overallScore: 10,
    overallLabel: "Excellent",
    dimensions: names.map((name) => ({
      name,
      score: 5,
      maxScore: 5,
      feedback: "Excellent execution.",
      evidence: "Specific, timestamped moment cited.",
    })),
    strengths: [],
    improvements: [],
    missedOpportunities: [],
  };
}

const env = { GEMINI_API_KEY: "test-key" };

async function testSingleCallCoversBoth() {
  const scorecard = buildAllTwosScorecard();
  const qualityCoach = buildAllFivesQualityCoach();
  let fetchCount = 0;

  mockFetch(async (url) => {
    fetchCount++;
    assert.match(url, /generateContent/);
    const verdicts = [];
    for (const theme of demo.themes) {
      for (let i = 0; i < 5; i++) {
        verdicts.push({ themeKey: theme.key, subParamIndex: i, confirmed: true, reason: "Holds up." });
      }
    }
    for (let i = 0; i < qualityCoach.dimensions.length; i++) {
      verdicts.push({ dimensionIndex: i, confirmed: true, reason: "Holds up." });
    }
    return geminiTextResponse({ verdicts });
  });

  const result = await verifyScorecardForLeadershipCap(env, {
    profile: demo,
    scorecard,
    qualityCoach,
    transcript: "[00:01:00] SE: Solid, specific, evidenced moment.",
  });
  restoreFetch();

  assert.equal(fetchCount, 1, "exactly one LLM call audits both scores");
  assert.equal(result.verified, true, "all confirmed on both sides => verified true");
  assert.equal(result.scorecard!.overall, 10, "QIP overall unchanged when confirmed");
  assert.equal(result.qualityCoach!.overallScore, 10, "qualityCoach overall unchanged when confirmed");
  assert.equal(
    result.justifications.length,
    demo.themes.length * 5 + qualityCoach.dimensions.length,
    "one justification per candidate across both scores",
  );
}

async function testDowngradeOnEitherSideFailsBothUnverified() {
  const scorecard = buildAllTwosScorecard();
  const qualityCoach = buildAllFivesQualityCoach();
  let fetchCount = 0;

  mockFetch(async () => {
    fetchCount++;
    const verdicts = [];
    for (const theme of demo.themes) {
      for (let i = 0; i < 5; i++) {
        verdicts.push({ themeKey: theme.key, subParamIndex: i, confirmed: true, reason: "Holds up." });
      }
    }
    // Downgrade only the very first qualityCoach dimension — QIP side is entirely confirmed.
    qualityCoach.dimensions.forEach((_, i) => {
      verdicts.push(
        i === 0
          ? { dimensionIndex: 0, confirmed: false, newScore: 3, reason: "Generic, not specific." }
          : { dimensionIndex: i, confirmed: true, reason: "Holds up." },
      );
    });
    return geminiTextResponse({ verdicts });
  });

  const result = await verifyScorecardForLeadershipCap(env, {
    profile: demo,
    scorecard,
    qualityCoach,
    transcript: "[00:01:00] SE: Solid, specific, evidenced moment.",
  });
  restoreFetch();

  assert.equal(fetchCount, 1, "still exactly one LLM call");
  assert.equal(result.verified, false, "a single downgrade anywhere fails the shared verified flag");
  assert.equal(result.scorecard!.overall, 10, "QIP side stays at its confirmed value");
  assert.equal(result.qualityCoach!.dimensions[0].score, 3, "downgraded qualityCoach dimension applied");
  assert.ok(result.qualityCoach!.overallScore < 10, "qualityCoach overall drops from the downgrade");
}

async function testQualityCoachOnlyNoScorecard() {
  const qualityCoach = buildAllFivesQualityCoach();
  mockFetch(async () => {
    const verdicts = qualityCoach.dimensions.map((_, i) => ({
      dimensionIndex: i,
      confirmed: true,
      reason: "Holds up.",
    }));
    return geminiTextResponse({ verdicts });
  });

  const result = await verifyScorecardForLeadershipCap(env, {
    qualityCoach,
    transcript: "[00:01:00] SE: Solid, specific, evidenced moment.",
  });
  restoreFetch();

  assert.equal(result.scorecard, undefined, "no scorecard passed in, none returned");
  assert.equal(result.qualityCoach!.overallScore, 10);
  assert.equal(result.verified, true);
}

async function main() {
  await testSingleCallCoversBoth();
  await testDowngradeOnEitherSideFailsBothUnverified();
  await testQualityCoachOnlyNoScorecard();
  console.log("test-scorecard-verify-dual: ok");
}

main().catch((err) => {
  restoreFetch();
  console.error(err);
  process.exit(1);
});
