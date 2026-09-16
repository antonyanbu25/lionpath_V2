#!/usr/bin/env tsx
/**
 * Unit tests for the golden-set calibration pass — worker/src/postcall/scorecard-calibrate.ts.
 * Mocks Gemini fetch (same pattern as test-scorecard-verify.ts).
 */
import assert from "node:assert/strict";
import { calibrateScorecardToGoldenSet } from "../src/postcall/scorecard-calibrate.ts";
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
const planUpgrade = QIP_PROFILES.find((p) => p.key === "demo_plan_upgrade")!;
const discoveryNb = QIP_PROFILES.find((p) => p.key === "discovery" && p.motion === "new_business")!;

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
          reason: "Matches the human bar.",
        },
      );
    });
  }
  return verdicts;
}

function buildAllOnesScorecard(profile = demo): ScorecardDraft {
  const lines: ScorecardLineDraft[] = profile.themes.map((theme) => ({
    themeKey: theme.key,
    subParameters: Array.from({ length: 5 }, () => ({
      score: 1 as const,
      evidence: [{ atS: 60, quote: "Something happened.", source: "transcript" as const }],
    })),
    grade: 5,
    credit: theme.credit,
    category: theme.category,
    evidenceUnavailable: false,
    confidence: 0.9,
    coachingNote: null,
  }));
  return {
    rubricId: `${profile.key}-${profile.version}`,
    callType: profile.key,
    seMotion: profile.motion,
    rubricVersion: profile.version,
    provisional: false,
    overall: 5,
    totalCredits: profile.totalCredits,
    includedCredits: profile.totalCredits,
    categoryScores: {},
    confidence: 0.9,
    lines,
    dealRiskFlags: [],
  };
}

const env = { GEMINI_API_KEY: "test-key" };

async function testHuntingPromptIncludesGoldenExamples() {
  const scorecard = buildAllOnesScorecard();
  let system = "";
  let user = "";
  mockFetch(async (_url, init) => {
    const body = JSON.parse(String(init?.body ?? "{}"));
    system = body?.systemInstruction?.parts?.[0]?.text ?? JSON.stringify(body);
    user = body?.contents?.[0]?.parts?.[0]?.text ?? "";
    return geminiTextResponse({ verdicts: keepVerdicts(scorecard) });
  });

  const result = await calibrateScorecardToGoldenSet(env, {
    profile: demo,
    scorecard,
    transcript: "[00:01:00] SE: Something happened.",
    seMotion: "new_business",
    callType: "demo",
  });
  restoreFetch();

  const blob = `${system}\n${user}`;
  assert.match(blob, /Shamron/);
  assert.match(blob, /Nitish/);
  assert.match(blob, /value=0/);
  assert.doesNotMatch(blob, /Pradeep/);
  assert.equal(result.calibrated, true);
  assert.equal(result.scorecard?.overall, 5);
  assert.equal(result.justifications.length, demo.themes.length * 5);
}

async function testExpansionPromptSelectsPlanUpgrade() {
  const scorecard = buildAllOnesScorecard(planUpgrade);
  let blob = "";
  mockFetch(async (_url, init) => {
    const body = JSON.parse(String(init?.body ?? "{}"));
    blob = JSON.stringify(body);
    return geminiTextResponse({ verdicts: keepVerdicts(scorecard) });
  });

  await calibrateScorecardToGoldenSet(env, {
    profile: planUpgrade,
    scorecard,
    transcript: "[00:01:00] SE: Positioning call.",
    seMotion: "expansion",
    callType: "demo_plan_upgrade",
  });
  restoreFetch();

  assert.match(blob, /Pradeep/);
  assert.doesNotMatch(blob, /Shamron/);
}

async function testLowersCourtesyOnesOnAbsentTheme() {
  const scorecard = buildAllOnesScorecard();
  mockFetch(async () => {
    return geminiTextResponse({
      verdicts: keepVerdicts(scorecard, (themeKey, i) => {
        if (themeKey === "value") {
          return {
            themeKey,
            subParamIndex: i,
            confirmed: false,
            newScore: 0,
            reason: "No quantified ROI on the call.",
          };
        }
        return undefined;
      }),
    });
  });

  const result = await calibrateScorecardToGoldenSet(env, {
    profile: demo,
    scorecard,
    transcript: "[00:01:00] SE: Something happened.",
    seMotion: "new_business",
    callType: "demo",
  });
  restoreFetch();

  const value = result.scorecard?.lines.find((l) => l.themeKey === "value");
  assert.equal(value?.grade, 0);
  assert.ok((result.scorecard?.overall ?? 10) < 5, "zeroing a credit-3 theme lowers overall");
  assert.equal(result.calibrated, true);
}

async function testSkipWhenDisabled() {
  let fetchCalled = false;
  mockFetch(async () => {
    fetchCalled = true;
    throw new Error("must not call LLM when golden pass is off");
  });
  const scorecard = buildAllOnesScorecard();
  const result = await calibrateScorecardToGoldenSet(
    { GEMINI_API_KEY: "test-key", SCORECARD_GOLDEN_PASS: "0" },
    {
      profile: demo,
      scorecard,
      transcript: "irrelevant",
      seMotion: "new_business",
      callType: "demo",
    },
  );
  restoreFetch();
  assert.equal(fetchCalled, false);
  assert.equal(result.calibrated, false);
  assert.equal(result.scorecard, scorecard);
}

