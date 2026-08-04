#!/usr/bin/env tsx
/**
 * Parity: batched scorecard hydration vs serial per-call reads.
 *
 * Usage:
 *   npm run test:batched-hydration --workspace=worker
 *
 * Optional live mode:
 *   FIREBASE_PROJECT_ID=... GOOGLE_APPLICATION_CREDENTIALS=... TEST_OWNER_ID=usr_xxx \
 *     npm run test:batched-hydration --workspace=worker
 */

import { pathToFileURL } from "node:url";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import {
  listScorecardsByCall,
  listScorecardLinesByCall,
  listScorecardsForCalls,
  listScorecardLinesForCalls,
} from "../src/data/repositories/scorecards";

const __dirname = dirname(fileURLToPath(import.meta.url));
const WEB_ROOT = resolve(__dirname, "../../web");

function stableJson(value: unknown): string {
  return JSON.stringify(value, (_k, v) => (v instanceof Map ? Object.fromEntries(v) : v));
}

function assertEqual(label: string, a: unknown, b: unknown) {
  const sa = stableJson(a);
  const sb = stableJson(b);
  if (sa !== sb) {
    console.error(`FAIL ${label}`);
    console.error("left:", sa.slice(0, 800));
    console.error("right:", sb.slice(0, 800));
    process.exitCode = 1;
    throw new Error(`Parity mismatch: ${label}`);
  }
  console.log(`OK ${label}`);
}

/** Build 50-call fixture with varied scorecard coverage. */
function buildFixture() {
  const callIds: string[] = [];
  const scorecardsByCall = new Map<string, object[]>();
  const linesByCall = new Map<string, object[]>();

  for (let i = 0; i < 50; i++) {
    const callId = `pcall_batch_${i}`;
    callIds.push(callId);

    if (i % 7 === 0) continue; // no scorecard
    if (i % 11 === 0) continue; // scorecard added below without lines

    const scorecardId = `scr_batch_${i}`;
    scorecardsByCall.set(callId, [
      {
        id: scorecardId,
        callId,
        callType: i % 2 === 0 ? "demo" : "discovery",
        rubricVersion: "2.1",
        overall: 6 + (i % 4),
        confidence: 0.7 + (i % 3) * 0.1,
        provisional: i % 13 === 0,
        categoryScores: { communication_control: 7 + (i % 2) },
      },
    ]);

    if (i % 11 === 0) continue; // card only, no lines

    linesByCall.set(callId, [
      {
        themeKey: "call_flow",
        grade: 7 + (i % 3),
        credit: 3,
        category: "communication_control",
        subParameters: [{ score: 2 }],
      },
      {
        themeKey: "objections",
        grade: 6 + (i % 2),
        credit: 2,
        category: "credibility_objections",
        subParameters: [{ score: 1 }],
      },
    ]);
  }

  return { callIds, scorecardsByCall, linesByCall };
}

function buildAnalyses(callIds: string[]) {
  return callIds.map((id, i) => ({
    id,
    timestamp: Date.now() - i * 1000,
    title: `Call ${i}`,
    ownerId: "user_test",
    analysis: { callHeader: { title: `Call ${i}` } },
    scorecard: null,
    analysisMeta: {
      callType: "demo",
      rubricVersion: "2.1",
      analysisConfidence: null,
      provisional: false,
    },
    result: {
      analysis: { callHeader: { title: `Call ${i}` } },
      scorecard: null,
      analysisMeta: {
        callType: "demo",
        rubricVersion: "2.1",
        analysisConfidence: null,
        provisional: false,
      },
    },
  }));
}

async function loadHydrateModule() {
  const mod = await import(pathToFileURL(resolve(WEB_ROOT, "domain/postcall-hydrate.js")).href);
  return mod;
}

