/**
 * Pass 8 deal traction rollup — hot / warm / cold (spec §5, §9).
 * Deterministic aggregation across deal calls with time decay; not an LLM extraction.
 */

/** @typedef {"hot"|"warm"|"cold"} TractionLabel */

const DAY_MS = 86400000;

/** Default stage medians when closed-deal sample is too small (days). */
export const STAGE_MEDIAN_DAYS_DEFAULT = {
  research: 14,
  discovery: 21,
  demo: 14,
  evaluation: 30,
  business_case: 21,
  closed_won: 0,
  closed_lost: 0,
  nurture: 45,
};

/** Video-only signals — report as gaps, never approximate (spec §5 Pass 2). */
export const VIDEO_SIGNAL_GAPS = [
  { key: "talk_ratio", label: "Talk ratio" },
  { key: "attendee_dropoff", label: "Attendee drop-off mid-call" },
  { key: "dead_air", label: "Dead air" },
];

/**
 * @param {string|undefined|null} status
 * @returns {number}
 */
export function momentumPoints(status) {
  if (status === "Advancing") return 2;
  if (status === "At risk") return 0;
  if (status === "Stalled") return -2;
  return 0;
}

/**
 * Exponential time decay — half-life ~30 days.
 * @param {number} ageDays
 */
export function timeDecayWeight(ageDays) {
  if (ageDays <= 0) return 1;
  return Math.pow(0.5, ageDays / 30);
}

/**
 * @param {number[]} values
 * @returns {number|null}
 */
export function median(values) {
  const nums = (values || []).filter((v) => typeof v === "number" && Number.isFinite(v)).sort((a, b) => a - b);
  if (!nums.length) return null;
  const mid = Math.floor(nums.length / 2);
  return nums.length % 2 ? nums[mid] : (nums[mid - 1] + nums[mid]) / 2;
}

/**
 * @param {number} ts
 * @param {number} [nowMs]
 */
export function daysSince(ts, nowMs = Date.now()) {
  if (!ts || !Number.isFinite(ts)) return 0;
  return Math.max(0, Math.floor((nowMs - ts) / DAY_MS));
}

function isBlankDue(due) {
  const s = String(due ?? "").trim();
  return !s || /^unknown$|^tbd$|^—$|^-$|^n\/a$/i.test(s);
}

/**
 * @param {object[]} rows — nextSteps or followUps
 */
export function countUndatedNextSteps(rows) {
  let n = 0;
  for (const row of rows || []) {
    const due = row.due ?? row.dueDate;
    const action = row.action ?? row.description;
    if (!String(action || "").trim()) continue;
    if (isBlankDue(due)) n += 1;
  }
  return n;
}

/**
 * @param {object[]} objections
 * @param {string[]} openFromSignals
 */
export function countUnresolvedObjections(objections, openFromSignals = []) {
  let n = 0;
  for (const o of objections || []) {
    if (o && o.landed !== true) n += 1;
  }
  for (const s of openFromSignals || []) {
    if (String(s || "").trim()) n += 1;
  }
  return n;
}

/**
 * @param {{ status?: string, value?: string }|null|undefined} champion
 */
export function championSignal(champion) {
  if (!champion?.value) return { lean: -1, reason: "No champion identified on the deal" };
  const st = champion.status || "partial";
  if (st === "confirmed") return { lean: 2, reason: `Champion confirmed: ${champion.value}` };
  if (st === "partial") return { lean: 0, reason: `Champion partial: ${champion.value}` };
  return { lean: -1, reason: "Champion not validated" };
}

/**
 * @param {{ status?: string, justification?: string }|null} technicalCommit
 */
export function technicalCommitSignal(technicalCommit) {
  if (!technicalCommit) {
    return { lean: 0, reason: null, pending: true };
  }
  const status = technicalCommit.status;
  if (status === "at_risk") {
    return { lean: -2, reason: "Technical commit at risk", pending: false };
  }
  if (status === "no") {
    return { lean: -2, reason: "Technical commit declined", pending: false };
  }
  if (status === "pending") {
    return { lean: -1, reason: "Technical commit still pending", pending: false };
  }
  if (status === "yes") {
    const j = technicalCommit.justification ? `: ${technicalCommit.justification}` : "";
    return { lean: 1, reason: `Technical commit confirmed${j}`, pending: false };
  }
  return { lean: 0, reason: null, pending: false };
}

