/**
 * Unit tests for Pass 3 scorecard normalize + prompt scoping (v2.1).
 */
import {
  buildScorecardSystemPrompt,
  normalizeScorecardLines,
  buildScorecardDraft,
  SLIDE_DECK_NA_REASON,
  MODEL_OMITTED_THEME_REASON,
  MODEL_OMITTED_CONFIDENCE,
} from "../src/postcall/scorecard.ts";
import { themeNotEvidencedReason } from "../../web/shared/qip-scorecard-normalize.js";
import { QIP_PROFILES, CAMERA_ON_PENDING_REASON } from "../src/rubric-profiles.ts";
import { isEligibleForAggregate, HIGH_CONFIDENCE_THRESHOLD, scoreCall } from "../src/quality-score.ts";
import { DISCOVERY_INCIDENT_NA_REASONS } from "../src/postcall/discovery-incident-applicability.ts";

const demo = QIP_PROFILES.find((p) => p.key === "demo")!;
const trial = QIP_PROFILES.find((p) => p.key === "trial_setup")!;
const discoveryNb = QIP_PROFILES.find((p) => p.key === "discovery" && p.motion === "new_business")!;
const discoveryExp = QIP_PROFILES.find((p) => p.key === "discovery" && p.motion === "expansion")!;

const prompt = buildScorecardSystemPrompt(demo);
const checks: [string, boolean][] = [
  ["prompt includes demo call type", prompt.includes("Call type: demo")],
  ["prompt includes sub-parameters", prompt.includes("Sub-parameters")],
  ["prompt includes deal risk flags", prompt.includes("dealRiskFlags")],
  ["prompt does not list all eight profiles", !prompt.includes("Call type: discovery")],
  ["prompt lists cde_build credit", prompt.includes("cde_build (credit 2")],
  ["prompt no anchor language", !prompt.includes("unanchored")],
];

function modelLine(themeKey: string, scores: (0 | 1 | 2)[]) {
  return {
    themeKey,
    subParameters: scores.map((score) => ({
      score,
      evidence: [{ atS: 120, quote: "We can map this to your agents.", source: "transcript" }],
    })),
    confidence: 0.9,
    coachingNote: "Ask one quantified pain question before the walkthrough.",
  };
}

const fullModelLines = demo.themes.map((t) => modelLine(t.key, [2, 2, 1, 1, 1]));

const { lines, analysisConfidence, dealRiskFlags } = normalizeScorecardLines({
  profile: demo,
  videoAvailable: false,
  deckPresent: false,
  modelAnalysisConfidence: 0.9,
  modelLines: fullModelLines,
  modelDealRiskFlags: [
    { category: "claim_to_verify", description: "SLA quoted as 99.99% — verify with product." },
  ],
});

const camera = lines.find((l) => l.themeKey === "camera_on")!;
const slide = lines.find((l) => l.themeKey === "slide_deck")!;
const questions = lines.find((l) => l.themeKey === "questions")!;

checks.push(
  ["camera_on evidence_unavailable without video", camera.evidenceUnavailable === true],
  ["cde_build scored from transcript without video", !lines.find((l) => l.themeKey === "cde_build")!.evidenceUnavailable],
  ["call_flow scored from transcript without video", !lines.find((l) => l.themeKey === "call_flow")!.evidenceUnavailable],
  ["customer_engagement scored from transcript without video", !lines.find((l) => l.themeKey === "customer_engagement")!.evidenceUnavailable],
  ["slide_deck grade 0 without deck", slide.grade === 0],
  ["questions grade computed", questions.grade === 7],
  ["questions has 5 sub-parameters", questions.subParameters.length === 5],
  ["analysisConfidence finite", Number.isFinite(analysisConfidence)],
  ["line count matches profile", lines.length === demo.themes.length],
  ["deal risk flags preserved", dealRiskFlags.length === 1],
);

