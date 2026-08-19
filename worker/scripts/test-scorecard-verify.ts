#!/usr/bin/env tsx
/**
 * Unit tests for the v2.2 adversarial verifier — worker/src/postcall/scorecard-verify.ts.
 * Mocks the Gemini fetch call (same pattern as test-gemini-batch.ts) so this stays a fast,
 * deterministic, no-network unit test while still exercising the real
 * verifyScorecardForLeadershipCap() code path end to end: confirm path, downgrade path, and
 * the fail-safe "verifier omitted a verdict" path all recompute overall/grades via the same
 * scoreCall() the rest of QIP scoring uses (never a hand-rolled second implementation).
 */
import assert from "node:assert/strict";
import {
  verifyScorecardForLeadershipCap,
  LEADERSHIP_CAP_THRESHOLD,
} from "../src/postcall/scorecard-verify.ts";
import { QIP_PROFILES } from "../src/rubric-profiles.ts";
import type { ScorecardDraft, ScorecardLineDraft } from "../src/postcall/scorecard.ts";

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
      candidates: [
        {
          content: { parts: [{ text: JSON.stringify(json) }] },
          finishReason: "STOP",
        },
      ],
      usageMetadata: { promptTokenCount: 100, candidatesTokenCount: 50 },
    }),
    { status: 200 },
  );
}

const demo = QIP_PROFILES.find((p) => p.key === "demo")!;

/** Every sub-parameter across every theme scored 2 => overall 10, well above the cap. */
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

const env = { GEMINI_API_KEY: "test-key" };

async function testAllConfirmed() {
  const scorecard = buildAllTwosScorecard();
  mockFetch(async (url) => {
    assert.match(url, /generateContent/);
    const verdicts = [];
    for (const theme of demo.themes) {
      for (let i = 0; i < 5; i++) {
        verdicts.push({
          themeKey: theme.key,
          subParamIndex: i,
          confirmed: true,
          reason: "Transcript quote is specific and timestamped.",
        });
      }
    }
    return geminiTextResponse({ verdicts });
  });

  const result = await verifyScorecardForLeadershipCap(env, {
    profile: demo,
    scorecard,
    transcript: "[00:01:00] SE: Solid, specific, evidenced moment.",
  });
  restoreFetch();

  assert.equal(result.verified, true, "all confirmed => verified true");
  assert.equal(result.scorecard.overall, 10, "overall unchanged when every sub-param confirmed");
  assert.equal(
    result.justifications.length,
    demo.themes.length * 5,
    "one justification per candidate",
  );
  assert.ok(
    result.justifications.every((j) => j.confirmed && j.newScore === 2),
    "every justification reflects confirmation at score 2",
  );
}

async function testSomeDowngraded() {
  const scorecard = buildAllTwosScorecard();
  const firstTheme = demo.themes[0].key;
  const secondTheme = demo.themes[1].key;

  mockFetch(async () => {
    const verdicts = [];
    for (const theme of demo.themes) {
      for (let i = 0; i < 5; i++) {
        if (theme.key === firstTheme && i === 0) {
          verdicts.push({
            themeKey: theme.key,
            subParamIndex: i,
            confirmed: false,
            newScore: 1,
            reason: "Evidence is generic, does not show excellence.",
          });
        } else if (theme.key === secondTheme && i === 2) {
          verdicts.push({
            themeKey: theme.key,
            subParamIndex: i,
            confirmed: false,
            newScore: 0,
            reason: "No real evidence for this claim on re-read.",
          });
        } else {
          verdicts.push({
            themeKey: theme.key,
            subParamIndex: i,
            confirmed: true,
            reason: "Holds up on re-examination.",
          });
        }
      }
    }
    return geminiTextResponse({ verdicts });
  });

  const result = await verifyScorecardForLeadershipCap(env, {
    profile: demo,
    scorecard,
    transcript: "[00:01:00] SE: Solid, specific, evidenced moment.",
  });
  restoreFetch();

  assert.equal(result.verified, false, "any downgrade => verified false");
  assert.ok(result.scorecard.overall < 10, "overall drops below 10 once sub-params are downgraded");

  const firstLine = result.scorecard.lines.find((l) => l.themeKey === firstTheme)!;
  assert.equal(firstLine.subParameters[0].score, 1, "downgraded sub-param 0 -> score 1");
  assert.equal(firstLine.grade, 9, "theme grade recomputed from the downgraded sub-param (10 -> 9)");

  const secondLine = result.scorecard.lines.find((l) => l.themeKey === secondTheme)!;
  assert.equal(secondLine.subParameters[2].score, 0, "downgraded sub-param 2 -> score 0");
  assert.equal(secondLine.grade, 8, "theme grade recomputed (10 -> 8) for a downgrade to 0");

  const downgradeJustifications = result.justifications.filter((j) => !j.confirmed);
  assert.equal(downgradeJustifications.length, 2, "exactly the two downgraded sub-params are flagged");
}

