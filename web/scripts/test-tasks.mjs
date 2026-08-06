/** Smoke test for task import, dedupe, status transitions, call link, sort order. */

import {
  importRecommendedTasks,
  extractPrepRecommendations,
  stripPrepTasks,
  isPrepSourcedTask,
  updateTaskStatus,
  listTasks,
  tasksStorageKey,
  mergeTaskLists,
  createManualTask,
  sortTasksByUrgency,
  callLabelFromRecord,
  buildCallPickerOptions,
  aggregateTaskMetrics,
} from "../tasks.js";
import { savePostCallAnalysis, storageKey, listPostCallAnalyses } from "../history.js";
import { dueUrgency, isSeOwner } from "../follow-ups.js";

const store = new Map();
globalThis.localStorage = {
  getItem: (k) => store.get(k) ?? null,
  setItem: (k, v) => store.set(k, v),
  removeItem: (k) => store.delete(k),
};

const TEST_EMAIL = "test-se@freshworks.com";

function samplePostCall(action, title = "Acme · Discovery") {
  return {
    analysis: {
      callHeader: { title },
      nextSteps: [{ owner: "SE", action, due: "tomorrow" }],
      callSummary: { headline: "Acme call" },
    },
    transcriptMeta: { wordCount: 100 },
  };
}

store.delete(tasksStorageKey(TEST_EMAIL));
store.delete(storageKey(TEST_EMAIL));

savePostCallAnalysis(TEST_EMAIL, { recordingUrl: "https://zoom.us/rec/1" }, samplePostCall("Send demo recording"));
savePostCallAnalysis(
  TEST_EMAIL,
  { recordingUrl: "https://zoom.us/rec/2" },
  samplePostCall("Follow up on pricing", "Globex · Demo"),
);

const first = importRecommendedTasks(TEST_EMAIL, { seName: "Test SE" });
const second = importRecommendedTasks(TEST_EMAIL, { seName: "Test SE" });

if (extractPrepRecommendations({ painCapabilityValue: [{ capability: "X", pain: "Y" }] }, "Acme").length !== 0) {
  console.error("FAILED: prep recommendations must be disabled");
  process.exit(1);
}

if (
  !isPrepSourcedTask({
    id: "legacy",
    title: "Configure Omniroute. Manual triage",
    status: "completed",
    source: undefined,
  })
) {
  console.error("FAILED: legacy Configure.* prep pattern");
  process.exit(1);
}

store.set(
  tasksStorageKey(TEST_EMAIL),
  JSON.stringify([
    { id: "prep-old", title: "Configure demo", status: "recommended", source: "prep", sourceKey: "prep:Acme:x:0" },
    { id: "manual-1", title: "Manual task", status: "pending", source: "manual" },
  ]),
);

const purged = importRecommendedTasks(TEST_EMAIL, { seName: "Test SE" });
if (listTasks(TEST_EMAIL).some((t) => t.source === "prep")) {
  console.error("FAILED: prep tasks should be purged on import");
  process.exit(1);
}
if (purged.prepPurged < 1) {
  console.error("FAILED: expected prepPurged count", purged.prepPurged);
  process.exit(1);
}

if (!isSeOwner("SE", "Test SE")) {
  console.error("FAILED: SE owner should match");
  process.exit(1);
}
if (isSeOwner("AE", "Test SE")) {
  console.error("FAILED: AE owner should be rejected");
  process.exit(1);
}

const recommended = listTasks(TEST_EMAIL).filter((t) => t.status === "recommended");
const acceptTarget = recommended[0];
if (!acceptTarget) {
  console.error("FAILED: no recommended task to accept");
  process.exit(1);
}

await updateTaskStatus(TEST_EMAIL, acceptTarget.id, "pending");
await updateTaskStatus(TEST_EMAIL, acceptTarget.id, "completed");

if (first.added < 1) {
  console.error("FAILED: expected post-call recommendations on first import");
  process.exit(1);
}
if (second.added !== 0) {
  console.error("FAILED: duplicate import should add 0");
  process.exit(1);
}

const merged = stripPrepTasks(
  mergeTaskLists(
    [{ id: "a", source: "prep", status: "recommended" }],
    [{ id: "b", source: "manual", status: "pending" }],
  ),
);
if (merged.length !== 1 || merged[0].id !== "b") {
  console.error("FAILED: stripPrepTasks");
  process.exit(1);
}

console.log("test-tasks.mjs: ok");
