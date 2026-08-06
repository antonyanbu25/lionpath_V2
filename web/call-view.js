/**
 * Call record view — spec §11.4 (#calls/:id).
 */

import {
  getPostCallAnalysis,
  listPostCallAnalyses,
  updatePostCallAnalysis,
} from "./history.js";
import { isManagerRole } from "./domain/types.js";
import { canViewSeProfile, getPostCallForSession, normalizeSeEmail } from "./domain/se-access-service.js";
import { sessionToUser } from "./domain/rbac.js";
import { dedupeAnalysesByCallIdentity } from "./call-identity.js";
import { formatTypeComposite, isEligibleForAggregate, typeComposite, scoreCall } from "./quality-score.js";
import { RUBRIC_VERSION, profileFor, effectiveRubricVersion } from "./rubric-profiles.js";
import { renderQipScorecard, normalizeQipScorecard } from "./postcall.js";
import { coerceScorecardLines } from "./shared/qip-scorecard-normalize.js";
import { assembleMomEmailDraft, greetingNameFromDraft } from "./shared/mom-email-draft.js";
import { renderQipRadar } from "./qip-radar.js";
import { CHART_PALETTE, SPINE_SEGMENT_PALETTE, TIMELINE_MARKER_COLORS } from "./chart-shared.js";
import { getDeal, DEAL_TYPE_LABELS, listDealsForAccount } from "./domain/deal-service.js";
import {
  enrichDealFromHistoryRecords,
  rollupMeddpiccFromHistoryRecords,
} from "./domain/history-deal-enrichment.js";
import { getStore } from "./domain/store.js";
import { computeMeddpiccScore, resolveDealMeddpicc, MEDDPICC_FIELD_KEYS, MEDDPICC_FIELD_LABELS } from "./domain/contact-service.js";
import { sessionUserId, withEffectiveUserId } from "./domain/session.js";
import { syncSessionWithDomainStore } from "./auth.js";
import { STAGE_LABELS } from "./domain/types.js";
import { esc, titleCaseDisplayName } from "./shared.js";
import { themeLabel } from "./theme-library.js";
import { sanitizeUserFacingCopy } from "./user-facing-copy.js";
import { hidePrepGenOverlay } from "./prep-generation-overlay.js";
import { formatDealTitlePreview, isLegacyDealTitle } from "./domain/deal-service.js";
import { resolveCallTitleFromRecord, companyFromCallTitle, canonicalCallType } from "./call-type-labels.js";
import { mergeCallIdentities } from "./identity-merge.js";
import { renderCallProductSignalTab } from "./call-product-signal.js";
import { wireScoreDisputes } from "./score-disputes.js";

const CALL_TYPE_LABELS = {
  demo: "Demo",
  discovery: "Discovery",
  technical_deep_dive: "Technical deep dive",
  reverse_demo: "Reverse demo",
  use_case_discussion: "Use case discussion",
  trial_setup: "Trial setup",
  troubleshooting: "Troubleshooting",
  qa_session: "Q&A session",
};

function formatDate(ts) {
  if (!ts) return "-";
  return new Date(ts).toLocaleDateString(undefined, {
    month: "short",
    day: "numeric",
    year: "numeric",
  });
}

/**
 * Real call date. hdr.date is LLM-generated and has produced dates years off,
 * so it is only used when it agrees with the record within a week.
 */
function callDateLabel(record) {
  const hdr = record?.analysis?.callHeader || record?.result?.analysis?.callHeader || {};
  const real =
    record?.result?.resolve?.callTime ||
    record?.result?.resolve?.media?.startTime ||
    record?.timestamp ||
    null;
  const realMs = real ? new Date(real).getTime() : NaN;
  if (Number.isFinite(realMs)) {
    const hdrMs = hdr.date ? new Date(hdr.date).getTime() : NaN;
    const WEEK = 7 * 24 * 60 * 60 * 1000;
    if (Number.isFinite(hdrMs) && Math.abs(hdrMs - realMs) <= WEEK) return formatDate(hdrMs);
    return formatDate(realMs);
  }
  return hdr.date || formatDate(record?.timestamp);
}

