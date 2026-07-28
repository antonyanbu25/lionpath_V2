/**
 * Call record view — spec §11.4 (#calls/:id).
 */

import {
  getPostCallAnalysis,
  listPostCallAnalyses,
  updatePostCallAnalysis,
} from "./history.js";
import { getPostCallForSession } from "./domain/se-access-service.js";
import { dedupeAnalysesByCallIdentity } from "./call-identity.js";
import { formatTypeComposite, isEligibleForAggregate, typeComposite } from "./quality-score.js";
import { renderQipScorecard } from "./postcall.js";
import { getDeal, DEAL_TYPE_LABELS } from "./domain/deal-service.js";
import { getStore } from "./domain/store.js";
import { computeMeddpiccScore, resolveDealMeddpicc, MEDDPICC_FIELD_KEYS, MEDDPICC_FIELD_LABELS } from "./domain/contact-service.js";
import { sessionUserId, withEffectiveUserId } from "./domain/session.js";
import { syncSessionWithDomainStore } from "./auth.js";
import { STAGE_LABELS } from "./domain/types.js";
import { renderCallProductGapRow } from "./product-signal-view.js";
import { esc } from "./shared.js";

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
  if (!ts) return "—";
  return new Date(ts).toLocaleDateString(undefined, {
    month: "short",
    day: "numeric",
    year: "numeric",
  });
}

