/** QIP insight bullets and theme N/A copy — no HTML leaks, correct reasons per theme. */
import { renderQipScorecard } from "../postcall.js";
import {
  resolveThemeNaReason,
  GENERIC_EVIDENCE_UNAVAILABLE_REASON,
  CAMERA_ON_PENDING_REASON,
  DISCOVERY_INCIDENT_NA_REASONS,
  CATEGORY_ALL_THEMES_NA_REASON,
} from "../user-facing-copy.js";
import {
  MODEL_OMITTED_THEME_REASON,
  RESEARCH_NOT_EVIDENCED_REASON,
} from "../shared/qip-scorecard-normalize.js";
import { profileFor } from "../rubric-profiles.js";

function assert(cond, msg) {
  if (!cond) throw new Error(msg);
}

const demoProfile = profileFor("demo");

assert(
  resolveThemeNaReason({ themeKey: "research", evidenceUnavailable: true, modelOmitted: true }, demoProfile) ===
    RESEARCH_NOT_EVIDENCED_REASON,
  "legacy research row uses not-evidenced reason, not model omitted",
);

assert(
  resolveThemeNaReason({ themeKey: "camera_on", applicable: false }, demoProfile) ===
    CAMERA_ON_PENDING_REASON,
  "camera_on is N/A pending Zoom connector",
);

assert(
  resolveThemeNaReason({ themeKey: "research", evidenceUnavailable: true }, demoProfile) ===
    GENERIC_EVIDENCE_UNAVAILABLE_REASON,
  "research evidence gap uses generic reason",
);

const discProfile = profileFor("discovery", "new_business");
assert(!discProfile.themes.some((t) => t.key === "storytelling"), "NB discovery has no storytelling");
assert(
  resolveThemeNaReason(
    { themeKey: "objections", evidenceUnavailable: true, notApplicableReason: DISCOVERY_INCIDENT_NA_REASONS.objections },
    discProfile,
  ) === DISCOVERY_INCIDENT_NA_REASONS.objections,
  "discovery objections N/A uses incident reason",
);
assert(
  resolveThemeNaReason({ themeKey: "objections", evidenceUnavailable: true }, discProfile) ===
    DISCOVERY_INCIDENT_NA_REASONS.objections,
  "discovery objections N/A falls back without stored reason",
);
assert(
  !resolveThemeNaReason({ themeKey: "objections", evidenceUnavailable: true }, discProfile)
    .toLowerCase()
    .includes("video"),
  "discovery incident N/A is not a no-video reason",
);
assert(
  resolveThemeNaReason({ themeKey: "objections", evidenceUnavailable: true, grade: 0 }, demoProfile) ===
    GENERIC_EVIDENCE_UNAVAILABLE_REASON,
  "demo objections evidence gap stays generic, not discovery incident copy",
);

const longNote =
  "The SE introduced AI, but it was quickly dismissed; focus on demonstrating AI value before asking if they want to enable it on day one with their ticket volume patterns.";

const html = renderQipScorecard(
  {
    callType: "demo",
    overall: 6.9,
    categoryScores: {
      discovery_qualification: 7,
      solution_technical_fit: 6,
      business_value: 7,
      credibility_objections: 6.8,
      communication_control: 7.4,
    },
    lines: [
      {
        themeKey: "ai",
        grade: 4,
        credit: 2,
        category: "solution_technical_fit",
        coachingNote: longNote,
        confidence: 0.7,
        subParameters: Array.from({ length: 5 }, () => ({ score: 1, evidence: [] })),
      },
      {
        themeKey: "research",
        grade: 0,
        credit: 2,
        category: "discovery_qualification",
        evidenceUnavailable: true,
        modelOmitted: true,
        confidence: 0.25,
        coachingNote: RESEARCH_NOT_EVIDENCED_REASON,
        subParameters: [],
      },
    ],
  },
  { callType: "demo", rubricVersion: "2.1" },
  { context: "call-record" },
);

assert(!html.includes("&lt;span"), "insight tile must not show escaped span tags");
assert(!html.includes('<span class="trunc-ellipsis">'), "insight tile must not leak trunc HTML");
assert(html.includes("What didn"), "renders what didn't column");
assert(html.includes(RESEARCH_NOT_EVIDENCED_REASON), "research shows not-evidenced reason");
const researchRow = html.match(/data-theme-key="research"[\s\S]*?<\/details>/);
assert(
  researchRow && !researchRow[0].includes(MODEL_OMITTED_THEME_REASON),
  "research row must not show model-omitted copy",
);
assert(!html.includes("requires visual evidence") || html.includes("camera_on") === false, "research row avoids video copy");

function categorySummaryHtml(markup, label) {
  const escaped = String(label).replace(/&/g, "&amp;");
  const nameIdx = markup.indexOf(`>${escaped}<`);
  if (nameIdx < 0) throw new Error(`missing category label ${label}`);
  const summaryStart = markup.lastIndexOf("<summary", nameIdx);
  const summaryEnd = markup.indexOf("</summary>", nameIdx);
  if (summaryStart < 0 || summaryEnd < 0) throw new Error(`missing summary for ${label}`);
  return markup.slice(summaryStart, summaryEnd);
}