/**
 * @param {number} score
 * @returns {TractionLabel}
 */
export function scoreToTraction(score) {
  if (score >= 3) return "hot";
  if (score <= -2) return "cold";
  return "warm";
}

/**
 * Build visible video gap reasons when Pass 2 facts are absent.
 * @param {object|null|undefined} videoFacts
 */
export function videoGapReasons(videoFacts) {
  if (videoFacts && typeof videoFacts === "object") return [];
  return VIDEO_SIGNAL_GAPS.map((g) => `Unavailable without video: ${g.label}`);
}

/**
 * Aggregate momentum across calls with time decay.
 * @param {{ momentum?: { status?: string, reason?: string }, createdAt?: number, callId?: string }[]} calls
 * @param {number} [nowMs]
 */
export function aggregateMomentum(calls, nowMs = Date.now()) {
  let weighted = 0;
  let weightSum = 0;
  /** @type {string[]} */
  const reasons = [];

  for (const c of calls || []) {
    const pts = momentumPoints(c.momentum?.status);
    if (!pts && !c.momentum?.status) continue;
    const age = daysSince(c.createdAt, nowMs);
    const w = timeDecayWeight(age);
    weighted += pts * w;
    weightSum += w;
    if (c.momentum?.reason && w >= 0.4) {
      reasons.push(`${c.momentum.status}: ${c.momentum.reason}`);
    }
  }

  const avg = weightSum ? weighted / weightSum : 0;
  return { avg, reasons: reasons.slice(0, 3) };
}

/**
 * Pick exactly one recommended action from rollup context.
 * @param {object} ctx
 */
export function pickRecommendedAction(ctx) {
  const {
    traction,
    undatedNextSteps,
    unresolvedObjections,
    daysSilent,
    champion,
    momentumTopAction,
    technicalCommitPending,
  } = ctx;

  if (!champion?.value) {
    return "Identify and validate a champion with a named next step";
  }
  if (undatedNextSteps > 0) {
    return "Set a customer-owned next step with a specific due date";
  }
  if (unresolvedObjections > 0 && ctx.firstObjection) {
    return `Resolve open objection: ${ctx.firstObjection}`;
  }
  if (daysSilent >= 14) {
    return `Re-engage the customer — ${daysSilent} days since last activity`;
  }
  if (technicalCommitPending) {
    return "Complete Pass 5 technical commit assessment on this deal";
  }
  if (momentumTopAction) {
    return momentumTopAction;
  }
  if (traction === "hot") return "Maintain cadence — confirm next milestone on calendar";
  if (traction === "cold") return "Reset deal plan with AE — agree a dated re-engagement or close out";
  return "Confirm owner and date for the next customer touchpoint";
}

/**
 * Resolve next-step owner label from analysis / follow-ups.
 * @param {object} analysis
 * @param {object[]} followUps
 */
export function resolveNextStepOwner(analysis, followUps) {
  for (const row of analysis?.nextSteps || []) {
    if (String(row.action || "").trim() && isBlankDue(row.due)) {
      return String(row.owner || "se").trim() || "se";
    }
  }
  for (const fu of followUps || []) {
    if (fu.status === "open" && !fu.dueDate) {
      return String(fu.owner || "se").trim() || "se";
    }
  }
  const top = analysis?.momentum?.topAction;
  if (top) return "se";
  return "se";
}

/**
 * Core Pass 8 rollup — consumes Pass 4/5/7 inputs plus per-call momentum.
 * @param {object} input
 * @returns {{
 *   traction: TractionLabel,
 *   reasonsJson: string[],
 *   recommendedAction: string,
 *   daysSilent: number,
 *   nextStepOwner: string,
 *   daysInStage: number,
 *   stageMedianDays: number,
 * }}
 */