async function testMissingVerdictFailsSafe() {
  const scorecard = buildAllTwosScorecard();
  const omittedTheme = demo.themes[0].key;

  mockFetch(async () => {
    const verdicts = [];
    for (const theme of demo.themes) {
      for (let i = 0; i < 5; i++) {
        if (theme.key === omittedTheme && i === 0) continue; // model silently drops this verdict
        verdicts.push({ themeKey: theme.key, subParamIndex: i, confirmed: true, reason: "ok" });
      }
    }
    return geminiTextResponse({ verdicts });
  });

  const result = await verifyScorecardForLeadershipCap(env, {
    profile: demo,
    scorecard,
    transcript: "[00:01:00] SE: Solid, specific, evidenced moment.",
  });
  restoreFetch();

  assert.equal(result.verified, false, "a missing verdict fails safe to unverified");
  const line = result.scorecard.lines.find((l) => l.themeKey === omittedTheme)!;
  assert.equal(line.subParameters[0].score, 1, "missing verdict conservatively downgrades to 1, not 0 or left at 2");
  const j = result.justifications.find((x) => x.themeKey === omittedTheme && x.subParamIndex === 0)!;
  assert.equal(j.confirmed, false);
  assert.match(j.justification, /no verdict/i);
}

async function testVacuousWhenNoScoreTwoCandidates() {
  const scorecard = buildAllTwosScorecard();
  // Downgrade every candidate to 1 in-memory before calling verify again — but simpler: build
  // a scorecard with no score-2 sub-parameters at all so the verifier has nothing to challenge.
  const noTwos: ScorecardDraft = {
    ...scorecard,
    lines: scorecard.lines.map((l) => ({
      ...l,
      subParameters: l.subParameters.map((sp) => ({ ...sp, score: 1 as const })),
      grade: 5,
    })),
  };

  let fetchCalled = false;
  mockFetch(async () => {
    fetchCalled = true;
    throw new Error("must not call the LLM when there are no score-2 candidates");
  });

  const result = await verifyScorecardForLeadershipCap(env, {
    profile: demo,
    scorecard: noTwos,
    transcript: "irrelevant",
  });
  restoreFetch();

  assert.equal(fetchCalled, false, "no LLM call made when there is nothing to verify");
  assert.equal(result.verified, true, "vacuously verified with no score-2 candidates");
  assert.equal(result.justifications.length, 0);
  assert.deepEqual(result.scorecard, noTwos, "scorecard returned unchanged");
}

async function main() {
  assert.equal(LEADERSHIP_CAP_THRESHOLD, 8.0, "sanity: exported threshold matches quality-score.ts");
  await testAllConfirmed();
  await testSomeDowngraded();
  await testMissingVerdictFailsSafe();
  await testVacuousWhenNoScoreTwoCandidates();
  console.log("test-scorecard-verify: ok");
}

main().catch((err) => {
  restoreFetch();
  console.error(err);
  process.exit(1);
});
