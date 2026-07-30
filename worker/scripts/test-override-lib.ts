/**
 * Unit tests for override calibration stats (no I/O).
 */
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import {
  aggregateArrAssumptionOverrides,
  aggregateSeOverrides,
  aggregateThemeOverrides,
  buildOverrideReportData,
  classifyThemeFix,
  crossReferenceThemes,
  formatOverrideReport,
  groupReasons,
  isConsistentDirectionalBias,
  isFrequentlyOverridden,
  snapshotsFromConsistencyRuns,
  type ThemeOverrideStats,
} from "./override-lib.ts";
import { aggregateThemeMetrics, type ThemeAggregateMetrics } from "../src/consistency-lib.ts";

const __dirname = dirname(fileURLToPath(import.meta.url));
const fixtures = JSON.parse(
  readFileSync(join(__dirname, "../testdata/overrides/fixtures.json"), "utf8"),
);

const themeStats = aggregateThemeOverrides(fixtures.scoreOverrides, fixtures.scorecardLines);
const seStats = aggregateSeOverrides(
  fixtures.scoreOverrides,
  fixtures.scorecardLines,
  fixtures.users,
);
const arrStats = aggregateArrAssumptionOverrides(fixtures.arrOverrides);

const storytelling = themeStats.find((t) => t.themeKey === "storytelling")!;
const objections = themeStats.find((t) => t.themeKey === "objections")!;
const aiRate = arrStats.find((a) => a.field === "aiSessionRate")!;

const consistencyRuns = [
  {
    callId: "c1",
    callType: "demo",
    runIndex: 0,
    compositeScore: 80,
    applicableWeight: 90,
    lines: [
      { themeKey: "storytelling", score: 70, applicable: true, weight: 5, evidence: [{ atS: 1, quote: "a" }] },
      { themeKey: "objections", score: 72, applicable: true, weight: 5, evidence: [{ atS: 2, quote: "b" }] },
    ],
  },
  {
    callId: "c1",
    callType: "demo",
    runIndex: 1,
    compositeScore: 82,
    applicableWeight: 90,
    lines: [
      { themeKey: "storytelling", score: 95, applicable: true, weight: 5, evidence: [{ atS: 500, quote: "other" }] },
      { themeKey: "objections", score: 74, applicable: true, weight: 5, evidence: [{ atS: 2, quote: "b" }] },
    ],
  },
  {
    callId: "c1",
    callType: "demo",
    runIndex: 2,
    compositeScore: 78,
    applicableWeight: 90,
    lines: [
      { themeKey: "storytelling", score: 60, applicable: true, weight: 5, evidence: [{ atS: 10, quote: "c" }] },
      { themeKey: "objections", score: 73, applicable: true, weight: 5, evidence: [{ atS: 2, quote: "b" }] },
    ],
  },
];

const snapshots = snapshotsFromConsistencyRuns(consistencyRuns);
const consistencyMetrics = aggregateThemeMetrics(snapshots, ["c1"]);
const storyConsistency = consistencyMetrics.find((m) => m.themeKey === "storytelling")!;
const objectionConsistency = consistencyMetrics.find((m) => m.themeKey === "objections")!;

const checks: [string, boolean][] = [
  ["storytelling override rate", storytelling.overrideCount === 3 && storytelling.scoredCount === 3],
  ["storytelling generous bias", storytelling.meanSignedDelta < -20],
  ["storytelling low delta scatter", storytelling.deltaStddev < 15],
  ["objections harsh bias", objections.meanSignedDelta > 20],
  ["reason groups dedupe", groupReasons(["A", "a", " B "]).length === 2],
  ["ai session mean delta positive", aiRate.meanSignedDelta > 0.1],
  ["ai session 3 overrides", aiRate.overrideCount === 3],
  ["se c high override rate", seStats.find((s) => s.userId === "usr_c")!.overrideRate === 1],
  ["snapshots from consistency json", snapshots.length === 3],
  ["story unstable in 4.1", storyConsistency.meanScoreSd > 8],
  ["objections stable in 4.1", objectionConsistency.meanScoreSd <= 8],
  [
    "story anchor priority when unstable+frequent",
    classifyThemeFix(storytelling, storyConsistency).fixKind === "anchor_priority",
  ],
  [
    "objections prompt offset when stable+directional",
    classifyThemeFix(objections, objectionConsistency).fixKind === "prompt_offset",
  ],
  [
    "cross-ref sorts anchor first",
    crossReferenceThemes(themeStats, consistencyMetrics)[0].fixKind === "anchor_priority",
  ],
  [
    "report markdown sections",
    formatOverrideReport(
      buildOverrideReportData(fixtures, {
        consistencyMetrics,
        consistencyRunId: "test-run",
      }),
    ).includes("## ARR assumption overrides"),
  ],
  ["frequent override helper", isFrequentlyOverridden(storytelling)],
  [
    "directional bias helper",
    isConsistentDirectionalBias({
      themeKey: "x",
      overrideCount: 3,
      scoredCount: 10,
      overrideRate: 0.3,
      meanSignedDelta: 25,
      deltaVariance: 4,
      deltaStddev: 2,
      reasonGroups: [],
    } satisfies ThemeOverrideStats),
  ],
];

const failed = checks.filter(([, ok]) => !ok);
if (failed.length) {
  console.error("FAILED:", failed.map(([n]) => n).join(", "));
  process.exit(1);
}
console.log("OK — override-lib tests passed");
