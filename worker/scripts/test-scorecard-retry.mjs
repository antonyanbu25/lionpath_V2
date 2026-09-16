#!/usr/bin/env -S npx tsx
/**
 * Lane B coverage: scorecard retry/fallback stays no-network via mocked fetch,
 * and ai_run attribution resolution stays no-DB via a mocked PgClient.
 */
import assert from "node:assert/strict";
import { verifyScorecardForLeadershipCap } from "../src/postcall/scorecard-verify.ts";
import { calibrateScorecardToGoldenSet } from "../src/postcall/scorecard-calibrate.ts";
import { resolveAiRunAttribution } from "../src/data/persistence/ai-run.ts";
import { QIP_PROFILES } from "../src/rubric-profiles.ts";

const originalFetch = globalThis.fetch;

function mockFetch(handler) {
  globalThis.fetch = handler;
}

function restoreFetch() {
  globalThis.fetch = originalFetch;
}

function geminiTextResponse(json) {
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

const demo = QIP_PROFILES.find((p) => p.key === "demo");
assert.ok(demo, "demo profile available");
const env = { GEMINI_API_KEY: "test-key", DAILY_TOKEN_BUDGET_ENABLED: "0" };

function buildScorecard() {
  const lines = demo.themes.map((theme) => ({
    themeKey: theme.key,
    subParameters: Array.from({ length: 5 }, () => ({
      score: 1,
      evidence: [{ atS: 60, quote: "Something happened.", source: "transcript" }],
    })),
    grade: 5,
    credit: theme.credit,
    category: theme.category,
    evidenceUnavailable: false,
    confidence: 0.9,
    coachingNote: null,
  }));
  return {
    rubricId: `${demo.key}-${demo.version}`,
    callType: demo.key,
    seMotion: demo.motion,
    rubricVersion: demo.version,
    provisional: false,
    overall: 5,
    totalCredits: demo.totalCredits,
    includedCredits: demo.totalCredits,
    categoryScores: {},
    confidence: 0.9,
    lines,
    dealRiskFlags: [],
  };
}

function keepVerdicts(scorecard) {
  const verdicts = [];
  for (const line of scorecard.lines) {
    if (line.evidenceUnavailable || line.modelOmitted) continue;
    line.subParameters.forEach((sp, i) => {
      verdicts.push({
        themeKey: line.themeKey,
        subParamIndex: i,
        confirmed: true,
        newScore: sp.score,
        reason: "Score is supported.",
      });
    });
  }
  return verdicts;
}

async function testVerifyRetriesRemoteErrorThenSucceeds() {
  const scorecard = buildScorecard();
  let calls = 0;
  mockFetch(async () => {
    calls++;
    if (calls === 1) return new Response("temporary upstream failure", { status: 500 });
    return geminiTextResponse({ verdicts: keepVerdicts(scorecard) });
  });

  try {
    const result = await verifyScorecardForLeadershipCap(
      env,
      {
        profile: demo,
        scorecard,
        transcript: "[00:01:00] SE: Something happened.",
        userId: "usr_test",
        callId: "call_test",
      },
    );

    assert.equal(calls, 2, "verifier retries once after remote_error");
    assert.equal(result.verified, true, "retry success marks verification complete");
    assert.ok(result.scorecard, "scorecard remains non-null");
    assert.equal(result.scorecard.verificationSkipped, undefined);
  } finally {
    restoreFetch();
  }
}

async function testVerifyKeepsPreVerifyScorecardAfterRetryExhaustion() {
  const scorecard = buildScorecard();
  let calls = 0;
  mockFetch(async () => {
    calls++;
    return new Response("temporary upstream failure", { status: 500 });
  });

  try {
    const result = await verifyScorecardForLeadershipCap(
      env,
      {
        profile: demo,
        scorecard,
        transcript: "[00:01:00] SE: Something happened.",
      },
    );

    assert.equal(calls, 2, "verifier stops after one explicit retry");
    assert.equal(result.verified, false);
    assert.ok(result.scorecard, "pre-verify scorecard is preserved");
    assert.equal(result.scorecard.overall, scorecard.overall);
    assert.equal(result.scorecard.verificationSkipped, true);
  } finally {
    restoreFetch();
  }
}

async function testCalibrateKeepsScorecardAfterRetryExhaustion() {
  const scorecard = buildScorecard();
  let calls = 0;
  mockFetch(async () => {
    calls++;
    return new Response("temporary upstream failure", { status: 500 });
  });

  try {
    const result = await calibrateScorecardToGoldenSet(
      env,
      {
        profile: demo,
        scorecard,
        transcript: "[00:01:00] SE: Something happened.",
        seMotion: "new_business",
        callType: "demo",
      },
    );

    assert.equal(calls, 2, "calibrator stops after one explicit retry");
    assert.equal(result.calibrated, false);
    assert.ok(result.scorecard, "pre-calibration scorecard is preserved");
    assert.equal(result.scorecard.verificationSkipped, true);
  } finally {
    restoreFetch();
  }
}

async function testAiRunAttributionResolvesActivityAndAppUserPublicId() {
  const queries = [];
  const fakeClient = {
    async query(sql, params) {
      queries.push({ sql, params });
      if (sql.includes("resolve_internal_id")) return { rows: [{ id: 777 }] };
      if (sql.includes("FROM user_identity")) return { rows: [] };
      if (sql.includes("FROM app_user")) return { rows: [{ user_id: 42 }] };
      throw new Error(`Unexpected query: ${sql}`);
    },
  };

  const result = await resolveAiRunAttribution(fakeClient, {
    callId: "call_123",
    userId: "usr_owner",
  });

  assert.deepEqual(result, { activityId: 777, userIdInternal: 42 });
  assert.equal(queries[0].params[1], "act_call_123", "callId resolves as act_<callId>");
}

async function testAiRunAttributionResolvesFirebaseUid() {
  const fakeClient = {
    async query(sql) {
      if (sql.includes("resolve_internal_id")) return { rows: [{ id: 778 }] };
      if (sql.includes("FROM user_identity")) return { rows: [{ user_id: 43 }] };
      if (sql.includes("FROM app_user")) throw new Error("app_user fallback should not run");
      throw new Error(`Unexpected query: ${sql}`);
    },
  };

  const result = await resolveAiRunAttribution(fakeClient, {
    callId: "act_call_456",
    userId: "firebase_uid",
  });

  assert.deepEqual(result, { activityId: 778, userIdInternal: 43 });
}

await testVerifyRetriesRemoteErrorThenSucceeds();
await testVerifyKeepsPreVerifyScorecardAfterRetryExhaustion();
await testCalibrateKeepsScorecardAfterRetryExhaustion();
await testAiRunAttributionResolvesActivityAndAppUserPublicId();
await testAiRunAttributionResolvesFirebaseUid();

console.log("test-scorecard-retry: PASS");
