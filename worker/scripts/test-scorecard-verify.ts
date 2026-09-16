#!/usr/bin/env tsx
/**
 * Unit tests for the scorecard reevaluator — worker/src/postcall/scorecard-verify.ts.
 * Mocks the Gemini fetch call (same pattern as test-gemini-batch.ts) so this stays a fast,
 * deterministic, no-network unit test while still exercising the real
 * verifyScorecardForLeadershipCap() code path end to end: keep, lower, raise, and
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

function keepVerdicts(
  scorecard: ScorecardDraft,
  patch?: (themeKey: string, i: number) => Record<string, unknown> | null,
): Record<string, unknown>[] {
  const verdicts: Record<string, unknown>[] = [];
  for (const line of scorecard.lines) {
    if (line.evidenceUnavailable || line.modelOmitted) continue;
    line.subParameters.forEach((sp, i) => {
      const override = patch?.(line.themeKey, i);
      if (override === null) return;
      verdicts.push(
        override ?? {
          themeKey: line.themeKey,
          subParamIndex: i,
          confirmed: true,
          newScore: sp.score,
          reason: "Holds up on re-examination.",
        },
      );
    });
  }
  return verdicts;
}

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

function buildAllOnesScorecard(): ScorecardDraft {
  const allTwos = buildAllTwosScorecard();
  return {
    ...allTwos,
    overall: 5,
    lines: allTwos.lines.map((l) => ({
      ...l,
      subParameters: l.subParameters.map((sp) => ({ ...sp, score: 1 as const })),
      grade: 5,
    })),
  };
}

const env = { GEMINI_API_KEY: "test-key" };

async function testAllConfirmed() {
  const scorecard = buildAllTwosScorecard();
  mockFetch(async (url) => {
    assert.match(url, /generateContent/);
    return geminiTextResponse({ verdicts: keepVerdicts(scorecard) });
  });

  const result = await verifyScorecardForLeadershipCap(env, {
    profile: demo,
    scorecard,
    transcript: "[00:01:00] SE: Solid, specific, evidenced moment.",
  });
  restoreFetch();

  assert.equal(result.verified, true, "complete reevaluation => verified true");
  assert.equal(result.scorecard.overall, 10, "overall unchanged when every sub-param kept");
  assert.equal(
    result.justifications.length,
    demo.themes.length * 5,
    "one justification per candidate",
  );
  assert.ok(
    result.justifications.every((j) => j.confirmed && j.newScore === 2),
    "every justification reflects keeping score 2",
  );
}

async function testSomeLowered() {
  const scorecard = buildAllTwosScorecard();
  const firstTheme = demo.themes[0].key;
  const secondTheme = demo.themes[1].key;

  mockFetch(async () => {
    return geminiTextResponse({
      verdicts: keepVerdicts(scorecard, (themeKey, i) => {
        if (themeKey === firstTheme && i === 0) {
          return {
            themeKey,
            subParamIndex: i,
            confirmed: false,
            newScore: 1,
            reason: "Evidence is generic, does not show excellence.",
          };
        }
        if (themeKey === secondTheme && i === 2) {
          return {
            themeKey,
            subParamIndex: i,
            confirmed: false,
            newScore: 0,
            reason: "No real evidence for this claim on re-read.",
          };
        }
        return undefined;
      }),
    });
  });

  const result = await verifyScorecardForLeadershipCap(env, {
    profile: demo,
    scorecard,
    transcript: "[00:01:00] SE: Solid, specific, evidenced moment.",
  });
  restoreFetch();

  assert.equal(result.verified, true, "lowering scores does not fail a complete reevaluation");
  assert.ok(result.scorecard.overall < 10, "overall drops below 10 once sub-params are lowered");

  const firstLine = result.scorecard.lines.find((l) => l.themeKey === firstTheme)!;
  assert.equal(firstLine.subParameters[0].score, 1, "lowered sub-param 0 -> score 1");
  assert.equal(firstLine.grade, 9, "theme grade recomputed from the lowered sub-param (10 -> 9)");

  const secondLine = result.scorecard.lines.find((l) => l.themeKey === secondTheme)!;
  assert.equal(secondLine.subParameters[2].score, 0, "lowered sub-param 2 -> score 0");
  assert.equal(secondLine.grade, 8, "theme grade recomputed (10 -> 8) for a drop to 0");

  const changed = result.justifications.filter((j) => !j.confirmed);
  assert.equal(changed.length, 2, "exactly the two changed sub-params are flagged");
}

async function testRaisesAOneToTwo() {
  const scorecard = buildAllOnesScorecard();
  const firstTheme = demo.themes[0].key;
  let fetchCalled = false;

  mockFetch(async () => {
    fetchCalled = true;
    return geminiTextResponse({
      verdicts: keepVerdicts(scorecard, (themeKey, i) => {
        if (themeKey === firstTheme && i === 0) {
          return {
            themeKey,
            subParamIndex: i,
            confirmed: false,
            newScore: 2,
            reason: "Transcript shows excellent execution at 60s.",
          };
        }
        return undefined;
      }),
    });
  });

  const result = await verifyScorecardForLeadershipCap(env, {
    profile: demo,
    scorecard,
    transcript: "[00:01:00] SE: Solid, specific, evidenced moment.",
  });
  restoreFetch();

  assert.equal(fetchCalled, true, "all-1s scorecard is still reevaluated — not skipped");
  assert.equal(result.verified, true);
  const line = result.scorecard.lines.find((l) => l.themeKey === firstTheme)!;
  assert.equal(line.subParameters[0].score, 2, "first-pass 1 raised to 2");
  assert.equal(line.grade, 6, "theme grade recomputed from the raised sub-param (5 -> 6)");
  assert.ok(result.scorecard.overall > 5, "overall rises when a 1 is raised to 2");
}

async function testMissingVerdictKeepsFirstPass() {
  const scorecard = buildAllTwosScorecard();
  const omittedTheme = demo.themes[0].key;

  mockFetch(async () => {
    return geminiTextResponse({
      verdicts: keepVerdicts(scorecard, (themeKey, i) => (themeKey === omittedTheme && i === 0 ? null : undefined)),
    });
  });

  const result = await verifyScorecardForLeadershipCap(env, {
    profile: demo,
    scorecard,
    transcript: "[00:01:00] SE: Solid, specific, evidenced moment.",
  });
  restoreFetch();

  assert.equal(result.verified, false, "a missing verdict fails the complete-reevaluation flag");
  const line = result.scorecard.lines.find((l) => l.themeKey === omittedTheme)!;
  assert.equal(line.subParameters[0].score, 2, "missing verdict keeps the first-pass score");
  const j = result.justifications.find((x) => x.themeKey === omittedTheme && x.subParamIndex === 0)!;
  assert.equal(j.confirmed, false);
  assert.equal(j.newScore, 2);
  assert.match(j.justification, /no verdict/i);
}

async function testVacuousWhenNothingScorable() {
  const scorecard = buildAllTwosScorecard();
  const unavailable: ScorecardDraft = {
    ...scorecard,
    lines: scorecard.lines.map((l) => ({
      ...l,
      evidenceUnavailable: true,
      subParameters: l.subParameters.map((sp) => ({ ...sp, score: 0 as const })),
      grade: 0,
    })),
  };

  let fetchCalled = false;
  mockFetch(async () => {
    fetchCalled = true;
    throw new Error("must not call the LLM when nothing is scorable");
  });

  const result = await verifyScorecardForLeadershipCap(env, {
    profile: demo,
    scorecard: unavailable,
    transcript: "irrelevant",
  });
  restoreFetch();

  assert.equal(fetchCalled, false, "no LLM call when every line is evidenceUnavailable");
  assert.equal(result.verified, true, "vacuously verified with nothing to rescore");
  assert.equal(result.justifications.length, 0);
  assert.deepEqual(result.scorecard, unavailable, "scorecard returned unchanged");
}

async function main() {
  assert.equal(LEADERSHIP_CAP_THRESHOLD, 8.0, "sanity: exported threshold matches quality-score.ts");
  await testAllConfirmed();
  await testSomeLowered();
  await testRaisesAOneToTwo();
  await testMissingVerdictKeepsFirstPass();
  await testVacuousWhenNothingScorable();
  console.log("test-scorecard-verify: ok");
}

main().catch((err) => {
  restoreFetch();
  console.error(err);
  process.exit(1);
});