function formatDateTime(ts) {
  if (!ts) return "—";
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
  gap: "Gap",
  objection: "Objection",
  win: "Win",
  weak_cta: "Weak close",
};

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
  if (pct == null) return "—";
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
  const split = text.split(" — ");
  if (split.length >= 2) {
    return `<b class="call-verdict-tension-lead">${esc(split[0])}.</b> ${esc(split.slice(1).join(" — "))}`;
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

  if (confidencePct != null && confidencePct < 70) {
    parts.push("read scores with lower confidence — sparse evidence");
  }

  if (!parts.length) {
    return "Scores tell different stories — use the scorecard evidence before coaching or forecasting.";
  }

  const lead =
    qipScore != null && meddpiccScore != null && qipScore >= 75 && meddpiccScore < 45
      ? "Flawless call on a thin deal — "
      : qipScore != null && meddpiccScore != null && qipScore < 55 && meddpiccScore >= 60
        ? "Qualified deal, weak call — "
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
  return labels[status] || status || "—";
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

function renderMeddpiccList(meddpicc) {
  if (!meddpicc) return "";
  return MEDDPICC_FIELD_KEYS.map((key, i) => {
    const slot = meddpicc[key];
    const filled = slot?.value && slot.status !== "unknown";
    const label = MEDDPICC_FIELD_LABELS[key] || key;
    const value = filled ? slot.value : "Not surfaced";
    return `<div class="call-medp-row${i < MEDDPICC_FIELD_KEYS.length - 1 ? " call-medp-row--border" : ""}">
      <span class="call-medp-dot${filled ? " call-medp-dot--on" : ""}" aria-hidden="true"></span>
      <div>
        <div class="call-medp-label">${esc(label)}</div>
        <div class="sub call-medp-value${filled ? "" : " muted"}">${esc(value)}</div>
      </div>
    </div>`;
  }).join("");
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
  let html = '<div class="call-spine spine" aria-hidden="true">';
  segments.forEach((seg, i) => {
    const start = Number(seg.startS) || 0;
    const end = Number(seg.endS) || start;
    const left = (start / total) * 100;
    const width = Math.max(((end - start) / total) * 100, 0.5);
    const type = seg.segmentType || "none";
    const [bg, fg] = SPINE_SEGMENT_COLORS[type] || SPINE_SEGMENT_COLORS.none;
    const label = seg.label || segmentTypeLabel(type);
    const radius =
      i === 0 ? "border-radius:6px 0 0 6px;" : i === segments.length - 1 ? "border-radius:0 6px 6px 0;" : "";
    html += `<div class="seg" style="left:${left}%;width:${width}%;background:${bg};color:${fg};${radius}">${width > 11 ? esc(label) : ""}</div>`;
  });
  for (const m of markers || []) {
    const at = Number(m.atS);
    if (!Number.isFinite(at)) continue;
    const left = (at / total) * 100;
    html += `<div class="mk" style="left:${left}%"></div><div class="mkl" style="left:${left}%">${esc(m.label || MARKER_LABELS[m.kind] || m.kind || "")}</div>`;
  }
  html += "</div>";
  return html;
}

function renderSpineTimeAxis(durationSec) {
  if (!durationSec || !Number.isFinite(durationSec) || durationSec <= 0) return "";
  const ticks = [0, 0.25, 0.5, 0.75, 1].map((f) => formatSegmentTime(durationSec * f));
  return `<div class="call-spine-axis">${ticks.map((t) => `<span>${esc(t)}</span>`).join("")}</div>`;
}

function renderSpineMetrics(videoFacts, scorecard) {
  const metrics = [];
  if (videoFacts?.cameraOnPct != null) {
    metrics.push(["SE camera on", `${Math.round(Number(videoFacts.cameraOnPct))}%`]);
  }
  if (videoFacts?.shareOnPct != null) {
    metrics.push(["Screen share", `${Math.round(Number(videoFacts.shareOnPct))}%`]);
  }
  const engagement = (scorecard?.lines || []).find((l) => l.themeKey === "customer_engagement");
  if (engagement?.score != null && engagement.applicable) {
    metrics.push(["Customer engagement", `${esc(String(engagement.score))}%`]);
  }
  if (!metrics.length) return "";
  return `<div class="call-spine-metrics">${metrics
    .map(
      ([label, value]) =>
        `<div><div class="sub call-spine-metric-label">${esc(label)}</div><div class="call-spine-metric-value num">${value}</div></div>`,
    )
    .join("")}</div>`;
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
  const dealTitle = deal?.title || DEAL_TYPE_LABELS[deal?.type] || "—";
  const dealLabel = account?.name ? `${account.name} — ${dealTitle}` : dealTitle;
  const dealLink = deal?.id
    ? `<a href="#deals/${esc(deal.id)}" class="call-deal-link" data-action="open-deal">${esc(dealLabel)}</a>`
    : esc(dealLabel);
  const stage = deal?.stage ? STAGE_LABELS[deal.stage] || deal.stage : "—";
  const stageHtml = stage !== "—" ? `<span class="pill">${esc(stage)}</span>` : `<span class="muted">—</span>`;
  const tractionClass = tractionPillClass(momentumStatus);
  const traction =
    momentumStatus && momentumStatus !== "—"
      ? `<span class="pill${tractionClass ? ` ${tractionClass}` : ""}">${esc(momentumStatus)}</span>`
      : '<span class="muted">—</span>';
  const arrHtml = arrLabel ? `<span class="num">${esc(arrLabel)}</span>` : '<span class="muted">—</span>';
  const tcStatus = technicalCommit?.status;
  const tcHtml = tcStatus
    ? `<span class="pill ${tcStatusPillClass(tcStatus)}">${esc(tcStatusLabel(tcStatus))}</span>`
    : '<span class="muted">—</span>';
  const aiVal = formatTcFieldValue(technicalCommit?.aiAttach);
  const aiHtml = aiVal
    ? `<span class="pill purple">${esc(aiVal)}</span>`
    : '<span class="muted">—</span>';
  const seqLabel =
    sequence.position && sequence.total
      ? `Call ${sequence.position} of ${sequence.total} on this deal`
      : sequence.total
        ? `${sequence.total} call${sequence.total === 1 ? "" : "s"} on deal`
        : "—";

  return `
    <div class="call-deal-context card-wire" aria-label="Deal context">
      <div class="call-deal-context-inner">
        ${contextItem("Deal", dealLink)}
        ${contextItem("Stage", stageHtml)}
        ${contextItem("ARR", arrHtml)}
        ${contextItem("TC", tcHtml)}
        ${contextItem("AI attach", aiHtml)}
        ${contextItem("Traction", traction)}
        <div class="call-deal-context-seq muted">${esc(seqLabel)}</div>
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
  const qipNum = qipScore != null ? esc(String(Math.round(qipScore))) : "—";
  const medNum = meddpiccScore != null ? esc(String(meddpiccScore)) : "—";
  const medSub =
    meddpiccFilled != null
      ? `${esc(String(meddpiccFilled))} of ${esc(String(MEDDPICC_FIELD_KEYS.length))} surfaced`
      : "—";
  const traction =
    momentumStatus && momentumStatus !== "—" ? esc(momentumStatus) : "—";
  const tractionClass =
    momentumStatus === "Advancing"
      ? "call-verdict-big--good"
      : momentumStatus === "At risk"
        ? "call-verdict-big--bad"
        : "call-verdict-big--warn";
  const confLabel = confidenceBandLabel(confidencePct);
  const confSub =
    confidencePct != null ? `${esc(String(confidencePct))}% clean signals` : "—";
  const profileMeta =
    scorecard?.rubricVersion || scorecard?.callType || callType
      ? `${esc(CALL_TYPE_LABELS[scorecard?.callType || callType] || callType || "call")} profile v${esc(scorecard?.rubricVersion || "1.0")}`
      : "—";

  return `
    <div class="call-verdict-card card-wire" aria-label="Verdict">
      <div class="call-verdict-grid">
        <div class="call-verdict-cell">
          <div class="prep-form-eyebrow">QIP · the SE</div>
          <div class="call-verdict-value-row">
            <span class="call-verdict-big num call-verdict-big--good">${qipNum}</span>
            <span class="muted call-verdict-denom">/ 100</span>
            ${qipDeltaPill || ""}
          </div>
          <div class="call-verdict-mono">${profileMeta}</div>
        </div>
        <div class="call-verdict-cell">
          <div class="prep-form-eyebrow">MEDPICC · the deal</div>
          <div class="call-verdict-value-row">
            <span class="call-verdict-big num call-verdict-big--warn">${medNum}</span>
            <span class="muted call-verdict-denom">/ 100</span>
          </div>
          <div class="call-verdict-mono">${medSub}</div>
        </div>
        <div class="call-verdict-cell">
          <div class="prep-form-eyebrow">Traction</div>
          <div class="call-verdict-value-row">
            <span class="call-verdict-mid num ${tractionClass}">${traction}</span>
          </div>
          <div class="call-verdict-mono muted">from call momentum</div>
        </div>
        <div class="call-verdict-cell">
          <div class="prep-form-eyebrow">Confidence</div>
          <div class="call-verdict-value-row">
            <span class="call-verdict-mid">${esc(confLabel)}</span>
          </div>
          <div class="call-verdict-mono">${confSub}</div>
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

function renderCallNotesSection(notes) {
  return `
    <section class="call-section call-notes-section card-wire">
      <div class="call-section-body call-section-body--flat">
        <div class="prep-form-eyebrow">Call notes · what happened in this call</div>
        <p class="muted call-notes-hint">Internal — blunt coaching narrative. Not the customer MoM.</p>
        <textarea id="call-notes-editor" class="call-notes-editor" aria-label="Call notes">${esc(notes || "")}</textarea>
        <div class="call-notes-actions">
          <fw-button id="call-notes-save" color="secondary" fill="outline" size="small">Save notes</fw-button>
          <span id="call-notes-save-status" class="call-save-status muted" hidden></span>
        </div>
      </div>
    </section>`;
}

function renderStakeholderSection(identities, attendees, hasVideo) {
  const rows = [];
  const pushUnique = (name, role, meta = "") => {
    const label = String(name || "").trim();
    if (!label) return;
    const key = label.toLowerCase();
    if (rows.some((r) => r.key === key)) return;
    rows.push({ key, name: label, role, meta });
  };
  if (identities?.seIdentity) pushUnique(identities.seIdentity, "Solution Engineer", "Host");
  if (identities?.aeIdentity) pushUnique(identities.aeIdentity, "Account Executive");
  for (const c of identities?.customerIdentities || []) pushUnique(c, "Customer");
  for (const a of attendees || []) {
    pushUnique(a.name || a.email, a.role || "Attendee");
  }

  let body;
  if (rows.length) {
    body = `<div class="call-stakeholder-cards">${rows
      .map((r, i) => {
        const avCls = stakeholderAvatarClass(r.role);
        return `<div class="call-stakeholder-card${i < rows.length - 1 ? " call-stakeholder-card--border" : ""}">
          <div class="call-stakeholder-avatar call-stakeholder-avatar--${avCls || "neutral"}">${esc(stakeholderInitials(r.name))}</div>
          <div class="call-stakeholder-main">
            <div class="call-stakeholder-name">${esc(r.name)}</div>
            <div class="sub call-stakeholder-role">${esc(r.role)}</div>
            ${r.meta ? `<div class="sub call-stakeholder-meta">${esc(r.meta)}</div>` : ""}
          </div>
        </div>`;
      })
      .join("")}</div>
    ${
      hasVideo
        ? `<p class="muted call-stakeholder-note">Talk-share / camera curves from Pass 2 attach when video sampling succeeds.</p>`
        : `<p class="muted call-stakeholder-note">Transcript-only call — roles confirmed at intake.</p>`
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
    body += renderSpineTimeAxis(durationSec);
    body += renderSpineMetrics(opts.videoFacts, opts.scorecard);
    body += renderTimelineSpine(segments, markers);
    if (usingTranscript) {
      body += `<p class="muted call-timeline-note">Built from transcript timestamps, not video. Camera, CDE, call flow and engagement stay unscored — those need Pass 2.</p>`;
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
      "A timeline needs timestamps — either Pass 2 video or a VTT transcript. A plain-text transcript has no clock to place moments on.",
    );
  }

  const title = durationLabel
    ? `How the ${durationLabel} went`
    : "How the call went";
  const subtitle = usingTranscript
    ? "Conversation phases from the transcript clock — evidence only, not scored"
    : "From the screen-share track — feeds call flow scoring directly";

  return `
    <section class="call-section call-timeline-section card-wire">
      <div class="call-section-body call-section-body--flat">
        <div class="call-timeline-head">
          <h2 class="call-timeline-title">${esc(title)}</h2>
          <span class="muted call-timeline-sub">${esc(subtitle)}</span>
        </div>
        ${body}
      </div>
    </section>`;
}

function renderTechnicalCommitTab(technicalCommit, tcDeltas, followUps, whatWorks) {
  const tc = technicalCommit || null;
  const deltas = tcDeltas || [];
  if (!tc && !deltas.length) {
    return renderPhase2TabEmpty(
      "No technical commit yet",
      "Pass 5 did not return a commit snapshot for this call. Link a deal and re-run analysis — the whiteboard decomposition lands here.",
    );
  }

  const slotRows = [
    ["Incumbent", formatTcFieldValue(tc?.incumbent)],
    ["Competitor", formatTcFieldValue(tc?.competitor)],
    ["Identified risk", formatTcFieldValue(tc?.identifiedRisk)],
    ["Timeline for closure", formatTcFieldValue(tc?.timelineForClosure)],
    ["Reason for evaluation", formatTcFieldValue(tc?.reasonForEvaluation)],
    ["AI attach", formatTcFieldValue(tc?.aiAttach)],
  ]
    .filter(([, v]) => v)
    .map(
      ([label, value]) =>
        `<div class="call-tc-slot"><div class="prep-form-eyebrow">${esc(label)}</div><div>${esc(value)}</div></div>`,
    )
    .join("");

  const deltaRows = deltas.length
    ? `<ul class="call-delta-list call-tc-delta-list">
        ${deltas
          .map((d) => {
            const label = TC_SLOT_LABELS[d.field] || d.field;
            const current = formatTcFieldValue(d.current);
            return `<li class="call-delta-item">
              ${deltaChangePill(d.changeType)}
              <strong>${esc(label)}</strong>
              ${current ? `<span>${esc(current)}</span>` : ""}
            </li>`;
          })
          .join("")}
      </ul>`
    : "";

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
        `<div class="ev good"><div class="ts">${esc(w.productArea || "Win")}</div>${esc(w.verbatim || w.summary || "")}</div>`,
    )
    .join("");

  return `
    <div class="call-tc-tab call-tc-tab--wireframe">
      <div class="call-tc-tab-grid">
        <div class="call-tc-main card-wire card-wire--tight">
          <div class="call-tc-head">
            <h3>Technical commit</h3>
            ${tc ? tcStatusPill(tc.status) : ""}
          </div>
          <p class="sub call-tc-intro">What this call contributed to the commit. Deltas from the previous call are marked.</p>
          ${tc?.justification ? `<p class="call-tc-justification">${esc(tc.justification)}</p>` : ""}
          <div class="call-tc-slots">${slotRows || '<p class="muted">No commit fields on this snapshot.</p>'}</div>
          ${deltaRows ? `<div class="call-tc-deltas-inline">${deltaRows}</div>` : ""}
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
        </div>
      </div>
    </div>`;
}

function renderDealHealthTab(meddpiccDeltas, objections, dealSignal, meddpicc, meddpiccFilled) {
  const deltas = meddpiccDeltas || [];
  const objs = objections || [];
  const reasons = dealSignal?.reasonsJson || dealSignal?.reasons || [];
  const medList = renderMeddpiccList(meddpicc);

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
            (o) => `<div class="call-objection-wire-row">
              <div class="call-objection-wire-text">${esc(o.objectionText || "")}</div>
              <div class="sub">${esc(o.handling || "—")} · <span class="${o.landed ? "call-landed" : "call-open"}">${o.landed ? "landed" : "open"}</span></div>
            </div>`,
          )
          .join("")}
      </div>`
    : "";

  const tractionHtml = reasons.length
    ? `<div class="card-wire card-wire--tight call-health-traction-card">
        <div class="prep-form-eyebrow">Traction${dealSignal?.lean != null ? ` · ${esc(String(dealSignal.lean))}` : ""}</div>
        <div class="call-traction-bullets">${reasons.map((r) => `· ${esc(typeof r === "string" ? r : r.reason || JSON.stringify(r))}`).join("<br>")}</div>
      </div>`
    : "";

  return `<div class="call-health-tab call-health-tab--wireframe">
    <div class="call-health-grid">
      <div class="card-wire card-wire--tight">
        <h3>MEDPICC</h3>
        <p class="sub">${meddpiccFilled != null ? `${esc(String(meddpiccFilled))} of ${esc(String(MEDDPICC_FIELD_KEYS.length))} surfaced on this call` : "Deal qualification"}</p>
        <div class="call-medp-list">${medList || '<p class="muted">No MEDPICC rollup on this deal yet.</p>'}</div>
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

  const sentLine = sentAt
    ? `Sent ${formatDateTime(sentAt)}.`
    : "Not sent yet — edit before sharing with the customer.";

  const keyPointsHtml = keyPoints.length
    ? `<section class="call-mom-keypoints">
        <div class="call-mom-section-head">
          <h3>Key points</h3>
        </div>
        <div class="call-mom-keypoints-list">
          ${keyPoints
            .map(
              (kp, i) => `<details class="call-mom-keypoint" ${i === 0 ? "open" : ""}>
                <summary>${esc(kp.title)}</summary>
                ${kp.detail ? `<p>${esc(kp.detail)}</p>` : ""}
              </details>`,
            )
            .join("")}
        </div>
      </section>`
    : "";

  const actionsHtml = actionItems.length
    ? `<section class="call-mom-actions-section">
        <h3>Action items</h3>
        <ul class="call-mom-action-list">
          ${actionItems
            .map((a) => {
              const time =
                a.atS != null
                  ? `<span class="call-mom-action-time num">${esc(formatSegmentTime(a.atS))}</span>`
                  : "";
              const meta = [ownerLabel(a.owner), a.dueDate].filter(Boolean).join(" · ");
              return `<li class="call-mom-action-item">
                ${time}
                <div class="call-mom-action-body">
                  <span>${esc(a.text)}</span>
                  ${meta ? `<span class="muted call-mom-action-meta">${esc(meta)}</span>` : ""}
                  <span class="muted call-mom-action-source">Suggested from call</span>
                </div>
              </li>`;
            })
            .join("")}
        </ul>
      </section>`
    : "";

  return `
    <div class="call-mom-panel call-mom-panel--kaia">
      <p class="muted call-mom-hint">Customer-facing minutes — ${esc(sentLine)}</p>
      <section class="call-mom-outcome">
        <h3>Outcome</h3>
        <p class="call-mom-outcome-text">${esc(outcome || draftBody)}</p>
      </section>
      ${keyPointsHtml}
      ${actionsHtml}
      <details class="call-mom-edit-wrap">
        <summary>Edit flat draft</summary>
        <textarea id="call-mom-editor" class="call-mom-editor" aria-label="Minutes draft">${esc(draftBody || outcome)}</textarea>
        <div class="call-mom-actions">
          <fw-button id="call-mom-save" color="primary" size="small">Save draft</fw-button>
          <span id="call-mom-save-status" class="call-save-status muted" hidden></span>
        </div>
      </details>
    </div>`;
}

function renderProductSignalTab(productGaps, whatWorks, clusterLabels) {
  const gaps = productGaps || [];
  const wins = whatWorks || [];
  if (!gaps.length && !wins.length) {
    return `<p class="muted">No product gaps or wins recorded for this call yet. Re-run post-call analysis — Pass 6 extracts gaps (e.g. missing Flutter SDK) from the transcript and call notes.</p>`;
  }
  const gapsHtml = gaps.length
    ? `<section class="call-product-signal-section"><h3>Gaps raised</h3>${gaps
        .map((g) => renderCallProductGapRow(g, g.clusterId ? clusterLabels[g.clusterId] : null))
        .join("")}</section>`
    : "";
  const winsHtml = wins.length
    ? `<section class="call-product-signal-section"><h3>What landed</h3>${wins
        .map(
          (w) => `
        <div class="call-product-win-row">
          <div class="call-product-gap-head">
            <span class="call-product-gap-area">${esc(w.productArea || "other")}</span>
            ${w.referenceCandidate ? `<fw-tag text="Reference candidate" color="green"></fw-tag>` : ""}
          </div>
          <blockquote class="call-product-gap-verbatim">${esc(w.verbatim || "")}</blockquote>
        </div>`,
        )
        .join("")}</section>`
    : "";
  return `<div class="call-product-signal-tab">${gapsHtml}${winsHtml}</div>`;
}

function renderCallTabs(record, scorecard, analysisMeta, tabs = {}) {
  const qipHtml = scorecard?.lines?.length
    ? renderQipScorecard(scorecard, analysisMeta)
    : `<fw-inline-message type="warning" open closable="false">No QIP scorecard for this call yet.</fw-inline-message>`;

  return `
    <section class="call-record-tabs-section">
      <fw-tabs class="call-record-tabs" active-tab-name="qip">
        <fw-tab slot="tab" panel="qip">QIP scorecard</fw-tab>
        <fw-tab slot="tab" panel="technical">Technical commit</fw-tab>
        <fw-tab slot="tab" panel="health">Deal health</fw-tab>
        <fw-tab slot="tab" panel="signal">Product signal</fw-tab>
        <fw-tab slot="tab" panel="minutes">Minutes</fw-tab>
        <fw-tab-panel name="qip">
          <div class="call-tab-panel-inner call-tab-qip">${qipHtml}</div>
        </fw-tab-panel>
        <fw-tab-panel name="technical">
          <div class="call-tab-panel-inner">
            ${renderTechnicalCommitTab(tabs.technicalCommit, tabs.tcDeltas, tabs.followUps, tabs.whatWorks)}
          </div>
        </fw-tab-panel>
        <fw-tab-panel name="health">
          <div class="call-tab-panel-inner">
            ${renderDealHealthTab(
              tabs.meddpiccDeltas,
              tabs.objections,
              tabs.dealSignal,
              tabs.meddpicc,
              tabs.meddpiccFilled,
            )}
          </div>
        </fw-tab-panel>
        <fw-tab-panel name="signal">
          <div class="call-tab-panel-inner">
            ${renderProductSignalTab(
              tabs.productGaps,
              tabs.whatWorks,
              tabs.clusterLabels || {},
            )}
          </div>
        </fw-tab-panel>
        <fw-tab-panel name="minutes">
          <div class="call-tab-panel-inner">${renderMinutesTab(record, {
            momDraft: tabs.momDraft,
            followUps: tabs.followUps,
          })}</div>
        </fw-tab-panel>
      </fw-tabs>
    </section>`;
}

/** Firestore reads are optional — local history analysis blob renders the wireframe. */
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

async function loadCallBundle(session, record) {
  const email = session.email;
  const store = getStore();
  let dealId = resolveDealId(record);
  // Prefer domain postCall.dealId when history record was saved before dual-write stamped it.
  if (!dealId && store.getPostCall) {
    const domainCall = await safeEnrich("getPostCall", () => store.getPostCall(record.id), null);
    if (domainCall?.dealId) dealId = domainCall.dealId;
  }
  let deal = null;
  let account = null;

  if (dealId) {
    deal = await safeEnrich("getDeal", () => getDeal(dealId), null);
    if (deal?.accountId && store.getAccount) {
      account = await safeEnrich("getAccount", () => store.getAccount(deal.accountId), null);
    }
  }

  const med = resolveDealMeddpicc(deal, account);
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
  const analysis = record.analysis || record.result?.analysis || {};
  const momentumStatus = analysis?.momentum?.status || "—";
  const confRaw = scorecard?.confidence ?? analysisMeta.analysisConfidence;
  const confidencePct = confRaw != null ? Math.round(confRaw * 100) : null;

  let productGaps = store.listProductGapsByPostCall
    ? await safeEnrich("listProductGapsByPostCall", () => store.listProductGapsByPostCall(record.id), [])
    : [];
  let whatWorks = store.listWhatWorksByPostCall
    ? await safeEnrich("listWhatWorksByPostCall", () => store.listWhatWorksByPostCall(record.id), [])
    : [];
  // Fallback: Pass 6 blob on the history record when dual-write collections are empty.
  const pass6 = record.pass6 || record.result?.pass6 || null;
  if (!productGaps.length && pass6?.productGaps?.length) {
    productGaps = pass6.productGaps;
  }
  if (!whatWorks.length && pass6?.whatWorks?.length) {
    whatWorks = pass6.whatWorks;
  }
  /** @type {Record<string, string>} */
  const clusterLabels = {};
  for (const g of productGaps) {
    if (!g.clusterId || clusterLabels[g.clusterId]) continue;
    const cluster = store.getGapCluster
      ? await safeEnrich("getGapCluster", () => store.getGapCluster(g.clusterId), null)
      : null;
    if (cluster?.label) clusterLabels[g.clusterId] = cluster.label;
  }

  const identities = resolveConfirmedIdentities(record);
  const attendees = analysis?.callHeader?.attendees || [];

  let timelineFacts = null;
  let timelineSegments = [];
  const storedFacts = store.listVideoFactsByCall
    ? await safeEnrich("listVideoFactsByCall", () => store.listVideoFactsByCall(record.id), [])
    : [];
  if (storedFacts?.[0]) {
    timelineFacts = storedFacts[0];
  }
  // Segments are stored per call, not per videoFacts — transcript spines have no facts doc.
  if (store.listTimelineSegmentsByCall) {
    timelineSegments = await safeEnrich(
      "listTimelineSegmentsByCall",
      () => store.listTimelineSegmentsByCall(record.id),
      [],
    );
  }
  const draftVf = record.result?.videoFacts;
  if (!timelineSegments.length && Array.isArray(draftVf?.segments)) {
    timelineSegments = draftVf.segments;
    timelineFacts = timelineFacts || draftVf;
  }

  let timelineMarkers = store.listTimelineMarkersByCall
    ? await safeEnrich("listTimelineMarkersByCall", () => store.listTimelineMarkersByCall(record.id), [])
    : [];
  const draftTimeline = record.result?.timeline;
  if (!timelineSegments.length && Array.isArray(draftTimeline?.segments)) {
    timelineSegments = draftTimeline.segments;
  }
  if (!timelineMarkers.length && Array.isArray(draftTimeline?.markers)) {
    timelineMarkers = draftTimeline.markers;
  }

  const arrPoint =
    deal?.arrSnapshot?.arrEstimatePoint ??
    deal?.arrEstimatePoint ??
    record.result?.arrCompute?.arrPoint ??
    record.result?.arrCompute?.arrEstimatePoint ??
    null;
  const arrLabel =
    arrPoint != null && Number.isFinite(Number(arrPoint))
      ? `$${Math.round(Number(arrPoint)).toLocaleString()}`
      : null;

  let technicalCommit = null;
  if (dealId && store.getTechnicalCommitByDeal) {
    technicalCommit = await safeEnrich(
      "getTechnicalCommitByDeal",
      () => store.getTechnicalCommitByDeal(dealId),
      null,
    );
  }
  if (!technicalCommit) {
    technicalCommit = record.result?.technicalCommit || null;
  }

  let tcDeltas = store.listTcDeltasByCall
    ? await safeEnrich("listTcDeltasByCall", () => store.listTcDeltasByCall(record.id), [])
    : [];
  if (!tcDeltas.length && Array.isArray(record.result?.tcDeltas)) {
    tcDeltas = record.result.tcDeltas;
  }

  let meddpiccDeltas = store.listMeddpiccDeltasByCall
    ? await safeEnrich("listMeddpiccDeltasByCall", () => store.listMeddpiccDeltasByCall(record.id), [])
    : [];

  let objections = store.listObjectionsByCall
    ? await safeEnrich("listObjectionsByCall", () => store.listObjectionsByCall(record.id), [])
    : [];
  if (!objections.length && Array.isArray(record.result?.summarise?.objections)) {
    objections = record.result.summarise.objections;
  }

  let followUps = store.listFollowUpsByCall
    ? await safeEnrich("listFollowUpsByCall", () => store.listFollowUpsByCall(record.id), [])
    : [];
  if (!followUps.length && Array.isArray(record.result?.summarise?.followUps)) {
    followUps = record.result.summarise.followUps;
  }

  let momDraft = null;
  if (store.listMomDraftsByCall) {
    const moms = await safeEnrich("listMomDraftsByCall", () => store.listMomDraftsByCall(record.id), []);
    momDraft = moms?.[0] || null;
  }
  if (!momDraft) {
    momDraft = record.result?.summarise?.momDraft || record.result?.momDraft || null;
  }

  let dealSignal = null;
  if (store.listDealSignalsByCall) {
    const signals = await safeEnrich("listDealSignalsByCall", () => store.listDealSignalsByCall(record.id), []);
    dealSignal = signals?.[0] || null;
  }

  return {
    record,
    deal,
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
    callNotes: typeof analysis.callNotes === "string" ? analysis.callNotes : "",
    identities,
    attendees,
    timeline: { facts: timelineFacts, segments: timelineSegments, markers: timelineMarkers },
    videoFacts: timelineFacts,
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
  const metaBits = [
    account?.id
      ? `<a href="#accounts/${esc(account.id)}" class="call-meta-link">${esc(account.name)}</a>`
      : account?.name
        ? esc(account.name)
        : "",
    hdr.date || formatDate(record.timestamp),
    hdr.duration,
    attendeeCount != null ? `${esc(String(attendeeCount))} participants` : "",
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
            <fw-button color="secondary" fill="outline" size="small" data-action="open-deal" ${bundle.deal?.id ? "" : "disabled"}>Open deal</fw-button>
          </div>
        </header>
        ${renderDealContextStrip(bundle)}
        ${renderVerdictStrip(bundle)}
        <div class="call-record-notes-row">
          ${renderCallNotesSection(bundle.callNotes)}
          ${renderStakeholderSection(bundle.identities, bundle.attendees, bundle.hasVideo)}
        </div>
        ${renderTimelineSection(bundle.hasVideo, bundle.timeline, durationLabel, {
          videoFacts: bundle.videoFacts,
          scorecard: bundle.scorecard,
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
    if (bundle.deal?.id) opts.onOpenDeal?.(bundle.deal.id);
  };
  container.querySelector('[data-action="open-deal"]')?.addEventListener("fwClick", openDeal);
  container.querySelector('[data-action="open-deal"]')?.addEventListener("click", openDeal);
  container.querySelector('a[data-action="open-deal"]')?.addEventListener("click", (e) => {
    e.preventDefault();
    openDeal();
  });

  const notesEditor = container.querySelector("#call-notes-editor");
  const notesSave = container.querySelector("#call-notes-save");
  const notesStatus = container.querySelector("#call-notes-save-status");

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

  if (opts.initialTab) {
    const tabs = container.querySelector(".call-record-tabs");
    if (tabs) tabs.activeTabName = opts.initialTab;
  }

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
    const record =
      (await getPostCallForSession(activeSession, opts.callId, ownerEmail)) ||
      getPostCallAnalysis(activeSession.email, opts.callId);
    if (!record) {
      container.innerHTML = renderCallEmptyState("Call not found — it may have been cleared from this browser.");
      return;
    }

    const bundle = await loadCallBundle(activeSession, record);
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
