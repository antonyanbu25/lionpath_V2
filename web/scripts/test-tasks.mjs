/** Smoke test for task import, dedupe, status transitions, call link, sort order. */

import {
  importRecommendedTasks,
  extractPrepRecommendations,
  updateTaskStatus,
  listTasks,
  tasksStorageKey,
  mergeTaskLists,
  createManualTask,
  sortTasksByUrgency,
  callLabelFromRecord,
  buildCallPickerOptions,
  aggregateTaskMetrics,
  renderTaskBoard,
} from "../tasks.js";
import { savePostCallAnalysis, storageKey, listPostCallAnalyses } from "../history.js";
import { dueUrgency } from "../follow-ups.js";

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

const prepRecs = extractPrepRecommendations(
  {
    painCapabilityValue: [
      { capability: "Routing", pain: "Manual triage" },
      { capability: "SLA", pain: "Missed deadlines" },
    ],
  },
  "Acme",
);
if (prepRecs.length !== 2) {
  console.error("FAILED: prep recommendations count", prepRecs.length);
  process.exit(1);
}

const withPrep = importRecommendedTasks(TEST_EMAIL, {
  prepResult: { painCapabilityValue: [{ capability: "Routing", pain: "Manual triage" }] },
  company: "Acme",
});

const recommended = listTasks(TEST_EMAIL).filter((t) => t.status === "recommended");
const acceptTarget = recommended[0];
if (!acceptTarget) {
  console.error("FAILED: no recommended task to accept");
  process.exit(1);
}

await updateTaskStatus(TEST_EMAIL, acceptTarget.id, "pending");
await updateTaskStatus(TEST_EMAIL, acceptTarget.id, "completed");

const calls = listPostCallAnalyses(TEST_EMAIL);
const callOpts = buildCallPickerOptions(calls);
if (callOpts.length < 2) {
  console.error("FAILED: call picker should list saved calls");
  process.exit(1);
}

const linkedCall = calls.find((c) => (c.title || "").includes("Acme")) || calls[0];
const label = callLabelFromRecord(linkedCall);
if (!label.split(" · ")[0].includes("Acme") && !label.includes("Acme")) {
  console.error("FAILED: call label should include company", label);
  process.exit(1);
}

await createManualTask(TEST_EMAIL, {
  title: "Manual linked task",
  callId: linkedCall.id,
  company: "Acme",
  callTitle: label,
});

const manual = listTasks(TEST_EMAIL).find((t) => t.title === "Manual linked task");
if (!manual?.callId || manual.callId !== linkedCall.id) {
  console.error("FAILED: manual task call link");
  process.exit(1);
}

const overdue = {
  id: "t-overdue",
  title: "Overdue",
  status: "pending",
  dueDate: Date.now() - 86400000 * 3,
  createdAt: Date.now(),
};
const soon = {
  id: "t-soon",
  title: "Soon",
  status: "pending",
  dueDate: Date.now() + 86400000,
  createdAt: Date.now(),
};
const sorted = sortTasksByUrgency([soon, overdue]);
if (sorted[0].id !== "t-overdue" || dueUrgency(new Date(overdue.dueDate)) !== "overdue") {
  console.error("FAILED: overdue tasks should sort first");
  process.exit(1);
}

const merged = mergeTaskLists(listTasks(TEST_EMAIL), listTasks(TEST_EMAIL));

const allTasks = listTasks(TEST_EMAIL);
const metrics = aggregateTaskMetrics(allTasks);
const metricsChecks = [
  ["metrics openTotal", metrics.openTotal === metrics.recommended + metrics.active],
  ["metrics completedThisWeek", metrics.completedThisWeek >= 1],
  ["metrics completedByWeek length", metrics.completedByWeek.length === 4],
  ["metrics overdue subset of open", metrics.overdueOpen <= metrics.openTotal],
  ["metrics completedTotal", metrics.completedTotal >= 1],
];

const failedMetrics = metricsChecks.filter(([, ok]) => !ok);
if (failedMetrics.length) {
  console.error("FAILED metrics:", failedMetrics.map(([n]) => n).join(", "));
  process.exit(1);
}

const checks = [
  ["dedupe on second import", second.added === 0],
  ["first import added tasks", first.added >= 1],
  ["prep import adds new", withPrep.added >= 1],
  ["completed task exists", listTasks(TEST_EMAIL).some((t) => t.status === "completed")],
  ["merge idempotent", merged.length === listTasks(TEST_EMAIL).length],
  ["manual task has callTitle", !!manual.callTitle],
];

const failed = checks.filter(([, ok]) => !ok);

const boardEl = {
  _html: "",
  get innerHTML() {
    return this._html;
  },
  set innerHTML(v) {
    this._html = v;
  },
  querySelector() {
    return null;
  },
  querySelectorAll() {
    return [];
  },
};
renderTaskBoard(boardEl, TEST_EMAIL);
const boardOut = boardEl.innerHTML;
const boardChecks = [
  ["task board merged head", boardOut.includes('class="task-board-head"') && boardOut.includes("task-quick-add")],
  ["recommended row simplified", boardOut.includes("task-row-recommended") && !boardOut.includes("task-pill-recommended")],
  ["recommended hint copy", boardOut.includes("Accept a task to move it to Active")],
  ["active row no urgency dot", boardOut.includes("task-row-active") && !boardOut.includes("task-urgency-dot dot-red")],
  ["active row no status pill", boardOut.includes("task-row-active") && !boardOut.includes("task-pill-active")],
];
const failedBoard = boardChecks.filter(([, ok]) => !ok);
if (failedBoard.length) {
  console.error("FAILED board render:", failedBoard.map(([n]) => n).join(", "));
  process.exit(1);
}

store.delete(tasksStorageKey(TEST_EMAIL));
store.delete(storageKey(TEST_EMAIL));

if (failed.length) {
  console.error("FAILED:", failed.map(([n]) => n).join(", "));
  process.exit(1);
}

console.log("OK — tasks frontend smoke test passed");
