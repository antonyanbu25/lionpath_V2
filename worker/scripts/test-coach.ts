/**
 * Unit tests for Coach module — sub-parameter guidance + dispute → override calibration.
 */
import {
  buildCoachOutput,
  coachTextForSubParameter,
  COACH_GENERAL_INSTRUCTIONS,
  formatCoachTimestamp,
  resolveScoreDispute,
} from "../src/coach/index.ts";
import type { ScoreDisputeEntry } from "../src/coach/types.ts";

const solutioningLine = {
  id: "scl_solutioning_1",
  themeKey: "solutioning",
  grade: 8,
  subParameters: [
    { score: 2, evidence: [{ atS: 300, quote: "For your agents, ticket routing maps here." }] },
    { score: 2, evidence: [] },
    { score: 1, evidence: [{ atS: 420, quote: "We also have reporting dashboards." }] },
    { score: 2, evidence: [] },
    { score: 1, evidence: [] },
  ],
  coachingNote: "Tie each feature to one named pain.",
};

const perfectLine = {
  id: "scl_questions_1",
  themeKey: "questions",
  grade: 10,
  subParameters: Array.from({ length: 5 }, () => ({ score: 2 as const, evidence: [] })),
};

const coachSe = buildCoachOutput({
  callId: "call_test_1",
  callType: "demo",
  lines: [solutioningLine, perfectLine],
  audience: "se",
});

const coachMgr = buildCoachOutput({
  callId: "call_test_1",
  callType: "demo",
  lines: [solutioningLine],
  audience: "manager",
});

const sp2Note = coachTextForSubParameter(coachSe, "solutioning", 2);
const sp0Skipped = coachTextForSubParameter(coachSe, "solutioning", 0);
const perfectSkipped = coachTextForSubParameter(coachSe, "questions", 0);

const dispute: ScoreDisputeEntry = {
  id: "sd_test",
  createdAt: new Date().toISOString(),
  category: "score_too_low",
  categoryLabel: "Score too low",
  note: "Pain was named earlier in the call",
  callId: "call_test_1",
  themeKey: "solutioning",
  grade: 8,
  scorecardLineId: "scl_solutioning_1",
  scorecardId: "scr_test_1",
  status: "pending",
};

const resolved = resolveScoreDispute({
  dispute,
  ruling: "adjust",
  managerId: "mgr_1",
  overrideGrade: 9,
  reason: "Customer pain was established at 04:30",
});

const coachCalibrated = buildCoachOutput({
  callId: "call_test_1",
  callType: "demo",
  lines: [solutioningLine],
  overrides: resolved.override ? [resolved.override] : [],
  audience: "se",
});

const calibratedNote = coachTextForSubParameter(coachCalibrated, "solutioning", 2);

const checks: [string, boolean][] = [
  ["general instructions versioned", COACH_GENERAL_INSTRUCTIONS.version === "1.0.0"],
  ["general instructions have rules", COACH_GENERAL_INSTRUCTIONS.rules.length >= 4],
  ["format timestamp", formatCoachTimestamp(305) === "05:05"],
  ["low-scoring theme included", coachSe.themes.some((t) => t.themeKey === "solutioning")],
  ["perfect theme omitted", !coachSe.themes.some((t) => t.themeKey === "questions")],
  ["theme lost points flag", coachSe.themes.find((t) => t.themeKey === "solutioning")!.lostPoints],
  ["weak sub-parameter note exists", !!sp2Note],
  ["note cites timestamp", !!sp2Note && sp2Note.includes("07:00")],
  ["note cites sub-parameter", !!sp2Note && /features not relevant/i.test(sp2Note)],
  ["note has next time action", !!sp2Note && /push further|next time sharpen/i.test(sp2Note)],
  ["full credit sp skipped", sp0Skipped === null],
  ["perfect theme sp skipped", perfectSkipped === null],
  ["SE vs manager framing differs", sp2Note !== coachTextForSubParameter(coachMgr, "solutioning", 2)],
  ["manager note uses the SE", coachTextForSubParameter(coachMgr, "solutioning", 2)!.includes("the SE")],
  ["resolve adjust creates override", !!resolved.override && resolved.override.original === 8],
  ["resolve adjust override grade", resolved.override?.override === 9],
  ["calibration visible in coach note", !!calibratedNote && calibratedNote.includes("Your manager raised")],
  ["dispute marked adjusted", resolved.dispute.status === "adjusted"],
  ["uphold no override", !resolveScoreDispute({ dispute, ruling: "uphold", managerId: "mgr_1" }).override],
];

const failed = checks.filter(([, ok]) => !ok);
if (failed.length) {
  console.error("FAILED:", failed.map(([n]) => n).join(", "));
  process.exit(1);
}

console.log("OK — coach module tests passed");
console.log("Example coach output shape:", JSON.stringify(coachSe, null, 2).slice(0, 1200) + "…");
