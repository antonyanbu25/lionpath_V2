/**
 * Unit tests for Pass 3 scorecard normalize + prompt scoping.
 */
import {
  buildScorecardSystemPrompt,
  normalizeScorecardLines,
  buildScorecardDraft,
  UNANCHORED_CONFIDENCE_CAP,
  SLIDE_DECK_NA_REASON,
  MODEL_OMITTED_THEME_REASON,
  MODEL_OMITTED_CONFIDENCE,
} from "../src/postcall/scorecard.ts";
import { RUBRIC_PROFILES, VIDEO_THEME_NA_REASON } from "../src/rubric-profiles.ts";
import { isEligibleForAggregate, HIGH_CONFIDENCE_THRESHOLD } from "../src/quality-score.ts";

const demo = RUBRIC_PROFILES.find((p) => p.callType === "demo")!;
const trial = RUBRIC_PROFILES.find((p) => p.callType === "trial_setup")!;

const prompt = buildScorecardSystemPrompt(demo);
const checks: [string, boolean][] = [
  ["prompt includes demo call type", prompt.includes("Call type: demo")],
  ["prompt includes storytelling anchors", prompt.includes("Named personas across all three lenses")],
  ["prompt flags unanchored themes", prompt.includes("This theme is unanchored")],
  ["prompt does not list all eight profiles", !prompt.includes("Call type: discovery")],
  ["prompt lists cde_build weight", prompt.includes("cde_build (weight 10)")],
];

const { lines, analysisConfidence } = normalizeScorecardLines({
  profile: demo,
  videoAvailable: false,
  deckPresent: false,
  modelAnalysisConfidence: 0.9,
  modelLines: demo.themes.map((t) => ({
    themeKey: t.themeKey,
    score: 80,
    applicable: true,
    confidence: 0.9,
    evidence: [{ atS: 120, quote: "We can map this to your agents.", source: "transcript" }],
    coachingNote: "Ask one quantified pain question before the walkthrough.",
  })),
});

const camera = lines.find((l) => l.themeKey === "camera_on")!;
const slide = lines.find((l) => l.themeKey === "slide_deck")!;
const story = lines.find((l) => l.themeKey === "storytelling")!;
const value = lines.find((l) => l.themeKey === "value")!;

checks.push(
  ["camera_on NA without video", camera.applicable === false],
  ["camera_on reason is video ban", camera.notApplicableReason === VIDEO_THEME_NA_REASON],
  ["slide_deck NA without deck", slide.applicable === false],
  ["slide_deck reason", slide.notApplicableReason === SLIDE_DECK_NA_REASON],
  ["storytelling keeps higher confidence with anchors", (story.confidence ?? 0) > UNANCHORED_CONFIDENCE_CAP],
  ["unanchored value capped", (value.confidence ?? 1) <= UNANCHORED_CONFIDENCE_CAP],
  ["analysisConfidence finite", Number.isFinite(analysisConfidence)],
  ["line count matches profile", lines.length === demo.themes.length],
);

const draft = buildScorecardDraft(demo, lines, analysisConfidence);
checks.push(
  ["draft not provisional for demo", draft.provisional === false],
  ["draft rubricVersion 1.0", draft.rubricVersion === "1.0"],
  ["draft denominator 100 when applicable weight", draft.denominator === 100],
);

const trialDraft = buildScorecardDraft(
  trial,
  normalizeScorecardLines({
    profile: trial,
    videoAvailable: true,
    deckPresent: true,
    modelLines: trial.themes.map((t) => ({
      themeKey: t.themeKey,
      score: 70,
      applicable: true,
      confidence: 0.8,
      evidence: [{ atS: 10, quote: "Exit criteria: ticket deflection +20%.", source: "transcript" }],
      coachingNote: "Write exit criteria in the MoM.",
    })),
  }).lines,
  0.8,
);
checks.push(["trial_setup is provisional/shadow", trialDraft.provisional === true]);

checks.push(
  [
    "provisional excluded from aggregate",
    isEligibleForAggregate({ provisional: true, confidence: 0.95 }) === false,
  ],
  [
    "low confidence excluded when required",
    isEligibleForAggregate(
      { provisional: false, confidence: 0.4 },
      { requireHighConfidence: true },
    ) === false,
  ],
  [
    "high confidence live eligible",
    isEligibleForAggregate(
      { provisional: false, confidence: HIGH_CONFIDENCE_THRESHOLD },
      { requireHighConfidence: true },
    ) === true,
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
      score: 90,
      applicable: true,
      confidence: 0.95,
      evidence: [{ quote: "What does success look like?", source: "transcript" }],
      coachingNote: "Timestamp every evidence quote.",
    },
  ],
});
const qLine = thin.lines.find((l) => l.themeKey === "questions")!;
checks.push(["no-timestamp evidence reduces confidence", (qLine.confidence ?? 1) <= 0.35]);

