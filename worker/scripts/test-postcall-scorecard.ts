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
import { QIP_PROFILES, VIDEO_THEME_NA_REASON } from "../src/rubric-profiles.ts";
import { isEligibleForAggregate, HIGH_CONFIDENCE_THRESHOLD } from "../src/quality-score.ts";

const demo = QIP_PROFILES.find((p) => p.key === "demo")!;
const trial = QIP_PROFILES.find((p) => p.key === "trial_setup")!;

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
  ["facts ready makes camera applicable", factCam.evidenceUnavailable === false],
  ["camera grade from Pass 2 pct", factCam.grade === 9],
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
    "omitted video theme still modelOmitted",
    partial.lines.find((l) => l.themeKey === "camera_on")?.modelOmitted === true,
  ],
  ["partial response lowers analysis confidence", partial.analysisConfidence < 0.9],
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
