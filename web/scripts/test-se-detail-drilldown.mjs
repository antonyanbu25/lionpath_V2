/** SE detail + drill-down smoke test (no browser). */

import { renderManagerHeatmap } from "../dashboard.js";
import { renderSeDetailView } from "../se-detail-view.js";
import {
  canViewSeProfile,
  filterCallRecordsForList,
  buildTeamThemeAverages,
} from "../domain/se-access-service.js";
import { savePostCallAnalysis, storageKey } from "../history.js";
import { esc } from "../shared.js";

const store = new Map();
globalThis.localStorage = {
  getItem: (k) => store.get(k) ?? null,
  setItem: (k, v) => store.set(k, v),
  removeItem: (k) => store.delete(k),
};

const SE_A = "se.alpha@test.com";
const SE_B = "se.beta@test.com";
const CALL_ID = "call-comp-pitch-001";

function seedCall(email) {
  store.delete(storageKey(email));
  savePostCallAnalysis(
    email,
    { recordingUrl: "https://zoom.us/rec/1" },
    {
      scorecard: {
        callType: "demo",
        rubricVersion: "1.0",
        confidence: 0.92,
        provisional: false,
        lines: [
          {
            themeKey: "comp_pitch",
            score: 42,
            maxScore: 100,
            applicable: true,
            weight: 5,
            evidence: [{ quote: "Competitor came up and was left unanswered.", atS: 2200 }],
          },
          {
            themeKey: "call_flow",
            score: 78,
            maxScore: 100,
            applicable: true,
            weight: 10,
          },
        ],
      },
      analysis: {
        callHeader: { title: "Pioneer Metering · demo" },
        qualityCoach: { overallScore: 70 },
      },
    },
  );
  const list = JSON.parse(store.get(storageKey(email)));
  list[0].id = CALL_ID;
  store.set(storageKey(email), JSON.stringify(list));
}

seedCall(SE_A);

const seSession = { email: SE_A, role: "se" };
const outsider = { email: SE_B, role: "se" };

const scorecardsA = [
  {
    callType: "demo",
    rubricVersion: "1.0",
    provisional: false,
    confidence: 0.9,
    lines: [{ themeKey: "comp_pitch", score: 48, maxScore: 100, applicable: true, weight: 5 }],
  },
];
const view = {
  seRows: [{ email: SE_A, name: "SE Alpha" }],
  seScorecardsByEmail: new Map([[SE_A, scorecardsA]]),
  allEligibleScorecards: scorecardsA,
};

const heatmapHtml = renderManagerHeatmap(view, "demo");

const clicks = [
  { step: 1, action: "heatmap cell (comp_pitch × SE)", lands: `#se/${encodeURIComponent(SE_A)}?theme=comp_pitch` },
  { step: 2, action: "receipt on SE detail", lands: `#calls/${CALL_ID}?tab=qip&theme=comp_pitch&owner=${encodeURIComponent(SE_A)}` },
];

class MockEl {
  constructor() {
    this.innerHTML = "";
    this.children = [];
  }
  querySelector(sel) {
    if (sel === "#se-detail-back") return null;
    return null;
  }
  querySelectorAll(sel) {
    return [];
  }
}
const container = new MockEl();
await renderSeDetailView(container, seSession, {
  targetEmail: SE_A,
  expandThemeKey: "comp_pitch",
  teamThemeAverages: buildTeamThemeAverages(view.seScorecardsByEmail),
});

const detailHtml = container.innerHTML;
const noNextStep = filterCallRecordsForList(
  [{ analysis: { momentum: { status: "Stalled" }, nextSteps: [] } }],
  "no-next-step",
);

const checks = [
  ["SE can view self", await canViewSeProfile(seSession, SE_A)],
  ["sideways SE blocked", !(await canViewSeProfile(outsider, SE_A))],
  ["heatmap cell is link", heatmapHtml.includes('data-drill="se-theme"')],
  ["heatmap carries theme key", heatmapHtml.includes("comp_pitch")],
  ["SE row is link", heatmapHtml.includes("team-heatmap-se-link")],
  ["SE detail has type stat", detailHtml.includes("Demo average")],
  ["receipt links theme", detailHtml.includes('data-expand-theme="comp_pitch"')],
  ["receipt shows quote", detailHtml.includes("Competitor came up")],
  ["accounts section", detailHtml.includes("Their accounts")],
  ["no-next-step filter", noNextStep.length === 1],
  ["esc wired", esc("<x>") === "&lt;x&gt;"],
];

const failed = checks.filter(([, ok]) => !ok);
if (failed.length) {
  console.error("FAILED:", failed.map(([n]) => n).join(", "));
  process.exit(1);
}

console.log("OK — SE detail drill-down smoke test passed");
console.log(`Click count to quote (team → evidence): ${clicks.length} clicks`);
console.log(JSON.stringify(clicks, null, 2));
