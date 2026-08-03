/** Coach module — mirrors worker/src/coach/index.ts */

import { profileFor } from "../rubric-profiles.js";
import { canonicalCallType } from "../call-type-labels.js";

export const COACH_GENERAL_INSTRUCTIONS = {
  version: "1.0.0",
  voice:
    "Direct, specific, evidence-anchored coaching. Name timestamps, sub-parameters, and one next-time action.",
  rules: [
    "Be specific — point at the exact sub-parameter and timestamp; never vague praise.",
    "Anchor every note in evidence: what happened, what the rubric expects, what to try next.",
    "SE-facing uses you/your; manager-facing uses the SE / coach toward …",
    "When a manager override exists, say so transparently with the date.",
    "Skip sub-parameters that scored full credit (2/2).",
  ],
};

export const SCORE_OVERRIDE_STORAGE_KEY = "se-score-overrides";

const THEME_LABEL_OVERRIDES = {
  cde_build: "CDE build",
  ai: "AI demo",
  camera_on: "Camera on",
};

export function themeDisplayLabel(themeKey) {
  if (THEME_LABEL_OVERRIDES[themeKey]) return THEME_LABEL_OVERRIDES[themeKey];
  return String(themeKey || "")
    .split("_")
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
    .join(" ");
}

export function formatCoachTimestamp(atS) {
  if (atS == null || !Number.isFinite(atS)) return null;
  const s = Math.max(0, Math.floor(atS));
  const m = Math.floor(s / 60);
  const sec = s % 60;
  return `${String(m).padStart(2, "0")}:${String(sec).padStart(2, "0")}`;
}

function newOverrideId() {
  return `sov_${crypto.randomUUID()}`;
}

function primaryEvidence(sp) {
  const hit = (sp?.evidence || []).find((e) => e?.quote && String(e.quote).trim());
  return hit || sp?.evidence?.[0] || null;
}

function truncateQuote(quote, max = 55) {
  const cleaned = String(quote || "")
    .trim()
    .replace(/\s+/g, " ");
  if (cleaned.length <= max) return cleaned;
  return `${cleaned.slice(0, max - 1)}…`;
}

function nextTimeAction(spLabel, score, themeKey, spIndex) {
  const tip = insightfulCoachTip(spLabel, themeKey, spIndex, score);
  if (tip) return tip;
  const lower = spLabel.charAt(0).toLowerCase() + spLabel.slice(1);
  if (score === 0) return `On the next call, plan one moment to ${lower}.`;
  if (score === 1) return `You started this — next time push further on ${lower}.`;
  return `Push further — add a concrete example or timestamp for “${spLabel}”.`;
}