export function computeDealTraction(input) {
  const nowMs = input.nowMs ?? Date.now();
  const deal = input.deal || {};
  const analysis = input.analysis || {};
  const followUps = input.followUps || [];
  const objections = input.objections || [];

  const daysSilent = daysSince(deal.lastActivityAt, nowMs);
  const daysInStage = input.daysInStage ?? daysSince(deal.updatedAt, nowMs);
  const stageMedianDays =
    typeof input.stageMedianDays === "number"
      ? input.stageMedianDays
      : STAGE_MEDIAN_DAYS_DEFAULT[deal.stage] ?? 21;

  const priorCalls = input.priorCalls || [];
  const allMomentumCalls = [
    { momentum: analysis.momentum, createdAt: input.callCreatedAt ?? nowMs, callId: input.callId },
    ...priorCalls.filter((c) => c.callId !== input.callId),
  ];
  const { avg: momentumAvg, reasons: momentumReasons } = aggregateMomentum(allMomentumCalls, nowMs);

  const undatedFromAnalysis = countUndatedNextSteps(analysis.nextSteps);
  const undatedFromFollowUps = countUndatedNextSteps(
    followUps.map((f) => ({ action: f.description, due: f.dueDate })),
  );
  const undatedNextSteps = Math.max(undatedFromAnalysis, undatedFromFollowUps);

  const openSignals = analysis.signals?.objectionsOpen || [];
  const unresolvedObjections = countUnresolvedObjections(objections, openSignals);
  const firstObjection =
    objections.find((o) => o.landed !== true)?.objectionText ||
    openSignals[0] ||
    null;

  const champion = deal.metadata?.meddpicc?.champion || null;
  const champ = championSignal(champion);
  const tc = technicalCommitSignal(input.technicalCommit);

  let score = 0;
  /** @type {string[]} */
  const reasonsJson = [];

  if (momentumAvg >= 1) {
    score += 2;
    reasonsJson.push(`Call momentum trending advancing (decayed avg ${momentumAvg.toFixed(1)})`);
  } else if (momentumAvg <= -0.8) {
    score -= 2;
    reasonsJson.push(`Call momentum trending stalled (decayed avg ${momentumAvg.toFixed(1)})`);
  } else {
    reasonsJson.push(`Call momentum mixed across recent calls (decayed avg ${momentumAvg.toFixed(1)})`);
  }
  for (const r of momentumReasons) {
    if (!reasonsJson.includes(r)) reasonsJson.push(r);
  }

  if (daysSilent >= 14) {
    score -= 2;
    reasonsJson.push(`${daysSilent} days since last deal activity`);
  } else if (daysSilent >= 7) {
    score -= 1;
    reasonsJson.push(`${daysSilent} days since last activity — cadence slipping`);
  } else if (daysSilent <= 2 && momentumAvg > 0) {
    score += 1;
    reasonsJson.push("Recent activity on the deal");
  }

  if (undatedNextSteps >= 2) {
    score -= 2;
    reasonsJson.push(`${undatedNextSteps} next steps lack a due date`);
  } else if (undatedNextSteps === 1) {
    score -= 1;
    reasonsJson.push("A next step has no due date");
  }

  if (unresolvedObjections >= 2) {
    score -= 2;
    reasonsJson.push(`${unresolvedObjections} unresolved objections on this call`);
  } else if (unresolvedObjections === 1) {
    score -= 1;
    reasonsJson.push("One unresolved objection remains");
  }

  score += champ.lean;
  if (champ.reason) reasonsJson.push(champ.reason);

  score += tc.lean;
  if (tc.reason) reasonsJson.push(tc.reason);
  if (tc.pending) reasonsJson.push("Technical commit (Pass 5) not yet on file");

  if (daysInStage > stageMedianDays * 1.5) {
    score -= 2;
    reasonsJson.push(
      `${daysInStage} days in ${deal.stage || "stage"} vs ${stageMedianDays}d median for closed deals`,
    );
  } else if (daysInStage > stageMedianDays) {
    score -= 1;
    reasonsJson.push(
      `${daysInStage} days in stage — above ${stageMedianDays}d median`,
    );
  }

  for (const gap of videoGapReasons(input.videoFacts)) {
    reasonsJson.push(gap);
  }

  const traction = scoreToTraction(score);
  const recommendedAction = pickRecommendedAction({
    traction,
    undatedNextSteps,
    unresolvedObjections,
    daysSilent,
    champion,
    momentumTopAction: analysis.momentum?.topAction,
    technicalCommitPending: tc.pending,
    firstObjection,
  });
  const nextStepOwner = resolveNextStepOwner(analysis, followUps);

  return {
    traction,
    reasonsJson,
    recommendedAction,
    daysSilent,
    nextStepOwner,
    daysInStage,
    stageMedianDays,
  };
}