const draft = buildScorecardDraft(demo, lines, analysisConfidence, dealRiskFlags);
checks.push(
  ["draft not provisional for demo", draft.provisional === false],
  ["draft rubricVersion 2.1", draft.rubricVersion === "2.1"],
  ["draft overall out of 10", draft.overall >= 0 && draft.overall <= 10],
  ["draft totalCredits 34", draft.totalCredits === 34],
  ["draft has categoryScores", Object.keys(draft.categoryScores).length === 5],
);

const trialDraft = buildScorecardDraft(
  trial,
  normalizeScorecardLines({
    profile: trial,
    videoAvailable: true,
    deckPresent: true,
    modelLines: trial.themes.map((t) => modelLine(t.key, [1, 1, 1, 1, 1])),
  }).lines,
  0.8,
);
checks.push(["trial_setup is provisional/shadow", trialDraft.provisional === true]);

checks.push(
  ["provisional excluded from aggregate", isEligibleForAggregate({ provisional: true, confidence: 0.95 }) === false],
  [
    "low confidence excluded when required",
    isEligibleForAggregate({ provisional: false, confidence: 0.4 }, { requireHighConfidence: true }) === false,
  ],
  [
    "high confidence live eligible",
    isEligibleForAggregate({ provisional: false, confidence: HIGH_CONFIDENCE_THRESHOLD }, { requireHighConfidence: true }) === true,
  ],
);

// Missing timestamp → confidence crushed
const thin = normalizeScorecardLines({
  profile: demo,
  videoAvailable: true,
  deckPresent: true,
  modelLines: [
    {
      themeKey: "questions",
      subParameters: [{ score: 2, evidence: [{ quote: "What does success look like?", source: "transcript" }] }],
      confidence: 0.95,
      coachingNote: "Timestamp every evidence quote.",
    },
  ],
});
const qLine = thin.lines.find((l) => l.themeKey === "questions")!;
checks.push(["no-timestamp evidence reduces confidence", (qLine.confidence ?? 1) <= 0.35]);

// Pass 2 facts ready + consent → camera_on from sampled pct
const withFacts = normalizeScorecardLines({
  profile: demo,
  videoAvailable: true,
  deckPresent: true,
  videoFacts: {
    status: "ready",
    cameraOnPct: 91,
    cdeCustomized: true,
    cdeEvidence: "Tenant logo and real account name visible.",
    visualAnalysisConsent: true,
    keyframeRefs: [{ atS: 0, path: "/x.jpg" }],
    sampleIntervalS: 10,
    retentionExpiresAt: Date.now() + 1000,
    segments: [{ startS: 0, endS: 60, segmentType: "scene_change", label: "change" }],
  },
  modelLines: demo.themes.map((t) => modelLine(t.key, [1, 1, 1, 0, 0])),
});
const factCam = withFacts.lines.find((l) => l.themeKey === "camera_on")!;
const factCde = withFacts.lines.find((l) => l.themeKey === "cde_build")!;
checks.push(
  ["camera_on stays N/A even with Pass 2 facts", factCam.evidenceUnavailable === true],
  ["camera_on pending Zoom reason", factCam.coachingNote === CAMERA_ON_PENDING_REASON],
  ["camera grade not scored from pct", factCam.grade === 0],
  ["cde_build applicable from vision", factCde.evidenceUnavailable === false],
  ["cde_build grade high when customized", factCde.grade === 8],
);