/** Actionable coaching when generic regurgitation would fire. */
const COACH_TIPS_BY_THEME = {
  research: {
    0: {
      0: "Open with one fact about their company or industry before you ask anything.",
      1: "Reference a recent news item, funding round, or launch to show you did homework.",
    },
    1: {
      0: "Name their stack or incumbent before asking — check LinkedIn, website, or CRM first.",
      1: "Use one public signal (hire, launch, earnings) in the first five minutes.",
    },
    2: {
      0: "Address someone on the call by role and context, not just first name.",
      1: "Tie prep to a specific person’s priorities you found before the meeting.",
    },
    3: {
      0: "Front-load prep in the opening — don’t retrofit context after discovery.",
      1: "Show prep in minute one; avoid ‘I looked you up’ comments after minute ten.",
    },
    4: {
      0: "Have three account-specific facts ready before you join.",
      1: "Weave one more prep detail into the first five minutes next time.",
    },
  },
  questions: {
    0: {
      0: "Replace yes/no checks with what/how/why — e.g. ‘What breaks today when…?’",
      1: "You opened well; push one more open-ended layer on the next answer.",
    },
    1: {
      0: "Save a sharper question for after the demo — don’t front-load everything.",
      1: "Late-call questions went flat; plan one probing follow-up for the second half.",
    },
    2: {
      0: "Aim for one question whose answer isn’t in the CRM or brief.",
      1: "You surfaced something new once — make that a deliberate goal every call.",
    },
    3: {
      0: "After they answer, pause and ask one clarifying why or how before moving on.",
      1: "You followed up once; stack a second clarifier when answers stay surface-level.",
    },
    4: {
      0: "Count to three after they stop talking — resist filling the silence.",
      1: "Hold silence especially after budget, timeline, or stakeholder answers.",
    },
  },
  value: {
    0: {
      0: "Quantify impact — hours, tickets, headcount — not ‘faster’ or ‘better’.",
      1: "Anchor one number to their KPI, not a generic industry stat.",
    },
    1: {
      0: "Use their metrics or cite a benchmark explicitly — don’t invent ROI.",
      1: "Ask for their baseline before stating savings.",
    },
    2: {
      0: "Tie value to the champion’s personal KPI, not only company-wide goals.",
      1: "Name who wins personally when this works — time back, fewer escalations, etc.",
    },
    3: {
      0: "Address time-to-value — when they see benefit, not just eventual upside.",
      1: "Set a realistic ‘first win in X weeks’ frame.",
    },
    4: {
      0: "Repeat value language at least three times — open, mid-call, and close.",
      1: "Weave one more quantified value moment into the second half.",
    },
  },
  case_study: {
    0: {
      0: "Pick a reference close in industry or size — avoid generic ‘similar customers’.",
      1: "Name the segment explicitly when you tell the story.",
    },
    1: {
      0: "Cite a specific number in the story — %, hours, revenue — not ‘big improvement’.",
      1: "Lead with the metric, then the narrative.",
    },
    2: {
      0: "Use a named logo or honest NDA placeholder — never a vague ‘a customer’.",
      1: "Show the slide or say you can’t name them under NDA.",
    },
    3: {
      0: "Draw the parallel out loud: ‘Same situation as your X team…’",
      1: "Make the ‘so for you’ bridge explicit before moving on.",
    },
    4: {
      0: "Tell the story when the pain is live — not as a closing filler.",
      1: "Keep it under two minutes and stop when they nod.",
    },
  },
};

function defaultTipPair(spLabel) {
  const lower = spLabel.charAt(0).toLowerCase() + spLabel.slice(1);
  return {
    0: `On the next call, plan one moment to ${lower}.`,
    1: `You started this — next time ${lower}.`,
  };
}

function ensureCoachTipsForCallType(callType) {
  try {
    const profile = profileFor(callType);
    for (const theme of profile.themes) {
      if (COACH_TIPS_BY_THEME[theme.key]) continue;
      COACH_TIPS_BY_THEME[theme.key] = Object.fromEntries(
        (theme.subParameters || []).map((label, i) => [i, defaultTipPair(label)]),
      );
    }
  } catch {
    /* profile unavailable in test env */
  }
}

for (const callType of ["demo", "discovery", "technical_deep_dive", "reverse_demo"]) {
  ensureCoachTipsForCallType(callType);
}

export function insightfulCoachTip(spLabel, themeKey, spIndex, score) {
  const bucket = COACH_TIPS_BY_THEME[themeKey]?.[spIndex];
  if (!bucket) return null;
  const n = Math.max(0, Math.min(2, Number(score) || 0));
  return bucket[n] ?? bucket[1] ?? bucket[0] ?? null;
}

function formatCalibrationNote(override, audience) {
  const date = new Date(override.createdAt).toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
  });
  if (audience === "se") {
    const direction =
      override.override > override.original
        ? "Your manager raised this score"
        : override.override < override.original
          ? "Your manager adjusted this score"
          : "Your manager reviewed this score";
    return `${direction} on ${date}.`;
  }
  return `Manager calibrated on ${date}: ${override.reason}`;
}