async function serialHydrateReference(
  analyses: object[],
  scorecardsByCall: Map<string, object[]>,
  linesByCall: Map<string, object[]>,
) {
  const { hydratePostCallAnalyses } = await loadHydrateModule();
  const serialMaps = new Map<string, object[]>();
  const serialLines = new Map<string, object[]>();

  for (const rec of analyses) {
    const id = (rec as { id: string }).id;
    serialMaps.set(id, scorecardsByCall.get(id) || []);
    serialLines.set(id, linesByCall.get(id) || []);
  }

  // Simulate serial per-call fetch: same data, one call at a time
  const perCallCards = new Map<string, object[]>();
  const perCallLines = new Map<string, object[]>();
  for (const rec of analyses) {
    const id = (rec as { id: string }).id;
    perCallCards.set(id, serialMaps.get(id) || []);
    perCallLines.set(id, serialLines.get(id) || []);
  }

  return hydratePostCallAnalyses(analyses, perCallCards, perCallLines);
}

async function batchedHydrate(
  analyses: object[],
  scorecardsByCall: Map<string, object[]>,
  linesByCall: Map<string, object[]>,
) {
  const { hydratePostCallAnalyses } = await loadHydrateModule();
  const needIds = analyses.map((a) => (a as { id: string }).id);
  const batchedCards = new Map<string, object[]>();
  const batchedLines = new Map<string, object[]>();

  for (const id of needIds) {
    if (scorecardsByCall.has(id)) batchedCards.set(id, scorecardsByCall.get(id)!);
    if (linesByCall.has(id)) batchedLines.set(id, linesByCall.get(id)!);
  }

  return hydratePostCallAnalyses(analyses, batchedCards, batchedLines);
}

async function runFixtureTest() {
  const { callIds, scorecardsByCall, linesByCall } = buildFixture();
  const analyses = buildAnalyses(callIds);

  const serial = await serialHydrateReference(analyses, scorecardsByCall, linesByCall);
  const batched = await batchedHydrate(analyses, scorecardsByCall, linesByCall);
  assertEqual("fixture-50 serial vs batched hydrate", serial, batched);
}

async function runLiveTest(env: { FIREBASE_PROJECT_ID?: string; FIREBASE_SERVICE_ACCOUNT_JSON?: string }) {
  const ownerId = (process.env.TEST_OWNER_ID || "").trim();
  if (!ownerId) return;

  const { listPostCallsByOwner } = await import("../src/data/repositories/calls");
  const { postCallRecordsToAnalyses, hydratePostCallAnalyses } = await loadHydrateModule();

  const records = await listPostCallsByOwner(ownerId, 50, env);
  if (!records.length) {
    console.warn("Live test skipped — no postCalls for TEST_OWNER_ID");
    return;
  }

  const analyses = postCallRecordsToAnalyses(records);
  const needIds = analyses.map((a: { id: string }) => a.id);

  const serialCards = new Map<string, object[]>();
  const serialLines = new Map<string, object[]>();
  for (const id of needIds) {
    serialCards.set(id, await listScorecardsByCall(id, env));
    serialLines.set(id, await listScorecardLinesByCall(id, env));
  }
  const serial = hydratePostCallAnalyses(analyses, serialCards, serialLines);

  const [batchedCards, batchedLines] = await Promise.all([
    listScorecardsForCalls(needIds, env),
    listScorecardLinesForCalls(needIds, env),
  ]);
  const batched = hydratePostCallAnalyses(analyses, batchedCards, batchedLines);

  assertEqual("live serial vs batched hydrate", serial, batched);
}

async function main() {
  await runFixtureTest();

  const projectId = (process.env.FIREBASE_PROJECT_ID || "").trim();
  if (
    projectId &&
    (process.env.GOOGLE_APPLICATION_CREDENTIALS || process.env.FIREBASE_SERVICE_ACCOUNT_JSON)
  ) {
    await runLiveTest({
      FIREBASE_PROJECT_ID: projectId,
      FIREBASE_SERVICE_ACCOUNT_JSON: process.env.FIREBASE_SERVICE_ACCOUNT_JSON,
    });
  }

  console.log("Batched hydration parity checks passed.");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
