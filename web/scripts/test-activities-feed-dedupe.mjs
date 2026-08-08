/** Activities feed lists every analysis; KPI metrics still dedupe same recording. */
import assert from "node:assert/strict";
import { dedupeAnalysesByCallIdentity } from "../call-identity.js";
import { mergeActivityFeed, aggregateCallListMetrics, filterCallRecords } from "../calls-list-view.js";

const sharedZoom = "https://zoom.us/rec/share/gamersheek-demo-1";
const records = [1, 2, 3].map((i) => ({
  id: `call_${i}`,
  timestamp: 1_700_000_000_000 + i * 60_000,
  zoomLink: sharedZoom,
  callType: "demo",
  analysis: { callHeader: { title: "Gamersheek · Demo" } },
  scorecard: { overall: 7, provisional: false, callType: "demo", lines: [] },
  analysisMeta: { callType: "demo", provisional: false },
}));

const feed = mergeActivityFeed(records, [], { window: "all" });
assert.equal(feed.filter((i) => i.kind === "call").length, 3, "feed shows all three analyses");

const metrics = aggregateCallListMetrics(dedupeAnalysesByCallIdentity(filterCallRecords(records, { window: "all" })));
assert.equal(metrics.callCount, 1, "KPI metrics still count one activity per recording");

console.log("test-activities-feed-dedupe: ok");