function adaptationHint(override, audience) {
  const delta = override.override - override.original;
  if (delta === 0) {
    return audience === "se"
      ? "Your dispute was reviewed; the score stands."
      : "Dispute upheld — original score retained.";
  }
  if (delta > 0) {
    return audience === "se"
      ? "Calibration note: the rubric was too harsh here — keep disputing when evidence supports you."
      : "Calibration: model scored harsh; reinforce fair-credit expectations with the SE.";
  }
  return audience === "se"
    ? "Calibration note: your manager agreed this needed more weight — focus here next call."
    : "Calibration: model was generous; double down on this sub-parameter in 1:1.";
}

function buildSubParameterCoachNote(themeKey, spIndex, spLabel, sp, override, audience) {
  const score = sp?.score ?? 0;
  if (score >= 2) return null;

  const ev = primaryEvidence(sp);
  const ts = formatCoachTimestamp(ev?.atS);
  const quote = ev?.quote ? truncateQuote(String(ev.quote)) : null;
  const themeLabel = themeDisplayLabel(themeKey);
  const action = nextTimeAction(spLabel, score, themeKey, spIndex);

  const seEvidence = quote ? `you said “${quote}”` : "this wasn’t clear on the call";
  const mgrEvidence = quote ? `the SE said “${quote}”` : "the transcript lacks clear evidence";

  const seFacing = ts
    ? `At ${ts}, ${seEvidence}. ${action}`
    : `${action.charAt(0).toUpperCase()}${action.slice(1)}`;
  const managerFacing = ts
    ? `At ${ts}, ${mgrEvidence}. Coach on “${spLabel}” under ${themeLabel} — ${action.replace(/^On the next call, /, "next call: ").replace(/^You started this — next time /, "sharpen: ")}`
    : `Under ${themeLabel}, “${spLabel}” needs work: ${mgrEvidence}. ${action.replace(/^On the next call, /, "1:1 focus: ")}`;

  let calibrationNote;
  if (override) {
    calibrationNote = [formatCalibrationNote(override, audience), adaptationHint(override, audience)]
      .filter(Boolean)
      .join(" ");
  }

  return {
    themeKey,
    subParameterIndex: spIndex,
    subParameterLabel: spLabel,
    score,
    evidenceAtS: ev?.atS ?? null,
    evidenceQuote: quote,
    seFacing,
    managerFacing,
    calibrationNote,
  };
}

function themeGrade(line) {
  if (line.evidenceUnavailable || line.applicable === false) return -1;
  if (typeof line.grade === "number") return line.grade;
  const subs = line.subParameters || [];
  if (subs.length === 5) return subs.reduce((acc, sp) => acc + (sp?.score ?? 0), 0);
  return 0;
}

function overrideForLine(overrides, line) {
  if (!line?.id || !overrides?.length) return null;
  const matches = overrides
    .filter((o) => o.scorecardLineId === line.id)
    .sort((a, b) => b.createdAt - a.createdAt);
  return matches[0] ?? null;
}

function buildThemeCoachGuidance(line, profileTheme, overrides, audience) {
  if (line.evidenceUnavailable || line.applicable === false) return null;
  const grade = themeGrade(line);
  if (grade < 0) return null;

  const subLabels = profileTheme?.subParameters || [];
  const subParams =
    line.subParameters?.length === 5
      ? line.subParameters
      : Array.from({ length: 5 }, () => ({ score: 0, evidence: [] }));

  const override = overrideForLine(overrides, line);
  const subParameterNotes = subParams
    .map((sp, i) =>
      buildSubParameterCoachNote(
        line.themeKey,
        i,
        subLabels[i] || `Sub-parameter ${i + 1}`,
        sp,
        override,
        audience,
      ),
    )
    .filter(Boolean);

  const lostPoints = grade < 10;
  if (!lostPoints && !subParameterNotes.length) return null;

  const themeLabel = themeDisplayLabel(line.themeKey);
  let themeSummary;

  if (lostPoints) {
    const weakCount = subParameterNotes.length;
    const seFacing =
      weakCount > 0
        ? `${themeLabel} lost ${10 - grade} point${10 - grade === 1 ? "" : "s"} — ${weakCount} sub-parameter${weakCount === 1 ? "" : "s"} to tighten.`
        : line.coachingNote?.trim() ||
          `${themeLabel} has room to grow (${grade}/10). Review sub-parameters below.`;
    const managerFacing =
      weakCount > 0
        ? `${themeLabel} at ${grade}/10 — focus 1:1 on ${weakCount} weak sub-parameter${weakCount === 1 ? "" : "s"}.`
        : `${themeLabel} at ${grade}/10 — open with evidence from the weakest sub-parameter.`;
    themeSummary = { seFacing, managerFacing };
  }

  return {
    themeKey: line.themeKey,
    themeLabel,
    grade,
    lostPoints,
    subParameterNotes,
    themeSummary,
  };
}