// Stream without Pass 2 facts → video themes still NA
const streamOnly = normalizeScorecardLines({
  profile: demo,
  videoAvailable: true,
  deckPresent: true,
  modelLines: demo.themes.map((t) => ({
    themeKey: t.themeKey,
    score: 80,
    applicable: true,
    confidence: 0.9,
    evidence: [{ atS: 10, quote: "hello", source: "transcript" }],
    coachingNote: "x",
  })),
});
const streamCam = streamOnly.lines.find((l) => l.themeKey === "camera_on")!;
checks.push(
  ["stream without facts keeps camera NA", streamCam.applicable === false],
  ["stream without facts explains Pass 2", /Pass 2/i.test(streamCam.notApplicableReason || "")],
);

// Pass 2 facts ready + consent → camera_on from sampled pct; CDE from vision
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
  modelLines: demo.themes.map((t) => ({
    themeKey: t.themeKey,
    score: 40,
    applicable: true,
    confidence: 0.5,
    evidence: [{ atS: 10, quote: "hello", source: "transcript" }],
    coachingNote: "x",
  })),
});
const factCam = withFacts.lines.find((l) => l.themeKey === "camera_on")!;
const factCde = withFacts.lines.find((l) => l.themeKey === "cde_build")!;
checks.push(
  ["facts ready makes camera applicable", factCam.applicable === true],
  ["camera score from Pass 2 pct", factCam.score === 91],
  ["cde_build applicable from vision", factCde.applicable === true],
  ["cde_build score high when customized", factCde.score === 85],
);

// Facts without consent → camera NA, CDE still ok
const noConsent = normalizeScorecardLines({
  profile: demo,
  videoAvailable: true,
  deckPresent: true,
  videoFacts: {
    status: "ready",
    cameraOnPct: null,
    cdeCustomized: false,
    cdeEvidence: "Stock Acme seed data.",
    visualAnalysisConsent: false,
    keyframeRefs: [{ atS: 0, path: "/x.jpg" }],
    sampleIntervalS: 10,
    retentionExpiresAt: Date.now() + 1000,
    segments: [],
  },
  modelLines: demo.themes.map((t) => ({
    themeKey: t.themeKey,
    score: 50,
    applicable: true,
    confidence: 0.5,
    evidence: [{ atS: 10, quote: "hello", source: "transcript" }],
    coachingNote: "x",
  })),
});
const ncCam = noConsent.lines.find((l) => l.themeKey === "camera_on")!;
const ncCde = noConsent.lines.find((l) => l.themeKey === "cde_build")!;
checks.push(
  ["no consent keeps camera NA", ncCam.applicable === false],
  ["no consent camera mentions consent", /consent/i.test(ncCam.notApplicableReason || "")],
  ["no consent still scores CDE", ncCde.applicable === true && ncCde.score === 35],
);

// Model returns 9/16 lines — missing themes must not pass as applicable score 0.
const nineThemeKeys = [
  "questions",
  "solutioning",
  "storytelling",
  "ai",
  "value",
  "objections",
  "case_study_roi",
  "comp_pitch",
  "summarise",
] as const;
const partialModelLines = nineThemeKeys.map((themeKey) => ({
  themeKey,
  score: 80,
  applicable: true,
  confidence: 0.9,
  evidence: [{ atS: 120, quote: "Evidence for this theme.", source: "transcript" }],
  coachingNote: "Keep doing this.",
}));
const partial = normalizeScorecardLines({
  profile: demo,
  videoAvailable: false,
  deckPresent: false,
  modelAnalysisConfidence: 0.9,
  modelLines: partialModelLines,
});
checks.push(
  ["partial response still emits 16 lines", partial.lines.length === demo.themes.length],
  [
    "omitted transcript theme marked not scored",
    partial.lines.find((l) => l.themeKey === "research_agenda")?.applicable === false &&
      partial.lines.find((l) => l.themeKey === "research_agenda")?.notApplicableReason ===
        MODEL_OMITTED_THEME_REASON,
  ],
  [
    "omitted cta marked not scored",
    partial.lines.find((l) => l.themeKey === "cta")?.applicable === false &&
      partial.lines.find((l) => l.themeKey === "cta")?.notApplicableReason === MODEL_OMITTED_THEME_REASON,
  ],
  [
    "omitted theme confidence capped",
    (partial.lines.find((l) => l.themeKey === "research_agenda")?.confidence ?? 1) ===
      MODEL_OMITTED_CONFIDENCE,
  ],
  [
    "returned theme still scored",
    partial.lines.find((l) => l.themeKey === "questions")?.applicable === true &&
      partial.lines.find((l) => l.themeKey === "questions")?.score === 80,
  ],
  [
    "omitted themes excluded from applicable weight",
    partial.lines.filter((l) => l.applicable).every((l) => nineThemeKeys.includes(l.themeKey as (typeof nineThemeKeys)[number])),
  ],
  [
    "partial response lowers analysis confidence",
    partial.analysisConfidence < 0.9,
  ],
);
const partialDraft = buildScorecardDraft(demo, partial.lines, partial.analysisConfidence);
checks.push(
  [
    "partial composite ignores omitted themes",
    partialDraft.rawScore != null && partialDraft.rawScore >= 75,
  ],
);

const failed = checks.filter(([, ok]) => !ok);
if (failed.length) {
  console.error("FAILED:", failed.map(([n]) => n).join(", "));
  for (const [n, ok] of checks) {
    if (!ok) console.error(" -", n);
  }
  process.exit(1);
}
console.log("OK — postcall scorecard tests passed");