async function testIdempotentWhenAlreadyCalibrated() {
  let fetchCalled = false;
  mockFetch(async () => {
    fetchCalled = true;
    throw new Error("must not recall LLM");
  });
  const scorecard = { ...buildAllOnesScorecard(), goldenCalibrated: true, goldenJustifications: [] };
  const result = await calibrateScorecardToGoldenSet(env, {
    profile: demo,
    scorecard,
    transcript: "irrelevant",
    seMotion: "new_business",
    callType: "demo",
  });
  restoreFetch();
  assert.equal(fetchCalled, false);
  assert.equal(result.calibrated, true);
}

async function testVacuousWhenNothingScorable() {
  const scorecard = buildAllOnesScorecard();
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
    throw new Error("must not call LLM");
  });
  const result = await calibrateScorecardToGoldenSet(env, {
    profile: demo,
    scorecard: unavailable,
    transcript: "irrelevant",
    seMotion: "new_business",
    callType: "demo",
  });
  restoreFetch();
  assert.equal(fetchCalled, false);
  assert.equal(result.calibrated, true);
}

async function testDiscoveryPromptHasNoDemoTables() {
  const scorecard = buildAllOnesScorecard(discoveryNb);
  let blob = "";
  mockFetch(async (_url, init) => {
    const body = JSON.parse(String(init?.body ?? "{}"));
    blob = JSON.stringify(body);
    return geminiTextResponse({ verdicts: keepVerdicts(scorecard) });
  });
  await calibrateScorecardToGoldenSet(env, {
    profile: discoveryNb,
    scorecard,
    transcript: "[00:01:00] SE: Something happened.",
    seMotion: "new_business",
    callType: "discovery",
  });
  restoreFetch();
  assert.doesNotMatch(blob, /Shamron/);
  assert.doesNotMatch(blob, /Nitish/);
  assert.match(blob, /incident/i);
  assert.match(blob, /hypothesis/i);
}

async function testGoldenPolarizeAbsentDiscoveryIncidentsToNa() {
  const scorecard = buildAllOnesScorecard(discoveryNb);
  mockFetch(async () => {
    return geminiTextResponse({
      verdicts: keepVerdicts(scorecard, (themeKey, i) => {
        if (themeKey === "objections" || themeKey === "comp_pitch" || themeKey === "case_study") {
          return {
            themeKey,
            subParamIndex: i,
            confirmed: false,
            newScore: 0,
            reason: "Incident never occurred.",
          };
        }
        return undefined;
      }),
    });
  });
  const result = await calibrateScorecardToGoldenSet(env, {
    profile: discoveryNb,
    scorecard,
    transcript: "[00:01:00] SE: Something happened.",
    seMotion: "new_business",
    callType: "discovery",
  });
  restoreFetch();
  const obj = result.scorecard?.lines.find((l) => l.themeKey === "objections");
  assert.equal(obj?.evidenceUnavailable, true);
  assert.equal(obj?.grade, 0);
  const incidentCredits = discoveryNb.themes
    .filter((t) => t.key === "objections" || t.key === "comp_pitch" || t.key === "case_study")
    .reduce((a, t) => a + t.credit, 0);
  assert.equal(result.scorecard?.includedCredits, discoveryNb.totalCredits - incidentCredits);
}

async function testGoldenFumbledObjectionStaysInDenom() {
  const scorecard = buildAllOnesScorecard(discoveryNb);
  scorecard.lines = scorecard.lines.map((line) => {
    if (line.themeKey !== "objections") return line;
    return {
      ...line,
      subParameters: line.subParameters.map((sp) => ({
        ...sp,
        evidence: [{ atS: 90, quote: "That's too expensive for us.", source: "transcript" as const }],
      })),
    };
  });
  mockFetch(async () => {
    return geminiTextResponse({
      verdicts: keepVerdicts(scorecard, (themeKey, i) => {
        if (themeKey === "objections") {
          return {
            themeKey,
            subParamIndex: i,
            confirmed: false,
            newScore: 0,
            reason: "Pushback happened; SE did not handle it.",
          };
        }
        return undefined;
      }),
    });
  });
  const result = await calibrateScorecardToGoldenSet(env, {
    profile: discoveryNb,
    scorecard,
    transcript: "[00:01:30] Customer: That's too expensive for us.",
    seMotion: "new_business",
    callType: "discovery",
  });
  restoreFetch();
  const obj = result.scorecard?.lines.find((l) => l.themeKey === "objections");
  assert.equal(obj?.evidenceUnavailable, false);
  assert.equal(obj?.grade, 0);
  assert.equal(result.scorecard?.includedCredits, discoveryNb.totalCredits);
}

async function main() {
  await testHuntingPromptIncludesGoldenExamples();
  await testExpansionPromptSelectsPlanUpgrade();
  await testLowersCourtesyOnesOnAbsentTheme();
  await testSkipWhenDisabled();
  await testIdempotentWhenAlreadyCalibrated();
  await testVacuousWhenNothingScorable();
  await testDiscoveryPromptHasNoDemoTables();
  await testGoldenPolarizeAbsentDiscoveryIncidentsToNa();
  await testGoldenFumbledObjectionStaysInDenom();
  console.log("test-scorecard-calibrate: ok");
}

main().catch((err) => {
  restoreFetch();
  console.error(err);
  process.exit(1);
});