function discoveryLines({ naKeys = [], scoredKeys = [] } = {}) {
  return discProfile.themes.map((theme) => {
    const na = naKeys.includes(theme.key);
    const scored = scoredKeys.includes(theme.key);
    return {
      themeKey: theme.key,
      credit: theme.credit,
      category: theme.category,
      grade: na ? 0 : scored ? 8 : 6,
      evidenceUnavailable: na,
      applicable: na ? false : true,
      confidence: 0.55,
      notApplicableReason: na ? DISCOVERY_INCIDENT_NA_REASONS[theme.key] : undefined,
      coachingNote: na ? DISCOVERY_INCIDENT_NA_REASONS[theme.key] : "Keep going.",
      subParameters: na
        ? []
        : Array.from({ length: 5 }, () => ({ score: scored ? 2 : 1, evidence: [] })),
    };
  });
}

const discBothNaHtml = renderQipScorecard(
  {
    callType: "discovery",
    seMotion: "new_business",
    overall: 7.1,
    confidence: 0.55,
    categoryScores: {
      discovery_qualification: 7,
      solution_technical_fit: 7,
      business_value: 7,
      credibility_objections: 0,
      communication_control: 7,
    },
    lines: discoveryLines({ naKeys: ["objections", "comp_pitch"] }),
  },
  { callType: "discovery", seMotion: "new_business" },
  { context: "call-record" },
);

const credSummary = categorySummaryHtml(discBothNaHtml, "Objections & credibility");
assert(credSummary.includes(">N/A<"), "fully N/A category header shows N/A");
assert(!credSummary.includes(" / 10"), "fully N/A category header does not show 0 / 10");
assert(!credSummary.includes("pill med") && !/>Med</.test(credSummary), "fully N/A category hides Med chip");
assert(
  credSummary.includes(CATEGORY_ALL_THEMES_NA_REASON) || discBothNaHtml.includes(CATEGORY_ALL_THEMES_NA_REASON),
  "category N/A copy is not a video gap",
);
assert(!CATEGORY_ALL_THEMES_NA_REASON.toLowerCase().includes("video"), "category N/A copy is not 'no video'");
assert(discBothNaHtml.includes(DISCOVERY_INCIDENT_NA_REASONS.objections), "child objections keep incident N/A reason");

const discMixedHtml = renderQipScorecard(
  {
    callType: "discovery",
    seMotion: "new_business",
    overall: 7.1,
    confidence: 0.7,
    categoryScores: {
      discovery_qualification: 7,
      solution_technical_fit: 7,
      business_value: 7,
      credibility_objections: 10,
      communication_control: 7,
    },
    lines: discoveryLines({ naKeys: ["objections"], scoredKeys: ["comp_pitch"] }),
  },
  { callType: "discovery", seMotion: "new_business" },
  { context: "call-record" },
);
const mixedSummary = categorySummaryHtml(discMixedHtml, "Objections & credibility");
assert(mixedSummary.includes(" / 10"), "mixed category still shows a numeric / 10");
assert(!mixedSummary.includes(">N/A<"), "mixed category header is not N/A");

const demoZeroHtml = renderQipScorecard(
  {
    callType: "demo",
    overall: 0,
    confidence: 0.7,
    categoryScores: {
      discovery_qualification: 0,
      solution_technical_fit: 0,
      business_value: 0,
      credibility_objections: 0,
      communication_control: 0,
    },
    lines: demoProfile.themes
      .filter((t) => t.key !== "camera_on")
      .map((theme) => ({
        themeKey: theme.key,
        credit: theme.credit,
        category: theme.category,
        grade: 0,
        evidenceUnavailable: false,
        confidence: 0.7,
        subParameters: Array.from({ length: 5 }, () => ({ score: 0, evidence: [] })),
      })),
  },
  { callType: "demo", rubricVersion: "2.1" },
  { context: "call-record" },
);
const demoCredSummary = categorySummaryHtml(demoZeroHtml, "Objections & credibility");
assert(demoCredSummary.includes(" / 10"), "demo all-zero category stays 0 / 10, not N/A");
assert(!demoCredSummary.includes(">N/A<"), "demo scored-zero category is not N/A");

const themeAllNaHtml = renderQipScorecard(
  {
    callType: "demo",
    overall: 6,
    categoryScores: { discovery_qualification: 6, solution_technical_fit: 6, business_value: 6, credibility_objections: 6, communication_control: 6 },
    lines: [
      {
        themeKey: "objections",
        grade: 0,
        credit: 3,
        category: "credibility_objections",
        evidenceUnavailable: true,
        confidence: 0.5,
        subParameters: Array.from({ length: 5 }, () => ({ score: 0, evidence: [] })),
      },
    ],
  },
  { callType: "demo" },
  { context: "call-record" },
);
const objectionsTheme = themeAllNaHtml.match(/data-theme-key="objections"[\s\S]*?<\/details>/);
assert(objectionsTheme && objectionsTheme[0].includes(">N/A<"), "theme-level evidenceUnavailable still renders N/A");

console.log("test-qip-insight-na: ok");
