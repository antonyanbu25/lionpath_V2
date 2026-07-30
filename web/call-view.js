/**
 * Call record view — spec §11.4 (#calls/:id).
 */

import {
  getPostCallAnalysis,
  listPostCallAnalyses,
  updatePostCallAnalysis,
} from "./history.js";
import { getPostCallForSession, normalizeSeEmail } from "./domain/se-access-service.js";
import { dedupeAnalysesByCallIdentity } from "./call-identity.js";
import { formatTypeComposite, isEligibleForAggregate, typeComposite } from "./quality-score.js";
import { renderQipScorecard } from "./postcall.js";
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
import { esc } from "./shared.js";
import { renderLoadingPanel } from "./crayons-ui.js";

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
  return (
    record?.result?.confirmed?.dealId ||
    record?.dealId ||
    record?.result?.resolve?.deals?.find((d) => d.preselected)?.dealId ||
    null
  );
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

const SPINE_LEGEND = [
  ["slides", "Slides", "#EFEBFD", "#4A3BA8"],
  ["product", "Product / CDE", "#E3F5EE", "#0D5C41"],
  ["customer_screen", "Customer screen", "#E8F0FE", "#1D4FD8"],
  ["none", "No share", "#F1F3F7", "#5A6B82"],
];

function spineSegmentLabel(type, customLabel) {
  if (customLabel) return customLabel;
  if (type === "product" || type === "cde") return "Product / CDE";
  return segmentTypeLabel(type);
}

function markerDisplayLabel(marker) {
  const raw = marker?.label || MARKER_LABELS[marker?.kind] || marker?.kind || "";
  return String(raw).trim();
}

function parseCustomerQuestions(scorecard, record) {
  const lines = scorecard?.lines || [];
  const eng = lines.find((l) => l.themeKey === "customer_engagement");
  const texts = [eng?.evidence, eng?.feedback, eng?.summary].filter(Boolean);
  for (const t of texts) {
    const m = String(t).match(/(\d+)\s+customer questions?/i);
    if (m) return Number(m[1]);
  }
  const hdr = record?.analysis?.callHeader || record?.result?.analysis?.callHeader;
  if (hdr?.customerQuestions != null && Number.isFinite(Number(hdr.customerQuestions))) {
    return Number(hdr.customerQuestions);
  }
  return null;
}

function parseLongestMonologue(scorecard) {
  const line = (scorecard?.lines || []).find((l) => l.themeKey === "call_flow");
  const texts = [line?.evidence, line?.feedback, line?.summary].filter(Boolean);
  for (const t of texts) {
    const m = String(t).match(/(\d+)\s*m\s*(\d+)\s*s|(\d+)m(\d+)s|(\d+):(\d{2})/i);
    if (m) {
      if (m[5] != null) {
        return `${Number(m[5])}m ${String(m[6]).padStart(2, "0")}s`;
      }
      const mins = Number(m[1] || m[3]);
      const secs = Number(m[2] || m[4]);
      return `${mins}m ${String(secs).padStart(2, "0")}s`;
    }
  }
  return null;
}

function renderSpineLegend() {
  return `<div class="call-spine-legend" aria-hidden="true">${SPINE_LEGEND.map(
    ([, label, bg, fg]) =>
      `<span class="call-spine-legend-item"><span class="call-spine-legend-swatch" style="background:${bg};color:${fg}"></span>${esc(label)}</span>`,
  ).join("")}</div>`;
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
  return (
    sc?.callType ||
    meta.callType ||
    record?.result?.confirmed?.callType ||
    record?.callType ||
    "demo"
  );
}

function resolveScorecard(record) {
  return record?.scorecard || record?.result?.scorecard || null;
}

