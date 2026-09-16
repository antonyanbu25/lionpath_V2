/** Parity — shared normalize fills missing themes; transcript gaps score 0, video gaps stay N/A. */
import {
  normalizeQipScorecard,
  isThemeExcludedFromAggregate,
  createModelOmittedLine,
  RESEARCH_NOT_EVIDENCED_REASON,
} from "../shared/qip-scorecard-normalize.js";
import { profileFor } from "../rubric-profiles.js";
import { themeAverage, scoreCall } from "../quality-score.js";

function assert(cond, msg) {
  if (!cond) throw new Error(msg);
}

const profile = profileFor("demo");
const scoredThemes = profile.themes.slice(0, 3).map((theme) => ({
  themeKey: theme.key,
  grade: 8,
  credit: theme.credit,
  category: theme.category,
  subParameters: [{ score: 2 }, { score: 2 }, { score: 2 }, { score: 1 }, { score: 1 }],
  evidenceUnavailable: false,
}));

const scorecard = {
  callType: "demo",
  rubricVersion: "2.1",
  provisional: false,
  confidence: 0.9,
  lines: scoredThemes,
};

const normalized = normalizeQipScorecard(scorecard, { callType: "demo" });
assert(normalized.lines.length >= profile.themes.length, "fills missing profile themes");

const missingTranscriptTheme = profile.themes.find((t) => !scoredThemes.some((l) => l.themeKey === t.key) && !t.requiresVideo);
assert(missingTranscriptTheme, "profile has a missing transcript theme");
const transcriptFill = normalized.lines.find((l) => l.themeKey === missingTranscriptTheme.key);
assert(transcriptFill, "transcript theme filler added");
assert(!transcriptFill.modelOmitted, "transcript filler is not model-omitted");
assert(!isThemeExcludedFromAggregate(transcriptFill), "transcript filler stays in denominator");
if (missingTranscriptTheme.key === "research") {
  assert(transcriptFill.coachingNote === RESEARCH_NOT_EVIDENCED_REASON, "research filler uses not-evidenced copy");
}

const cameraFill = normalized.lines.find((l) => l.themeKey === "camera_on");
assert(cameraFill?.evidenceUnavailable, "camera_on is N/A pending Zoom detection");
assert(isThemeExcludedFromAggregate(cameraFill), "camera_on filler excluded from aggregates");

const fullScore = scoreCall(
  profile,
  normalized.lines.map((line) => ({
    themeKey: line.themeKey,
    subParameters: line.subParameters || [],
    evidenceUnavailable: isThemeExcludedFromAggregate(line),
    modelOmitted: !!line.modelOmitted,
  })),
);
assert(fullScore.overall < 7.5, "overall includes zero scores for missing transcript themes");

const withEvidenceNa = {
  ...scorecard,
  lines: [
    ...scoredThemes,
    {
      themeKey: "camera_on",
      grade: 0,
      credit: 2,
      category: "communication_control",
      subParameters: [],
      evidenceUnavailable: true,
    },
  ],
};
const avgCam = themeAverage(
  [
    {
      callType: "demo",
      rubricVersion: "2.1",
      provisional: false,
      confidence: 0.9,
      lines: withEvidenceNa.lines,
    },
  ],
  "camera_on",
  "demo",
);
assert(avgCam.score == null, "evidenceUnavailable theme not averaged as zero");

const researchPlaceholder = createModelOmittedLine(profile.themes.find((t) => t.key === "research"));
assert(!isThemeExcludedFromAggregate(researchPlaceholder), "research placeholder stays in denominator");

const cameraPlaceholder = createModelOmittedLine(profile.themes.find((t) => t.key === "camera_on"));
assert(isThemeExcludedFromAggregate(cameraPlaceholder), "camera placeholder excluded from aggregates");

const discovery = profileFor("discovery", "new_business");
assert(!discovery.themes.some((t) => t.key === "storytelling"), "NB discovery profile has no storytelling");
const discScorecard = {
  callType: "discovery",
  seMotion: "new_business",
  rubricVersion: "2.1",
  lines: discovery.themes.map((theme) => {
    if (theme.key === "camera_on") {
      return {
        themeKey: theme.key,
        credit: theme.credit,
        category: theme.category,
        grade: 0,
        evidenceUnavailable: true,
        subParameters: [],
      };
    }
    if (theme.key === "objections" || theme.key === "comp_pitch" || theme.key === "case_study") {
      return {
        themeKey: theme.key,
        credit: theme.credit,
        category: theme.category,
        grade: 0,
        evidenceUnavailable: true,
        notApplicableReason: "No objection or customer pushback came up on this call.",
        subParameters: Array.from({ length: 5 }, () => ({ score: 0, evidence: [] })),
      };
    }
    return {
      themeKey: theme.key,
      credit: theme.credit,
      category: theme.category,
      grade: 8,
      evidenceUnavailable: false,
      subParameters: [{ score: 2 }, { score: 2 }, { score: 2 }, { score: 1 }, { score: 1 }],
    };
  }),
};
const discNorm = normalizeQipScorecard(discScorecard, { callType: "discovery", seMotion: "new_business" });
const discObj = discNorm.lines.find((l) => l.themeKey === "objections");
assert(isThemeExcludedFromAggregate(discObj), "discovery absent objections excluded from aggregates");
assert(
  discNorm.categoryScores.credibility_objections == null,
  "discovery both incident N/A → credibility_objections is null, not 0",
);

const storedZeroCat = normalizeQipScorecard(
  {
    ...discScorecard,
    overall: 8,
    categoryScores: {
      discovery_qualification: 8,
      solution_technical_fit: 8,
      business_value: 8,
      credibility_objections: 0,
      communication_control: 8,
    },
  },
  { callType: "discovery", seMotion: "new_business" },
);
assert(
  storedZeroCat.categoryScores.credibility_objections == null,
  "stored 0 for a fully N/A category is rewritten to null",
);
assert(
  typeof storedZeroCat.categoryScores.discovery_qualification === "number",
  "scored categories stay numeric",
);
const discScored = scoreCall(
  discovery,
  discNorm.lines.map((line) => ({
    themeKey: line.themeKey,
    subParameters: line.subParameters || [],
    evidenceUnavailable: isThemeExcludedFromAggregate(line),
  })),
);
const discForced = scoreCall(
  discovery,
  discNorm.lines.map((line) => ({
    themeKey: line.themeKey,
    subParameters: line.subParameters || [],
    evidenceUnavailable: line.themeKey === "camera_on",
  })),
);
assert(discScored.overall > discForced.overall, "discovery N/A incidents raise overall vs zeros in denom");

console.log("test-qip-normalize-parity: ok");