// Partial model response
const partialKeys = ["questions", "solutioning", "value", "objections", "summarise"] as const;
const partial = normalizeScorecardLines({
  profile: demo,
  videoAvailable: false,
  deckPresent: false,
  modelAnalysisConfidence: 0.9,
  modelLines: partialKeys.map((k) => modelLine(k, [2, 2, 1, 1, 1])),
});
checks.push(
  ["partial response still emits all lines", partial.lines.length === demo.themes.length],
  [
    "omitted research uses not-evidenced reason",
    partial.lines.find((l) => l.themeKey === "research")?.coachingNote ===
      themeNotEvidencedReason("research"),
  ],
  [
    "omitted research stays in denominator",
    partial.lines.find((l) => l.themeKey === "research")?.evidenceUnavailable === false,
  ],
  [
    "omitted research not flagged modelOmitted",
    partial.lines.find((l) => l.themeKey === "research")?.modelOmitted === false,
  ],
  [
    "omitted video theme is N/A pending Zoom, not model-omitted",
    partial.lines.find((l) => l.themeKey === "camera_on")?.evidenceUnavailable === true &&
      partial.lines.find((l) => l.themeKey === "camera_on")?.modelOmitted === false,
  ],
  ["partial response lowers analysis confidence", partial.analysisConfidence < 0.9],
);

function zerosNoEvidence(themeKey: string) {
  return {
    themeKey,
    subParameters: Array.from({ length: 5 }, () => ({ score: 0 as const, evidence: [] })),
    confidence: 0.9,
    coachingNote: "If it comes up, acknowledge first.",
  };
}

function discoveryLines(profile: typeof discoveryNb, incident: "absent" | "fumble") {
  return profile.themes
    .filter((t) => t.key !== "camera_on")
    .map((t) => {
      if (t.key === "objections" || t.key === "comp_pitch" || t.key === "case_study") {
        if (incident === "fumble" && t.key === "objections") {
          return {
            themeKey: t.key,
            subParameters: Array.from({ length: 5 }, () => ({
              score: 0 as const,
              evidence: [{ atS: 210, quote: "That's too expensive for us right now.", source: "transcript" }],
            })),
            confidence: 0.9,
            coachingNote: "Acknowledge the cost concern first.",
          };
        }
        return zerosNoEvidence(t.key);
      }
      return modelLine(t.key, [2, 2, 2, 1, 1]);
    });
}

const discPrompt = buildScorecardSystemPrompt(discoveryNb);
checks.push(
  ["NB discovery has no storytelling", !discoveryNb.themes.some((t) => t.key === "storytelling")],
  ["NB discovery total credits 32", discoveryNb.totalCredits === 32],
  ["discovery prompt has incident exception", discPrompt.includes("DISCOVERY INCIDENT THEMES")],
  ["demo prompt has no discovery incident exception", !prompt.includes("DISCOVERY INCIDENT THEMES")],
);

const discAbsent = normalizeScorecardLines({
  profile: discoveryNb,
  videoAvailable: false,
  deckPresent: false,
  modelAnalysisConfidence: 0.9,
  modelLines: discoveryLines(discoveryNb, "absent"),
});
const discAbsentDraft = buildScorecardDraft(discoveryNb, discAbsent.lines, discAbsent.analysisConfidence);
const absentObj = discAbsent.lines.find((l) => l.themeKey === "objections")!;
const absentComp = discAbsent.lines.find((l) => l.themeKey === "comp_pitch")!;
const absentCase = discAbsent.lines.find((l) => l.themeKey === "case_study")!;
const absentQuestions = discAbsent.lines.find((l) => l.themeKey === "questions")!;
const forcedInDenom = scoreCall(
  discoveryNb,
  discAbsent.lines.map((l) => ({
    themeKey: l.themeKey,
    subParameters: l.subParameters.map((sp) => ({ score: sp.score })),
    evidenceUnavailable: l.themeKey === "camera_on",
  })),
);
checks.push(
  ["discovery absent objections are N/A", absentObj.evidenceUnavailable === true],
  ["discovery absent comp_pitch is N/A", absentComp.evidenceUnavailable === true],
  ["discovery absent case_study is N/A", absentCase.evidenceUnavailable === true],
  [
    "discovery N/A reason is not video copy",
    absentObj.notApplicableReason === DISCOVERY_INCIDENT_NA_REASONS.objections &&
      !String(absentObj.notApplicableReason).toLowerCase().includes("video"),
  ],
  ["discovery questions stay in denominator", absentQuestions.evidenceUnavailable === false],
  [
    "discovery absent incidents shrink denom",
    discAbsentDraft.includedCredits === discoveryNb.totalCredits - 1 - 2 - 1 - 1,
  ],
  ["discovery absent incidents raise overall", discAbsentDraft.overall > forcedInDenom.overall],
  [
    "discovery absent credibility_objections is N/A",
    discAbsentDraft.categoryScores.credibility_objections == null,
  ],
  [
    "discovery absent overall not a fake 0 category average",
    discAbsentDraft.overall > 0 && Number.isFinite(discAbsentDraft.overall),
  ],
);

