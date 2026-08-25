#!/usr/bin/env tsx
/**
 * v2.3 — B3: the verifier prompt windows the transcript around cited evidence timestamps
 * instead of taking a flat last-N-words tail. On a long call, evidence for an early
 * sub-parameter would otherwise fall outside a flat tail entirely, biasing the verifier
 * toward downgrading for missing context rather than genuine weakness.
 */
import assert from "node:assert/strict";
import { verifyScorecardForLeadershipCap } from "../src/postcall/scorecard-verify.ts";
import { QIP_PROFILES } from "../src/rubric-profiles.ts";
import type { ScorecardDraft, ScorecardLineDraft } from "../src/postcall/scorecard.ts";

const originalFetch = globalThis.fetch;
function mockFetchCapturing(onRequest: (userText: string) => void, verdicts: unknown[]) {
  globalThis.fetch = (async (_url: string, init?: RequestInit) => {
    const body = JSON.parse(String(init?.body ?? "{}"));
    const userText = body?.contents?.[0]?.parts?.[0]?.text ?? "";
    onRequest(userText);
    return new Response(
      JSON.stringify({
        candidates: [{ content: { parts: [{ text: JSON.stringify({ verdicts }) }] }, finishReason: "STOP" }],
        usageMetadata: { promptTokenCount: 100, candidatesTokenCount: 50 },
      }),
      { status: 200 },
    );
  }) as typeof fetch;
}
function restoreFetch() {
  globalThis.fetch = originalFetch;
}

const demo = QIP_PROFILES.find((p) => p.key === "demo")!;

/** One score-2 sub-parameter with evidence at t=30s, cited by a unique marker phrase. */
function buildScorecardWithEarlyEvidence(): ScorecardDraft {
  const firstTheme = demo.themes[0].key;
  const lines: ScorecardLineDraft[] = demo.themes.map((theme) => ({
    themeKey: theme.key,
    subParameters: Array.from({ length: 5 }, (_, i) => ({
      score: (theme.key === firstTheme && i === 0 ? 2 : 1) as 0 | 1 | 2,
      evidence:
        theme.key === firstTheme && i === 0
          ? [{ atS: 30, quote: "MARKER_EARLY_EVIDENCE_PHRASE", source: "transcript" as const }]
          : [],
    })),
    grade: theme.key === firstTheme ? 6 : 5,
    credit: theme.credit,
    category: theme.category,
    evidenceUnavailable: false,
    confidence: 0.9,
    coachingNote: null,
  }));
  return {
    rubricId: `${demo.key}-${demo.version}`,
    callType: demo.key,
    rubricVersion: demo.version,
    provisional: false,
    overall: 8.5,
    totalCredits: demo.totalCredits,
    includedCredits: demo.totalCredits,
    categoryScores: {},
    confidence: 0.9,
    lines,
  };
}

/** A VTT transcript long enough (>5500 words) that a flat tail would drop the t=30s cue. */
function buildLongTranscriptWithEarlyMarker(): string {
  const cueAt = (startS: number, text: string) => {
    const fmt = (s: number) => {
      const m = Math.floor(s / 60);
      const sec = s % 60;
      return `00:${String(m).padStart(2, "0")}:${String(sec).padStart(2, "0")}.000`;
    };
    return [`${fmt(startS)} --> ${fmt(startS + 4)}`, text, ""].join("\n");
  };

  const lines = ["WEBVTT", ""];
  lines.push(cueAt(30, "SE: MARKER_EARLY_EVIDENCE_PHRASE about their ticket volume."));

  // Pad with ~7000 words of filler well after the marker so a flat 5500-word tail would
  // never reach back to t=30s.
  let t = 120;
  let words = 0;
  while (words < 7000) {
    const filler = "filler word ".repeat(20).trim();
    lines.push(cueAt(t, `SE: ${filler}`));
    words += 40;
    t += 6;
  }
  return lines.join("\n");
}

const env = { GEMINI_API_KEY: "test-key" };

async function testEarlyEvidenceSurvivesWindowing() {
  const scorecard = buildScorecardWithEarlyEvidence();
  const transcript = buildLongTranscriptWithEarlyMarker();

  let capturedPrompt = "";
  mockFetchCapturing((userText) => {
    capturedPrompt = userText;
  }, [{ themeKey: demo.themes[0].key, subParamIndex: 0, confirmed: true, reason: "Marker phrase confirmed." }]);

  const result = await verifyScorecardForLeadershipCap(env, {
    profile: demo,
    scorecard,
    transcript,
  });
  restoreFetch();

  assert.ok(
    capturedPrompt.includes("MARKER_EARLY_EVIDENCE_PHRASE"),
    "windowed transcript retains evidence cited near the start of a long call",
  );
  assert.equal(result.verified, true);
  console.log("testEarlyEvidenceSurvivesWindowing: ok");
}

async function testFallsBackToFlatTailWithoutTimestamps() {
  // qualityCoach-only candidates carry no atS timestamp to window around — must not throw and
  // must still produce a non-empty transcript block (the flat-tail fallback).
  const qualityCoach = {
    overallScore: 10,
    overallLabel: "Excellent",
    dimensions: [
      { name: "Discovery", score: 5, maxScore: 5, feedback: "ok", evidence: "Specific moment cited." },
    ],
    strengths: [],
    improvements: [],
    missedOpportunities: [],
  };

  let capturedPrompt = "";
  mockFetchCapturing((userText) => {
    capturedPrompt = userText;
  }, [{ dimensionIndex: 0, confirmed: true, reason: "Holds up." }]);

  const result = await verifyScorecardForLeadershipCap(env, {
    qualityCoach,
    transcript: "SE: Thanks for joining today.\nCustomer: Happy to be here.",
  });
  restoreFetch();

  assert.ok(capturedPrompt.includes("=== TIMESTAMPED TRANSCRIPT ==="));
  assert.equal(result.verified, true);
  console.log("testFallsBackToFlatTailWithoutTimestamps: ok");
}

async function main() {
  await testEarlyEvidenceSurvivesWindowing();
  await testFallsBackToFlatTailWithoutTimestamps();
  console.log("test-scorecard-verify-transcript-window: ok");
}

main().catch((err) => {
  restoreFetch();
  console.error(err);
  process.exit(1);
});