function resolveAnalysisMeta(record) {
  return record?.analysisMeta || record?.result?.analysisMeta || {};
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

function resolveVideoFactsForBundle(draftVf, timelineFacts, storedFacts) {
  const candidates = [draftVf, timelineFacts, storedFacts?.[0]].filter(Boolean);
  if (!candidates.length) return null;

  let videoFacts = candidates[0];
  for (const next of candidates.slice(1)) {
    const hasCam = curveHasCameraData(next?.attendeeCurveJson);
    const curHasCam = curveHasCameraData(videoFacts?.attendeeCurveJson);
    if (hasCam && !curHasCam) {
      videoFacts = {
        ...videoFacts,
        ...next,
        attendeeCurveJson: next.attendeeCurveJson,
        cameraOnPct: next.cameraOnPct ?? videoFacts.cameraOnPct,
        streamKind: next.streamKind || videoFacts.streamKind,
      };
    } else if (!videoFacts?.attendeeCurveJson && next?.attendeeCurveJson) {
      videoFacts = { ...videoFacts, ...next };
    }
  }
  return videoFacts;
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
      rubricVersion: sc.rubricVersion || meta.rubricVersion || "1.0",
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
    if (qipDelta >= 8) parts.push("strong call execution");
    else if (qipDelta <= -8) parts.push("execution below your usual bar");
    else if (qipDelta >= 3) parts.push("solid execution");
    else if (qipDelta <= -3) parts.push("execution lagging your norm");
  }

  if (meddpiccScore != null) {
    if (meddpiccScore >= 70 && qipScore != null && qipScore >= 75) {
      parts.push("deal qualification keeps pace with delivery");
    } else if (meddpiccScore < 45 && qipScore != null && qipScore >= 75) {
      parts.push("the gap is qualification, not delivery");
    } else if (meddpiccScore >= 60 && qipScore != null && qipScore < 55) {
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
    qipScore != null && meddpiccScore != null && qipScore >= 75 && meddpiccScore < 45
      ? "Flawless call on a thin deal. "
      : qipScore != null && meddpiccScore != null && qipScore < 55 && meddpiccScore >= 60
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

const SPINE_SEGMENT_COLORS = {
  slides: ["#EFEBFD", "#4A3BA8"],
  product: ["#E3F5EE", "#0D5C41"],
  cde: ["#E3F5EE", "#0D5C41"],
  customer_screen: ["#E8F0FE", "#1D4FD8"],
  none: ["#F1F3F7", "#5A6B82"],
  intro: ["#EFEBFD", "#4A3BA8"],
  discovery: ["#E8F0FE", "#1D4FD8"],
  demo: ["#E3F5EE", "#0D5C41"],
  pricing: ["#FDF3E2", "#B7791F"],
  objection_handling: ["#FDECEF", "#D6455D"],
  next_steps: ["#E3F5EE", "#0D5C41"],
};

function renderVisualSpine(segments, markers, durationSec) {
  const total = durationSec && Number.isFinite(durationSec) && durationSec > 0
    ? durationSec
    : Math.max(...segments.map((s) => Number(s.endS) || 0), 1);
  let html = '<div class="call-spine-wrap">';
  html += '<div class="call-spine spine" aria-hidden="true">';
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
    html += `<div class="seg" style="left:${left}%;width:${width}%;background:${bg};color:${fg};${radius}">${width > 11 ? esc(label) : ""}</div>`;
  });
  for (const m of markers || []) {
    const at = Number(m.atS);
    if (!Number.isFinite(at)) continue;
    const left = (at / total) * 100;
    html += `<div class="mk" style="left:${left}%"></div><div class="mkl" style="left:${left}%">${esc(markerDisplayLabel(m))}</div>`;
  }
  html += "</div></div>";
  return html;
}

function renderSpineTimeAxis(durationSec) {
  if (!durationSec || !Number.isFinite(durationSec) || durationSec <= 0) return "";
  const ticks = [0, 0.25, 0.5, 0.75, 1].map((f) => formatSegmentTime(durationSec * f));
  return `<div class="call-spine-axis">${ticks.map((t) => `<span>${esc(t)}</span>`).join("")}</div>`;
}

function renderSpineMetrics(videoFacts, scorecard, record, stakeholderRows) {
  const metrics = [];
  const rows = stakeholderRows?.length
    ? stakeholderRows
    : normalizeParticipantStats(videoFacts?.attendeeCurveJson);

  const isSe = (r) => /solution engineer|sales engineer|^se$/i.test(String(r.role || ""));
  const isAe = (r) => /account executive|account manager|^ae$/i.test(String(r.role || ""));
  const isCustomer = (r) =>
    /customer/i.test(String(r.role || "")) || String(r.side || "") === "customer";

  const seRow = rows.find(isSe) || null;
  const aeRow = rows.find(isAe) || null;
  const customerRows = rows.filter((r) => isCustomer(r) && !isSe(r) && !isAe(r));

  if (seRow?.talkPct != null) {
    metrics.push(["SE talk ratio", `${seRow.talkPct}%`, ""]);
  } else {
    const internal = rows.filter((r) => String(r.side || "") === "internal");
    const bestInternal = internal.reduce(
      (best, r) =>
        r.talkPct != null && (best == null || r.talkPct > best.talkPct) ? r : best,
      null,
    );
    if (bestInternal?.talkPct != null) {
      metrics.push(["SE talk ratio", `${bestInternal.talkPct}%`, ""]);
    } else {
      metrics.push(["SE talk ratio", "-", ""]);
    }
  }

  const customerQuestions = parseCustomerQuestions(scorecard, record);
  metrics.push([
    "Customer questions",
    customerQuestions != null ? String(customerQuestions) : "-",
    "",
  ]);

  const monologue = parseLongestMonologue(scorecard);
  metrics.push(["Longest monologue", monologue || "-", monologue ? "warn" : ""]);

  if (seRow?.cameraOnPct != null) {
    metrics.push(["SE camera on", `${Math.round(Number(seRow.cameraOnPct))}%`, ""]);
  } else if (seRow?.cameraOn != null) {
    metrics.push(["SE camera on", seRow.cameraOn ? "On" : "Off", ""]);
  } else if (videoFacts?.cameraOnPct != null) {
    metrics.push(["SE camera on", `${Math.round(Number(videoFacts.cameraOnPct))}%`, ""]);
  } else {
    metrics.push(["SE camera on", "-", ""]);
  }

  if (aeRow?.cameraOnPct != null) {
    metrics.push(["AE camera on", `${aeRow.cameraOnPct}%`, ""]);
  } else if (aeRow?.cameraOn != null) {
    metrics.push(["AE camera on", aeRow.cameraOn ? "On" : "Off", ""]);
  } else {
    metrics.push(["AE camera on", "-", ""]);
  }

  if (customerRows.length) {
    const onCount = customerRows.filter((p) => p.cameraOn === true).length;
    const avgPct =
      customerRows.filter((p) => p.cameraOnPct != null).length > 0
        ? Math.round(
            customerRows
              .filter((p) => p.cameraOnPct != null)
              .reduce((sum, p) => sum + Number(p.cameraOnPct), 0) /
              customerRows.filter((p) => p.cameraOnPct != null).length,
          )
        : null;
    metrics.push([
      "Customer cameras",
      avgPct != null ? `${onCount} on · avg ${avgPct}%` : `${onCount} of ${customerRows.length} on`,
      "",
    ]);
  } else {
    metrics.push(["Customer cameras", "-", ""]);
  }

  return `<div class="call-spine-metrics">${metrics
    .map(
      ([label, value, tone]) =>
        `<div><div class="sub call-spine-metric-label">${esc(label)}</div><div class="call-spine-metric-value num${tone === "warn" ? " call-spine-metric-value--warn" : ""}">${esc(String(value))}</div></div>`,
    )
    .join("")}</div>`;
}

function normalizeParticipantStats(raw) {
  if (!Array.isArray(raw)) return [];
  const seen = new Set();
  return raw
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

function findParticipantStat(statsByName, label) {
  const key = normalizePersonKey(label);
  return statsByName.get(key) ?? statsByName.get(String(label || "").trim().toLowerCase());
}

function buildStakeholderRows(identities, attendees, videoFacts) {
  const statsByName = new Map();
  for (const p of normalizeParticipantStats(videoFacts?.attendeeCurveJson)) {
    statsByName.set(normalizePersonKey(p.name), p);
    statsByName.set(p.name.toLowerCase(), p);
  }

  const rows = [];
  const pushUnique = (name, role, side = "") => {
    const label = String(name || "").trim();
    if (!label) return;
    const key = normalizePersonKey(label);
    const existing = rows.find((r) => r.key === key);
    if (existing) {
      existing.name = preferPersonLabel(existing.name, label);
      return;
    }
    const stat = findParticipantStat(statsByName, label);
    let talkPct = stat?.talkPct ?? null;
    let cameraOnPct = stat?.cameraOnPct ?? null;
    let cameraOn = stat?.cameraOn;
    if (cameraOnPct == null && /solution engineer|^se$/i.test(role)) {
      if (videoFacts?.cameraOnPct != null) {
        cameraOnPct = Math.round(Number(videoFacts.cameraOnPct));
      }
    }
    if (cameraOn == null && cameraOnPct != null) {
      cameraOn = cameraOnPct >= 50;
    }
    rows.push({
      key,
      name: label,
      role,
      side,
      talkPct,
      cameraOn,
      cameraOnPct,
    });
  };

  if (identities?.seIdentity) pushUnique(identities.seIdentity, "Solution Engineer", "internal");
  if (identities?.aeIdentity) pushUnique(identities.aeIdentity, "Account Executive", "internal");
  for (const c of identities?.customerIdentities || []) pushUnique(c, "Customer", "customer");
  for (const a of attendees || []) {
    const role = a.role || "Attendee";
    pushUnique(a.name || a.email, role, /customer/i.test(role) ? "customer" : "");
  }
  return rows;
}

function contextItem(label, valueHtml) {
  return `
    <div class="call-deal-context-item">
      <span class="prep-form-eyebrow">${esc(label)}</span>
      <span class="call-deal-context-value">${valueHtml}</span>
    </div>`;
}

function renderDealContextStrip(ctx) {
  const { deal, account, sequence, momentumStatus, arrLabel, technicalCommit } = ctx;
  const items = [];

  if (deal?.id || deal?.title || account?.name) {
    const dealTitle = deal?.title || DEAL_TYPE_LABELS[deal?.type] || "";
    const dealLabel = account?.name && dealTitle
      ? `${account.name}. ${dealTitle}`
      : account?.name || dealTitle;
    if (dealLabel) {
      const dealLink = deal?.id
        ? `<a href="#deals/${esc(deal.id)}" class="call-deal-link" data-action="open-deal">${esc(dealLabel)}</a>`
        : esc(dealLabel);
      items.push(contextItem("Deal", dealLink));
    }
  }

  const stage = deal?.stage ? STAGE_LABELS[deal.stage] || deal.stage : null;
  if (stage) items.push(contextItem("Stage", `<span class="pill">${esc(stage)}</span>`));

  if (arrLabel) items.push(contextItem("ARR", `<span class="num">${esc(arrLabel)}</span>`));

  const tcStatus = technicalCommit?.status;
  if (tcStatus) {
    items.push(contextItem("TC",
      `<span class="pill ${tcStatusPillClass(tcStatus)}">${esc(tcStatusLabel(tcStatus))}</span>`));
  }

  const aiVal = formatTcFieldValue(technicalCommit?.aiAttach);
  if (aiVal) items.push(contextItem("AI attach", `<span class="pill purple">${esc(aiVal)}</span>`));

  if (momentumStatus && momentumStatus !== "-") {
    const cls = tractionPillClass(momentumStatus);
    items.push(contextItem("Traction",
      `<span class="pill${cls ? ` ${cls}` : ""}">${esc(momentumStatus)}</span>`));
  }

  // Nothing resolved — no empty-dash rail.
  if (!items.length) return "";

  const seqLabel =
    sequence.position && sequence.total
      ? `Call ${sequence.position} of ${sequence.total} on this deal`
      : sequence.total
        ? `${sequence.total} call${sequence.total === 1 ? "" : "s"} on deal`
        : "";

  return `
    <div class="call-deal-context card-wire" aria-label="Deal context">
      <div class="call-deal-context-inner">
        ${items.join("")}
        ${seqLabel ? `<div class="call-deal-context-seq muted">${esc(seqLabel)}</div>` : ""}
      </div>
    </div>`;
}

function renderVerdictStrip(ctx) {
  const {
    qipScore,
    qipDeltaPill,
    meddpiccScore,
    meddpiccFilled,
    momentumStatus,
    confidencePct,
    tensionLine,
    scorecard,
    callType,
  } = ctx;
  const qipNum = qipScore != null ? esc(String(Math.round(qipScore))) : "-";
  const medNum = meddpiccScore != null ? esc(String(meddpiccScore)) : "-";
  const medSub =
    meddpiccFilled != null
      ? `${esc(String(meddpiccFilled))} of ${esc(String(MEDDPICC_FIELD_KEYS.length))} surfaced`
      : "-";
  const traction =
    momentumStatus && momentumStatus !== "-" ? esc(momentumStatus) : "-";
  const tractionClass =
    momentumStatus === "Advancing"
      ? "call-verdict-big--good"
      : momentumStatus === "At risk"
        ? "call-verdict-big--bad"
        : "call-verdict-big--warn";
  const confLabel = confidenceBandLabel(confidencePct);
  // Percentage removed — the band label alone is the signal.
  const confSub = "";
  const profileMeta =
    scorecard?.rubricVersion || scorecard?.callType || callType
      ? `${esc(CALL_TYPE_LABELS[scorecard?.callType || callType] || callType || "call")} profile v${esc(scorecard?.rubricVersion || "1.0")}`
      : "-";

  return `
    <div class="call-verdict-card card-wire" aria-label="Verdict">
      <div class="call-verdict-grid">
        <div class="call-verdict-cell">
          <div class="prep-form-eyebrow">QIP Score</div>
          <div class="call-verdict-value-row">
            <span class="call-verdict-big num call-verdict-big--good">${qipNum}</span>
            <span class="muted call-verdict-denom">/ 100</span>
            ${qipDeltaPill || ""}
          </div>
          <div class="call-verdict-mono">${profileMeta}</div>
        </div>
        <div class="call-verdict-cell">
          <div class="prep-form-eyebrow">Qualification MEDDPICC</div>
          <div class="call-verdict-value-row">
            <span class="call-verdict-big num call-verdict-big--warn">${medNum}</span>
            <span class="muted call-verdict-denom">/ 100</span>
          </div>
          <div class="call-verdict-mono">${medSub}</div>
        </div>
        <div class="call-verdict-cell">
          <div class="prep-form-eyebrow">Overall Call sentiment</div>
          <div class="call-verdict-value-row">
            <span class="call-verdict-mid num ${tractionClass}">${traction}</span>
          </div>
          <div class="call-verdict-mono muted">from call momentum</div>
        </div>
        <div class="call-verdict-cell">
          <div class="prep-form-eyebrow">Confidence to Closure</div>
          <div class="call-verdict-value-row">
            <span class="call-verdict-mid">${esc(confLabel)}</span>
          </div>
          ${confSub ? `<div class="call-verdict-mono">${confSub}</div>` : ""}
        </div>
      </div>
      <div class="call-verdict-tension-band">${renderTensionBand(tensionLine)}</div>
    </div>`;
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

export function formatCallNotesBullets(notes) {
  const text = String(notes || "").trim();
  if (!text) return [];

  const finish = (arr) =>
    arr.map(stripBulletMarkers).filter(Boolean).slice(0, 8);

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

function renderCallNotesBulletsHtml(notes) {
  const bullets = formatCallNotesBullets(notes);
  if (!bullets.length) {
    return '<p class="muted call-notes-empty">No call notes yet. Re-run post-call analysis or edit to add.</p>';
  }
  return `<ul class="call-notes-bullets">${bullets
    .map((b) => `<li>${esc(b)}</li>`)
    .join("")}</ul>`;
}

function renderCallNotesEditPanelHtml(notes) {
  return `
          <p class="muted call-notes-hint">Internal: blunt coaching narrative. Not the customer MoM.</p>
          <textarea id="call-notes-editor" class="call-notes-editor" aria-label="Call notes">${esc(notes || "")}</textarea>`;
}

function renderCallNotesSection(notes) {
  return `
    <section class="call-section call-notes-section card-wire">
      <div class="call-section-body call-section-body--flat">
        <div class="prep-form-eyebrow">Call notes · what happened in this call</div>
        <div id="call-notes-read" class="call-notes-read">${renderCallNotesBulletsHtml(notes)}</div>
        <div id="call-notes-edit" class="call-notes-edit" hidden aria-hidden="true"></div>
        <div class="call-notes-actions">
          <fw-button id="call-notes-edit-btn" color="secondary" fill="outline" size="small">Edit notes</fw-button>
          <fw-button id="call-notes-save" class="call-notes-action--edit" color="secondary" fill="outline" size="small" hidden>Save notes</fw-button>
          <fw-button id="call-notes-cancel" class="call-notes-action--edit" color="secondary" fill="clear" size="small" hidden>Cancel</fw-button>
          <span id="call-notes-save-status" class="call-save-status muted" hidden></span>
        </div>
      </div>
    </section>`;
}

function renderStakeholderSection(identities, attendees, hasVideo, videoFacts, stakeholderRows) {
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
            <div class="call-stakeholder-name">${esc(r.name)}</div>
            <div class="sub call-stakeholder-role">${esc(r.role)}</div>
            <div class="call-stakeholder-signals">${talkPill}<span class="pill ${camCls} call-stakeholder-pill">cam ${camLabel}</span></div>
          </div>
        </div>`;
      })
      .join("")}</div>
    ${
      hasVideo
        ? ""
        : `<p class="muted call-stakeholder-note">Transcript-only call. roles confirmed at intake; camera state is inferred and may read as unknown.</p>`
    }`;
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

  return `
    <section class="call-section call-stakeholder-section card-wire card-wire--tight">
      <div class="call-section-body call-section-body--flat">
        <div class="prep-form-eyebrow">Who was in the room</div>
        ${body}
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
          <span class="call-timeline-marker-label">${esc(m.label || "")}</span>
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
 * derived from transcript timestamps. The transcript spine is display evidence only —
 * `call_flow` and the other video-dependent themes stay not-applicable without video.
 */
export function renderTimelineSection(hasVideo, timeline, durationLabel, opts = {}) {
  const all = timeline?.segments || [];
  const markers = (timeline?.markers || []).slice().sort((a, b) => (a.atS || 0) - (b.atS || 0));
  const videoSegments = all.filter((s) => (s.source || "video") === "video");
  const transcriptSegments = all.filter((s) => s.source === "transcript");
  const usingTranscript = !videoSegments.length && transcriptSegments.length > 0;
  const segments = videoSegments.length ? videoSegments : transcriptSegments;
  const durationSec =
    timeline?.facts?.durationSec ??
    (segments.length ? Math.max(...segments.map((s) => Number(s.endS) || 0)) : null);

  let body = "";
  if (segments.length) {
    body += renderVisualSpine(segments, markers, durationSec);
    body += renderSpineLegend();
    body += renderSpineTimeAxis(durationSec);
    body += renderSpineMetrics(opts.videoFacts, opts.scorecard, opts.record, opts.stakeholderRows);
    if (usingTranscript) {
      body += `<p class="muted call-timeline-note">Built from transcript timestamps, not video. Camera, CDE, call flow and engagement stay unscored; those need Pass 2.</p>`;
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
      "Video was available, but Pass 2 did not produce share segments (Gemini transcript inference or VPS ffmpeg).",
    );
  } else {
    body = renderVideoEmptySection(
      "No timeline",
      "A timeline needs timestamps: either Pass 2 video or a VTT transcript. A plain-text transcript has no clock to place moments on.",
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
      "Pass 5 did not return a commit snapshot for this call. Link a deal and re-run analysis; the whiteboard decomposition lands here.",
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
          <p class="sub call-tc-intro">What this call contributed to the commit. Deltas from the previous call are marked.</p>
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

function renderDealHealthTab(meddpiccDeltas, objections, dealSignal, meddpicc, meddpiccFilled) {
  const deltas = meddpiccDeltas || [];
  const objs = objections || [];
  const reasons = dealSignal?.reasonsJson || dealSignal?.reasons || [];
  const medList = renderMeddpiccList(meddpicc, deltas);

  if (!deltas.length && !objs.length && !reasons.length && !medList) {
    return renderPhase2TabEmpty(
      "No deal-health movement yet",
      "Pass 4 MEDDPICC deltas, Pass 7 objections, and Pass 8 traction reasons appear here after analysis on a linked deal.",
    );
  }

  const objHtml = objs.length
    ? `<div class="card-wire card-wire--tight call-health-side-card">
        <div class="prep-form-eyebrow">Objections</div>
        ${objs
          .map(
            (o, i) => `<div class="call-objection-wire-row${i < objs.length - 1 ? " call-objection-wire-row--border" : ""}">
              <div class="call-objection-wire-text">${esc(o.objectionText || "")}</div>
              <div class="sub">${esc(o.handling || "-")} · <span class="${o.landed ? "call-landed" : "call-open"}">${o.landed ? "landed" : "open"}</span></div>
            </div>`,
          )
          .join("")}
      </div>`
    : "";

  const tractionClass =
    dealSignal?.lean === "hot" || dealSignal?.lean === "Hot"
      ? "green"
      : dealSignal?.lean === "cold" || dealSignal?.lean === "Cold"
        ? "red"
        : "amber";
  const tractionHtml = reasons.length
    ? `<div class="card-wire card-wire--tight call-health-traction-card call-health-traction-card--${tractionClass}">
        <div class="prep-form-eyebrow">Traction${dealSignal?.lean != null ? ` · ${esc(String(dealSignal.lean))}` : ""}</div>
        <div class="call-traction-bullets">${reasons.map((r) => `· ${esc(typeof r === "string" ? r : r.reason || JSON.stringify(r))}`).join("<br>")}</div>
      </div>`
    : "";

  return `<div class="call-health-tab call-health-tab--wireframe">
    <div class="call-health-grid">
      <div class="card-wire card-wire--tight">
        <h3>MEDDPICC</h3>
        <p class="sub">${meddpiccFilled != null ? `${esc(String(meddpiccFilled))} of ${esc(String(MEDDPICC_FIELD_KEYS.length))} surfaced on this call` : "Deal qualification"}</p>
        <div class="call-medp-list">${medList || '<p class="muted">No MEDDPICC surfaced yet. Run Pass 4 qualification on a linked deal.</p>'}</div>
      </div>
      <div class="call-health-aside">${objHtml}${tractionHtml}</div>
    </div>
  </div>`;
}

/**
 * Resolve MoM for the Minutes tab — prefer stored momDrafts, then Pass 7 blob.
 * Compose Kaia-style sections from structured fields; fall back to flat body + follow-ups.
 */
export function resolveMinutesViewModel(record, momDraft, followUps) {
  const mom =
    momDraft ||
    record?.result?.summarise?.momDraft ||
    record?.result?.momDraft ||
    null;
  const fus = followUps || record?.result?.summarise?.followUps || [];

  const outcome = (mom?.outcome || "").trim() || (mom?.editedBody || mom?.draftBody || "").trim();
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

  return {
    mom,
    outcome,
    keyPoints,
    actionItems,
    draftBody: mom?.editedBody || mom?.draftBody || "",
    sentAt: mom?.sentAt || null,
  };
}

function ownerLabel(owner) {
  const map = { se: "SE", ae: "AE", customer: "Customer" };
  return map[owner] || owner || "";
}

export function renderMinutesTab(record, opts = {}) {
  const view = resolveMinutesViewModel(record, opts.momDraft, opts.followUps);
  const { outcome, keyPoints, actionItems, draftBody, sentAt } = view;

  if (!outcome && !keyPoints.length && !actionItems.length && !draftBody.trim()) {
    return renderPhase2TabEmpty(
      "No minutes draft yet",
      "Pass 7 did not return a MoM for this call, or summarisation was skipped. Re-run analysis to generate one.",
    );
  }

  const hdr = record?.analysis?.callHeader || record?.result?.analysis?.callHeader || {};
  const title = hdr.title || record?.title || "Call recap";
  const dateLabel = callDateLabel(record);

  const nextStepsHtml = actionItems.length
    ? `<br><br><b>Next steps</b><br>${actionItems
        .map((a) => {
          const owner = ownerLabel(a.owner);
          const due = a.dueDate ? `. <i>${esc(owner || "Owner")}, by ${esc(a.dueDate)}</i>` : owner ? `. <i>${esc(owner)}</i>` : "";
          return `· ${esc(a.text)}${due}`;
        })
        .join("<br>")}`
    : "";

  const keyPointsHtml = keyPoints.length
    ? `<br><br><b>What we covered</b><br>${keyPoints.map((kp) => `${esc(kp.title)}${kp.detail ? `: ${esc(kp.detail)}` : ""}`).join("<br>")}`
    : "";

  const bodyText = outcome.trim() || draftBody.trim();
  const recapHtml = `${esc(bodyText)}${keyPointsHtml}${nextStepsHtml}`;

  return `
    <div class="call-mom-panel call-mom-panel--wireframe">
      <div class="call-mom-wire-head">
        <h3>Minutes of meeting</h3>
        <span class="pill blue">Customer facing · never auto-sends</span>
      </div>
      <p class="sub call-mom-wire-sub">Drafted from commitments made aloud, with timestamps kept underneath.</p>
      <div class="call-mom-wire-body">
        <div class="call-mom-wire-title">${esc(title)}${dateLabel ? `. ${esc(dateLabel)}` : ""}</div>
        ${recapHtml}
      </div>
      <details class="call-mom-edit-wrap">
        <summary>Edit draft</summary>
        <textarea id="call-mom-editor" class="call-mom-editor" aria-label="Minutes draft">${esc(draftBody || outcome)}</textarea>
        <div class="call-mom-actions">
          <fw-button id="call-mom-save" color="primary" size="small">Save draft</fw-button>
          <span id="call-mom-save-status" class="call-save-status muted" hidden></span>
          ${sentAt ? `<span class="muted">Sent ${esc(formatDateTime(sentAt))}</span>` : '<span class="muted">Not sent yet</span>'}
        </div>
      </details>
    </div>`;
}

function renderProductSignalTab(productGaps, whatWorks, clusterLabels) {
  const gaps = productGaps || [];
  const wins = whatWorks || [];
  if (!gaps.length && !wins.length) {
    return `<p class="muted">No product gaps or wins recorded for this call yet. Re-run post-call analysis. Pass 6 extracts gaps from the transcript and call notes.</p>`;
  }

  const gapRows = gaps.map((g) => {
    const cluster = g.clusterId ? clusterLabels[g.clusterId] : null;
    const typeLabel = g.gapType === "enablement_gap" ? "Enablement gap" : "Real gap";
    const typeCls = g.gapType === "enablement_gap" ? "amber" : "red";
    const statusLabel = g.status === "published" ? "Roadmap Q3" : "Triage";
    const ts = g.atS != null ? formatSegmentTime(g.atS) : null;
    return `<div class="call-product-unified-row">
      <div class="call-product-unified-main">
        <div class="call-product-unified-title">${esc(g.title || g.productArea || "Product gap")}</div>
        ${g.verbatim ? `<div class="ev bad"><div class="ts">${ts ? esc(ts) : "-"}</div>${esc(g.verbatim)}</div>` : ""}
        <div class="sub call-product-unified-meta">${esc(formatProductAreaLabel(g))}${cluster ? ` · ${esc(cluster)}` : ""} · <span class="pill ${typeCls}">${esc(typeLabel)}</span></div>
      </div>
      <span class="pill blue">${esc(statusLabel)}</span>
    </div>`;
  });

  const winRows = wins.map((w) => {
    const ts = w.atS != null ? formatSegmentTime(w.atS) : null;
    return `<div class="call-product-unified-row call-product-unified-row--win">
      <div class="call-product-unified-main">
        <div class="call-product-unified-title">${esc(w.title || w.productArea || "What landed")}</div>
        ${w.verbatim ? `<div class="ev good"><div class="ts">${ts ? esc(ts) : "-"}</div>${esc(w.verbatim)}</div>` : `<div class="sub">${esc(w.summary || "")}</div>`}
      </div>
      <span class="pill green">What's working</span>
    </div>`;
  });

  return `<div class="call-product-signal-tab call-product-signal-tab--wireframe">
    <h3>Raised on this call</h3>
    <p class="sub">Classified against the taxonomy, clustered on the verbatim</p>
    ${[...gapRows, ...winRows].join("")}
  </div>`;
}

function formatProductAreaLabel(gap) {
  const area = String(gap.productArea || "other").replace(/_/g, " ");
  if (!gap.subArea || gap.subArea === "other") return area;
  return `${area} › ${String(gap.subArea).replace(/_/g, " ")}`;
}

function renderCallTabs(record, scorecard, analysisMeta, tabs = {}) {
  const qipHtml = scorecard?.lines?.length
    ? renderQipScorecard(scorecard, analysisMeta, { context: "call-record" })
    : `<div class="call-tab-empty"><h4>No QIP scorecard</h4><p>Re-run post-call analysis to populate the scorecard.</p></div>`;

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
        tabs.dealSignal,
        tabs.meddpicc,
        tabs.meddpiccFilled,
      )}</div>`,
    },
    {
      id: "signal",
      label: "Product signal",
      body: `<div class="call-tab-panel-inner">${renderProductSignalTab(
        tabs.productGaps,
        tabs.whatWorks,
        tabs.clusterLabels || {},
      )}</div>`,
    },
    {
      id: "minutes",
      label: "Minutes",
      body: `<div class="call-tab-panel-inner">${renderMinutesTab(record, {
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

/** @param {Record<string, Promise<any>>} tasks */
async function promiseAllValues(tasks) {
  const entries = await Promise.all(
    Object.entries(tasks).map(async ([key, task]) => [key, await task]),
  );
  return Object.fromEntries(entries);
}

/** Immediate shell while Firestore enrichments load. */
function renderCallLoadingShell(record) {
  const analysis = record?.analysis || record?.result?.analysis || {};
  const title = analysis.callHeader?.title || record?.title || "Call";
  return `
    <div class="lifecycle-detail call-record call-record--loading">
      <div class="call-record-page">
        <header class="call-record-hero">
          <h1 class="call-record-title">${esc(title)}</h1>
        </header>
        ${renderLoadingPanel("Loading call record…")}
      </div>
    </div>`;
}

async function loadCallBundle(session, record) {
  const email = session.email;
  const store = getStore();
  let dealId = resolveDealId(record);
  const resultBlob = record.result || {};
  const pass6 = record.pass6 || resultBlob.pass6 || null;
  const draftVf = resultBlob.videoFacts;
  const draftTimeline = resultBlob.timeline;
  const summarise = resultBlob.summarise || {};

  const parallel = await promiseAllValues({
    domainCall:
      !dealId && store.getPostCall
        ? safeEnrich("getPostCall", () => store.getPostCall(record.id), null)
        : Promise.resolve(null),
    productGaps:
      !pass6?.productGaps?.length && store.listProductGapsByPostCall
        ? safeEnrich("listProductGapsByPostCall", () => store.listProductGapsByPostCall(record.id), [])
        : Promise.resolve([]),
    whatWorks:
      !pass6?.whatWorks?.length && store.listWhatWorksByPostCall
        ? safeEnrich("listWhatWorksByPostCall", () => store.listWhatWorksByPostCall(record.id), [])
        : Promise.resolve([]),
    storedFacts:
      store.listVideoFactsByCall
        ? safeEnrich("listVideoFactsByCall", () => store.listVideoFactsByCall(record.id), [])
        : Promise.resolve([]),
    timelineSegments:
      !draftVf?.segments?.length && !draftTimeline?.segments?.length && store.listTimelineSegmentsByCall
        ? safeEnrich("listTimelineSegmentsByCall", () => store.listTimelineSegmentsByCall(record.id), [])
        : Promise.resolve([]),
    timelineMarkers:
      !draftTimeline?.markers?.length && store.listTimelineMarkersByCall
        ? safeEnrich("listTimelineMarkersByCall", () => store.listTimelineMarkersByCall(record.id), [])
        : Promise.resolve([]),
    tcDeltas:
      !resultBlob.tcDeltas?.length && store.listTcDeltasByCall
        ? safeEnrich("listTcDeltasByCall", () => store.listTcDeltasByCall(record.id), [])
        : Promise.resolve([]),
    meddpiccDeltas: store.listMeddpiccDeltasByCall
      ? safeEnrich("listMeddpiccDeltasByCall", () => store.listMeddpiccDeltasByCall(record.id), [])
      : Promise.resolve([]),
    objections:
      !summarise.objections?.length && store.listObjectionsByCall
        ? safeEnrich("listObjectionsByCall", () => store.listObjectionsByCall(record.id), [])
        : Promise.resolve([]),
    followUps:
      !summarise.followUps?.length && store.listFollowUpsByCall
        ? safeEnrich("listFollowUpsByCall", () => store.listFollowUpsByCall(record.id), [])
        : Promise.resolve([]),
    momDrafts:
      !summarise.momDraft && !resultBlob.momDraft && store.listMomDraftsByCall
        ? safeEnrich("listMomDraftsByCall", () => store.listMomDraftsByCall(record.id), [])
        : Promise.resolve([]),
    dealSignals: store.listDealSignalsByCall
      ? safeEnrich("listDealSignalsByCall", () => store.listDealSignalsByCall(record.id), [])
      : Promise.resolve([]),
  });

  if (!dealId && parallel.domainCall?.dealId) dealId = parallel.domainCall.dealId;

  // Tier 3 — the record never got a dealId stamped (dual-write skipped, or confirm
  // had no deals on the account). Recover it from the account's deal list.
  if (!dealId) {
    const accountId =
      record?.result?.confirmed?.accountId ||
      record?.result?.resolve?.account?.accountId ||
      parallel.domainCall?.accountId ||
      null;
    if (accountId && store.listDealsByAccount) {
      const ownerId = record?.ownerId || session?.userId || undefined;
      const accountDeals = await safeEnrich(
        "listDealsForAccount",
        () => listDealsForAccount(accountId, ownerId),
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
  let technicalCommit = resultBlob.technicalCommit || null;

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
  const scorecard = resolveScorecard(record);
  const analysisMeta = resolveAnalysisMeta(record);
  const composite = scorecard?.lines?.length
    ? typeComposite(
        [{
          callType: scorecard.callType || callType,
          rubricVersion: scorecard.rubricVersion || analysisMeta.rubricVersion || "1.0",
          lines: scorecard.lines,
          provisional: scorecard.provisional ?? analysisMeta.provisional,
          confidence: scorecard.confidence ?? analysisMeta.analysisConfidence,
        }],
        scorecard.callType || callType,
        { includeIneligible: true },
      )
    : null;
  const qipScore = composite?.score ?? null;
  const qipLabel = composite ? formatTypeComposite(composite) : null;
  const deltaInfo = qipDeltaForType(email, callType, qipScore, record.id);
  const analysis = record.analysis || resultBlob.analysis || {};
  const momentumStatus = analysis?.momentum?.status || "-";
  const confRaw = scorecard?.confidence ?? analysisMeta.analysisConfidence;
  const confidencePct = confRaw != null ? Math.round(confRaw * 100) : null;

  let productGaps = pass6?.productGaps?.length ? pass6.productGaps : parallel.productGaps;
  let whatWorks = pass6?.whatWorks?.length ? pass6.whatWorks : parallel.whatWorks;

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
  if (dealId && !deal?.accountId) {
    const probe = await safeEnrich("getDeal:probe", () => getDeal(dealId), null);
    if (!probe?.accountId) navigableDealId = null;
  }

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

function renderCallRecord(bundle) {
  const { record, callTypeLabel, account } = bundle;
  const analysis = record.analysis || record.result?.analysis || {};
  const hdr = analysis.callHeader || {};
  const title = hdr.title || record.title || "Call";
  const attendeeCount = Array.isArray(hdr.attendees) ? hdr.attendees.length : null;
  const durationLabel = parseDurationMinutesLabel(record, bundle.timeline);
  const stakeholderRows = buildStakeholderRows(bundle.identities, bundle.attendees, bundle.videoFacts);
  const metaBits = [
    account?.id
      ? `<a href="#accounts/${esc(account.id)}" class="call-meta-link">${esc(account.name)}</a>`
      : account?.name
        ? esc(account.name)
        : "",
    callDateLabel(record),
  ].filter(Boolean);

  return `
    <div class="lifecycle-detail call-record">
      <div class="call-record-page">
        <header class="call-record-hero">
          <fw-button class="lifecycle-back call-record-back" color="secondary" fill="clear" data-action="back">← All calls</fw-button>
          <div class="call-record-hero-main">
            <div class="call-record-title-row">
              <h1 class="call-record-title">${esc(title)}</h1>
              ${callTypePill(callTypeLabel)}
            </div>
            ${metaBits.length ? `<p class="call-record-meta-line muted">${metaBits.join(" · ")}</p>` : ""}
          </div>
          <div class="call-record-header-actions">
            <fw-button color="secondary" fill="outline" size="small" data-action="new-postcall">New post call</fw-button>
            <fw-button color="secondary" fill="outline" size="small" data-action="open-deal" ${bundle.deal?.id || bundle.dealId ? "" : "disabled"}>Open deal</fw-button>
          </div>
        </header>
        ${renderDealContextStrip(bundle)}
        ${renderVerdictStrip(bundle)}
        <div class="call-record-notes-row">
          ${renderCallNotesSection(bundle.callNotes)}
          ${renderStakeholderSection(bundle.identities, bundle.attendees, bundle.hasVideo, bundle.videoFacts, stakeholderRows)}
        </div>
        ${renderTimelineSection(bundle.hasVideo, bundle.timeline, durationLabel, {
          videoFacts: bundle.videoFacts,
          scorecard: bundle.scorecard,
          record,
          stakeholderRows,
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
          momDraft: bundle.momDraft,
          dealSignal: bundle.dealSignal,
          deal: bundle.deal,
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

  let notesEditor = container.querySelector("#call-notes-editor");
  const notesRead = container.querySelector("#call-notes-read");
  const notesEditPanel = container.querySelector("#call-notes-edit");
  const notesEditBtn = container.querySelector("#call-notes-edit-btn");
  const notesCancelBtn = container.querySelector("#call-notes-cancel");
  const notesSave = container.querySelector("#call-notes-save");
  const notesStatus = container.querySelector("#call-notes-save-status");

  const mountNotesEditor = () => {
    if (!notesEditPanel || notesEditor) return notesEditor;
    notesEditPanel.innerHTML = renderCallNotesEditPanelHtml(bundle.callNotes);
    notesEditor = notesEditPanel.querySelector("#call-notes-editor");
    return notesEditor;
  };

  const setNotesEditMode = (editing) => {
    if (editing) mountNotesEditor();
    if (notesRead) {
      notesRead.hidden = editing;
      notesRead.setAttribute("aria-hidden", editing ? "true" : "false");
    }
    if (notesEditPanel) {
      notesEditPanel.hidden = !editing;
      notesEditPanel.setAttribute("aria-hidden", editing ? "false" : "true");
      notesEditPanel.classList.toggle("call-notes-edit--open", editing);
    }
    if (notesEditBtn) {
      notesEditBtn.hidden = editing;
      if (editing) notesEditBtn.setAttribute("hidden", "");
      else notesEditBtn.removeAttribute("hidden");
    }
    for (const el of [notesSave, notesCancelBtn]) {
      if (!el) continue;
      el.hidden = !editing;
      if (!editing) el.setAttribute("hidden", "");
      else el.removeAttribute("hidden");
    }
  };

  setNotesEditMode(false);

  notesEditBtn?.addEventListener("fwClick", () => setNotesEditMode(true));
  notesEditBtn?.addEventListener("click", () => setNotesEditMode(true));
  notesCancelBtn?.addEventListener("fwClick", () => {
    if (notesEditor) notesEditor.value = bundle.callNotes || "";
    setNotesEditMode(false);
  });
  notesCancelBtn?.addEventListener("click", () => {
    if (notesEditor) notesEditor.value = bundle.callNotes || "";
    setNotesEditMode(false);
  });

  const saveNotes = async () => {
    const notes = notesEditor?.value ?? "";
    const updated = await updatePostCallAnalysis(email, recordId, (rec) => {
      rec.analysis = { ...(rec.analysis || {}), callNotes: notes };
      if (rec.result) {
        rec.result = {
          ...rec.result,
          analysis: { ...(rec.result.analysis || {}), callNotes: notes },
        };
      }
      return rec;
    });
    if (updated) {
      bundle.callNotes = notes;
      if (notesRead) notesRead.innerHTML = renderCallNotesBulletsHtml(notes);
      setNotesEditMode(false);
      flashSaveStatus(notesStatus, "Saved");
    } else {
      flashSaveStatus(notesStatus, "Could not save", true);
    }
  };

  notesSave?.addEventListener("fwClick", () => { void saveNotes(); });
  notesSave?.addEventListener("click", () => { void saveNotes(); });

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

  if (opts.expandThemeKey) {
    const themeKey = opts.expandThemeKey;
    window.requestAnimationFrame(() => {
      const lines = container.querySelectorAll(".qip-line");
      for (const line of lines) {
        const name = line.querySelector(".qip-theme-name")?.textContent?.trim().toLowerCase();
        const keyLabel = themeKey.replace(/_/g, " ").toLowerCase();
        if (name && (name === keyLabel || line.querySelector(`[data-theme-key="${themeKey}"]`))) {
          if (line.tagName === "DETAILS") line.open = true;
          line.scrollIntoView({ block: "nearest", behavior: "smooth" });
          break;
        }
      }
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
        ? getPostCallAnalysis(activeSession.email, opts.callId)
        : null;
    const resolvedRecord =
      record || (await getPostCallForSession(activeSession, opts.callId, ownerEmail));
    if (!resolvedRecord) {
      container.innerHTML = renderCallEmptyState("Call not found. It may have been cleared from this browser.");
      return;
    }

    container.innerHTML = renderCallLoadingShell(resolvedRecord);
    const bundle = await loadCallBundle(activeSession, resolvedRecord);
    if (opts.shouldApply && !opts.shouldApply()) return;
    container.innerHTML = renderCallRecord(bundle);
    wireCallRecord(container, activeSession, bundle, opts);
  } catch (err) {
    console.error("[call-view] failed to render call:", err);
    container.innerHTML = renderCallEmptyState(
      "Could not load this call right now. Refresh the page or try again in a moment.",
    );
  }
}

export { resolveDealId, resolveCallType, qipDeltaForType, buildVerdictTension };