const discFumble = normalizeScorecardLines({
  profile: discoveryNb,
  videoAvailable: false,
  deckPresent: false,
  modelAnalysisConfidence: 0.9,
  modelLines: discoveryLines(discoveryNb, "fumble"),
});
const discFumbleDraft = buildScorecardDraft(discoveryNb, discFumble.lines, discFumble.analysisConfidence);
const fumbleObj = discFumble.lines.find((l) => l.themeKey === "objections")!;
checks.push(
  ["discovery fumbled objection stays scored", fumbleObj.evidenceUnavailable === false],
  ["discovery fumbled objection grade 0", fumbleObj.grade === 0],
  [
    "discovery fumble keeps objection credit in denom",
    discFumbleDraft.includedCredits === discoveryNb.totalCredits - 1 - 1 - 1,
  ],
  ["discovery fumble overall below absent-N/A overall", discFumbleDraft.overall < discAbsentDraft.overall],
);

const expAbsent = normalizeScorecardLines({
  profile: discoveryExp,
  videoAvailable: false,
  deckPresent: false,
  modelLines: discoveryLines(discoveryExp, "absent"),
});
checks.push(
  [
    "expansion discovery absent objections are N/A",
    expAbsent.lines.find((l) => l.themeKey === "objections")?.evidenceUnavailable === true,
  ],
);

const demoAbsentObj = normalizeScorecardLines({
  profile: demo,
  videoAvailable: false,
  deckPresent: false,
  modelAnalysisConfidence: 0.9,
  modelLines: demo.themes.filter((t) => t.key !== "camera_on").map((t) =>
    t.key === "objections" || t.key === "comp_pitch" || t.key === "case_study"
      ? zerosNoEvidence(t.key)
      : modelLine(t.key, [2, 2, 2, 1, 1]),
  ),
});
const demoAbsentDraft = buildScorecardDraft(demo, demoAbsentObj.lines, demoAbsentObj.analysisConfidence);
const demoObj = demoAbsentObj.lines.find((l) => l.themeKey === "objections")!;
checks.push(
  ["demo absent objections stay in denom", demoObj.evidenceUnavailable === false],
  ["demo absent objections grade 0", demoObj.grade === 0],
  ["demo denom only drops camera_on", demoAbsentDraft.includedCredits === demo.totalCredits - 1],
  [
    "demo absent incidents keep credibility_objections numeric",
    typeof demoAbsentDraft.categoryScores.credibility_objections === "number",
  ],
);

const discHabitZero = normalizeScorecardLines({
  profile: discoveryNb,
  videoAvailable: false,
  deckPresent: false,
  modelLines: [
    ...discoveryLines(discoveryNb, "absent").filter((l) => l.themeKey !== "questions"),
    zerosNoEvidence("questions"),
  ],
});
const habitQ = discHabitZero.lines.find((l) => l.themeKey === "questions")!;
checks.push(
  ["discovery absent questions stay in denom", habitQ.evidenceUnavailable === false],
  ["discovery absent questions grade 0", habitQ.grade === 0],
);

const failed = checks.filter(([, ok]) => !ok);
if (failed.length) {
  console.error("FAILED:", failed.map(([n]) => n).join(", "));
  for (const [n, ok] of checks) {
    if (!ok) console.error(" -", n);
  }
  process.exit(1);
}
console.log("OK — postcall scorecard v2.1 tests passed");