/** @param {{ callId?: string, callType: string, lines?: object[], overrides?: object[], audience?: string, instructions?: object }} input */
export function buildCoachOutput(input = {}) {
  const audience = input.audience ?? "se";
  const instructions = input.instructions ?? COACH_GENERAL_INSTRUCTIONS;
  const callType = canonicalCallType(input.callType || "demo");
  let profile;
  try {
    profile = profileFor(callType);
  } catch {
    profile = profileFor("demo");
  }
  const overrides = input.overrides ?? [];

  const themes = (input.lines || [])
    .map((line) => {
      const profileTheme = profile.themes.find((t) => t.key === line.themeKey);
      return buildThemeCoachGuidance(line, profileTheme, overrides, audience);
    })
    .filter(Boolean);

  return {
    configVersion: instructions.version,
    callId: input.callId,
    callType: callType,
    audience,
    generalInstructions: instructions,
    themes,
  };
}

export function coachTextForSubParameter(output, themeKey, subParameterIndex) {
  const theme = output?.themes?.find((t) => t.themeKey === themeKey);
  const note = theme?.subParameterNotes?.find((n) => n.subParameterIndex === subParameterIndex);
  if (!note) return null;
  const base = output?.audience === "manager" ? note.managerFacing : note.seFacing;
  return note.calibrationNote ? `${base} ${note.calibrationNote}` : base;
}

export function resolveScoreDispute({ dispute, ruling, managerId, overrideGrade, reason }) {
  const now = new Date().toISOString();

  if (ruling === "uphold") {
    return {
      dispute: {
        ...dispute,
        status: "upheld",
        resolvedAt: now,
        resolvedBy: managerId,
        ruling: "uphold",
        rulingReason: reason || dispute.note,
      },
    };
  }

  const original = dispute.grade ?? dispute.score ?? 0;
  const overrideVal = Math.max(0, Math.min(10, overrideGrade ?? original));
  const overrideEntry = {
    id: newOverrideId(),
    scorecardLineId: dispute.scorecardLineId || `scl_dispute_${dispute.id}`,
    scorecardId: dispute.scorecardId || `scr_dispute_${dispute.callId || dispute.id}`,
    callId: dispute.callId || "",
    original,
    override: overrideVal,
    userId: managerId,
    reason: reason || dispute.note,
    createdAt: Date.now(),
  };

  return {
    dispute: {
      ...dispute,
      status: "adjusted",
      resolvedAt: now,
      resolvedBy: managerId,
      ruling: "adjust",
      rulingReason: reason || dispute.note,
      overrideId: overrideEntry.id,
    },
    override: overrideEntry,
  };
}

export function loadScoreOverrides() {
  try {
    const raw = localStorage.getItem(SCORE_OVERRIDE_STORAGE_KEY);
    return raw ? JSON.parse(raw) : [];
  } catch {
    return [];
  }
}

export function saveScoreOverrides(entries) {
  localStorage.setItem(SCORE_OVERRIDE_STORAGE_KEY, JSON.stringify((entries || []).slice(0, 500)));
}

export function appendScoreOverride(entry) {
  const list = loadScoreOverrides();
  list.unshift(entry);
  saveScoreOverrides(list);
  return entry;
}

export function overridesForCall(overrides, callId) {
  return (overrides || []).filter((o) => o.callId === callId);
}

export const buildCoachForScorecard = buildCoachOutput;
export const coachNoteForSubParameter = coachTextForSubParameter;