function formatDateTime(ts) {
  if (!ts) return "-";
  return new Date(ts).toLocaleString(undefined, {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
}

function resolveDealId(record) {
  const confirmed = record?.result?.confirmed || {};
  if (confirmed.dealId) return confirmed.dealId;
  if (record?.dealId) return record.dealId;
  if (confirmed.createNewDeal || record?.createNewDeal) return null;
  return record?.result?.resolve?.deals?.find((d) => d.preselected)?.dealId || null;
}

function recordPendingNewDeal(record) {
  const confirmed = record?.result?.confirmed || {};
  return !!(confirmed.createNewDeal || record?.createNewDeal);
}

function resolveConfirmedIdentities(record) {
  const fromRecord = record?.confirmedIdentities;
  if (fromRecord?.seIdentity || fromRecord?.aeIdentity || fromRecord?.customerIdentities?.length) {
    return {
      seIdentity: fromRecord.seIdentity || "",
      aeIdentity: fromRecord.aeIdentity || "",
      customerIdentities: fromRecord.customerIdentities || [],
    };
  }
  const resolve = record?.result?.resolve || {};
  return {
    seIdentity: resolve.seIdentity || "",
    aeIdentity: resolve.aeIdentity || "",
    customerIdentities: resolve.customerIdentities || [],
  };
}

function segmentTypeLabel(type) {
  const map = {
    slides: "Slides",
    product: "Product",
    cde: "CDE",
    customer_screen: "Customer screen",
    none: "No share",
    intro: "Intro",
    discovery: "Discovery",
    demo: "Demo",
    pricing: "Pricing",
    objection_handling: "Objections",
    next_steps: "Next steps",
  };
  return map[type] || type || "Segment";
}

const MARKER_LABELS = {
  gap: "gap raised",
  objection: "objection",
  win: "what worked",
  weak_cta: "weak CTA",
};

const MARKER_COLORS = TIMELINE_MARKER_COLORS;

const MARKER_LEGEND = [
  ["gap", "Product gap"],
  ["objection", "Objection handled"],
  ["win", "What worked"],
  ["weak_cta", "Weak CTA"],
];

const OBJECTION_ANSWER_SPLIT =
  /\s+(?:(?:SE|AE)(?:\/(?:SE|AE))?|the SE|Solution Engineer)(?:\s+and\s+(?:SE|AE|the AE))?\s+(?:emphasized|responded|explained|noted|said|addressed|handled|countered|walked through|showed|demonstrated)/i;

const OBJECTION_FRAMING =
  /^(?:Customer|Prospect|The customer|The prospect)\s+(?:expressed(?:\s+concern(?:\s+that)?|\s+that|\s+a concern about)?|raised|asked|noted|said|mentioned|was concerned(?:\s+that)?|pushed back(?:\s+on)?|questioned)\s+/i;

const SPINE_LEGEND = [
  ["slides", "Slides", SPINE_SEGMENT_PALETTE.slides[0], SPINE_SEGMENT_PALETTE.slides[1]],
  ["product", "Product / CDE", SPINE_SEGMENT_PALETTE.product[0], SPINE_SEGMENT_PALETTE.product[1]],
  ["customer_screen", "Customer screen", SPINE_SEGMENT_PALETTE.customer_screen[0], SPINE_SEGMENT_PALETTE.customer_screen[1]],
  ["none", "No share", SPINE_SEGMENT_PALETTE.none[0], SPINE_SEGMENT_PALETTE.none[1]],
];

function spineSegmentLabel(type, customLabel) {
  if (customLabel) return customLabel;
  if (type === "product" || type === "cde") return "Product / CDE";
  return segmentTypeLabel(type);
}

const MARKER_KIND_WORDS = new Set(["gap", "objection", "win", "weak_cta", "gap raised", "what worked", "weak cta"]);

/** Turn snake_case product areas and theme keys into readable labels. */
export function humanizeMarkerLabel(raw, kind) {
  const s = String(raw || "").trim();
  if (!s) return MARKER_LABELS[kind] || kind || "";
  const lower = s.toLowerCase();
  if (MARKER_KIND_WORDS.has(lower)) return MARKER_LABELS[kind] || MARKER_LABELS[lower.replace(/\s+/g, "_")] || s;

  if (/^[a-z][a-z0-9_]*$/i.test(s) && s.includes("_")) {
    const themed = themeLabel(s);
    if (themed && themed !== s) return themed;
    return s
      .split("_")
      .filter(Boolean)
      .map((word) => {
        const w = word.toLowerCase();
        if (w === "ai") return "AI";
        if (w === "cde") return "CDE";
        if (w === "sso") return "SSO";
        if (w === "api") return "API";
        if (w === "ui") return "UI";
        if (w === "se") return "SE";
        if (w === "ae") return "AE";
        return word.charAt(0).toUpperCase() + word.slice(1).toLowerCase();
      })
      .join(" ");
  }

  if (s.includes(" · ")) {
    return s
      .split(" · ")
      .map((part) => humanizeMarkerLabel(part, kind))
      .join(" · ");
  }

  return s;
}

function markerDisplayLabel(marker) {
  const raw = marker?.label || MARKER_LABELS[marker?.kind] || marker?.kind || "";
  return humanizeMarkerLabel(String(raw).trim(), marker?.kind);
}

function renderCombinedSpineLegend(markers) {
  const kinds = new Set((markers || []).map((m) => m.kind).filter(Boolean));
  const segmentItems = SPINE_LEGEND.map(
    ([, label, bg, fg]) =>
      `<span class="call-spine-legend-item"><span class="call-spine-legend-swatch" style="background:${bg};color:${fg}"></span>${esc(label)}</span>`,
  ).join("");
  const markerItems = MARKER_LEGEND.filter(([kind]) => kinds.has(kind))
    .map(
      ([kind, label]) =>
        `<span class="call-spine-legend-item"><span class="call-spine-dot call-spine-dot--${esc(kind)}"></span>${esc(label)}</span>`,
    )
    .join("");
  return `<div class="call-spine-legend" aria-hidden="true">${segmentItems}${markerItems}</div>`;
}

function renderSpineMarkerList(_markers) {
  return "";
}

function renderSpineLegend() {
  return renderCombinedSpineLegend([]);
}

function renderMarkerLegend(markers) {
  return renderCombinedSpineLegend(markers);
}

function stripObjectionFraming(text) {
  if (!text) return "";
  let t = String(text).trim();
  t = t.replace(OBJECTION_FRAMING, "");
  t = t.replace(/^["'""]|["'""]$/g, "").trim();
  return t;
}

function stripResponseFraming(text) {
  if (!text) return "";
  return String(text)
    .replace(
      /^(?:(?:SE|AE)(?:\/(?:SE|AE))?|the SE|Solution Engineer)(?:\s+and\s+(?:SE|AE|the AE))?\s+(?:emphasized|responded|explained|noted|said|addressed|handled|countered|walked through|showed|demonstrated)\s+(?:that\s+)?/i,
      "",
    )
    .trim();
}

/** Split narrative objection blobs into customer Q and SE/AE A when fields are merged. */
export function resolveObjectionQa(obj) {
  let question = String(obj?.objectionText || obj?.text || "").trim();
  let answer = String(obj?.handling || "").trim();

  if (question && !answer && OBJECTION_ANSWER_SPLIT.test(question)) {
    const idx = question.search(OBJECTION_ANSWER_SPLIT);
    if (idx > 12) {
      answer = question.slice(idx).trim();
      question = question.slice(0, idx).trim().replace(/\.\.\.\s*$/, "").trim();
    }
  }

  question = stripObjectionFraming(question);
  answer = stripResponseFraming(answer);

  if (!question && answer) {
    if (OBJECTION_ANSWER_SPLIT.test(answer)) {
      const idx = answer.search(OBJECTION_ANSWER_SPLIT);
      question = stripObjectionFraming(answer.slice(0, idx).trim());
      answer = answer.slice(idx).trim();
    } else {
      question = stripObjectionFraming(answer);
      answer = "";
    }
  }

  return { question, answer };
}

export function renderObjectionQaRow(obj) {
  const { question, answer } = resolveObjectionQa(obj);
  const landed = obj?.landed === true;
  const statusCls = landed ? "good" : "bad";
  const statusPill = landed
    ? '<span class="pill green">Landed</span>'
    : '<span class="pill red">Open</span>';
  const theme = obj?.theme
    ? `<span class="pill">${esc(String(obj.theme).replace(/_/g, " "))}</span>`
    : "";
  const ts =
    obj?.atS != null && Number.isFinite(Number(obj.atS))
      ? `<div class="ts num">${esc(formatSegmentTime(obj.atS))}</div>`
      : "";

  return `<div class="ev ${statusCls} call-objection-qa">
    ${ts}
    <div class="call-qa-row">
      <span class="call-qa-label">Q</span>
      <p class="call-qa-text">${esc(question || "—")}</p>
    </div>
    <div class="call-qa-row call-qa-row--answer">
      <span class="call-qa-label">A</span>
      <p class="call-qa-text sub">${esc(answer || "— No response captured")}</p>
    </div>
    <div class="call-qa-meta">${theme}${statusPill}</div>
  </div>`;
}

function formatSegmentTime(sec) {
  const n = Number(sec);
  if (!Number.isFinite(n) || n < 0) return "0:00";
  const m = Math.floor(n / 60);
  const s = Math.floor(n % 60);
  return `${m}:${String(s).padStart(2, "0")}`;
}

function formatTcFieldValue(val) {
  if (val == null) return "";
  if (typeof val === "string") return val.trim();
  if (typeof val === "object") {
    if (val.summary) return String(val.summary).trim();
    if (val.value) return String(val.value).trim();
    if (val.agentCount != null && val.agentTotal != null) {
      return `${val.agentCount}/${val.agentTotal}`;
    }
  }
  return String(val).trim();
}

const TC_SLOT_LABELS = {
  incumbent: "Incumbent",
  competitor: "Competitor",
  identifiedRisk: "Identified risk",
  timelineForClosure: "Go live",
  reasonForEvaluation: "Reason for evaluation",
  aiAttach: "AI attach",
  whatsWorking: "What's working",
  status: "Status",
  justification: "Justification",
};

function tcStatusPill(status) {
  const s = status || "pending";
  const labels = { yes: "Yes", no: "No", pending: "Pending", at_risk: "At risk" };
  const colors = { yes: "green", no: "red", pending: "yellow", at_risk: "red" };
  return `<fw-tag text="${esc(labels[s] || s)}" color="${colors[s] || "grey"}"></fw-tag>`;
}

function deltaChangePill(changeType) {
  const ct = changeType || "changed";
  const colors = { confirmed: "green", changed: "yellow", new: "blue" };
  const labels = { confirmed: "Confirmed", changed: "Changed", new: "New" };
  return `<fw-tag text="${esc(labels[ct] || ct)}" color="${colors[ct] || "grey"}"></fw-tag>`;
}

function resolveCallType(record) {
  const sc = record?.scorecard || record?.result?.scorecard;
  const meta = record?.analysisMeta || record?.result?.analysisMeta || {};
  return canonicalCallType(
    sc?.callType ||
      meta.callType ||
      record?.result?.confirmed?.callType ||
      record?.callType ||
      "demo",
  );
}

function resolveScorecard(record) {
  const result = record?.result || {};
  const raw =
    record?.scorecard ||
    result.scorecard ||
    result.analysis?.scorecard ||
    result.generate?.scorecard ||
    null;
  if (!raw) return null;
  const lines = coerceScorecardLines(raw.lines);
  return lines.length || raw.categoryScores || typeof raw.overall === "number"
    ? { ...raw, lines }
    : raw;
}

async function enrichScorecardFromStore(record, scorecard) {
  const hasUsable =
    scorecard?.lines?.length ||
    (scorecard?.categoryScores &&
      Object.values(scorecard.categoryScores).some((n) => Number(n) > 0)) ||
    (typeof scorecard?.overall === "number" && Number.isFinite(scorecard.overall));
  if (hasUsable) return scorecard;

  const store = getStore();
  if (!store.listScorecardsByCall) return scorecard;

  const storedCards = await safeEnrich(
    "listScorecardsByCall",
    () => store.listScorecardsByCall(record.id),
    [],
  );
  const stored = storedCards[0];
  if (!stored) return scorecard;

  let lines = scorecard?.lines || [];
  if (!lines.length && store.listScorecardLinesByCall) {
    const storedLines = await safeEnrich(
      "listScorecardLinesByCall",
      () => store.listScorecardLinesByCall(record.id),
      [],
    );
    lines = storedLines.map((line) => ({
      themeKey: line.themeKey,
      grade: line.grade,
      credit: line.credit,
      category: line.category,
      subParameters: line.subParameters || [],
      evidenceUnavailable: !!line.evidenceUnavailable,
      confidence: line.confidence ?? null,
      coachingNote: line.coachingNote || null,
    }));
  }

  return {
    callType: stored.callType || record.callType || "demo",
    rubricVersion: stored.rubricVersion || RUBRIC_VERSION,
    overall: stored.overall ?? scorecard?.overall ?? null,
    categoryScores: stored.categoryScores || scorecard?.categoryScores || {},
    lines,
    confidence: stored.confidence ?? scorecard?.confidence ?? null,
    provisional: !!(stored.provisional ?? scorecard?.provisional),
  };
}

function isSeRole(role) {
  return /solution engineer|primary se|secondary se|^se$|\bse\b/i.test(String(role || ""));
}

function resolveEffectiveRubricVersion(scorecard, analysisMeta = {}) {
  return effectiveRubricVersion(scorecard, analysisMeta);
}

function resolveCategoryScores(scorecard, callType) {
  const raw = scorecard?.categoryScores || {};
  if (Object.values(raw).some((n) => Number(n) > 0)) return raw;
  if (!scorecard?.lines?.length) return raw;
  try {
    const profile = profileFor(scorecard.callType || callType);
    const scored = scoreCall(
      profile,
      scorecard.lines.map((l) => ({
        themeKey: l.themeKey,
        subParameters: (l.subParameters || []).map((sp) => ({ score: sp.score ?? sp.grade ?? 0 })),
        evidenceUnavailable: !!l.evidenceUnavailable,
      })),
    );
    return scored.categoryScores;
  } catch {
    return raw;
  }
}

function resolvePass6(record) {
  const resultBlob = record?.result || {};
  return record?.pass6 || resultBlob.pass6 || resultBlob.result?.pass6 || null;
}

function resolveRecordHydration(record) {
  const h = record?.result?.hydration || {};
  const pending = Array.isArray(h.pending) ? h.pending : [];
  return {
    pending: resolveEffectiveHydrationPending(record, pending),
    errors: h.errors && typeof h.errors === "object" ? h.errors : {},
    progressMessage: typeof h.progressMessage === "string" ? h.progressMessage : "",
  };
}

/** Drop hydration keys when generate-pass data is already on the record (avoids pocket skeletons). */
export function resolveEffectiveHydrationPending(record, pendingKeys) {
  const pending = Array.isArray(pendingKeys) ? pendingKeys : [];
  if (!pending.length) return [];
  const result = record?.result || {};
  const analysis = record?.analysis || result.analysis || {};
  const summarise = result.summarise || {};
  const pass6 = resolvePass6(record);
  const hasArr =
    result.arrCompute?.arrPoint != null || result.arrCompute?.arrEstimatePoint != null;
  const hasGaps =
    (pass6?.productGaps?.length || 0) > 0 || (pass6?.whatWorks?.length || 0) > 0;

  return pending.filter((key) => {
    switch (key) {
      case "qualify":
        return !result.qualification;
      case "summarise":
        return !String(summarise.callNotes || analysis.callNotes || "").trim();
      case "commit":
        return !result.technicalCommit;
      case "arr":
        return !hasArr;
      case "gaps":
        return !hasGaps;
      default:
        return true;
    }
  });
}

function renderCallInlineProgress(message) {
  if (!message) return "";
  return `<div class="call-record-inline-progress postcall-inline-progress" role="status" aria-live="polite" aria-busy="true">
    <span class="postcall-inline-progress-dot" aria-hidden="true"></span>
    <span class="postcall-inline-progress-label">${esc(message)}</span>
  </div>`;
}

function renderCallSectionSkeleton(label, minHeight = 120) {
  const rectH = Math.max(64, minHeight - 52);
  return `<div class="call-section-skeleton" style="min-height:${minHeight}px" aria-hidden="true" aria-label="${esc(label)} loading">
    <fw-skeleton variant="text" width="28%" effect="sheen"></fw-skeleton>
    <fw-skeleton variant="text" count="2" effect="sheen"></fw-skeleton>
    <fw-skeleton variant="rect" height="${rectH}px" effect="sheen"></fw-skeleton>
  </div>`;
}

function renderCallSectionRetry(section, message, recordId) {
  return `<div class="call-section-retry card-wire" data-retry-section="${esc(section)}" data-record-id="${esc(recordId)}">
    <fw-inline-message type="warning" open closable="false">${esc(message)}</fw-inline-message>
    <button type="button" class="btn-wire call-section-retry-btn" data-action="retry-hydration" data-retry-section="${esc(section)}">Retry</button>
  </div>`;
}

function buildLocalCallBundle(session, record) {
  const email = session.email;
  const resultBlob = record.result || {};
  const pass6 = resolvePass6(record);
  const summarise = resultBlob.summarise || {};
  const analysis = record.analysis || resultBlob.analysis || {};
  const analysisMeta = resolveAnalysisMeta(record);
  const callType = resolveCallType(record);
  let scorecard = resolveScorecard(record);
  if (scorecard?.lines?.length) {
    scorecard = normalizeQipScorecard(scorecard, analysisMeta);
  } else if (scorecard && (scorecard.categoryScores || typeof scorecard.overall === "number")) {
    scorecard = normalizeQipScorecard({ ...scorecard, lines: scorecard.lines || [] }, analysisMeta);
  }
  const qipScore = resolveQipOverallScore(scorecard, callType, analysisMeta);
  const momentumStatus = analysis?.momentum?.status || "-";
  const sentiment = resolveCallSentiment(analysis);
  const confRaw = scorecard?.confidence ?? analysisMeta.analysisConfidence;
  const confidencePct = confRaw != null ? Math.round(confRaw * 100) : null;
  const med = resultBlob.qualification
    ? rollupMeddpiccFromHistoryRecords([{ ...record, result: { ...resultBlob, qualification: resultBlob.qualification } }])
    : null;
  const meddpiccScore = med ? computeMeddpiccScore(med) : null;
  const meddpiccFilled = countMeddpiccFilled(med);
  const arrPoint =
    resultBlob.arrCompute?.arrPoint ?? resultBlob.arrCompute?.arrEstimatePoint ?? null;
  const arrLabel =
    arrPoint != null && Number.isFinite(Number(arrPoint))
      ? `$${Math.round(Number(arrPoint)).toLocaleString()}`
      : null;
  const identities = resolveConfirmedIdentities(record);
  const attendees = analysis?.callHeader?.attendees || [];
  const draftVf = resultBlob.videoFacts;
  const draftTimeline = resultBlob.timeline;
  const productGaps = (pass6?.productGaps || []).map(normalizeProductSignalRow).filter(Boolean);
  const whatWorks = (pass6?.whatWorks || []).map(normalizeProductSignalRow).filter(Boolean);
  const deltaInfo = qipScore != null ? qipDeltaForType(email, callType, qipScore, record.id) : null;
  const callNotes = (() => {
    const fromAnalysis = typeof analysis.callNotes === "string" ? analysis.callNotes.trim() : "";
    if (fromAnalysis) return fromAnalysis;
    const fromSummarise = summarise.callNotes;
    return typeof fromSummarise === "string" ? fromSummarise.trim() : "";
  })();

  return {
    record,
    deal: null,
    dealId: resolveDealId(record),
    account: null,
    sequence: null,
    callType,
    callTypeLabel: CALL_TYPE_LABELS[callType] || callType,
    scorecard,
    analysisMeta,
    qipLabel:
      qipScore != null
        ? formatTypeComposite({
            score: qipScore,
            callType: scorecard?.callType || callType,
            rubricVersion: scorecard?.rubricVersion || analysisMeta.rubricVersion || RUBRIC_VERSION,
          })
        : null,
    qipScore,
    qipDeltaHtml: deltaInfo ? formatDelta(deltaInfo.delta) : "",
    qipDeltaPill: deltaInfo ? formatDeltaPill(deltaInfo.delta) : "",
    meddpiccScore,
    meddpiccFilled,
    meddpicc: med,
    momentumStatus,
    sentiment,
    confidencePct,
    arrLabel,
    tensionLine: buildVerdictTension({
      qipScore,
      qipDelta: deltaInfo?.delta,
      meddpiccScore,
      momentumStatus,
      confidencePct,
    }),
    hasVideo: resolveVideoAvailable(record),
    kaiaSource: isKaiaRecordingUrl(record?.zoomLink),
    callNotes,
    identities,
    attendees,
    timeline: {
      facts: draftVf || null,
      segments: draftTimeline?.segments || draftVf?.segments || [],
      markers: draftTimeline?.markers || [],
    },
    videoFacts: draftVf || null,
    productSignal: { productGaps, whatWorks, clusterLabels: {} },
    technicalCommit: resultBlob.technicalCommit || null,
    tcDeltas: resultBlob.tcDeltas || [],
    meddpiccDeltas: [],
    objections: summarise.objections || [],
    followUps: summarise.followUps || [],
    momDraft: summarise.momDraft || resultBlob.momDraft || null,
    dealSignal: null,
    stakeholderRows: buildStakeholderRows(identities, attendees, draftVf),
  };
}

function formatQipScoreValue(score) {
  if (score == null || !Number.isFinite(Number(score))) return "-";
  const n = Number(score);
  return n % 1 === 0 ? String(Math.round(n)) : String(Math.round(n * 10) / 10);
}

function resolveQipOverallScore(scorecard, callType, analysisMeta = {}) {
  if (!scorecard) return null;
  const version = resolveEffectiveRubricVersion(scorecard, analysisMeta);
  if (typeof scorecard.overall === "number" && Number.isFinite(scorecard.overall)) {
    if (scorecard.overall > 10 && String(version).startsWith("1")) {
      return Math.round((scorecard.overall / 10) * 10) / 10;
    }
    return scorecard.overall;
  }
  if (!scorecard.lines?.length) return null;
  const composite = typeComposite(
    [{
      callType: scorecard.callType || callType,
      rubricVersion: version,
      lines: scorecard.lines,
      provisional: scorecard.provisional ?? analysisMeta.provisional,
      confidence: scorecard.confidence ?? analysisMeta.analysisConfidence,
    }],
    scorecard.callType || callType,
    { includeIneligible: true },
  );
  return composite?.score ?? null;
}

function resolveCallSentiment(analysis) {
  const status = String(analysis?.momentum?.status || "").trim();
  const reason = String(analysis?.momentum?.reason || "").trim();
  const signals = analysis?.signals || {};
  const objections = (signals.objectionsOpen || []).filter(Boolean).length;
  const pains = (signals.painsConfirmed || []).filter(Boolean).length;

  if (status === "Advancing") {
    return { label: "Positive", valueClass: "call-kpi-value--good", sub: reason || "Deal momentum advancing" };
  }
  if (status === "At risk") {
    return { label: "Negative", valueClass: "call-kpi-value--bad", sub: reason || "Deal momentum at risk" };
  }
  if (status === "Stalled") {
    return { label: "Neutral", valueClass: "call-kpi-value--warn", sub: reason || "Deal momentum stalled" };
  }
  if (objections >= 2 && pains === 0) {
    return { label: "Negative", valueClass: "call-kpi-value--bad", sub: "Open objections without confirmed pains" };
  }
  if (pains >= 2 && objections === 0) {
    return { label: "Positive", valueClass: "call-kpi-value--good", sub: "Pains confirmed with few open objections" };
  }
  return { label: "Neutral", valueClass: "call-kpi-value--warn", sub: reason || "Mixed signals on this call" };
}

function normalizeProductSignalRow(row) {
  if (!row || typeof row !== "object") return null;
  const area = String(row.productArea || "other").replace(/_/g, " ");
  const sub = row.subArea && row.subArea !== "other" ? ` › ${String(row.subArea).replace(/_/g, " ")}` : "";
  const title = row.title || (area + sub) || "Product signal";
  return { ...row, title };
}

function resolveAnalysisMeta(record) {
  return record?.analysisMeta || record?.result?.analysisMeta || {};
}

function identityMatchesName(identity, geminiName) {
  const idKey = normalizePersonKey(identity);
  const nameKey = normalizePersonKey(geminiName);
  if (!idKey || !nameKey) return false;
  if (idKey === nameKey) return true;
  if (nameKey.includes(idKey) || idKey.includes(nameKey)) return true;
  const idFirst = idKey.split(/\s+/)[0] || "";
  const nameFirst = nameKey.split(/\s+/)[0] || "";
  if (idFirst.length >= 3 && idFirst === nameFirst) return true;
  const idLast = idKey.split(/\s+/).pop() || "";
  const nameLast = nameKey.split(/\s+/).pop() || "";
  if (idLast.length >= 3 && idLast === nameLast) return true;
  return false;
}

function isAttendeeCurveRow(row) {
  return !!row && typeof row === "object" && !Array.isArray(row);
}

function finalizeParticipantCameraRows(rows) {
  if (!Array.isArray(rows) || !rows.length) return rows;
  return rows.filter(isAttendeeCurveRow).map((p) => {
    let cameraOnPct =
      p.cameraOnPct != null && Number.isFinite(Number(p.cameraOnPct))
        ? Math.max(0, Math.min(100, Math.round(Number(p.cameraOnPct))))
        : null;
    let cameraOn = p.cameraOn ?? null;
    if (cameraOnPct != null) {
      cameraOn = cameraOnPct >= 50;
    } else if (cameraOn === true) {
      cameraOnPct = 100;
    } else if (cameraOn === false) {
      cameraOnPct = 0;
    }
    return { ...p, cameraOn, cameraOnPct };
  });
}

function finalizeVideoFactsCamera(videoFacts) {
  if (!videoFacts) return videoFacts;
  const consentDenied = videoFacts.visualAnalysisConsent === false;
  let curve = coerceAttendeeCurve(videoFacts.attendeeCurveJson);
  if (!curve.length) return videoFacts;
  if (consentDenied) {
    return {
      ...videoFacts,
      attendeeCurveJson: curve.map((p) => ({ ...p, cameraOn: null, cameraOnPct: null })),
      cameraOnPct: null,
    };
  }
  curve = finalizeParticipantCameraRows(curve);
  return { ...videoFacts, attendeeCurveJson: curve, visualAnalysisConsent: videoFacts.visualAnalysisConsent ?? true };
}

function curveHasCameraData(curve) {
  if (!Array.isArray(curve)) return false;
  return curve.some(
    (p) =>
      p?.cameraOn === true ||
      p?.cameraOn === false ||
      (p?.cameraOnPct != null && Number.isFinite(Number(p.cameraOnPct))),
  );
}

function mergeParticipantCameraRows(baseCurve, extraCurve) {
  const base = coerceAttendeeCurve(baseCurve);
  const extra = coerceAttendeeCurve(extraCurve);
  if (!base.length) return extra;
  if (!extra.length) return base;
  const byKey = new Map();
  for (const row of extra) {
    const name = String(row?.name || row?.displayName || "").trim();
    if (!name) continue;
    byKey.set(normalizePersonKey(name), row);
  }
  return base.map((row) => {
    const name = String(row?.name || row?.displayName || "").trim();
    const key = normalizePersonKey(name);
    let patch = byKey.get(key);
    if (!patch && name) {
      patch = extra.find((r) => identityMatchesName(name, r?.name || r?.displayName || ""));
    }
    if (!patch) return row;
    return {
      ...row,
      cameraOn: row.cameraOn ?? patch.cameraOn ?? patch.camOn ?? null,
      cameraOnPct: row.cameraOnPct ?? patch.cameraOnPct ?? patch.camera_on_pct ?? null,
    };
  });
}

function resolveVideoFactsForBundle(draftVf, timelineFacts, storedFacts) {
  const candidates = [draftVf, timelineFacts, ...(storedFacts || [])].filter(Boolean);
  if (!candidates.length) return null;

  let videoFacts = { ...candidates[0] };
  let mergedCurve = coerceAttendeeCurve(videoFacts.attendeeCurveJson);
  for (const next of candidates.slice(1)) {
    const hasCam = curveHasCameraData(next?.attendeeCurveJson);
    const curHasCam = curveHasCameraData(mergedCurve);
    if (next?.attendeeCurveJson) {
      mergedCurve = mergeParticipantCameraRows(mergedCurve, next.attendeeCurveJson);
    }
    if (hasCam && !curHasCam) {
      videoFacts = {
        ...videoFacts,
        ...next,
        attendeeCurveJson: mergedCurve.length ? mergedCurve : next.attendeeCurveJson,
        cameraOnPct: next.cameraOnPct ?? videoFacts.cameraOnPct,
        streamKind: next.streamKind || videoFacts.streamKind,
      };
    } else if (!videoFacts?.attendeeCurveJson && next?.attendeeCurveJson) {
      videoFacts = { ...videoFacts, ...next };
    }
  }
  if (mergedCurve.length) {
    videoFacts = { ...videoFacts, attendeeCurveJson: mergedCurve };
  }
  return finalizeVideoFactsCamera(videoFacts);
}

function isKaiaRecordingUrl(url) {
  try {
    const u = new URL(String(url || "").trim().split(/\s/)[0]);
    return u.hostname.toLowerCase() === "engage.freshworks.com";
  } catch {
    return false;
  }
}

function resolveVideoAvailable(record) {
  const meta = resolveAnalysisMeta(record);
  const resolve = record?.result?.resolve || {};
  if (meta.videoAvailable === true || resolve.videoAvailable === true) return true;
  if (meta.videoAvailable === false || resolve.videoAvailable === false) return false;
  const vf = record?.result?.videoFacts;
  if (vf?.status === "complete" || vf?.status === "ok") return true;
  if (vf?.status === "unavailable" || vf?.errorMessage) return false;
  return false;
}

function dealSequencePosition(email, dealId, callId) {
  if (!dealId) return { position: null, total: 0 };
  const onDeal = listPostCallAnalyses(email)
    .filter((r) => resolveDealId(r) === dealId)
    .sort((a, b) => (a.timestamp || 0) - (b.timestamp || 0));
  const idx = onDeal.findIndex((r) => r.id === callId);
  return { position: idx >= 0 ? idx + 1 : null, total: onDeal.length };
}

function qipDeltaForType(email, callType, currentScore, excludeId) {
  if (currentScore == null || !callType) return null;
  const analyses = dedupeAnalysesByCallIdentity(listPostCallAnalyses(email));
  const pool = [];

  for (const rec of analyses) {
    if (rec.id === excludeId) continue;
    const sc = resolveScorecard(rec);
    if (!sc?.lines?.length) continue;
    const ct = sc.callType || resolveCallType(rec);
    if (ct !== callType) continue;
    const meta = resolveAnalysisMeta(rec);
    pool.push({
      callType: ct,
      rubricVersion: sc.rubricVersion || meta.rubricVersion || RUBRIC_VERSION,
      lines: sc.lines,
      provisional: sc.provisional ?? meta.provisional,
      confidence: sc.confidence ?? meta.analysisConfidence,
    });
  }

  const avgResult = typeComposite(pool, callType, { requireHighConfidence: true });
  if (avgResult.score == null) return null;
  const count = pool.filter((sc) =>
    isEligibleForAggregate(sc, { requireHighConfidence: true }),
  ).length;
  return {
    avg: avgResult.score,
    delta: Math.round((currentScore - avgResult.score) * 10) / 10,
    count,
  };
}

function formatDelta(delta) {
  if (delta == null || !Number.isFinite(delta)) return "";
  if (delta > 0) return `<span class="call-verdict-delta--up">+${esc(delta)}</span> vs your avg`;
  if (delta < 0) return `<span class="call-verdict-delta--down">${esc(delta)}</span> vs your avg`;
  return `<span class="muted">at your avg</span>`;
}

function formatDeltaPill(delta) {
  if (delta == null || !Number.isFinite(delta)) return "";
  if (delta > 0) return `<span class="pill green">+${esc(delta)} vs avg</span>`;
  if (delta < 0) return `<span class="pill red">${esc(delta)} vs avg</span>`;
  return `<span class="pill">at avg</span>`;
}

function callTypePill(label) {
  if (!label) return "";
  return `<span class="pill blue">${esc(label)}</span>`;
}

function confidenceBandLabel(pct) {
  if (pct == null) return "-";
  if (pct >= 80) return "High";
  if (pct >= 50) return "Medium";
  return "Low";
}

function countMeddpiccFilled(meddpicc) {
  if (!meddpicc) return null;
  let filled = 0;
  for (const key of MEDDPICC_FIELD_KEYS) {
    const slot = meddpicc[key];
    if (slot?.value && slot.status !== "unknown") filled += 1;
  }
  return filled;
}

function renderTensionBand(line) {
  const text = String(line || "").trim();
  if (!text) return "";
  const split = text.split(". ");
  if (split.length >= 2) {
    return `<b class="call-verdict-tension-lead">${esc(split[0])}.</b> ${esc(split.slice(1).join(". "))}`;
  }
  return esc(text);
}

function buildVerdictTension({ qipScore, qipDelta, meddpiccScore, momentumStatus, confidencePct }) {
  const parts = [];
  if (qipScore != null && qipDelta != null) {
    if (qipDelta >= 0.8) parts.push("strong call execution");
    else if (qipDelta <= -0.8) parts.push("execution below your usual bar");
    else if (qipDelta >= 0.3) parts.push("solid execution");
    else if (qipDelta <= -0.3) parts.push("execution lagging your norm");
  }

  if (meddpiccScore != null) {
    if (meddpiccScore >= 70 && qipScore != null && qipScore >= 7.5) {
      parts.push("deal qualification keeps pace with delivery");
    } else if (meddpiccScore < 45 && qipScore != null && qipScore >= 7.5) {
      parts.push("the gap is qualification, not delivery");
    } else if (meddpiccScore >= 60 && qipScore != null && qipScore < 5.5) {
      parts.push("the deal looks real but this call did not land");
    } else if (meddpiccScore < 40) {
      parts.push("qualification is thin");
    }
  }

  if (momentumStatus === "Advancing") parts.push("momentum is advancing");
  else if (momentumStatus === "At risk") parts.push("momentum is at risk");
  else if (momentumStatus === "Stalled") parts.push("momentum has stalled");

  if (!parts.length) {
    return "Scores tell different stories. Use the scorecard evidence before coaching or forecasting.";
  }

  const lead =
    qipScore != null && meddpiccScore != null && qipScore >= 7.5 && meddpiccScore < 45
      ? "Flawless call on a thin deal. "
      : qipScore != null && meddpiccScore != null && qipScore < 5.5 && meddpiccScore >= 60
        ? "Qualified deal, weak call. "
        : "";

  return `${lead}${parts[0].charAt(0).toUpperCase()}${parts[0].slice(1)}${
    parts.length > 1 ? `; ${parts.slice(1).join("; ")}.` : "."
  }`;
}

function tractionPillClass(status) {
  if (status === "Advancing") return "green";
  if (status === "At risk") return "red";
  if (status === "Stalled") return "amber";
  return "";
}

function tcStatusLabel(status) {
  const labels = { yes: "Yes", no: "No", pending: "Pending", at_risk: "At risk" };
  return labels[status] || status || "-";
}

function tcStatusPillClass(status) {
  const colors = { yes: "green", no: "red", pending: "amber", at_risk: "red" };
  return colors[status] || "";
}

function stakeholderInitials(name) {
  const parts = String(name || "")
    .trim()
    .split(/\s+/)
    .filter(Boolean);
  if (!parts.length) return "?";
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
  return `${parts[0][0]}${parts[parts.length - 1][0]}`.toUpperCase();
}

function stakeholderAvatarClass(role) {
  const r = String(role || "").toLowerCase();
  if (/customer|prospect|attendee/.test(r)) return "brand";
  if (/ae|account/.test(r)) return "blue";
  return "";
}

function renderMeddpiccList(meddpicc, meddpiccDeltas) {
  if (!meddpicc) return "";
  const deltaByField = {};
  for (const d of meddpiccDeltas || []) {
    if (d?.field) deltaByField[d.field] = d;
  }
  return MEDDPICC_FIELD_KEYS.map((key, i) => {
    const slot = meddpicc[key];
    const filled = slot?.value && slot.status !== "unknown";
    const label = MEDDPICC_FIELD_LABELS[key] || key;
    const value = filled ? slot.value : "Not surfaced";
    const delta = deltaByField[key];
    const deltaPill = delta?.changeType
      ? `<span class="pill ${delta.changeType === "new" ? "red" : delta.changeType === "confirmed" ? "green" : "amber"}" style="margin-left:4px">${esc(delta.changeType === "new" ? "Surfaced in this conversation" : delta.changeType === "confirmed" ? "Confirmed" : "Still unknown")}</span>`
      : "";
    return `<div class="call-medp-row${i < MEDDPICC_FIELD_KEYS.length - 1 ? " call-medp-row--border" : ""}">
      <span class="call-medp-dot${filled ? " call-medp-dot--on" : ""}" aria-hidden="true"></span>
      <div>
        <div class="call-medp-label">${esc(label)}</div>
        <div class="sub call-medp-value${filled ? "" : " muted"}">${esc(value)}${deltaPill}</div>
      </div>
    </div>`;
  }).join("");
}

function tcFieldDeltaPill(field, tcDeltas) {
  const delta = (tcDeltas || []).find((d) => d.field === field);
  if (!delta?.changeType) return "";
  if (delta.changeType === "new") return ' <span class="pill red">Surfaced in this conversation</span>';
  if (delta.changeType === "still_unknown" || delta.changeType === "unknown") {
    return ' <span class="pill amber">Still unknown</span>';
  }
  if (delta.changeType === "confirmed") return ' <span class="pill green">Confirmed</span>';
  return "";
}

function renderFitmentCard(deal) {
  const functional = deal?.functionalFitment ?? deal?.metadata?.functionalFitment;
  const technical = deal?.technicalFitment ?? deal?.metadata?.technicalFitment;
  const fitBar = (label, val) => {
    const n = val != null && Number.isFinite(Number(val)) ? Math.round(Number(val)) : null;
    const pct = n != null ? Math.min(100, Math.max(0, n)) : null;
    return `<div class="call-fitment-metric">
      <div class="sub">${esc(label)}</div>
      <div class="call-fitment-value num">${pct != null ? `${pct}%` : "-"}</div>
      <div class="bar"><span style="width:${pct ?? 0}%;background:var(--green)"></span></div>
    </div>`;
  };
  if (functional == null && technical == null) return "";
  return `<div class="card-wire card-wire--tight call-tc-side-card call-fitment-card">
    <div class="prep-form-eyebrow">Fitment</div>
    <div class="call-fitment-grid">
      ${fitBar("Functional", functional)}
      ${fitBar("Technical", technical)}
    </div>
  </div>`;
}

const SPINE_SEGMENT_COLORS = SPINE_SEGMENT_PALETTE;

const SPINE_TRACK_STYLE =
  "position:relative;height:56px;border-radius:10px;overflow:visible;margin-bottom:6px;width:100%;";
const SPINE_SEG_STYLE =
  "position:absolute;top:16px;height:24px;display:grid;place-items:center;font-size:10.5px;font-weight:600;overflow:hidden;white-space:nowrap;text-overflow:ellipsis;padding:0 4px;box-sizing:border-box;";

function markerAtSeconds(marker) {
  if (!marker || typeof marker !== "object") return null;
  for (const key of ["atS", "atSec", "at_sec", "seconds"]) {
    const v = Number(marker[key]);
    if (Number.isFinite(v) && v >= 0) return v;
  }
  const ms = Number(marker.atMs ?? marker.timestampMs ?? marker.timestamp);
  if (Number.isFinite(ms) && ms > 0) return ms > 1e5 ? ms / 1000 : ms;
  return null;
}

function normalizeTimelineMarkers(markers) {
  return (markers || [])
    .map((m) => {
      const atS = markerAtSeconds(m);
      if (atS == null) return null;
      return { ...m, atS };
    })
    .filter(Boolean);
}

/** Prefer segment + marker coverage when stored duration is missing or wildly off (unit mismatch). */
export function resolveSpineDuration(durationSec, segments, markers) {
  const segmentEnd = Math.max(
    ...segments.map((s) => Math.max(Number(s.startS) || 0, Number(s.endS) || 0)),
    1,
  );
  const markerEnd = Math.max(0, ...normalizeTimelineMarkers(markers).map((m) => m.atS));
  const evidenceEnd = Math.max(segmentEnd, markerEnd, 1);
  const raw = Number(durationSec);
  if (!Number.isFinite(raw) || raw <= 0) return evidenceEnd;
  if (evidenceEnd > 0 && raw > evidenceEnd * 4) return evidenceEnd;
  return Math.max(raw, evidenceEnd);
}

function renderVisualSpine(segments, markers, durationSec) {
  const normalizedMarkers = normalizeTimelineMarkers(markers);
  const total = resolveSpineDuration(durationSec, segments, normalizedMarkers);
  // #region agent log
  fetch("http://127.0.0.1:7865/ingest/46e458f7-44ce-49a5-87ef-1bb8839e9c5e", {
    method: "POST",
    headers: { "Content-Type": "application/json", "X-Debug-Session-Id": "edc907" },
    body: JSON.stringify({
      sessionId: "edc907",
      runId: "timeline-compact",
      hypothesisId: "F",
      location: "call-view.js:renderVisualSpine",
      message: "compact spine with dot markers",
      data: { totalSec: total, markerCount: (markers || []).length },
      timestamp: Date.now(),
    }),
  }).catch(() => {});
  // #endregion
  let html = '<div class="call-spine-wrap">';
  html += `<div class="call-spine spine" style="${SPINE_TRACK_STYLE}" role="img" aria-label="Call scene timeline">`;
  segments.forEach((seg, i) => {
    const start = Number(seg.startS) || 0;
    const end = Number(seg.endS) || start;
    const left = (start / total) * 100;
    const width = Math.max(((end - start) / total) * 100, 0.5);
    const type = seg.segmentType || "none";
    const [bg, fg] = SPINE_SEGMENT_COLORS[type] || SPINE_SEGMENT_COLORS.none;
    const label = spineSegmentLabel(type, seg.label || segmentTypeLabel(type));
    const radius =
      i === 0 ? "border-radius:6px 0 0 6px;" : i === segments.length - 1 ? "border-radius:0 6px 6px 0;" : "";
    html += `<div class="seg" style="${SPINE_SEG_STYLE}left:${left}%;width:${width}%;background:${bg};color:${fg};${radius}">${width > 11 ? esc(label) : ""}</div>`;
  });
  for (const m of normalizeTimelineMarkers(markers)) {
    const at = m.atS;
    const left = Math.min(100, Math.max(0, (at / total) * 100));
    const kind = m.kind || "gap";
    const readable = markerDisplayLabel(m);
    const tip = `${formatSegmentTime(at)} · ${MARKER_LABELS[kind] || kind} · ${readable}`;
    html += `<div class="mk-dot mk-dot--${esc(kind)}" style="left:${left}%" title="${esc(tip)}" aria-label="${esc(tip)}"></div>`;
  }
  html += "</div></div>";
  return html;
}

function renderSpineTimeAxis(durationSec) {
  if (!durationSec || !Number.isFinite(durationSec) || durationSec <= 0) return "";
  const ticks = [0, 0.25, 0.5, 0.75, 1].map((f) => formatSegmentTime(durationSec * f));
  return `<div class="call-spine-axis">${ticks.map((t) => `<span>${esc(t)}</span>`).join("")}</div>`;
}

function coerceAttendeeCurve(raw) {
  let rows = [];
  if (Array.isArray(raw)) rows = raw;
  else if (raw && typeof raw === "object") {
    if (Array.isArray(raw.participants)) rows = raw.participants;
    else rows = Object.values(raw);
  }
  return rows.filter(isAttendeeCurveRow);
}

function normalizeParticipantStats(raw) {
  const rows = coerceAttendeeCurve(raw);
  if (!rows.length) return [];
  const seen = new Set();
  return rows
    .map((p) => {
      const name = String(p?.name || p?.displayName || "").trim();
      if (!name) return null;
      const key = normalizePersonKey(name);
      if (seen.has(key)) return null;
      seen.add(key);
      const talkRaw = p.talkPct ?? p.talkSharePct ?? p.talk_pct;
      const camRaw = p.cameraOn ?? p.camOn ?? p.camera;
      let cameraOn = null;
      if (typeof camRaw === "boolean") cameraOn = camRaw;
      else if (typeof camRaw === "string") cameraOn = camRaw.toLowerCase() === "on";
      const camPctRaw = p.cameraOnPct ?? p.camera_on_pct;
      const cameraOnPct =
        camPctRaw != null && Number.isFinite(Number(camPctRaw))
          ? Math.max(0, Math.min(100, Math.round(Number(camPctRaw))))
          : null;
      if (cameraOnPct != null) cameraOn = cameraOnPct >= 50;
      return {
        name,
        role: String(p.role || p.side || "").trim(),
        talkPct:
          talkRaw != null && Number.isFinite(Number(talkRaw)) ? Math.round(Number(talkRaw)) : null,
        cameraOn,
        cameraOnPct,
      };
    })
    .filter(Boolean);
}

function normalizePersonKey(label) {
  let key = String(label || "")
    .trim()
    .toLowerCase()
    .replace(/\s*\([^)]*\)\s*/g, " ")
    .replace(/\s*\|.*$/, "")
    .replace(/<[^>]+>/g, "")
    .replace(/\s+/g, " ")
    .trim();
  const at = key.indexOf("@");
  if (at >= 0) {
    key = key
      .slice(0, at)
      .replace(/[._-]/g, " ")
      .replace(/\s+/g, " ")
      .trim();
  }
  return key;
}

function preferPersonLabel(a, b) {
  const score = (s) => {
    const t = String(s || "").trim();
    if (!t) return -1;
    if (/@/.test(t)) return 0;
    if (/\s/.test(t)) return 3;
    return 2;
  };
  const sa = score(a);
  const sb = score(b);
  if (sa !== sb) return sa > sb ? a : b;
  return String(a).trim().length <= String(b).trim().length ? a : b;
}

function findParticipantStat(stats, label) {
  const key = normalizePersonKey(label);
  const direct = stats.find((p) => normalizePersonKey(p.name) === key);
  if (direct) return direct;
  return stats.find((p) => identityMatchesName(label, p.name)) || null;
}

function buildStakeholderRows(identities, attendees, videoFacts, contacts = []) {
  const stats = normalizeParticipantStats(videoFacts?.attendeeCurveJson);
  const transcriptSpeakers = stats.map((s) => s.name).filter(Boolean);

  /** @type {object[]} */
  const candidates = [];
  const pushCandidate = (name, email, role) => {
    const label = String(name || email || "").trim();
    if (!label) return;
    candidates.push({
      name: String(name || "").trim() || label,
      email: email ? String(email).trim().toLowerCase() : null,
      label,
      role: role || "Attendee",
    });
  };

  if (identities?.seIdentity) pushCandidate(identities.seIdentity, null, "Solution Engineer");
  if (identities?.aeIdentity) pushCandidate(identities.aeIdentity, null, "Account Executive");
  for (const c of identities?.customerIdentities || []) pushCandidate(c, null, "Customer");
  for (const a of attendees || []) {
    pushCandidate(a.name || a.email, a.email, a.role || "Attendee");
  }

  const merged = mergeCallIdentities(candidates, contacts, transcriptSpeakers);

  const topLevelCameraOnPct =
    videoFacts?.cameraOnPct != null && Number.isFinite(Number(videoFacts.cameraOnPct))
      ? Math.max(0, Math.min(100, Math.round(Number(videoFacts.cameraOnPct))))
      : null;
  const seIdentity = identities?.seIdentity?.trim() || "";

  const rows = merged.map((att) => {
    const displayName = String(att.name || att.label || att.email || "").trim();
    const stat = findParticipantStat(stats, displayName);
    let talkPct = stat?.talkPct ?? null;
    let cameraOnPct = stat?.cameraOnPct ?? null;
    let cameraOn = stat?.cameraOn ?? null;
    if (
      cameraOn == null &&
      cameraOnPct == null &&
      topLevelCameraOnPct != null &&
      seIdentity &&
      identityMatchesName(seIdentity, displayName)
    ) {
      cameraOnPct = topLevelCameraOnPct;
      cameraOn = topLevelCameraOnPct >= 50;
    }
    if (cameraOn == null && cameraOnPct != null) {
      cameraOn = cameraOnPct >= 50;
    }
    const role = att.role || "Attendee";
    const side = /customer/i.test(role)
      ? "customer"
      : /engineer|executive|host|\bse\b|\bae\b/i.test(role)
        ? "internal"
        : "";
    return {
      key: normalizePersonKey(att.email || displayName),
      name: displayName,
      role,
      side,
      talkPct,
      cameraOn,
      cameraOnPct,
      email: att.email || stat?.email || null,
    };
  });

  return rows.map((row) => {
    const finalized = finalizeParticipantCameraRows([
      {
        name: row.name,
        talkPct: row.talkPct,
        cameraOn: row.cameraOn,
        cameraOnPct: row.cameraOnPct,
      },
    ])[0];
    if (!finalized) return row;
    return { ...row, cameraOn: finalized.cameraOn, cameraOnPct: finalized.cameraOnPct };
  });
}

async function enrichStakeholderContacts(accountId, rows, contacts = null) {
  if (!accountId || !rows?.length) return rows;
  const store = getStore();
  if (!store?.listContactsByAccount && !contacts?.length) return rows;
  let resolvedContacts = contacts;
  if (!resolvedContacts?.length && store?.listContactsByAccount) {
    try {
      resolvedContacts = await store.listContactsByAccount(accountId);
    } catch {
      return rows;
    }
  }
  if (!resolvedContacts?.length) return rows;
  const byKey = new Map();
  for (const c of resolvedContacts) {
    if (c?.name) byKey.set(normalizePersonKey(c.name), c);
    if (c?.email) byKey.set(normalizePersonKey(c.email), c);
  }
  return rows.map((row) => {
    let contact = byKey.get(row.key);
    if (!contact && row.email) {
      contact = resolvedContacts.find((c) => String(c.email || "").toLowerCase() === row.email) || null;
    }
    return {
      ...row,
      accountId,
      contactId: contact?.id || null,
    };
  });
}

function resolveDealDisplayTitle(deal, account) {
  const accountName = titleCaseDisplayName(account?.name || account?.slug || "") || account?.name || "";
  const rawTitle = String(deal?.title || "").trim();
  if (
    !rawTitle ||
    rawTitle === accountName ||
    rawTitle === account?.slug ||
    isLegacyDealTitle(rawTitle, accountName)
  ) {
    return formatDealTitlePreview(accountName || "Account", deal?.type || "new_business", deal?.createdAt);
  }
  return titleCaseDisplayName(rawTitle) || rawTitle;
}

function renderDealContextLine(ctx, opts = {}) {
  const { deal, account, momentumStatus, arrLabel, technicalCommit } = ctx;
  const pending = opts.pending instanceof Set ? opts.pending : new Set(Array.isArray(opts.pending) ? opts.pending : []);
  const errors = opts.errors || {};
  const recordId = opts.recordId || "";
  const pairs = [];

  if (deal?.id || deal?.title || account?.name) {
    const dealTitle = deal ? resolveDealDisplayTitle(deal, account) : "";
    const dealLabel = dealTitle || account?.name || "";
    if (dealLabel) {
      const dealLink = deal?.id
        ? `<a href="#deals/${esc(deal.id)}" class="call-deal-link" data-action="open-deal">${esc(dealLabel)}</a>`
        : esc(dealLabel);
      pairs.push({ label: "Deal", value: dealLink });
    }
  }

  const stage = deal?.stage ? STAGE_LABELS[deal.stage] || deal.stage : null;
  if (stage) pairs.push({ label: "Stage", value: `<span class="pill">${esc(stage)}</span>` });

  if (errors.arr && recordId) {
    return renderCallSectionRetry("arr", errors.arr, recordId);
  }
  if (pending.has("arr") && !arrLabel) {
    pairs.push({
      label: "ARR",
      value: `<span class="call-deal-context-skeleton">${renderCallSectionSkeleton("ARR", 40)}</span>`,
    });
  } else if (arrLabel) {
    pairs.push({ label: "ARR", value: `<span class="num">${esc(arrLabel)}</span>` });
  }

  const tcStatus = technicalCommit?.status;
  if (tcStatus) {
    pairs.push({
      label: "TC",
      value: `<span class="pill ${tcStatusPillClass(tcStatus)}">${esc(tcStatusLabel(tcStatus))}</span>`,
    });
  }

  const aiVal = formatTcFieldValue(technicalCommit?.aiAttach);
  if (aiVal) pairs.push({ label: "AI attach", value: `<span class="pill purple">${esc(aiVal)}</span>` });

  if (momentumStatus && momentumStatus !== "-") {
    const cls = tractionPillClass(momentumStatus);
    pairs.push({
      label: "Traction",
      value: `<span class="pill${cls ? ` ${cls}` : ""}">${esc(momentumStatus)}</span>`,
    });
  }

  if (!pairs.length) return "";

  return `
    <div class="call-deal-context call-deal-context--line card-wire" aria-label="Deal context">
      <div class="call-deal-context-inner">
        ${pairs
          .map(
            (p) =>
              `<span class="call-deal-context-pair"><span class="prep-form-eyebrow">${esc(p.label)}</span><span class="call-deal-context-value">${p.value}</span></span>`,
          )
          .join("")}
      </div>
    </div>`;
}

function qipMeterPct(score) {
  if (score == null || !Number.isFinite(Number(score))) return 0;
  return Math.min(100, Math.max(0, Math.round((Number(score) / 10) * 100)));
}

function meddpiccPipsHtml(filled) {
  const n = filled != null ? Math.max(0, Math.min(MEDDPICC_FIELD_KEYS.length, Number(filled))) : 0;
  return `<div class="pips8">${MEDDPICC_FIELD_KEYS.map((_, i) => `<i${i < n ? ' class="on"' : ""}></i>`).join("")}</div>`;
}

function confidenceDotsHtml(confidencePct) {
  const label = confidenceBandLabel(confidencePct);
  const filled = label === "High" ? 3 : label === "Medium" ? 2 : label === "Low" ? 1 : 0;
  const short = label === "High" ? "High" : label === "Medium" ? "Med" : label === "Low" ? "Low" : "-";
  return `<div class="confdots">${[0, 1, 2].map((i) => `<i${i < filled ? ' class="on"' : ""}></i>`).join("")}<span>${esc(short)}</span></div>`;
}

function sentimentColor(label) {
  if (label === "Positive") return CHART_PALETTE.green;
  if (label === "Negative") return CHART_PALETTE.red;
  if (label === "Neutral") return CHART_PALETTE.amber;
  return CHART_PALETTE.text;
}

function renderPostcallKpiStack(ctx, pending = null) {
  const {
    qipScore,
    meddpiccScore,
    meddpiccFilled,
    sentiment,
    confidencePct,
    scorecard,
    callType,
    analysisMeta,
  } = ctx;
  const pendingSet = pending instanceof Set ? pending : new Set(Array.isArray(pending) ? pending : []);
  const qipNum = formatQipScoreValue(qipScore);
  const qipPct = qipMeterPct(qipScore);
  const medPending =
    pendingSet.has("qualify") && meddpiccScore == null && meddpiccFilled == null;
  const medNum = medPending ? null : meddpiccScore != null ? esc(String(meddpiccScore)) : "-";
  const medSub = medPending
    ? "Qualifying deal…"
    : meddpiccFilled != null
      ? `${esc(String(meddpiccFilled))} of ${esc(String(MEDDPICC_FIELD_KEYS.length))} surfaced`
      : "-";
  const sentimentLabel = sentiment?.label || "Neutral";
  const sentimentSub = sentiment?.sub ? esc(sentiment.sub) : "";
  const confLabel = confidenceBandLabel(confidencePct);

  const medCard = medPending
    ? `<div class="mcard call-section-skeleton mcard--pending" style="--accent:${CHART_PALETTE.amber};min-height:132px">
        <span class="lab">Qualification · MEDDPICC</span>
        ${renderCallSectionSkeleton("Qualification", 96)}
      </div>`
    : `<div class="mcard" style="--accent:${CHART_PALETTE.amber}">
      <span class="lab">Qualification · MEDDPICC</span>
      <span class="big" style="--val:${CHART_PALETTE.amber}">${medNum}<span class="u"> / 100</span></span>
      ${meddpiccPipsHtml(meddpiccFilled)}
      <span class="subline">${medSub}</span>
    </div>`;

  return `<div class="metrics" aria-label="Call KPIs">
    <div class="mcard" style="--accent:${CHART_PALETTE.green}">
      <span class="lab">QIP score</span>
      <span class="big" style="--val:${CHART_PALETTE.green}">${esc(qipNum)}<span class="u"> / 10</span></span>
      <div class="meter"><span style="width:${qipPct}%;background:${CHART_PALETTE.green}"></span></div>
    </div>
    ${medCard}
    <div class="mcard" style="--accent:${sentimentColor(sentimentLabel)}">
      <span class="lab">Overall call sentiment</span>
      <span class="sentiment" style="color:${sentimentColor(sentimentLabel)}">${esc(sentimentLabel)}</span>
      ${sentimentSub ? `<span class="subline">${sentimentSub}</span>` : ""}
    </div>
    <div class="mcard" style="--accent:${CHART_PALETTE.amber}">
      <span class="lab">Confidence to closure</span>
      <span class="sentiment" style="color:${CHART_PALETTE.text}">${esc(confLabel)}</span>
      ${confidenceDotsHtml(confidencePct)}
    </div>
  </div>`;
}

function scorecardHasRadarInput(scorecard, categoryScores, qipScore) {
  if (Object.values(categoryScores).some((n) => Number(n) > 0)) return true;
  if (qipScore != null && Number.isFinite(Number(qipScore)) && Number(qipScore) > 0) return true;
  return (scorecard?.lines || []).some(
    (line) =>
      !line.modelOmitted &&
      !line.evidenceUnavailable &&
      line.applicable !== false &&
      (Number(line.grade) > 0 ||
        (line.subParameters || []).some((sp) => Number(sp.score ?? sp.grade) > 0)),
  );
}

function renderPostcallSummaryRow(bundle, stakeholderRows, pending = null) {
  const categoryScores = resolveCategoryScores(bundle.scorecard, bundle.callType);
  const hasRadarData = scorecardHasRadarInput(bundle.scorecard, categoryScores, bundle.qipScore);
  const radarHtml = hasRadarData
    ? renderQipRadar(categoryScores, {
        overallScore: bundle.qipScore,
        title: "Evaluation signal",
        animate: false,
      })
    : `<div class="star-card star-card--empty"><div class="star-head"><span class="eyebrow">Evaluation signal</span></div><p class="muted call-radar-empty">QIP category scores appear here once analysis completes.</p></div>`;
  const tensionHtml = bundle.tensionLine
    ? `<div class="call-verdict-tension-band">${renderTensionBand(bundle.tensionLine)}</div>`
    : "";
  return `
    <section class="toprow call-postcall-summary-row">
      ${renderPostcallKpiStack({ ...bundle, analysisMeta: bundle.analysisMeta }, pending)}
      ${radarHtml}
      ${renderStakeholderSection(bundle.identities, bundle.attendees, bundle.hasVideo, bundle.videoFacts, stakeholderRows, bundle.analysisMeta)}
    </section>
    ${tensionHtml}`;
}

function renderVideoEmptySection(title, detail) {
  return `
    <div class="call-video-empty">
      <fw-icon name="video-off" size="28" aria-hidden="true"></fw-icon>
      <h4>${esc(title)}</h4>
      <p class="muted">${esc(detail)}</p>
    </div>`;
}

function renderPhase2TabEmpty(title, detail) {
  return `
    <div class="call-tab-empty">
      <fw-icon name="info" size="24" aria-hidden="true"></fw-icon>
      <h4>${esc(title)}</h4>
      <p>${esc(detail)}</p>
    </div>`;
}

/** Split internal call notes into scannable bullets for the wireframe read view. */
const BULLET_MARKER = /^\s*(?:[-–—•*·▪]|\d+[.)])\s+/;
/** Abbreviations that must not end a sentence. */
const ABBREV = /\b(?:vs|etc|e\.g|i\.e|approx|no|dept|inc|ltd|corp|mr|mrs|ms|dr|jr|sr|fig|vol|est|min|max|avg|q1|q2|q3|q4)\.$/i;

/** Strip every stacked list marker: "- - x", "* - x", "1. - x" all become "x". */
function stripBulletMarkers(line) {
  let out = String(line || "").trim();
  let guard = 0;
  while (BULLET_MARKER.test(out) && guard++ < 4) out = out.replace(BULLET_MARKER, "").trim();
  return out;
}

/** Sentence split that does not break on "vs." / "e.g." / "Inc.". */
function splitSentences(text) {
  const raw = String(text).match(/[^.!?]+[.!?]+(?:\s|$)|[^.!?]+$/g) || [text];
  const out = [];
  for (const piece of raw) {
    const prev = out[out.length - 1];
    if (prev && ABBREV.test(prev.trim())) out[out.length - 1] = `${prev.trim()} ${piece.trim()}`;
    else out.push(piece);
  }
  return out.map((s) => s.trim()).filter(Boolean);
}

export function formatCallNotesBullets(notes, maxLines = 8) {
  const text = String(notes || "").trim();
  if (!text) return [];

  const finish = (arr) =>
    arr.map(stripBulletMarkers).filter(Boolean).slice(0, maxLines);

  const lines = text.split(/\n+/).map((l) => l.trim()).filter(Boolean);
  const prefixed = lines.filter((l) => BULLET_MARKER.test(l));
  if (prefixed.length >= 2) return finish(prefixed);

  const paras = text.split(/\n\n+/).map((p) => p.trim()).filter(Boolean);
  if (paras.length >= 2) return finish(paras);

  const inline = text
    .split(/\s+(?=(?:[-–—•*·]|\d+[.)])\s+)/)
    .map((s) => s.trim())
    .filter(Boolean);
  if (inline.length >= 2) return finish(inline);

  const sentences = splitSentences(text);
  if (sentences.length <= 5) return finish(sentences);

  const bullets = [];
  const groupSize = sentences.length > 8 ? 2 : 1;
  for (let i = 0; i < sentences.length && bullets.length < 7; i += groupSize) {
    bullets.push(sentences.slice(i, i + groupSize).join(" "));
  }
  return finish(bullets);
}

function renderCallNotesBulletsHtml(notes, maxLines = 3) {
  const bullets = formatCallNotesBullets(notes, maxLines);
  if (!bullets.length) {
    return '<p class="muted call-notes-empty">No call notes yet.</p>';
  }
  return `<ul class="call-notes-bullets">${bullets
    .map((b) => `<li>${esc(b)}</li>`)
    .join("")}</ul>`;
}

function renderCallNotesSection(notes, opts = {}) {
  const pending = opts.pending instanceof Set ? opts.pending : new Set(Array.isArray(opts.pending) ? opts.pending : []);
  const hasNotes = String(notes || "").trim().length > 0;
  const body =
    !hasNotes && pending.has("summarise")
      ? renderCallSectionSkeleton("Call notes", 88)
      : renderCallNotesBulletsHtml(notes);
  return `
    <section class="call-section call-notes-section card-wire">
      <div class="call-section-body call-section-body--flat">
        <div class="prep-form-eyebrow">Call notes · what happened in this call</div>
        <div id="call-notes-read" class="call-notes-read">${body}</div>
      </div>
    </section>`;
}

function formatPass2DebugNote(analysisMeta, videoFacts, stakeholderRows) {
  const rows = stakeholderRows || [];
  if (!rows.length) return "";
  const hasTalk = rows.some((r) => r.talkPct != null);
  const allCamUnknown = rows.every((r) => r.cameraOn !== true && r.cameraOn !== false);
  if (!hasTalk || !allCamUnknown) return "";

  const dbg = analysisMeta?.pass2Debug || {};
  const route = dbg.route || null;
  const streamKind = videoFacts?.streamKind || null;
  if (route === "transcript" || streamKind === "transcript_infer") {
    if (dbg.ffmpegOk === false && dbg.hasRecordingUrl) {
      return (
        "Camera state unavailable — Pass 2 could not run ffmpeg on the recording. " +
        "On VPS check GET /api/config → videoPass.ffmpeg is true and VIDEO_PASS_ENABLED=1, then redeploy the worker."
      );
    }
    if (dbg.fallbackReason) {
      return `Camera state unavailable — Pass 2 used transcript only (${dbg.fallbackReason}).`;
    }
    return "Camera state unavailable — Pass 2 used transcript only. Re-run with a Zoom recording on the VPS for cam On/Off.";
  }
  if (videoFacts?.errorMessage) {
    return "Camera state could not be determined from the recording.";
  }
  return "Camera state could not be determined from the recording.";
}

function renderStakeholderName(row) {
  const nameHtml = esc(row.name);
  if (row.contactId && row.accountId) {
    return `<a href="#accounts/${esc(row.accountId)}/contacts/${esc(row.contactId)}" class="call-stakeholder-link" data-action="open-contact-account" data-account-id="${esc(row.accountId)}" data-contact-id="${esc(row.contactId)}">${nameHtml}</a>`;
  }
  return `<span class="call-stakeholder-name">${nameHtml}</span>`;
}

function renderStakeholderSection(identities, attendees, hasVideo, videoFacts, stakeholderRows, analysisMeta) {
  const rows = stakeholderRows?.length
    ? stakeholderRows
    : buildStakeholderRows(identities, attendees, videoFacts);

  let body;
  if (rows.length) {
    body = `<div class="call-stakeholder-cards">${rows
      .map((r, i) => {
        const avCls = stakeholderAvatarClass(r.role);
        const talkPill =
          r.talkPct != null
            ? `<span class="pill call-stakeholder-pill">talk ${esc(String(r.talkPct))}%</span>`
            : "";
        const camKnown = r.cameraOn === true || r.cameraOn === false;
        const camCls = r.cameraOn === true ? "green" : r.cameraOn === false ? "amber" : "";
        const camLabel = !camKnown
          ? "-"
          : r.cameraOnPct != null
            ? `${r.cameraOn ? "On" : "Off"} · ${esc(String(r.cameraOnPct))}%`
            : r.cameraOn ? "On" : "Off";
        return `<div class="call-stakeholder-card${i < rows.length - 1 ? " call-stakeholder-card--border" : ""}">
          <div class="call-stakeholder-avatar call-stakeholder-avatar--${avCls || "neutral"}">${esc(stakeholderInitials(r.name))}</div>
          <div class="call-stakeholder-main">
            <div class="call-stakeholder-name-row">${renderStakeholderName(r)}</div>
            <div class="sub call-stakeholder-role">${esc(r.role)}</div>
            <div class="call-stakeholder-signals">${talkPill}<span class="pill ${camCls} call-stakeholder-pill">cam ${camLabel}</span></div>
          </div>
        </div>`;
      })
      .join("")}</div>`;
  } else if (hasVideo) {
    body = renderVideoEmptySection(
      "Stakeholder profiles not loaded",
      "Video was available for this call, but attendee curves and role inference are not linked to this record yet.",
    );
  } else {
    body = renderVideoEmptySection(
      "No identities confirmed",
      "Re-run post-call and confirm SE / AE / customer on the gate before analysis.",
    );
  }

  const pass2Note = formatPass2DebugNote(analysisMeta, videoFacts, rows);

  return `
    <section class="call-section call-stakeholder-section card-wire card-wire--tight call-postcall-room">
      <div class="call-section-body call-section-body--flat">
        <div class="prep-form-eyebrow">Who was in the room</div>
        ${body}
        ${pass2Note ? `<p class="muted call-stakeholder-pass2-note">${esc(pass2Note)}</p>` : ""}
      </div>
    </section>`;
}

/** Markers belonging to a segment, so each phase carries the moments inside it. */
function markersWithin(markers, seg) {
  return (markers || []).filter((m) => m.atS >= seg.startS && m.atS < seg.endS);
}

function renderTimelineMarkers(markers) {
  if (!markers.length) return "";
  return `<ul class="call-timeline-markers">
    ${markers
      .map(
        (m) => `<li class="call-timeline-marker call-timeline-marker--${esc(m.kind)}">
          <span class="call-timeline-time num">${esc(formatSegmentTime(m.atS))}</span>
          <span class="pill pill--${esc(m.kind)}">${esc(MARKER_LABELS[m.kind] || m.kind)}</span>
          <span class="call-timeline-marker-label">${esc(markerDisplayLabel(m))}</span>
        </li>`,
      )
      .join("")}
  </ul>`;
}

function renderTimelineSpine(segments, markers) {
  return `<ol class="call-timeline-list">
    ${segments
      .map((seg) => {
        const start = formatSegmentTime(seg.startS);
        const end = formatSegmentTime(seg.endS);
        const label = seg.label || segmentTypeLabel(seg.segmentType);
        return `<li class="call-timeline-item">
          <span class="call-timeline-time num">${esc(start)}–${esc(end)}</span>
          <span class="call-timeline-label">${esc(label)}</span>
          <span class="pill">${esc(segmentTypeLabel(seg.segmentType))}</span>
          ${renderTimelineMarkers(markersWithin(markers, seg))}
        </li>`;
      })
      .join("")}
  </ol>`;
}

/**
 * Two possible spines, never mixed: Pass 2 screen-share segments, or conversation phases
 * derived from transcript timestamps. The transcript spine is display evidence only.
 */
export function renderTimelineSection(hasVideo, timeline, durationLabel, opts = {}) {
  const all = timeline?.segments || [];
  const markers = normalizeTimelineMarkers(timeline?.markers).sort((a, b) => a.atS - b.atS);
  const videoSegments = all.filter((s) => (s.source || "video") === "video");
  const transcriptSegments = all.filter((s) => s.source === "transcript");
  const usingTranscript = !videoSegments.length && transcriptSegments.length > 0;
  const segments = videoSegments.length ? videoSegments : transcriptSegments;
  const durationSec = segments.length
    ? resolveSpineDuration(
        timeline?.facts?.durationSec ??
          (segments.length ? Math.max(...segments.map((s) => Number(s.endS) || 0)) : null),
        segments,
        markers,
      )
    : null;

  let body = "";
  if (segments.length) {
    body += renderVisualSpine(segments, markers, durationSec);
    body += renderSpineTimeAxis(durationSec);
    body += renderCombinedSpineLegend(markers);
    if (usingTranscript) {
      body += `<p class="muted call-timeline-note">Built from transcript timestamps, not video. Camera, CDE, call flow, and engagement require video analysis and stay unscored here.</p>`;
    }
  } else if (markers.length) {
    body = renderTimelineMarkers(markers);
  } else if (timeline?.facts?.status && timeline.facts.status !== "unavailable") {
    body = renderVideoEmptySection(
      "Timeline not sampled",
      timeline.facts.errorMessage ||
        "Video facts exist for this call, but no share segments were detected.",
    );
  } else if (hasVideo) {
    body = renderVideoEmptySection(
      "Timeline not loaded",
      "Video was available, but visual analysis did not produce share segments for this call.",
    );
  } else if (opts.kaiaSource) {
    body = renderVideoEmptySection(
      "No timeline yet",
      "Kaia share links provide an AI summary, not a video file or VTT transcript. Pass 2 infers slide/demo phases from that summary — re-run post-call analysis if this call was processed before that step ran.",
    );
  } else {
    body = renderVideoEmptySection(
      "No timeline",
      "A timeline needs timestamps: either video analysis or a VTT transcript. A plain-text transcript has no clock to place moments on.",
    );
  }

  const title = durationLabel
    ? `How the ${durationLabel} went`
    : "How the call went";
  const subtitle = usingTranscript
    ? "Conversation phases from the transcript clock (evidence only, not scored)"
    : "";

  return `
    <section class="call-section call-timeline-section card-wire">
      <div class="call-section-body call-section-body--flat">
        <div class="call-timeline-head">
          <h2 class="call-timeline-title">${esc(title)}</h2>
          ${subtitle ? `<span class="muted call-timeline-sub">${esc(subtitle)}</span>` : ""}
        </div>
        ${body}
      </div>
    </section>`;
}

function renderTechnicalCommitTab(technicalCommit, tcDeltas, followUps, whatWorks, deal) {
  const tc = technicalCommit || null;
  const deltas = tcDeltas || [];
  if (!tc && !deltas.length) {
    return renderPhase2TabEmpty(
      "No technical commit yet",
      "Technical commit has not been captured for this call yet. Re-run post-call analysis to extract it from the transcript.",
    );
  }

  const tcFields = [
    ["incumbent", "Incumbent", formatTcFieldValue(tc?.incumbent)],
    ["competitor", "Competitor", formatTcFieldValue(tc?.competitor)],
    ["identifiedRisk", "Identified risk", formatTcFieldValue(tc?.identifiedRisk)],
    ["timelineForClosure", "Timeline for closure", formatTcFieldValue(tc?.timelineForClosure)],
    ["reasonForEvaluation", "Reason for evaluation", formatTcFieldValue(tc?.reasonForEvaluation)],
    ["aiAttach", "AI attach", formatTcFieldValue(tc?.aiAttach)],
  ];

  const slotRows = tcFields
    .filter(([, , v]) => v)
    .map(
      ([field, label, value]) =>
        `<div class="call-tc-slot call-tc-slot--wire"><div class="prep-form-eyebrow">${esc(label)}</div><div>${esc(value)}${tcFieldDeltaPill(field, deltas)}</div></div>`,
    )
    .join("");

  const pendingRows = (followUps || [])
    .filter((f) => f?.description)
    .slice(0, 5)
    .map((f) => {
      const owner = ownerLabel(f.owner) || "Open";
      const due = f.dueDate ? esc(f.dueDate) : "No date";
      const pillCls = f.status === "open" && !f.dueDate ? "red" : f.owner === "customer" ? "amber" : "";
      return `<div class="call-tc-pending-row"><span>${esc(f.description)}</span><span class="pill ${pillCls}">${esc(owner)} · ${due}</span></div>`;
    })
    .join("");

  const winsHtml = (whatWorks || [])
    .slice(0, 3)
    .map(
      (w) =>
        `<div class="ev good"><div class="ts">${esc(formatSegmentTime(w.atS) || w.productArea || "Win")}</div>${esc(w.verbatim || w.summary || "")}</div>`,
    )
    .join("");

  const tcPill = tc?.status
    ? `<span class="pill ${tcStatusPillClass(tc.status)}">${esc(tcStatusLabel(tc.status))} · unchanged</span>`
    : "";

  return `
    <div class="call-tc-tab call-tc-tab--wireframe">
      <div class="call-tc-tab-grid">
        <div class="call-tc-main card-wire card-wire--tight">
          <div class="call-tc-head">
            <h3>Technical commit</h3>
            ${tcPill}
          </div>
          ${tc?.justification ? `<p class="call-tc-justification">${esc(tc.justification)}</p>` : ""}
          <div class="call-tc-slots">${slotRows || '<p class="muted">No commit fields on this snapshot.</p>'}</div>
        </div>
        <div class="call-tc-aside">
          ${
            pendingRows
              ? `<div class="card-wire card-wire--tight call-tc-side-card"><div class="prep-form-eyebrow">Pending action items</div>${pendingRows}</div>`
              : ""
          }
          ${
            winsHtml
              ? `<div class="card-wire card-wire--tight call-tc-side-card"><div class="prep-form-eyebrow">What's working</div>${winsHtml}</div>`
              : ""
          }
          ${renderFitmentCard(deal)}
        </div>
      </div>
    </div>`;
}

function renderDealHealthTab(meddpiccDeltas, objections, meddpicc, meddpiccFilled) {
  const deltas = meddpiccDeltas || [];
  const objs = objections || [];
  const medList = renderMeddpiccList(meddpicc, deltas);

  if (!deltas.length && !objs.length && !medList) {
    return renderPhase2TabEmpty(
      "No deal-health movement yet",
      "MEDDPICC movement and objections appear here after analysis on a linked deal.",
    );
  }

  const objHtml = objs.length
    ? `<div class="card-wire card-wire--tight call-health-side-card">
        <div class="prep-form-eyebrow">Objections</div>
        ${objs.map((o) => renderObjectionQaRow(o)).join("")}
      </div>`
    : "";

  return `<div class="call-health-tab call-health-tab--wireframe">
    <div class="call-health-grid">
      <div class="card-wire card-wire--tight">
        <h3>MEDDPICC</h3>
        <p class="sub">${meddpiccFilled != null ? `${esc(String(meddpiccFilled))} of ${esc(String(MEDDPICC_FIELD_KEYS.length))} surfaced on this call` : "Deal qualification"}</p>
        <div class="call-medp-list">${medList || '<p class="muted">No MEDDPICC surfaced yet. Run deal qualification on a linked deal.</p>'}</div>
      </div>
      <div class="call-health-aside">${objHtml}</div>
    </div>
  </div>`;
}

/**
 * Resolve MoM for the Minutes tab — prefer stored momDrafts, then Pass 7 blob.
 * Compose Kaia-style sections from structured fields; fall back to flat body + follow-ups.
 */
function resolveMomGreetingName(record, mom, attendees = []) {
  const customer = (attendees || []).find((a) =>
    /customer|prospect|buyer|client/i.test(String(a?.role || a?.type || a?.side || "")),
  );
  const name = customer?.name || customer?.displayName || "";
  if (name.trim()) return name.trim().split(/\s+/)[0];
  return greetingNameFromDraft(mom?.editedBody || mom?.draftBody || "");
}

/** Plain legacy draftBody (not a composed email) usable as outcome text. */
function legacyPlainOutcome(body) {
  const t = String(body || "").trim();
  if (!t || /^Dear\s+/i.test(t)) return "";
  if (/\n\n(?:Meeting outcome|What we covered|Next steps)/i.test(t)) return "";
  if (t.length < 600) return t;
  return "";
}

export function resolveMinutesViewModel(record, momDraft, followUps) {
  const mom =
    momDraft ||
    record?.result?.summarise?.momDraft ||
    record?.result?.momDraft ||
    null;
  const fus = followUps || record?.result?.summarise?.followUps || [];
  const hdr = record?.analysis?.callHeader || record?.result?.analysis?.callHeader || {};
  const attendees = hdr.attendees || [];

  const rawOutcome = (mom?.outcome || "").trim();
  const keyPoints = Array.isArray(mom?.keyPoints) ? mom.keyPoints.filter((k) => k?.title) : [];
  let actionItems = Array.isArray(mom?.actionItems) ? mom.actionItems.filter((a) => a?.text) : [];

  if (!actionItems.length && fus.length) {
    actionItems = fus.map((f) => ({
      text: f.description,
      owner: f.owner || null,
      dueDate: f.dueDate || null,
      atS: null,
      sourceQuote: f.sourceQuote || null,
    }));
  }

  const hasStructured = rawOutcome || keyPoints.length || actionItems.length;
  const legacyBody = (mom?.editedBody || mom?.draftBody || "").trim();
  const legacyOutcome = legacyPlainOutcome(mom?.editedBody ? "" : mom?.draftBody);
  const outcome = rawOutcome || legacyOutcome || (!hasStructured ? legacyBody : "");

  const emailDraft = assembleMomEmailDraft({
    outcome: rawOutcome || legacyOutcome || (!hasStructured ? legacyBody : ""),
    keyPoints,
    actionItems,
    greetingName: resolveMomGreetingName(record, mom, attendees),
    companyName: hdr.company || hdr.account || record?.company || companyFromCallTitle(hdr.title) || "",
    meetingTitle: hdr.title || record?.title || "",
  });

  const editedBody = (mom?.editedBody || "").trim();

  return {
    mom,
    outcome,
    keyPoints,
    actionItems,
    draftBody: legacyBody,
    emailDraft,
    editorBody: editedBody || emailDraft || legacyBody,
    sentAt: mom?.sentAt || null,
  };
}

function ownerLabel(owner) {
  const map = { se: "SE", ae: "AE", customer: "Customer" };
  return map[owner] || owner || "";
}

function momOwnerChip(owner) {
  const label = ownerLabel(owner);
  if (!label) return "";
  const key = String(owner || "").toLowerCase();
  const cls =
    key === "ae" ? "mom-owner--ae" : key === "customer" ? "mom-owner--customer" : "mom-owner--se";
  return `<span class="mom-owner ${cls}">${esc(label)}</span>`;
}

function renderMomActionRow(action) {
  const meta = [
    momOwnerChip(action.owner),
    action.dueDate ? `<span class="mom-due">By ${esc(action.dueDate)}</span>` : "",
    action.atS != null && Number.isFinite(Number(action.atS))
      ? `<span class="mom-action-ts num">${esc(formatSegmentTime(action.atS))}</span>`
      : "",
  ]
    .filter(Boolean)
    .join("");
  return `<li class="mom-action">
    <div class="mom-action-main">
      <span class="mom-action-text">${esc(action.text)}</span>
      ${meta ? `<div class="mom-action-meta">${meta}</div>` : ""}
    </div>
  </li>`;
}

function renderMomTopicRow(kp) {
  const detail = kp.detail ? `<span class="mom-topic-detail">${esc(kp.detail)}</span>` : "";
  return `<li class="mom-topic">
    <strong class="mom-topic-title">${esc(kp.title)}</strong>
    ${detail}
  </li>`;
}

export function renderMinutesTab(record, opts = {}) {
  const view = resolveMinutesViewModel(record, opts.momDraft, opts.followUps);
  const { outcome, keyPoints, actionItems, editorBody, sentAt } = view;

  if (!outcome && !keyPoints.length && !actionItems.length && !editorBody.trim()) {
    return renderPhase2TabEmpty(
      "No minutes draft yet",
      "Minutes of meeting were not generated for this call, or summarisation was skipped. Re-run analysis to generate one.",
    );
  }

  const hdr = record?.analysis?.callHeader || record?.result?.analysis?.callHeader || {};
  const title = hdr.title || record?.title || "Call recap";
  const dateLabel = callDateLabel(record);
  const bodyText = outcome.trim();

  const statusHtml = sentAt
    ? `<span class="mom-status mom-status--sent">Sent ${esc(formatDateTime(sentAt))}</span>`
    : "";

  const outcomeHtml = bodyText
    ? `<section class="mom-section mom-section--outcome">
        <h3>Outcome</h3>
        <p class="mom-outcome-text">${esc(bodyText)}</p>
      </section>`
    : "";

  const topicsHtml = keyPoints.length
    ? `<section class="mom-section mom-section--topics">
        <h3>What we covered</h3>
        <ul class="mom-topics">${keyPoints.map(renderMomTopicRow).join("")}</ul>
      </section>`
    : "";

  const actionsHtml = actionItems.length
    ? `<section class="mom-section mom-section--actions">
        <h3>Next steps</h3>
        <ul class="mom-actions">${actionItems.map(renderMomActionRow).join("")}</ul>
      </section>`
    : "";

  return `<section class="card mom-card mom-card--wireframe">
    <div class="mom-head">
      <h2>Minutes of meeting</h2>
      ${statusHtml}
    </div>
    <div class="mom-title-row">${esc(title)}${dateLabel ? ` · ${esc(dateLabel)}` : ""}</div>
    ${outcomeHtml}
    ${topicsHtml}
    ${actionsHtml}
    <div class="mom-email-edit">
      <p class="mom-edit-intro">Use the below to send an email to the customer.</p>
      <details class="call-mom-edit-wrap">
        <summary>Edit email draft</summary>
        <textarea id="call-mom-editor" class="call-mom-editor" aria-label="Email draft">${esc(editorBody)}</textarea>
        <div class="call-mom-actions">
          <fw-button id="call-mom-save" color="primary" size="small">Save draft</fw-button>
          <span id="call-mom-save-status" class="call-save-status muted" hidden></span>
        </div>
      </details>
    </div>
  </section>`;
}

function renderCallTabs(record, scorecard, analysisMeta, tabs = {}) {
  const coachAudience = tabs.coachAudience || "se";
  const pending = tabs.pending instanceof Set ? tabs.pending : new Set(Array.isArray(tabs.pending) ? tabs.pending : []);
  const errors = tabs.errors || {};
  let qipHtml;
  try {
    qipHtml =
      scorecard?.lines?.length || scorecard?.categoryScores || scorecard?.overall != null
        ? renderQipScorecard(scorecard, analysisMeta, {
            context: "call-record",
            callId: record.id,
            coachAudience,
            company: tabs.company || "",
          })
        : `<div class="call-tab-empty"><h4>No QIP scorecard</h4><p>Re-run post-call analysis to populate the scorecard.</p></div>`;
  } catch (err) {
    console.error("[call-view] QIP scorecard render failed:", err);
    qipHtml = `<div class="call-tab-empty"><h4>QIP scorecard unavailable</h4><p class="muted">Could not render the scorecard for this call. Try refreshing; if it persists, re-run post-call analysis.</p></div>`;
  }

  const tabDefs = [
    { id: "qip", label: "QIP scorecard", body: `<div class="call-tab-panel-inner call-tab-qip">${qipHtml}</div>` },
    {
      id: "technical",
      label: "Technical commit",
      body: `<div class="call-tab-panel-inner">${renderTechnicalCommitTab(tabs.technicalCommit, tabs.tcDeltas, tabs.followUps, tabs.whatWorks, tabs.deal)}</div>`,
    },
    {
      id: "health",
      label: "Deal health",
      body: `<div class="call-tab-panel-inner">${renderDealHealthTab(
        tabs.meddpiccDeltas,
        tabs.objections,
        tabs.meddpicc,
        tabs.meddpiccFilled,
      )}</div>`,
    },
    {
      id: "signal",
      label: "Product signal",
      body: `<div class="call-tab-panel-inner call-tab-signal">${
        errors.gaps
          ? renderCallSectionRetry("gaps", errors.gaps, record.id)
          : pending.has("gaps") && !(tabs.productGaps || []).length && !(tabs.whatWorks || []).length
            ? renderCallSectionSkeleton("Product signal", 280)
            : renderCallProductSignalTab(record, {
                productGaps: tabs.productGaps,
                whatWorks: tabs.whatWorks,
                clusterLabels: tabs.clusterLabels || {},
                objections: tabs.objections,
                timelineMarkers: tabs.timelineMarkers,
              })
      }</div>`,
    },
    {
      id: "minutes",
      label: "Minutes",
      body: `<div class="call-tab-panel-inner call-tab-mom">${renderMinutesTab(record, {
        momDraft: tabs.momDraft,
        followUps: tabs.followUps,
      })}</div>`,
    },
  ];

  const initial = tabs.initialTab || "qip";
  const tabButtons = tabDefs
    .map(
      (t) =>
        `<button type="button" class="call-record-tab${t.id === initial ? " on" : ""}" data-call-tab="${esc(t.id)}" role="tab" aria-selected="${t.id === initial ? "true" : "false"}">${esc(t.label)}</button>`,
    )
    .join("");
  const tabPanels = tabDefs
    .map(
      (t) =>
        `<div class="call-record-tabpane tabpane${t.id === initial ? " on" : ""}" data-call-panel="${esc(t.id)}" role="tabpanel">${t.body}</div>`,
    )
    .join("");

  return `
    <section class="call-record-tabs-section">
      <div class="call-record-tablist tabs" role="tablist">${tabButtons}</div>
      <div class="call-record-tabpanes">${tabPanels}</div>
    </section>`;
}

/** Firestore reads are optional. local history analysis blob renders the wireframe. */
async function safeEnrich(label, fn, fallback) {
  try {
    return await fn();
  } catch (err) {
    const msg = err?.message || String(err);
    if (err?.code === "permission-denied" || /permission/i.test(msg)) {
      console.warn(`[call-view] ${label} skipped (permissions)`);
    } else {
      console.warn(`[call-view] ${label} skipped:`, msg);
    }
    return fallback;
  }
}

/** Immediate full-layout shell while enrichments load. */
function renderCallLoadingShell(record) {
  const hydration = resolveRecordHydration(record);
  return renderCallRecordSkeleton(record, {
    pending: hydration.pending.length
      ? hydration.pending
      : ["qualify", "summarise", "commit", "arr", "gaps"],
    errors: hydration.errors,
    progressMessage: hydration.progressMessage || "Loading deal context…",
  });
}

async function loadCallBundle(session, record) {
  const email = session.email;
  const store = getStore();
  let dealId = resolveDealId(record);
  const resultBlob = record.result || {};
  const pass6 = resolvePass6(record);
  const draftVf = resultBlob.videoFacts;
  const draftTimeline = resultBlob.timeline;
  const summarise = resultBlob.summarise || {};

  const domainCall = store.getCall
    ? await safeEnrich("getCall", () => store.getCall(record.id), null)
    : store.getPostCall
      ? await safeEnrich("getPostCall", () => store.getPostCall(record.id), null)
      : null;

  const detail = domainCall?.detail || {};
  const needsProductGaps =
    !pass6?.productGaps?.length && !detail.productGaps?.length && store.listProductGapsByPostCall;
  const needsWhatWorks =
    !pass6?.whatWorks?.length && !detail.whatWorks?.length && store.listWhatWorksByPostCall;
  const needsTcDeltas =
    !resultBlob.tcDeltas?.length && !detail.tcDeltas?.length && store.listTcDeltasByCall;
  const needsMeddpiccDeltas = !detail.meddpiccDeltas?.length && store.listMeddpiccDeltasByCall;

  const [
    fetchedProductGaps,
    fetchedWhatWorks,
    fetchedTcDeltas,
    fetchedMeddpiccDeltas,
  ] = await Promise.all([
    needsProductGaps
      ? safeEnrich("listProductGapsByPostCall", () => store.listProductGapsByPostCall(record.id), [])
      : Promise.resolve([]),
    needsWhatWorks
      ? safeEnrich("listWhatWorksByPostCall", () => store.listWhatWorksByPostCall(record.id), [])
      : Promise.resolve([]),
    needsTcDeltas
      ? safeEnrich("listTcDeltasByCall", () => store.listTcDeltasByCall(record.id), [])
      : Promise.resolve([]),
    needsMeddpiccDeltas
      ? safeEnrich("listMeddpiccDeltasByCall", () => store.listMeddpiccDeltasByCall(record.id), [])
      : Promise.resolve([]),
  ]);

  const parallel = {
    domainCall,
    productGaps: detail.productGaps?.length ? detail.productGaps : fetchedProductGaps,
    whatWorks: detail.whatWorks?.length ? detail.whatWorks : fetchedWhatWorks,
    storedFacts: detail.videoFacts?.length ? detail.videoFacts : [],
    timelineSegments: detail.timelineSegments?.length ? detail.timelineSegments : [],
    timelineMarkers: detail.timelineMarkers?.length ? detail.timelineMarkers : [],
    tcDeltas: detail.tcDeltas?.length ? detail.tcDeltas : fetchedTcDeltas,
    meddpiccDeltas: detail.meddpiccDeltas?.length ? detail.meddpiccDeltas : fetchedMeddpiccDeltas,
    objections: detail.objections?.length ? detail.objections : [],
    followUps: detail.followUps?.length ? detail.followUps : [],
    momDrafts: detail.momDrafts?.length ? detail.momDrafts : [],
    dealSignals: detail.dealSignals?.length ? detail.dealSignals : [],
    embeddedTechnicalCommit: detail.technicalCommit || null,
  };

  if (!dealId && domainCall?.dealId) dealId = domainCall.dealId;

  // Tier 3 — the record never got a dealId stamped (dual-write skipped, or confirm
  // had no deals on the account). Recover it from the account's deal list.
  const pendingNewDeal = recordPendingNewDeal(record);
  if (!dealId && !pendingNewDeal) {
    const accountId =
      record?.result?.confirmed?.accountId ||
      record?.result?.resolve?.account?.accountId ||
      parallel.domainCall?.accountId ||
      null;
    if (accountId && store.listDealsByAccount) {
      const accountDeals = await safeEnrich(
        "listDealsForAccount",
        () => listDealsForAccount(accountId),
        [],
      );
      // Newest open deal wins; archived last.
      const pick =
        accountDeals.find((d) => d.status !== "archived") || accountDeals[0] || null;
      if (pick?.id) dealId = pick.id;
    }
  }

  let deal = null;
  let account = null;
  let technicalCommit =
    resultBlob.technicalCommit || parallel.embeddedTechnicalCommit || null;

  if (dealId) {
    const [loadedDeal, tcFromStore] = await Promise.all([
      safeEnrich("getDeal", () => getDeal(dealId), null),
      !technicalCommit && store.getTechnicalCommitByDeal
        ? safeEnrich("getTechnicalCommitByDeal", () => store.getTechnicalCommitByDeal(dealId), null)
        : Promise.resolve(null),
    ]);
    deal = loadedDeal;
    if (!technicalCommit) technicalCommit = tcFromStore;
    if (deal?.accountId && store.getAccount) {
      account = await safeEnrich("getAccount", () => store.getAccount(deal.accountId), null);
    }
  } else if (pendingNewDeal) {
    const confirmed = record?.result?.confirmed || {};
    const pendingTitle = confirmed.newDealTitle || record?.newDealTitle || "";
    if (pendingTitle) {
      deal = {
        title: pendingTitle,
        type: confirmed.newDealType || record?.newDealType || "new_business",
        stage: "research",
      };
    }
    const accountId =
      confirmed.accountId ||
      record?.accountId ||
      record?.result?.confirmed?.accountId ||
      parallel.domainCall?.accountId ||
      null;
    if (accountId && store.getAccount) {
      account = await safeEnrich("getAccount", () => store.getAccount(accountId), null);
    }
  }

  // Same enrichment the deal record uses — Firestore metadata.meddpicc lags behind
  // the Pass 4 qualification blobs sitting in local history.
  if (deal) {
    const dealRecords = listPostCallAnalyses(email).filter(
      (r) => resolveDealId(r) === dealId,
    );
    if (dealRecords.length) deal = enrichDealFromHistoryRecords(deal, dealRecords);
  }

  let med = resolveDealMeddpicc(deal, account);
  if (!med) {
    const own = record?.result?.qualification
      ? rollupMeddpiccFromHistoryRecords([record])
      : null;
    med = own || null;
  }
  const meddpiccScore = med ? computeMeddpiccScore(med) : null;
  const meddpiccFilled = countMeddpiccFilled(med);
  const sequence = dealSequencePosition(email, dealId, record.id);
  const callType = resolveCallType(record);
  const analysisMeta = resolveAnalysisMeta(record);
  let scorecard = await enrichScorecardFromStore(record, resolveScorecard(record));
  if (scorecard) {
    const rubric = effectiveRubricVersion(scorecard, analysisMeta);
    scorecard = { ...scorecard, rubricVersion: rubric };
  }
  if (scorecard?.lines?.length) {
    scorecard = normalizeQipScorecard(scorecard, analysisMeta);
  } else if (
    scorecard &&
    (scorecard.categoryScores || typeof scorecard.overall === "number")
  ) {
    scorecard = normalizeQipScorecard({ ...scorecard, lines: scorecard.lines || [] }, analysisMeta);
  }
  const categoryScores = resolveCategoryScores(scorecard, callType);
  const qipScore = resolveQipOverallScore(scorecard, callType, analysisMeta);
  const qipLabel =
    qipScore != null
      ? formatTypeComposite({
          score: qipScore,
          callType: scorecard?.callType || callType,
          rubricVersion: scorecard?.rubricVersion || analysisMeta.rubricVersion || RUBRIC_VERSION,
        })
      : null;
  const deltaInfo = qipDeltaForType(email, callType, qipScore, record.id);
  const analysis = record.analysis || resultBlob.analysis || {};
  const momentumStatus = analysis?.momentum?.status || "-";
  const sentiment = resolveCallSentiment(analysis);
  const confRaw = scorecard?.confidence ?? analysisMeta.analysisConfidence;
  const confidencePct = confRaw != null ? Math.round(confRaw * 100) : null;

  let productGaps = (pass6?.productGaps?.length ? pass6.productGaps : parallel.productGaps)
    .map(normalizeProductSignalRow)
    .filter(Boolean);
  let whatWorks = (pass6?.whatWorks?.length ? pass6.whatWorks : parallel.whatWorks)
    .map(normalizeProductSignalRow)
    .filter(Boolean);

  /** @type {Record<string, string>} */
  const clusterLabels = {};
  if (store.getGapCluster) {
    const clusterIds = [
      ...new Set(productGaps.map((g) => g.clusterId).filter(Boolean)),
    ];
    const clusters = await Promise.all(
      clusterIds.map((id) => safeEnrich("getGapCluster", () => store.getGapCluster(id), null)),
    );
    clusterIds.forEach((id, index) => {
      if (clusters[index]?.label) clusterLabels[id] = clusters[index].label;
    });
  }

  const identities = resolveConfirmedIdentities(record);
  const attendees = analysis?.callHeader?.attendees || [];

  let timelineFacts = parallel.storedFacts?.[0] || null;
  let timelineSegments = parallel.timelineSegments;
  if (!timelineSegments.length && Array.isArray(draftVf?.segments)) {
    timelineSegments = draftVf.segments;
    timelineFacts = timelineFacts || draftVf;
  }
  if (timelineFacts && draftVf?.attendeeCurveJson && !timelineFacts.attendeeCurveJson) {
    timelineFacts = { ...timelineFacts, attendeeCurveJson: draftVf.attendeeCurveJson };
  }

  let timelineMarkers = parallel.timelineMarkers;
  if (!timelineSegments.length && Array.isArray(draftTimeline?.segments)) {
    timelineSegments = draftTimeline.segments;
  }
  if (!timelineMarkers.length && Array.isArray(draftTimeline?.markers)) {
    timelineMarkers = draftTimeline.markers;
  }

  const videoFacts = resolveVideoFactsForBundle(
    draftVf,
    timelineFacts,
    parallel.storedFacts,
  );

  const arrPoint =
    deal?.arrSnapshot?.arrEstimatePoint ??
    deal?.arrEstimatePoint ??
    resultBlob.arrCompute?.arrPoint ??
    resultBlob.arrCompute?.arrEstimatePoint ??
    null;
  const arrLabel =
    arrPoint != null && Number.isFinite(Number(arrPoint))
      ? `$${Math.round(Number(arrPoint)).toLocaleString()}`
      : null;

  let tcDeltas = resultBlob.tcDeltas?.length ? resultBlob.tcDeltas : parallel.tcDeltas;
  let meddpiccDeltas = parallel.meddpiccDeltas;
  let objections = summarise.objections?.length ? summarise.objections : parallel.objections;
  let followUps = summarise.followUps?.length ? summarise.followUps : parallel.followUps;

  let momDraft = summarise.momDraft || resultBlob.momDraft || null;
  if (!momDraft) momDraft = parallel.momDrafts?.[0] || null;

  const dealSignal = parallel.dealSignals?.[0] || null;

  let navigableDealId = dealId;
  if (dealId && deal && !deal.accountId) {
    const probe = await safeEnrich("getDeal:probe", () => getDeal(dealId), null);
    if (probe && !probe.accountId) navigableDealId = null;
  }

  const accountId = deal?.accountId || account?.id || null;
  let accountContacts = [];
  if (accountId && store?.listContactsByAccount) {
    accountContacts = await safeEnrich(
      "listContactsByAccount",
      () => store.listContactsByAccount(accountId),
      [],
    );
  }
  const stakeholderRows = await enrichStakeholderContacts(
    accountId,
    buildStakeholderRows(identities, attendees, videoFacts, accountContacts),
    accountContacts,
  );

  return {
    record,
    deal,
    dealId: navigableDealId,
    account,
    sequence,
    callType,
    callTypeLabel: CALL_TYPE_LABELS[callType] || callType,
    scorecard,
    analysisMeta,
    qipLabel,
    qipScore,
    qipDeltaHtml: deltaInfo ? formatDelta(deltaInfo.delta) : "",
    qipDeltaPill: deltaInfo ? formatDeltaPill(deltaInfo.delta) : "",
    meddpiccScore,
    meddpiccFilled,
    meddpicc: med,
    momentumStatus,
    sentiment,
    confidencePct,
    arrLabel,
    tensionLine: buildVerdictTension({
      qipScore,
      qipDelta: deltaInfo?.delta,
      meddpiccScore,
      momentumStatus,
      confidencePct,
    }),
    hasVideo: resolveVideoAvailable(record),
    kaiaSource: isKaiaRecordingUrl(record?.zoomLink),
    callNotes: (() => {
      const fromAnalysis = typeof analysis.callNotes === "string" ? analysis.callNotes.trim() : "";
      if (fromAnalysis) return fromAnalysis;
      const fromSummarise = summarise.callNotes;
      return typeof fromSummarise === "string" ? fromSummarise.trim() : "";
    })(),
    identities,
    attendees,
    timeline: { facts: timelineFacts, segments: timelineSegments, markers: timelineMarkers },
    videoFacts,
    productSignal: { productGaps, whatWorks, clusterLabels },
    technicalCommit,
    tcDeltas,
    meddpiccDeltas,
    objections,
    followUps,
    momDraft,
    dealSignal,
    stakeholderRows,
  };
}

function parseDurationMinutesLabel(record, timeline) {
  const hdr = record?.analysis?.callHeader || record?.result?.analysis?.callHeader || {};
  const fromHdr = hdr.duration;
  if (typeof fromHdr === "string") {
    const m = fromHdr.match(/(\d+(?:\.\d+)?)\s*min/i);
    if (m) return `${Math.round(Number(m[1]))} minutes`;
  }
  const sec =
    timeline?.facts?.durationSec ??
    record?.result?.videoFacts?.durationSec ??
    record?.result?.resolve?.media?.durationSec ??
    null;
  if (sec != null && Number.isFinite(Number(sec)) && Number(sec) > 0) {
    return `${Math.round(Number(sec) / 60)} minutes`;
  }
  return null;
}

/** Full layout skeleton — same structure as the final call record. */
function renderCallRecordSkeleton(record, opts = {}) {
  const bundle = buildLocalCallBundle({ email: "" }, record);
  return renderCallRecord(bundle, opts);
}

function renderCallRecord(bundle, opts = {}) {
  const { record, callTypeLabel, account } = bundle;
  const pending = opts.pending instanceof Set ? opts.pending : new Set(Array.isArray(opts.pending) ? opts.pending : []);
  const errors = opts.errors || {};
  const progressMessage = opts.progressMessage || "";
  const analysis = record.analysis || record.result?.analysis || {};
  const title = resolveCallTitleFromRecord(record, { accountName: account?.name });
  const durationLabel = parseDurationMinutesLabel(record, bundle.timeline);
  const stakeholderRows = bundle.stakeholderRows || buildStakeholderRows(bundle.identities, bundle.attendees, bundle.videoFacts);
  const metaBits = [
    account?.id
      ? `<a href="#accounts/${esc(account.id)}" class="call-meta-link">${esc(titleCaseDisplayName(account.name) || account.name)}</a>`
      : account?.name
        ? esc(titleCaseDisplayName(account.name) || account.name)
        : "",
    callDateLabel(record),
  ].filter(Boolean);

  const canOpenDeal = !!(
    bundle.deal?.id ||
    bundle.dealId ||
    companyFromCallTitle(title)
  );
  const dealAction = canOpenDeal
    ? `<button type="button" class="btn-wire call-record-action call-record-action--deal" data-action="open-deal">Open deal</button>`
    : "";

  return `
    <div class="lifecycle-detail call-record${pending.size || progressMessage ? " call-record--progressive" : ""}">
      <div class="call-record-page">
        ${renderCallInlineProgress(progressMessage)}
        <div class="call-record-title-block">
          <div class="call-record-title-row">
            <div class="call-record-title-main">
              <h1 class="call-record-title">${esc(title)}</h1>
              ${callTypePill(callTypeLabel)}
            </div>
            <div class="call-record-title-actions">
              <button type="button" class="btn-wire call-record-action" data-action="new-postcall">New post call</button>
              ${dealAction}
            </div>
          </div>
          ${metaBits.length ? `<p class="call-record-meta-line muted">${metaBits.join(" · ")}</p>` : ""}
        </div>
        ${renderDealContextLine(bundle, { pending, errors, recordId: record.id })}
        ${renderCallNotesSection(bundle.callNotes, { pending })}
        ${renderPostcallSummaryRow(bundle, stakeholderRows, pending)}
        ${renderTimelineSection(bundle.hasVideo, bundle.timeline, durationLabel, {
          kaiaSource: bundle.kaiaSource,
        })}
        ${renderCallTabs(record, bundle.scorecard, bundle.analysisMeta, {
          ...bundle.productSignal,
          technicalCommit: bundle.technicalCommit,
          tcDeltas: bundle.tcDeltas,
          meddpiccDeltas: bundle.meddpiccDeltas,
          meddpicc: bundle.meddpicc,
          meddpiccFilled: bundle.meddpiccFilled,
          objections: bundle.objections,
          followUps: bundle.followUps,
          whatWorks: bundle.productSignal?.whatWorks,
          timelineMarkers: bundle.timeline?.markers,
          momDraft: bundle.momDraft,
          dealSignal: bundle.dealSignal,
          deal: bundle.deal,
          coachAudience: bundle.coachAudience || "se",
          company: companyFromCallTitle(title) || account?.name || "",
          pending,
          errors,
        })}
      </div>
    </div>`;
}

function flashSaveStatus(el, message, isError = false) {
  if (!el) return;
  el.textContent = message;
  el.hidden = false;
  el.classList.toggle("warn", isError);
  window.setTimeout(() => {
    el.hidden = true;
  }, 2500);
}

function wireCallRecord(container, session, bundle, opts) {
  const recordId = bundle.record.id;
  const email = session.email;

  container.querySelector('[data-action="back"]')?.addEventListener("fwClick", () => {
    opts.onBack?.();
  });
  container.querySelector('[data-action="back"]')?.addEventListener("click", () => {
    opts.onBack?.();
  });

  const openDeal = () => {
    const id = bundle.deal?.id || bundle.dealId;
    const accountId = bundle.deal?.accountId || bundle.account?.id || null;
    if (id) opts.onOpenDeal?.(id, { accountId });
  };
  container.querySelector('[data-action="open-deal"]')?.addEventListener("fwClick", openDeal);
  container.querySelector('[data-action="open-deal"]')?.addEventListener("click", openDeal);
  const newPostCall = () => {
    opts.onNewPostCall?.();
  };
  container.querySelector('[data-action="new-postcall"]')?.addEventListener("fwClick", newPostCall);
  container.querySelector('[data-action="new-postcall"]')?.addEventListener("click", newPostCall);
  container.querySelectorAll('a[data-action="open-deal"]').forEach((link) => {
    link.addEventListener("click", (e) => {
      e.preventDefault();
      openDeal();
    });
  });

  container.querySelectorAll('a.call-meta-link[href^="#accounts/"]').forEach((link) => {
    link.addEventListener("click", (e) => {
      const m = /^#accounts\/([^/?#]+)/.exec(link.getAttribute("href") || "");
      if (m?.[1]) {
        e.preventDefault();
        opts.onOpenAccount?.(m[1]);
      }
    });
  });

  container.querySelectorAll('[data-action="open-contact-account"]').forEach((el) => {
    const activate = (e) => {
      e.preventDefault();
      const accountId = el.getAttribute("data-account-id") || "";
      const contactId = el.getAttribute("data-contact-id") || "";
      if (accountId) opts.onOpenAccount?.(accountId, contactId || undefined);
    };
    el.addEventListener("click", activate);
  });

  const tablist = container.querySelector(".call-record-tablist");
  if (tablist) {
    const buttons = tablist.querySelectorAll("[data-call-tab]");
    const panels = container.querySelectorAll("[data-call-panel]");
    const activateTab = (name) => {
      buttons.forEach((btn) => {
        const on = btn.getAttribute("data-call-tab") === name;
        btn.classList.toggle("on", on);
        btn.setAttribute("aria-selected", on ? "true" : "false");
      });
      panels.forEach((panel) => {
        panel.classList.toggle("on", panel.getAttribute("data-call-panel") === name);
      });
    };
    buttons.forEach((btn) => {
      btn.addEventListener("click", () => activateTab(btn.getAttribute("data-call-tab")));
    });
    if (opts.initialTab) activateTab(opts.initialTab);
  }

  const momEditor = container.querySelector("#call-mom-editor");
  const momSave = container.querySelector("#call-mom-save");
  const momStatus = container.querySelector("#call-mom-save-status");

  const saveMom = async () => {
    const body = momEditor?.value ?? "";
    const updated = await updatePostCallAnalysis(email, recordId, (rec) => {
      const result = { ...(rec.result || {}) };
      const summarise = { ...(result.summarise || {}) };
      const momDraft = { ...(summarise.momDraft || result.momDraft || {}) };
      momDraft.editedBody = body;
      summarise.momDraft = momDraft;
      result.summarise = summarise;
      rec.result = result;
      return rec;
    });
    if (updated) {
      flashSaveStatus(momStatus, "Draft saved");
    } else {
      flashSaveStatus(momStatus, "Could not save", true);
    }
  };

  momSave?.addEventListener("fwClick", () => { void saveMom(); });
  momSave?.addEventListener("click", () => { void saveMom(); });

  if (typeof document !== "undefined") {
    wireScoreDisputes(container, email);
  }

  container.querySelectorAll('[data-action="retry-hydration"]').forEach((btn) => {
    const retry = async () => {
      const section = btn.getAttribute("data-retry-section");
      if (!section) return;
      btn.disabled = true;
      try {
        const { retryPostcallHydrationSection } = await import("./postcall.js");
        await retryPostcallHydrationSection(recordId, section);
      } catch (err) {
        console.warn("[call-view] hydration retry failed:", err?.message || err);
      } finally {
        btn.disabled = false;
      }
    };
    btn.addEventListener("click", () => { void retry(); });
  });

  container.querySelectorAll(".score-override-trigger").forEach((btn) => {
    btn.addEventListener("click", (ev) => {
      ev.preventDefault();
      ev.stopPropagation();
      const firstCat = container.querySelector("details.qip-category-row, details.cat");
      if (!firstCat) return;
      firstCat.open = true;
      const firstTheme = firstCat.querySelector("details.thm");
      if (firstTheme) firstTheme.open = true;
      firstCat.scrollIntoView({ block: "nearest", behavior: "smooth" });
    });
  });

  if (opts.expandThemeKey) {
    const themeKey = opts.expandThemeKey;
    window.requestAnimationFrame(() => {
      const match =
        container.querySelector(`.thm[data-theme-key="${themeKey}"]`) ||
        container.querySelector(`[data-theme-key="${themeKey}"]`);
      if (!match) return;
      const category = match.closest("details.qip-category-row");
      if (category) category.open = true;
      if (match.tagName === "DETAILS") match.open = true;
      match.scrollIntoView({ block: "nearest", behavior: "smooth" });
    });
  }
}

function renderCallEmptyState(message) {
  return `
    <div class="lifecycle-empty call-empty">
      <fw-card>
        <fw-icon name="phone" size="24" aria-hidden="true"></fw-icon>
        <h2>Call record</h2>
        <p class="muted">${esc(message)}</p>
      </fw-card>
    </div>`;
}

/** @param {HTMLElement} container @param {object} session @param {object} opts */
export async function renderCallView(container, session, opts = {}) {
  let activeSession = session;
  if (!sessionUserId(activeSession)) {
    try {
      activeSession = (await syncSessionWithDomainStore(activeSession)) || activeSession;
    } catch (err) {
      console.warn("[call-view] session sync failed:", err);
    }
  }
  activeSession = withEffectiveUserId(activeSession);

  if (!activeSession?.email) {
    container.innerHTML = `<p class="muted">Sign in to view call records.</p>`;
    return;
  }

  if (!opts.callId) {
    container.innerHTML = renderCallEmptyState(
      "Open a call from your dashboard, coaching view, or after post-call analysis.",
    );
    return;
  }

  try {
    const ownerEmail = opts.ownerEmail || activeSession.email;
    const selfEmail = normalizeSeEmail(activeSession.email);
    const record =
      !opts.ownerEmail || normalizeSeEmail(ownerEmail) === selfEmail
        ? getPostCallAnalysis(ownerEmail, opts.callId)
        : null;
    const resolvedRecord =
      record || (await getPostCallForSession(activeSession, opts.callId, ownerEmail));
    if (!resolvedRecord) {
      container.innerHTML = renderCallEmptyState("Call not found. It may have been cleared from this browser.");
      return;
    }

    const hydration = resolveRecordHydration(resolvedRecord);
    const coachAudience =
      normalizeSeEmail(ownerEmail) !== selfEmail &&
      isManagerRole(sessionToUser(activeSession)?.role)
        ? "manager"
        : "se";
    const localBundle = buildLocalCallBundle(activeSession, resolvedRecord);
    container.innerHTML = renderCallRecord(
      { ...localBundle, coachAudience },
      {
        pending: hydration.pending,
        errors: hydration.errors,
        progressMessage: hydration.progressMessage,
      },
    );
    wireCallRecord(container, activeSession, { ...localBundle, coachAudience }, opts);

    const bundle = await loadCallBundle(activeSession, resolvedRecord);
    const freshRecord = getPostCallAnalysis(ownerEmail, opts.callId) || resolvedRecord;
    const freshHydration = resolveRecordHydration(freshRecord);
    await hidePrepGenOverlay();
    if (opts.shouldApply && !opts.shouldApply()) return;
    const hydrationStillPending = (freshHydration.pending || []).length > 0;
    if (!hydrationStillPending) {
      container.innerHTML = renderCallRecord(
        { ...bundle, coachAudience },
        {
          pending: freshHydration.pending,
          errors: freshHydration.errors,
          progressMessage: freshHydration.progressMessage,
        },
      );
      wireCallRecord(container, activeSession, { ...bundle, coachAudience }, opts);
    }
  } catch (err) {
    console.error("[call-view] failed to render call:", err);
    container.innerHTML = renderCallEmptyState(
      "Could not load this call right now. Refresh the page or try again in a moment.",
    );
  }
}

export { resolveDealId, resolveCallType, qipDeltaForType, buildVerdictTension };
