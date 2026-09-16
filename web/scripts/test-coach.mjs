/** Smoke tests for web Coach mirror + dispute → override loop. */

import {
  buildCoachOutput,
  coachTextForSubParameter,
  insightfulCoachTip,
  loadScoreOverrides,
  appendScoreOverride,
  resolveScoreDispute,
  COACH_GENERAL_INSTRUCTIONS,
} from "../coach/index.js";
import { loadDisputes, STORAGE_KEY } from "../score-disputes.js";
import { sanitizeUserFacingCopy } from "../user-facing-copy.js";

const store = new Map();
globalThis.localStorage = {
  getItem: (k) => store.get(k) ?? null,
  setItem: (k, v) => store.set(k, v),
  removeItem: (k) => store.delete(k),
};

const line = {
  id: "scl_web_1",
  themeKey: "value",
  grade: 6,
  subParameters: [
    { score: 1, evidence: [{ atS: 900, quote: "This will save you a lot of time." }] },
    { score: 1, evidence: [] },
    { score: 1, evidence: [] },
    { score: 1, evidence: [] },
    { score: 2, evidence: [] },
  ],
};

const output = buildCoachOutput({ callType: "demo", lines: [line], audience: "se" });
const note = coachTextForSubParameter(output, "value", 0);

store.set(
  STORAGE_KEY,
  JSON.stringify([
    {
      id: "sd_web_1",
      createdAt: new Date().toISOString(),
      category: "score_too_low",
      categoryLabel: "Score too low",
      note: "Quantified ROI at 18:00",
      callId: "call_web_1",
      themeKey: "value",
      grade: 6,
      scorecardLineId: "scl_web_1",
      scorecardId: "scr_web_1",
      status: "pending",
    },
  ]),
);

const dispute = loadDisputes()[0];
const resolved = resolveScoreDispute({
  dispute,
  ruling: "adjust",
  managerId: "mgr@test.com",
  overrideGrade: 8,
  reason: "ROI was quantified later",
});
store.set(STORAGE_KEY, JSON.stringify([resolved.dispute]));
if (resolved.override) appendScoreOverride(resolved.override);

const overrides = loadScoreOverrides();
const calibrated = buildCoachOutput({
  callType: "demo",
  lines: [line],
  overrides,
  audience: "se",
});
const calibratedNote = coachTextForSubParameter(calibrated, "value", 0);

const aiTip = insightfulCoachTip("ROI or time saved was concrete, not 'faster'", "ai", 2, 1);
const slideTip = insightfulCoachTip("Deck ended on something memorable, not 'thank you'", "slide_deck", 4, 0);
const decoded = sanitizeUserFacingCopy("not &#39;faster&#39; and not &amp;#39;thank you&amp;#39;");
const decodedDebris = sanitizeUserFacingCopy("not $#39;faster$#39; and not #39;thank you#39;");

const checks = [
  ["config exists", COACH_GENERAL_INSTRUCTIONS.version === "1.0.0"],
  ["weak sp coach note", !!note && note.includes("15:00")],
  ["dispute resolved", loadDisputes()[0].status === "adjusted"],
  ["override appended", overrides.length === 1 && overrides[0].override === 8],
  ["calibration in guidance", !!calibratedNote && calibratedNote.includes("Your manager raised")],
  ["AI coach tip is actionable", !!aiTip && /hours saved|tickets deflected/i.test(aiTip)],
  ["AI coach tip does not regurgitate rubric", !!aiTip && !/rOI or time saved/i.test(aiTip)],
  ["slide deck coach tip is actionable", !!slideTip && /memorable close|thank-you/i.test(slideTip)],
  ["slide deck coach tip does not regurgitate rubric", !!slideTip && !/plan one moment to deck ended/i.test(slideTip)],
  ["HTML entities decode in user copy", decoded === "not 'faster' and not 'thank you'"],
  ["HTML entity debris $#39 / #39; decodes", decodedDebris === "not 'faster' and not 'thank you'"],
];

const failed = checks.filter(([, ok]) => !ok);
if (failed.length) {
  console.error("FAILED:", failed.map(([n]) => n).join(", "));
  process.exit(1);
}
console.log("OK — web coach tests passed");
