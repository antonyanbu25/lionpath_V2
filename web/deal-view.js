/**
 * Deals nav: global deal list + deal record (spec §11.6).
 */

import { listDealsForSession, listDealsFromHistory, getAccountEngagementDetail, historyRecordsForAccount } from "./domain/account-service.js?v=2.1.14";
import { buildDealExtrasFromHistory } from "./domain/history-deal-enrichment.js";
import { rollupProductSignalRows } from "./domain/product-signal-service.js";
import { renderCallProductSignalTab } from "./call-product-signal.js";
import { setAccountEngagementContext } from "./domain/account-context.js";
import { getDeal, DEAL_TYPE_LABELS } from "./domain/deal-service.js";
import {
  computeMeddpiccScore,
  MEDDPICC_FIELD_KEYS,
  MEDDPICC_FIELD_LABELS,
  resolveDealMeddpicc,
} from "./domain/contact-service.js";
import { computeDaysInStage, computeStageMedianDays } from "./domain/deal-traction-service.js";
import { renderContactTileList, wireContactTiles } from "./contact-tile.js";
import { getStore } from "./domain/store.js";
import { safeStoreOp } from "./domain/safe-store.js";
import { sessionUserId, withEffectiveUserId } from "./domain/session.js";
import { syncSessionWithDomainStore } from "./auth.js";
import { STAGE_LABELS } from "./domain/types.js";
import { resolveCallType } from "./call-view.js";
import { resolveDurationMinutes, resolveQipScoreNumeric } from "./calls-list-view.js";
import { resolveCallTitleFromRecord } from "./call-type-labels.js";
import { filterDealRows } from "./search-service.js?v=2.1.14";
import { filterDealRowsForList } from "./domain/se-access-service.js";
import { readFieldValueAsync, renderLoadingPanel } from "./crayons-ui.js";
import { displayMrrFromArr, formatUsd, mountDealArrModule, renderDealArrModule } from "./deal-arr-module.js";
import { selectLatestArrLines } from "./domain/arr-service.js";
import { getWorkerAuthHeaders } from "./postcall.js";
import { esc } from "./shared.js";
import { CALL_QUALITY_SCORE_LABEL } from "./user-facing-copy.js";
import { getDealTractionReadModels } from "./domain/read-models-service.js";

const MEDDPICC_LETTERS = {
  metrics: "M",
  economicBuyer: "E",
  decisionCriteria: "D",
  decisionProcess: "D",
  paperProcess: "P",
  identifyPain: "I",
  champion: "C",
  competition: "C",
};

const TRACTION_RANK = { hot: 0, warm: 1, cold: 2 };

const DEAL_LIST_TTL_MS = 45_000;
/** @type {{ key: string, at: number, rows: object[] } | null} */
let dealListCache = null;

export function invalidateDealListCache() {
  dealListCache = null;
}

function dealListCacheKey(session) {
  return sessionUserId(session) || "";
}

/** @param {object} session @returns {object[]|null} */
export function getDealListCacheRows(session) {
  const key = dealListCacheKey(session);
  if (dealListCache?.key !== key || Date.now() - dealListCache.at >= DEAL_LIST_TTL_MS) return null;
  return dealListCache.rows;
}

/** @param {object} session */
export function isDealListCacheFresh(session) {
  const rows = getDealListCacheRows(session);
  return Array.isArray(rows) && rows.length > 0;
}

function dealListRowsChanged(prev, next) {
  if (!prev || !next) return true;
  if (prev.length !== next.length) return true;
  for (let i = 0; i < next.length; i++) {
    const a = prev[i]?.deal;
    const b = next[i]?.deal;
    if (a?.id !== b?.id) return true;
    if ((a?.updatedAt || 0) !== (b?.updatedAt || 0)) return true;
  }
  return false;
}

/** @param {string|null|undefined} traction */
export function tractionSortRank(traction) {
  return TRACTION_RANK[traction] ?? 2;
}

/**
 * Deal list sort — default traction; ARR and MRR share the same arrPoint ordering (spec §11.6).
 * @param {object[]} rows
 * @param {"traction"|"arr"|"mrr"} [sortKey]
 */
export function sortDealListRows(rows, sortKey = "traction") {
  const sorted = [...rows];
  if (sortKey === "arr" || sortKey === "mrr") {
    sorted.sort((a, b) => {
      const arrA = a.arrPoint ?? -1;
      const arrB = b.arrPoint ?? -1;
      if (arrB !== arrA) return arrB - arrA;
      return tractionSortRank(a.traction) - tractionSortRank(b.traction);
    });
    return sorted;
  }
  sorted.sort((a, b) => {
    const tractionDelta = tractionSortRank(a.traction) - tractionSortRank(b.traction);
    if (tractionDelta !== 0) return tractionDelta;
    const silentA = a.daysSilent ?? -1;
    const silentB = b.daysSilent ?? -1;
    if (silentB !== silentA) return silentB - silentA;
    return (b.arrPoint ?? 0) - (a.arrPoint ?? 0);
  });
  return sorted;
}

/** @param {number|null|undefined} amount */
export function formatCompactUsd(amount) {
  if (amount == null || !Number.isFinite(amount)) return "-";
  if (amount >= 1_000_000) {
    const m = amount / 1_000_000;
    return `$${m >= 10 ? Math.round(m) : m.toFixed(1).replace(/\.0$/, "")}M`;
  }
  if (amount >= 1000) return `$${Math.round(amount / 1000)}K`;
  return formatUsd(amount);
}

/** @param {object[]} lines */
function weightedArrConfidence(lines) {
  const included = (lines || []).filter((l) => !l.excluded);
  let weight = 0;
  let sum = 0;
  for (const line of included) {
    if (line.confidence == null || !(line.annualValue > 0)) continue;
    weight += line.annualValue;
    sum += line.confidence * line.annualValue;
  }
  return weight > 0 ? sum / weight : null;
}

/** @param {number|null|undefined} low @param {number|null|undefined} high @param {number|null|undefined} point */
export function formatDealListMoneyBand(low, high, point) {
  const lo = low ?? point;
  const hi = high ?? point;
  if (lo == null && hi == null) return "-";
  if (lo != null && hi != null && lo !== hi) {
    return `${formatCompactUsd(lo)}–${formatCompactUsd(hi)}`;
  }
  return formatCompactUsd(point ?? lo ?? hi);
}

/** @param {number|null|undefined} confidence */
export function isLowConfidenceArr(confidence) {
  if (confidence == null) return true;
  return confidence < 0.5;
}

/** @param {import("./types.js").Deal} deal @param {object[]} latestLines */
export function resolveDealAgentCount(deal, latestLines) {
  const fromInputs = deal?.arrInputsJson?.agents;
  if (fromInputs != null && Number.isFinite(Number(fromInputs))) return Number(fromInputs);
  const base = (latestLines || []).find((l) => l.kind === "base" && !l.excluded);
  if (base?.quantity != null && Number.isFinite(Number(base.quantity))) return Number(base.quantity);
  return null;
}

/** @param {ReturnType<import("./domain/store.js").getStore>} store @param {object[]} rows */
export async function enrichDealListRows(store, rows, opts = {}) {
  const dealIds = rows.map((r) => r.deal.id);
  const orgId = opts.orgId || rows[0]?.deal?.orgId || null;

  const [tcList, signalsByDeal, arrByDeal, tractionDocs] = await Promise.all([
    orgId && store.listTechnicalCommitsByOrg
      ? safeStoreOp("listTechnicalCommitsByOrg", () => store.listTechnicalCommitsByOrg(orgId, 500), [])
      : Promise.resolve(null),
    store.listDealSignalsForDeals
      ? safeStoreOp("listDealSignalsForDeals", () => store.listDealSignalsForDeals(dealIds, 1), new Map())
      : Promise.resolve(null),
    store.listArrLinesForDeals
      ? safeStoreOp("listArrLinesForDeals", () => store.listArrLinesForDeals(dealIds), new Map())
      : Promise.resolve(null),
    store.getReadModels
      ? safeStoreOp("getDealTractionReadModels", () => getDealTractionReadModels(store, dealIds), [])
      : Promise.resolve([]),
  ]);

  const tractionByDeal = new Map((tractionDocs || []).map((doc) => [doc.dealId || doc.id, doc]));

  const tcByDeal = new Map();
  for (const tc of tcList || []) {
    if (tc?.dealId && !tcByDeal.has(tc.dealId)) tcByDeal.set(tc.dealId, tc);
  }

  return Promise.all(
    rows.map(async (row) => {
      const { deal, account } = row;
      const med = resolveDealMeddpicc(deal, account);
      const meddpiccScore = med?.completionScore ?? computeMeddpiccScore(med);

      let tc = tcByDeal.get(deal.id) ?? null;
      const tractionDoc = tractionByDeal.get(deal.id);
      let signals = signalsByDeal ? (signalsByDeal.get(deal.id) || []) : null;
      let arrLines = arrByDeal ? (arrByDeal.get(deal.id) || []) : null;

      if (tractionDoc?.traction != null) {
        signals = [
          {
            traction: tractionDoc.traction,
            daysSilent: tractionDoc.daysSilent,
          },
        ];
      }

      if (tcList === null && !tc) {
        tc = await safeStoreOp(
          "getTechnicalCommitByDeal",
          () => (store.getTechnicalCommitByDeal ? store.getTechnicalCommitByDeal(deal.id) : null),
          null,
        );
      }
      if (signalsByDeal === null && !(tractionDoc?.traction != null)) {
        signals = await safeStoreOp(
          "listDealSignalsByDeal",
          () => (store.listDealSignalsByDeal ? store.listDealSignalsByDeal(deal.id, 1) : []),
          [],
        );
      }
      if (arrByDeal === null) {
        arrLines = await safeStoreOp(
          "listArrLinesByDeal",
          () => (store.listArrLinesByDeal ? store.listArrLinesByDeal(deal.id) : []),
          [],
        );
      }

      const signal = (signals || [])[0] || null;

      const latestLines = selectLatestArrLines(arrLines || []);
      const arrConfidence = weightedArrConfidence(latestLines);

      const arrPoint = deal.arrEstimatePoint ?? null;
      const arrLow = deal.arrEstimateLow ?? arrPoint;
      const arrHigh = deal.arrEstimateHigh ?? arrPoint;
      const meta = account?.metadata || {};

      return {
        ...row,
        meddpiccScore,
        tcStatus: tc?.status || null,
        aiAttach: tc?.aiAttach || null,
        blocker: tc?.identifiedRisk?.value?.trim() || null,
        traction: signal?.traction || null,
        daysSilent: signal?.daysSilent ?? null,
        arrPoint,
        arrLow,
        arrHigh,
        arrConfidence,
        agentCount: resolveDealAgentCount(deal, latestLines),
        pendingActions: deal.openTaskCount || 0,
        subRegion: meta.sub_region || meta.subRegion || null,
        forecastMonth: deal.forecastMonth || null,
        callCount: deal.postCallCount || 0,
        /** Soft rollup from last scored call — display only; score still lives on the call. */
        callQualityScore:
          deal.latestQualityScore != null && Number.isFinite(Number(deal.latestQualityScore))
            ? Number(deal.latestQualityScore)
            : null,
      };
    }),
  );
}

const TERMINAL_PIPELINE_STAGES = new Set(["closed_won", "closed_lost", "nurture"]);

/** @param {import("./types.js").Deal|null|undefined} deal */
export function isOpenPipelineDeal(deal) {
  return !!deal && deal.status === "active" && !TERMINAL_PIPELINE_STAGES.has(deal.stage);
}

/**
 * Leadership whiteboard sort — big deals first (agent count, then ARR). Not traction-first.
 * @param {object[]} rows
 * @param {"agents"|"arr"|"mrr"} [sortKey]
 */
export function sortPipelineDealRows(rows, sortKey = "agents") {
  const sorted = [...rows];
  if (sortKey === "arr" || sortKey === "mrr") {
    sorted.sort((a, b) => {
      const arrA = a.arrPoint ?? -1;
      const arrB = b.arrPoint ?? -1;
      if (arrB !== arrA) return arrB - arrA;
      return (b.agentCount ?? -1) - (a.agentCount ?? -1);
    });
    return sorted;
  }
  sorted.sort((a, b) => {
    const agentDelta = (b.agentCount ?? -1) - (a.agentCount ?? -1);
    if (agentDelta !== 0) return agentDelta;
    return (b.arrPoint ?? 0) - (a.arrPoint ?? 0);
  });
  return sorted;
}

const CALL_TYPE_LABELS = {
  demo: "Demo",
  discovery: "Discovery",
  qa: "Q&A",
  reverse_demo: "Reverse demo",
  poc_kickoff: "POC kickoff",
  check_in: "Check-in",
  escalation: "Escalation",
  internal: "Internal",
};

const TC_FIELD_LABELS = {
  incumbent: "incumbent",
  competitor: "competitor",
  identifiedRisk: "identified risk",
  timelineForClosure: "go-live timeline",
  reasonForEvaluation: "reason for evaluation",
  aiAttach: "AI attach",
  whatsWorking: "what's working",
  status: "technical commit",
  justification: "TC justification",
};

function formatDate(ts) {
  if (!ts) return "-";
  return new Date(ts).toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" });
}

function formatShortDate(ts) {
  if (!ts) return "-";
  return new Date(ts).toLocaleDateString(undefined, { month: "short", day: "numeric" });
}

function dealListSubtitle(openCount, opts) {
  if (opts.listTractionFilter === "cold") {
    return "Deals flagged cold across your team, sorted by traction then ARR.";
  }
  const openLabel = openCount === 1 ? "1 open" : `${openCount} open`;
  return `${openLabel}. Sorted by traction, not close date; close date is what you typed in April.`;
}

/** @param {object[]} rows */
export function summarizeDealListMetrics(rows) {
  const openRows = rows.filter((row) => isOpenPipelineDeal(row.deal));
  let arrInPlay = 0;
  let hasArr = false;
  let tcYes = 0;
  let tcYesArr = 0;
  let coldCount = 0;
  let coldArr = 0;
  let aiAttachCount = 0;
  let openFollowUps = 0;

  for (const row of openRows) {
    if (row.arrPoint != null) {
      hasArr = true;
      arrInPlay += row.arrPoint;
    }
    if (row.tcStatus === "yes") {
      tcYes += 1;
      if (row.arrPoint != null) tcYesArr += row.arrPoint;
    }
    if (row.traction === "cold") {
      coldCount += 1;
      if (row.arrPoint != null) coldArr += row.arrPoint;
    }
    const aiSummary = formatTcValue(row.aiAttach);
    const attached =
      row.aiAttach?.agentCount > 0 ||
      row.aiAttach?.optedInAfterDemo === true ||
      /\bcopilot\b|\bagent\b/i.test(aiSummary);
    if (attached) aiAttachCount += 1;
    openFollowUps += row.pendingActions ?? 0;
  }

  return {
    openCount: openRows.length,
    arrInPlay: hasArr ? arrInPlay : null,
    tcYes,
    tcYesArr: tcYes > 0 && tcYesArr > 0 ? tcYesArr : null,
    coldCount,
    coldArr: coldCount > 0 && coldArr > 0 ? coldArr : null,
    aiAttachCount,
    openFollowUps,
  };
}

function renderDealListMetricCard(label, value, note = "") {
  return `
    <div class="deal-kpi">
      <span class="deal-kpi-label">${esc(label)}</span>
      <span class="deal-kpi-val">${value}</span>
      ${note ? `<span class="deal-kpi-note">${esc(note)}</span>` : ""}
    </div>`;
}

/** @param {ReturnType<typeof summarizeDealListMetrics>} metrics */
function renderDealListMetrics(metrics) {
  const arrVal = metrics.arrInPlay != null ? formatCompactUsd(metrics.arrInPlay) : "—";
  const openSub = metrics.openCount === 1 ? "1 open deal" : `${metrics.openCount} open deals`;
  const tcVal = metrics.openCount ? `${metrics.tcYes} / ${metrics.openCount}` : "—";
  const tcSub =
    metrics.tcYesArr != null
      ? `${formatCompactUsd(metrics.tcYesArr)} committed`
      : "secured this quarter";
  const aiVal = metrics.openCount ? `${metrics.aiAttachCount} / ${metrics.openCount}` : "—";
  const coldSub = metrics.coldArr != null ? `${formatCompactUsd(metrics.coldArr)} at risk` : "no traction · 30 days";
  const followSub = metrics.openFollowUps > 0 ? "tracked across deals" : "none tracked";

  return `
    <div class="deal-kpis" aria-label="Deal metrics">
      ${renderDealListMetricCard("ARR in play", esc(arrVal), openSub)}
      ${renderDealListMetricCard("Technical commit", esc(tcVal), tcSub)}
      ${renderDealListMetricCard("Cold", esc(String(metrics.coldCount)), coldSub)}
      ${renderDealListMetricCard("AI attach", esc(aiVal), "Copilot or Agent")}
      ${renderDealListMetricCard("Open follow-ups", esc(String(metrics.openFollowUps)), followSub)}
    </div>`;
}

function dealInitials(name) {
  const parts = String(name || "?")
    .trim()
    .split(/\s+/)
    .filter(Boolean);
  if (!parts.length) return "?";
  return parts
    .map((w) => w[0])
    .slice(0, 2)
    .join("")
    .toUpperCase();
}

function medScoreBand(v) {
  if (v == null || !Number.isFinite(v)) return "var(--dew-text-faint)";
  if (v < 40) return "var(--dew-red)";
  if (v < 70) return "var(--dew-amber)";
  return "var(--dew-green)";
}

function cqsScoreBand(v) {
  if (v == null || !Number.isFinite(v)) return "var(--dew-text-faint)";
  if (v < 4) return "var(--dew-red)";
  if (v < 7) return "var(--dew-amber)";
  return "var(--dew-green)";
}

function renderScoreCell(score, max, bandFn) {
  if (score == null || !Number.isFinite(score)) {
    return `<span class="deal-dash">—</span>`;
  }
  const pct = Math.max(0, Math.min(100, (score / max) * 100));
  const color = bandFn(score);
  const display = max === 10 ? score.toFixed(1) : String(Math.round(score));
  return `<div class="deal-scorecell">
    <span class="deal-scorecell-n" style="color:${color}">${esc(display)}<s>/${max}</s></span>
    <span class="deal-minibar"><i style="width:${pct}%;background:${color}"></i></span>
  </div>`;
}

function stagePill(stage) {
  const label = STAGE_LABELS[stage] || stage || "—";
  const mod =
    stage === "closed_won" ? "deal-pill--won" : stage === "closed_lost" ? "deal-pill--lost" : "deal-pill--neutral";
  return `<span class="deal-pill ${mod}">${esc(label)}</span>`;
}

function tractionPill(traction) {
  if (!traction) return `<span class="deal-dash">—</span>`;
  const t = String(traction);
  const label = t.charAt(0).toUpperCase() + t.slice(1);
  const mod = t === "hot" ? "deal-pill--hot" : t === "cold" ? "deal-pill--cold" : "deal-pill--warm";
  return `<span class="deal-pill ${mod}">${esc(label)}</span>`;
}

function formatGeneratedSummaryMeta(generatedAt, sourceCallIds) {
  const when = generatedAt ? formatDate(generatedAt) : "-";
  const count = sourceCallIds?.length || 0;
  const callLabel = count === 1 ? "1 call" : `${count} calls`;
  return `Updated ${when} · from ${callLabel}`;
}

function stageBadge(stage) {
  const label = STAGE_LABELS[stage] || stage;
  return `<span class="lifecycle-stage-badge stage-${esc(stage)}">${esc(label)}</span>`;
}

function listMotionBadge(type) {
  const label = DEAL_TYPE_LABELS[type] || type || "-";
  const mod = type === "expansion" ? "expansion" : "new-business";
  return `<span class="account-list-motion-badge account-list-motion-badge--${mod}">${esc(label)}</span>`;
}

function dealStatusLabel(status) {
  if (status === "archived") return "Archived";
  if (status === "paused") return "Paused";
  return "Active";
}

function meddpiccStatusTag(status) {
  const s = status || "unknown";
  if (s === "confirmed") return `<fw-tag text="Confirmed" color="green"></fw-tag>`;
  if (s === "partial") return `<fw-tag text="Partial" color="yellow"></fw-tag>`;
  return `<fw-tag text="Not captured" color="grey"></fw-tag>`;
}

function tractionTag(traction) {
  const t = traction || "warm";
  const color = t === "hot" ? "green" : t === "cold" ? "red" : "yellow";
  const label = t.charAt(0).toUpperCase() + t.slice(1);
  return `<fw-tag text="${esc(label)}" color="${color}"></fw-tag>`;
}

function tcStatusTag(status) {
  const s = status || "pending";
  const labels = { yes: "Yes", no: "No", pending: "Pending", at_risk: "At risk" };
  const colors = { yes: "green", no: "red", pending: "yellow", at_risk: "red" };
  return `<fw-tag text="${esc(labels[s] || s)}" color="${colors[s] || "grey"}"></fw-tag>`;
}

export function formatTcValue(val) {
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

/** @param {object} delta */
export function formatMeddpiccDeltaPhrase(delta) {
  const baseLabel = (MEDDPICC_FIELD_LABELS[delta.slot] || delta.slot).toLowerCase();
  const value = delta.current?.value?.trim();
  const ct = delta.changeType || "changed";
  if (ct === "confirmed") {
    return value ? `Confirmed ${baseLabel}: ${value}` : `Confirmed ${baseLabel}`;
  }
  if (ct === "new") {
    return value ? `Surfaced ${baseLabel}: ${value}` : `Surfaced ${baseLabel}`;
  }
  if (ct === "changed") {
    return value ? `Updated ${baseLabel}: ${value}` : `Updated ${baseLabel}`;
  }
  return value ? `${baseLabel}: ${value}` : baseLabel;
}

/** @param {object} delta */
export function formatTcDeltaPhrase(delta) {
  const field = delta.field;
  const ct = delta.changeType || "changed";
  const current = formatTcValue(delta.current);

  if (field === "identifiedRisk") {
    if (ct === "new") return current ? `Raised ${current}` : "Logged identified risk";
    if (ct === "changed") return current ? `Updated risk: ${current}` : "Updated identified risk";
    if (ct === "confirmed") return current ? `Confirmed risk: ${current}` : "Confirmed identified risk";
  }
  if (field === "status") {
    return current ? `TC status → ${current}` : "TC status updated";
  }
  if (field === "aiAttach") {
    return current ? `AI attach confirmed: ${current}` : "AI attach updated";
  }

  const label = TC_FIELD_LABELS[field] || String(field).replace(/([A-Z])/g, " $1").trim().toLowerCase();
  if (ct === "confirmed") return current ? `Confirmed ${label}: ${current}` : `Confirmed ${label}`;
  if (ct === "new") return current ? `Surfaced ${label}: ${current}` : `Logged ${label}`;
  return current ? `Updated ${label}: ${current}` : `Updated ${label}`;
}

/** @param {object[]} meddpiccDeltas @param {object[]} tcDeltas */
export function formatCallMovement(meddpiccDeltas, tcDeltas) {
  const phrases = [];
  for (const d of meddpiccDeltas || []) {
    phrases.push(formatMeddpiccDeltaPhrase(d));
  }
  for (const d of tcDeltas || []) {
    phrases.push(formatTcDeltaPhrase(d));
  }
  return phrases.length ? phrases.join(" · ") : "-";
}

function formatLength(minutes) {
  if (minutes == null || !Number.isFinite(minutes)) return "-";
  if (minutes < 60) return `${Math.round(minutes)}m`;
  const h = Math.floor(minutes / 60);
  const m = Math.round(minutes % 60);
  return m ? `${h}h ${m}m` : `${h}h`;
}

function callTitle(postCall) {
  return resolveCallTitleFromRecord(postCall, {
    accountName: postCall?.analysis?.callHeader?.company || postCall?.analysis?.callHeader?.account,
  });
}

function meddpiccListTag(score) {
  const s = score ?? 0;
  const color = s >= 70 ? "green" : s >= 50 ? "yellow" : "red";
  return `<fw-tag text="${esc(String(s))}" color="${color}"></fw-tag>`;
}

function aiAttachListTag(aiAttach) {
  const summary = formatTcValue(aiAttach);
  if (!summary) return `<span class="muted deal-list-ai-attach">-</span>`;
  const attached =
    aiAttach?.agentCount > 0 ||
    aiAttach?.optedInAfterDemo === true ||
    /\bcopilot\b|\bagent\b/i.test(summary);
  const label = attached ? "Yes" : "No";
  const color = attached ? "purple" : "grey";
  return `<fw-tag class="deal-list-ai-attach" text="${esc(label)}" color="${color}"></fw-tag>`;
}

function renderDealListMoneyCell(row, unit) {
  const { arrLow, arrHigh, arrPoint, arrConfidence } = row;
  const lowConf = isLowConfidenceArr(arrConfidence) && arrPoint != null;
  const band =
    unit === "MRR"
      ? formatDealListMoneyBand(
          arrLow != null ? displayMrrFromArr(arrLow) : null,
          arrHigh != null ? displayMrrFromArr(arrHigh) : null,
          arrPoint != null ? displayMrrFromArr(arrPoint) : null,
        )
      : formatDealListMoneyBand(arrLow, arrHigh, arrPoint);
  const confNote =
    lowConf && arrConfidence != null
      ? `${Math.round(arrConfidence * 100)}% confidence (estimate, not a firm number)`
      : "Estimate: confidence not established yet";
  return `<span class="deal-list-money${lowConf ? " deal-list-money--low-confidence" : ""}"${
    lowConf ? ` title="${esc(confNote)}"` : ""
  }>${esc(band)}${lowConf ? '<span class="deal-list-money-mark" aria-hidden="true">*</span>' : ""}</span>`;
}

function daysSilentCell(daysSilent, traction) {
  if (daysSilent == null) return `<span class="muted deal-list-silent">-</span>`;
  const t = traction || "warm";
  const tone = t === "cold" ? "deal-list-silent--cold" : t === "hot" ? "deal-list-silent--hot" : "deal-list-silent--warm";
  return `<span class="deal-list-silent ${tone}">${esc(String(daysSilent))}d</span>`;
}

function renderDealListItem(row) {
  const { deal, account } = row;
  const accountTitle = account?.name || account?.domain || "Account";
  const dealTitle = deal.title || DEAL_TYPE_LABELS[deal.type] || "Deal";
  const arrCell = renderDealListMoneyCell(row, "ARR");

  return `
    <tr class="deal-list-row" data-deal-id="${esc(deal.id)}" tabindex="0" role="button">
      <td>
        <div class="deal-cell">
          <span class="deal-av" aria-hidden="true">${esc(dealInitials(dealTitle))}</span>
          <span class="deal-nm">
            <b>${esc(dealTitle)}</b>
            <span>${esc(accountTitle)}</span>
          </span>
        </div>
      </td>
      <td>${stagePill(deal.stage)}</td>
      <td class="deal-num">${arrCell}</td>
      <td>${row._pending ? `<span class="deal-dash">·</span>` : renderScoreCell(row.meddpiccScore, 100, medScoreBand)}</td>
      <td>${row._pending ? `<span class="deal-dash">·</span>` : renderScoreCell(row.callQualityScore, 10, cqsScoreBand)}</td>
      <td>${row._pending ? `<span class="deal-dash">·</span>` : tractionPill(row.traction)}</td>
      <td class="deal-num deal-num--r">${esc(String(row.callCount ?? 0))}</td>
      <td class="deal-chev-cell"><span class="deal-chev" aria-hidden="true">›</span></td>
    </tr>`;
}

function renderDealListSortHeader(sortKey) {
  const btn = (key, label) => {
    const active = sortKey === key;
    return `<button type="button" class="deal-list-sort-btn${active ? " deal-list-sort-btn--active" : ""}" data-deal-sort="${esc(key)}" aria-pressed="${active ? "true" : "false"}">${esc(label)}</button>`;
  };
  return `
    <thead>
      <tr>
        <th scope="col">Deal</th>
        <th scope="col">Stage</th>
        <th scope="col">${btn("arr", "ARR")}</th>
        <th scope="col">MEDPICC</th>
        <th scope="col">Call quality</th>
        <th scope="col">Traction</th>
        <th scope="col" class="deal-th-r">Calls</th>
        <th scope="col"><span class="visually-hidden">Open</span></th>
      </tr>
    </thead>`;
}

function renderDealsEmptyState(message) {
  return `
    <div class="lifecycle-empty account-empty deal-empty">
      <fw-card>
        <fw-icon name="currency" size="24" aria-hidden="true"></fw-icon>
        <h2>Deals</h2>
        <p class="muted">${esc(message)}</p>
      </fw-card>
    </div>`;
}

function renderGeneratedSummarySection(title, summaryDoc, emptyHint, sectionOpts = {}) {
  const wireframe = sectionOpts.wireframe === true;
  const cardClass = wireframe ? " account-record-section--card" : "";
  const summary = summaryDoc?.summary?.trim();
  if (!summary) {
    return `
      <section class="account-record-section account-generated-summary account-generated-summary--empty deal-record-section${cardClass}">
        ${
          wireframe
            ? `<p class="prep-form-eyebrow account-section-eyebrow">${esc(title)}</p>`
            : `<h3 class="account-record-section-title">${esc(title)}</h3>`
        }
        <p class="muted">${esc(emptyHint)}</p>
      </section>`;
  }
  const meta = formatGeneratedSummaryMeta(summaryDoc.generatedAt, summaryDoc.sourceCallIds);
  if (wireframe) {
    const bullets = summary
      .split(/\n+/)
      .map((line) => line.replace(/^[-•*]\s*/, "").trim())
      .filter(Boolean);
    const items = (bullets.length > 1 ? bullets : [summary])
      .map((b) => `<li>${esc(b)}</li>`)
      .join("");
    return `
      <section class="account-record-section account-generated-summary deal-record-section account-record-section--card">
        <p class="prep-form-eyebrow account-section-eyebrow">${esc(title)} · regenerated after every call</p>
        <ul class="deal-summary-bullets">${items}</ul>
        <p class="muted account-generated-summary-meta">${esc(meta)}</p>
      </section>`;
  }
  return `
    <section class="account-record-section account-generated-summary deal-record-section">
      <div class="account-record-section-head">
        <h3 class="account-record-section-title">${esc(title)}</h3>
        <span class="muted account-generated-summary-meta">${esc(meta)}</span>
      </div>
      <p class="account-generated-summary-body">${esc(summary)}</p>
    </section>`;
}

function averageCallQuality(callRows) {
  let sum = 0;
  let n = 0;
  for (const row of callRows || []) {
    const score = resolveQipScoreNumeric(row.postCall);
    if (score != null && Number.isFinite(score)) {
      sum += score;
      n += 1;
    }
  }
  if (!n && callRows?.[0]?.postCall?.qualityScore != null) {
    const q = Number(callRows[0].postCall.qualityScore);
    return Number.isFinite(q) ? q : null;
  }
  return n ? Math.round((sum / n) * 10) / 10 : null;
}

function renderDealScoreStrip(detail) {
  const deal = detail.selectedDeal;
  const account = detail.account;
  const signal = detail.latestSignal;
  const tc = detail.technicalCommit;
  const med = resolveDealMeddpicc(deal, account);
  const medScore = med?.completionScore ?? computeMeddpiccScore(med);
  const filled = MEDDPICC_FIELD_KEYS.filter((key) => {
    const slot = med?.[key];
    return slot?.value && slot.status !== "unknown";
  }).length;
  const total = MEDDPICC_FIELD_KEYS.length;
  const cqs = averageCallQuality(detail.callRows);
  const traction = signal?.traction || null;
  const tractionLabel = traction ? traction.charAt(0).toUpperCase() + traction.slice(1) : "—";
  const tractionNote =
    signal?.daysSilent != null
      ? `${signal.daysSilent}d silent`
      : signal?.reasonsJson?.[0] || "Traction after first post-call";
  const tcStatus = tc?.status || "pending";
  const tcLabels = { yes: "Yes", no: "No", pending: "Pending", at_risk: "At risk" };
  const tcLabel = tcLabels[tcStatus] || tcStatus;
  const tcNote = tc?.justification ? String(tc.justification).slice(0, 80) : "After post-call analysis";
  const cqsColor = cqsScoreBand(cqs);
  const medColor = medScoreBand(medScore);
  const tractColor =
    traction === "hot" ? "var(--dew-green)" : traction === "cold" ? "var(--dew-red)" : "var(--dew-amber)";
  const tcColor =
    tcStatus === "yes" ? "var(--dew-green)" : tcStatus === "no" || tcStatus === "at_risk" ? "var(--dew-red)" : "var(--dew-amber)";
  const segOn = Math.max(0, Math.min(total, filled));
  const segs = Array.from({ length: total }, (_, i) => `<i class="${i < segOn ? "on" : ""}"></i>`).join("");

  return `
    <section id="deal-score-strip" class="deal-score-strip" aria-label="Deal score strip">
      <div class="deal-scard" style="--_a:${cqsColor};--_c:${cqsColor}">
        <span class="deal-scard-sl">${esc(CALL_QUALITY_SCORE_LABEL)}</span>
        <span class="deal-scard-sv">${cqs != null ? `${cqs.toFixed(1)}<u>/10</u>` : "—"}</span>
        <span class="deal-scard-bar"><i style="width:${cqs != null ? cqs * 10 : 0}%;background:${cqsColor}"></i></span>
        <span class="deal-scard-note">How you ran the calls</span>
      </div>
      <div class="deal-scard" style="--_a:${medColor};--_c:${medColor}">
        <span class="deal-scard-sl">MEDPICC</span>
        <span class="deal-scard-sv">${esc(String(medScore))}<u>/100</u></span>
        <span class="deal-scard-segbar">${segs}</span>
        <span class="deal-scard-note">${esc(String(filled))} of ${total} surfaced · deal qualification</span>
      </div>
      <div class="deal-scard" style="--_a:${tractColor};--_c:${tractColor}">
        <span class="deal-scard-sl">Traction</span>
        <span class="deal-scard-sv deal-scard-sv--word">${esc(tractionLabel)}</span>
        <span class="deal-scard-note">${esc(tractionNote)}</span>
      </div>
      <div class="deal-scard" style="--_a:${tcColor};--_c:${tcColor}">
        <span class="deal-scard-sl">Technical commit</span>
        <span class="deal-scard-sv deal-scard-sv--word">${esc(tcLabel)}</span>
        <span class="deal-scard-note">${esc(tcNote)}</span>
      </div>
    </section>`;
}

function renderDealGapLine(detail) {
  const deal = detail.selectedDeal;
  const med = resolveDealMeddpicc(deal, detail.account);
  const medScore = med?.completionScore ?? computeMeddpiccScore(med);
  const cqs = averageCallQuality(detail.callRows);
  if (cqs == null || !Number.isFinite(cqs)) return "";
  const medGood = medScore >= 70;
  const cqsMid = cqs < 7;
  const cqsWeak = cqs < 4;
  const medWeak = medScore < 40;
  if (medGood && cqsMid) {
    return `<div class="deal-gapline">The deal is <b>well-qualified (MEDPICC ${esc(String(medScore))})</b> but the call ran <b>${cqsWeak ? "weak" : "middling"} (${cqs.toFixed(1)})</b> — the deal is ahead of your delivery. Tighten the next call.</div>`;
  }
  if (medWeak && cqs >= 7) {
    return `<div class="deal-gapline">Calls are <b>strong (${cqs.toFixed(1)})</b> but the deal is <b>under-qualified (MEDPICC ${esc(String(medScore))})</b> — surface buyer, criteria, and process on the next call.</div>`;
  }
  return "";
}

function renderAiAttachCallout(tc) {
  const summary = formatTcValue(tc?.aiAttach);
  if (!summary) return `<div id="deal-ai-callout" class="deal-callout-mount" hidden></div>`;
  const watch = /skeptic|unproven|not sure|not using|non-standard/i.test(summary);
  return `
    <div id="deal-ai-callout" class="deal-callout-mount">
    <div class="deal-callout${watch ? " deal-callout--warn" : ""}">
      <div>
        <div class="deal-callout-k">AI attach${watch ? " · watch" : ""}</div>
        <p>${esc(summary)}</p>
      </div>
    </div>
    </div>`;
}

function renderRecommendedActionCard(signal) {
  const action = signal?.recommendedAction?.trim();
  if (!action) return "";
  return `
    <section class="account-record-section deal-record-section deal-record-rec account-record-section--card">
      <div class="deal-dothead"><span class="deal-dot" style="background:var(--dew-brand)"></span><span class="prep-form-eyebrow account-section-eyebrow" style="color:var(--dew-brand)">Recommended action</span></div>
      <div class="deal-rec-title">${esc(action)}</div>
      ${
        Array.isArray(signal.reasonsJson) && signal.reasonsJson.length
          ? `<p class="deal-rec-body">${esc(signal.reasonsJson[0])}</p>`
          : ""
      }
    </section>`;
}

function renderCustomerVoiceSection(whatWorks, productGaps) {
  const landed = (whatWorks || []).slice(0, 4);
  const missed = (productGaps || []).slice(0, 4);
  if (!landed.length && !missed.length) {
    return `
      <section class="account-record-section deal-record-section account-record-section--card">
        <div class="deal-dothead"><span class="deal-dot" style="background:#b0785b"></span><span class="prep-form-eyebrow account-section-eyebrow">Customer voice</span></div>
        <p class="muted">Landed themes and doubts appear here after post-call analysis.</p>
      </section>`;
  }
  const quote = (row, cls) => {
    const text = row?.verbatim || row?.description || row?.title || row?.gap || row?.theme || String(row);
    return `<blockquote class="deal-voice-q ${cls}">${esc(text)}</blockquote>`;
  };
  const chip = (row, cls) => {
    const text = row?.title || row?.product || row?.theme || row?.verbatim || row?.description || String(row);
    return `<span class="deal-chip ${cls}">${esc(String(text).slice(0, 48))}</span>`;
  };
  return `
    <section class="account-record-section deal-record-section account-record-section--card">
      <div class="deal-dothead"><span class="deal-dot" style="background:#b0785b"></span><span class="prep-form-eyebrow account-section-eyebrow">Customer voice</span></div>
      <div class="deal-voicegrid">
        <div class="deal-vcol">
          <div class="deal-vh" style="color:var(--dew-green)"><span class="deal-dot" style="background:var(--dew-green)"></span>Landed well</div>
          ${landed.length ? landed.map((r) => quote(r, "pos")).join("") : `<p class="muted">No wins captured yet.</p>`}
          ${landed.length ? `<div class="deal-chips">${landed.map((r) => chip(r, "good")).join("")}</div>` : ""}
        </div>
        <div class="deal-vcol">
          <div class="deal-vh" style="color:#b0785b"><span class="deal-dot" style="background:#b0785b"></span>Doubts &amp; didn’t land</div>
          ${missed.length ? missed.map((r) => quote(r, "neg")).join("") : `<p class="muted">No doubts captured yet.</p>`}
          ${missed.length ? `<div class="deal-chips">${missed.map((r) => chip(r, "bad")).join("")}</div>` : ""}
        </div>
      </div>
    </section>`;
}

function meddpiccScoreTone(score) {
  if (score >= 70) return "deal-record-score--good";
  if (score >= 50) return "deal-record-score--watch";
  return "deal-record-score--risk";
}

function renderMeddpiccCompactCard(deal, account) {
  const med = resolveDealMeddpicc(deal, account);
  const score = med?.completionScore ?? computeMeddpiccScore(med);
  const filled = MEDDPICC_FIELD_KEYS.filter((key) => {
    const slot = med?.[key];
    return slot?.value && slot.status !== "unknown";
  }).length;
  const total = MEDDPICC_FIELD_KEYS.length;

  return `
    <section class="account-record-section deal-record-section deal-record-metric-card deal-record-meddpicc-compact account-record-section--card account-record-section--tight">
      <p class="muted deal-record-metric-eyebrow">MEDPICC · deal qualification</p>
      <p class="deal-record-metric-value ${meddpiccScoreTone(score)}">${esc(String(score))} <span class="muted deal-record-metric-unit">/ 100</span></p>
      <p class="muted deal-record-meddpicc-score">${esc(String(filled))} of ${total} surfaced</p>
      <div class="meddpicc-progress deal-record-score-bar" role="progressbar" aria-valuenow="${score}" aria-valuemin="0" aria-valuemax="100">
        <div class="meddpicc-progress-bar" style="width: ${Math.max(0, Math.min(100, score))}%"></div>
      </div>
    </section>`;
}

function renderMeddpiccSidebar(deal, account) {
  const med = resolveDealMeddpicc(deal, account);
  const score = med?.completionScore ?? computeMeddpiccScore(med);
  const filled = MEDDPICC_FIELD_KEYS.filter((key) => {
    const slot = med?.[key];
    return slot?.value && slot.status !== "unknown";
  }).length;
  const total = MEDDPICC_FIELD_KEYS.length;

  const fields = MEDDPICC_FIELD_KEYS.map((key) => {
    const slot = med?.[key];
    const label = MEDDPICC_FIELD_LABELS[key] || key;
    const letter = MEDDPICC_LETTERS[key] || label.charAt(0);
    return `
      <div class="meddpicc-field meddpicc-field--compact">
        <span class="meddpicc-letter" aria-hidden="true">${esc(letter)}</span>
        <div class="meddpicc-field-body">
          <span class="meddpicc-field-label">${esc(label)}</span>
          <span class="meddpicc-field-status">${meddpiccStatusTag(slot?.status)}</span>
          ${slot?.value ? `<span class="meddpicc-field-value-text muted">${esc(slot.value)}</span>` : ""}
        </div>
      </div>`;
  }).join("");

  return `
    <section class="account-record-section deal-record-section deal-record-meddpicc-sidebar account-record-section--card account-record-section--tight">
      <p class="prep-form-eyebrow account-section-eyebrow">MEDDPICC</p>
      <p class="muted deal-record-meddpicc-score">${esc(String(score))}% · ${filled} of ${total} surfaced</p>
      <div class="meddpicc-field-grid meddpicc-field-grid--sidebar">${fields}</div>
      ${med?.lastUpdatedAt ? `<p class="muted meddpicc-updated">Last updated ${esc(formatDate(med.lastUpdatedAt))}</p>` : ""}
    </section>`;
}

function renderMeddpiccSection(deal, account) {
  const med = resolveDealMeddpicc(deal, account);
  const score = med?.completionScore ?? computeMeddpiccScore(med);
  const filled = MEDDPICC_FIELD_KEYS.filter((key) => {
    const slot = med?.[key];
    return slot?.value && slot.status !== "unknown";
  }).length;
  const total = MEDDPICC_FIELD_KEYS.length;

  const fields = MEDDPICC_FIELD_KEYS.map((key) => {
    const slot = med?.[key];
    const label = MEDDPICC_FIELD_LABELS[key] || key;
    const letter = MEDDPICC_LETTERS[key] || label.charAt(0);
    return `
      <div class="meddpicc-field meddpicc-field--compact">
        <span class="meddpicc-letter" aria-hidden="true">${esc(letter)}</span>
        <div class="meddpicc-field-body">
          <span class="meddpicc-field-label">${esc(label)}</span>
          <span class="meddpicc-field-status">${meddpiccStatusTag(slot?.status)}</span>
          ${slot?.value ? `<span class="meddpicc-field-value-text muted">${esc(slot.value)}</span>` : ""}
        </div>
      </div>`;
  }).join("");

  return `
    <section class="account-record-section deal-record-section deal-record-meddpicc">
      <div class="account-record-section-head">
        <h3 class="account-record-section-title">MEDDPICC</h3>
        <fw-tag text="${score}% · ${filled}/${total}" color="grey"></fw-tag>
      </div>
      <div class="meddpicc-progress" role="progressbar" aria-valuenow="${score}" aria-valuemin="0" aria-valuemax="100">
        <div class="meddpicc-progress-bar" style="width: ${Math.max(0, Math.min(100, score))}%"></div>
      </div>
      <p class="muted deal-record-meddpicc-score">${esc(score)}% completion · ${filled} of ${total} surfaced</p>
      <div class="meddpicc-field-grid">${fields}</div>
      ${med?.lastUpdatedAt ? `<p class="muted meddpicc-updated">Last updated ${esc(formatDate(med.lastUpdatedAt))}</p>` : ""}
    </section>`;
}

function renderVelocitySection(daysInStage, stageMedianDays, callCount, daysSilent) {
  const overMedian = daysInStage > stageMedianDays;
  const velocityClass = overMedian ? "deal-record-velocity--slow" : "deal-record-velocity--ok";
  const silentNote = daysSilent != null ? `${daysSilent}d silent · ` : "";
  return `
    <section class="account-record-section deal-record-section deal-record-metric-card ${velocityClass} account-record-section--card account-record-section--tight">
      <p class="muted deal-record-metric-eyebrow">Deal velocity</p>
      <p class="deal-record-metric-value${overMedian ? " deal-record-score--risk" : ""}">${esc(String(daysInStage))}d <span class="muted deal-record-metric-unit">in stage</span></p>
      <p class="muted deal-record-metric-sub">${esc(String(callCount || 0))} calls · ${esc(silentNote)}median for stage is ${esc(String(stageMedianDays))}d</p>
      <div class="meddpicc-progress deal-record-velocity-bar" role="presentation">
        <div class="meddpicc-progress-bar" style="width: ${Math.min(100, Math.round((daysInStage / Math.max(stageMedianDays, 1)) * 50))}%"></div>
      </div>
    </section>`;
}

function renderTractionSection(signal) {
  if (!signal) {
    return `
      <section class="account-record-section deal-record-section deal-record-traction deal-record-traction--empty">
        <h3 class="account-record-section-title">Traction</h3>
        <p class="muted">Traction rollup appears after the first post-call on this deal.</p>
      </section>`;
  }

  const reasons = Array.isArray(signal.reasonsJson) ? signal.reasonsJson : [];
  const reasonRows = reasons.length
    ? reasons.map((r) => `<li>${esc(r)}</li>`).join("")
    : `<li class="muted">No traction reasons recorded yet.</li>`;

  return `
    <section class="account-record-section deal-record-section deal-record-traction deal-record-traction--${esc(signal.traction || "warm")} account-record-section--card${signal.traction === "cold" ? " deal-record-traction--cold-card" : ""}">
      <div class="account-record-section-head">
        <p class="prep-form-eyebrow account-section-eyebrow">Traction${signal.traction === "cold" ? " · why this is cold" : ""}</p>
        ${tractionTag(signal.traction)}
      </div>
      <ul class="deal-traction-reasons">${reasonRows}</ul>
      ${signal.recommendedAction
        ? `<div class="deal-traction-action">
            <h4 class="deal-traction-action-title">Recommended action</h4>
            <p>${esc(signal.recommendedAction)}</p>
          </div>`
        : ""}
    </section>`;
}

function renderFitmentSection(deal) {
  const functional = deal?.functionalFitment ?? deal?.metadata?.functionalFitment;
  const technical = deal?.technicalFitment ?? deal?.metadata?.technicalFitment;

  function fitmentCard(label, value) {
    if (value == null || !Number.isFinite(Number(value))) {
      return `
        <div class="deal-record-metric-card deal-record-fitment-card deal-record-fitment-card--empty">
          <h4 class="deal-record-fitment-label">${esc(label)}</h4>
          <p class="muted">Not assessed yet</p>
        </div>`;
    }
    const pct = Math.max(0, Math.min(100, Math.round(Number(value))));
    return `
      <div class="deal-record-metric-card deal-record-fitment-card">
        <h4 class="deal-record-fitment-label">${esc(label)}</h4>
        <p class="deal-record-metric-value">${pct}<span class="muted deal-record-metric-unit">%</span></p>
        <div class="meddpicc-progress" role="progressbar" aria-valuenow="${pct}" aria-valuemin="0" aria-valuemax="100">
          <div class="meddpicc-progress-bar" style="width: ${pct}%"></div>
        </div>
      </div>`;
  }

  return `
    <section class="account-record-section deal-record-section deal-record-fitment account-record-section--card">
      <p class="prep-form-eyebrow account-section-eyebrow">Fitment</p>
      <div class="deal-record-fitment-grid">
        ${fitmentCard("Functional fitment", functional)}
        ${fitmentCard("Technical fitment", technical)}
      </div>
    </section>`;
}

function renderDealProductSignalSection(productGaps, whatWorks) {
  if (!productGaps?.length && !whatWorks?.length) {
    return `
      <section class="account-record-section deal-record-section deal-record-product-signal deal-record-product-signal--empty">
        <h3 class="account-record-section-title">Product signal</h3>
        <p class="muted">Product gaps and wins appear here after post-call analysis on this deal.</p>
      </section>`;
  }
  return `<div class="deal-record-product-signal">${renderCallProductSignalTab({}, { productGaps, whatWorks, dealRollup: true })}</div>`;
}

function renderTechnicalCommitSection(tc) {
  if (!tc) {
    return `
      <section class="account-record-section deal-record-section deal-record-tc deal-record-tc--empty">
        <h3 class="account-record-section-title">Technical commit</h3>
        <p class="muted">Technical commit snapshot appears after post-call analysis on a linked deal.</p>
      </section>`;
  }

  const fields = [
    ["Incumbent", formatTcValue(tc.incumbent)],
    ["Competitor", formatTcValue(tc.competitor)],
    ["Identified risk", formatTcValue(tc.identifiedRisk)],
    ["Go live", formatTcValue(tc.timelineForClosure)],
    ["Reason for evaluation", formatTcValue(tc.reasonForEvaluation)],
    ["AI attach", formatTcValue(tc.aiAttach)],
  ].filter(([, v]) => v);

  const fieldRows = fields.length
    ? fields
        .map(
          ([label, value]) =>
            `<div class="deal-tc-field"><span class="muted">${esc(label)}</span><span>${esc(value)}</span></div>`,
        )
        .join("")
    : "";

  return `
    <section class="account-record-section deal-record-section deal-record-tc account-record-section--card">
      <div class="account-record-section-head">
        <p class="prep-form-eyebrow account-section-eyebrow">Technical commit · justification</p>
        ${tcStatusTag(tc.status)}
      </div>
      ${tc.justification ? `<p class="deal-tc-justification">${esc(tc.justification)}</p>` : `<p class="muted">No justification on file yet.</p>`}
      ${fieldRows ? `<div class="deal-tc-fields deal-tc-fields--grid">${fieldRows}</div>` : ""}
      ${tc.updatedAt ? `<p class="muted meddpicc-updated">Updated ${esc(formatDate(tc.updatedAt))}</p>` : ""}
    </section>`;
}

function renderCallsSection(callRows, sectionOpts = {}) {
  const wireframe = sectionOpts.wireframe === true;
  const cardClass = wireframe ? " account-record-section--card deal-record-calls--wireframe" : "";

  const rows = (callRows || []).map(({ postCall, movement }) => {
    const callType = resolveCallType({ ...postCall, timestamp: postCall.createdAt });
    const typeLabel = CALL_TYPE_LABELS[callType] || callType || "-";
    return `
      <tr class="deal-calls-row" data-call-id="${esc(postCall.id)}" tabindex="0" role="button">
        <td class="deal-calls-col deal-calls-col--title">${esc(callTitle(postCall))}</td>
        <td class="deal-calls-col deal-calls-col--type"><fw-tag text="${esc(typeLabel)}" color="blue"></fw-tag></td>
        <td class="deal-calls-col deal-calls-col--date muted">${esc(wireframe ? formatShortDate(postCall.createdAt) : formatDate(postCall.createdAt))}</td>
        <td class="deal-calls-col deal-calls-col--length muted">${esc(formatLength(resolveDurationMinutes(postCall)))}</td>
        <td class="deal-calls-col deal-calls-col--movement">${esc(movement)}</td>
      </tr>`;
  });

  const body =
    rows.length ?
      rows.join("")
    : `<tr><td colspan="5" class="muted deal-calls-empty">No calls on this deal yet.</td></tr>`;

  if (wireframe) {
    return `
      <section class="account-record-section deal-record-section deal-record-calls${cardClass}">
        <p class="prep-form-eyebrow account-section-eyebrow deal-record-calls-eyebrow">Calls on this deal</p>
        <div class="deal-calls-table-wrap">
          <table class="deal-calls-table">
            <thead>
              <tr>
                <th scope="col">Call</th>
                <th scope="col">Type</th>
                <th scope="col">Date</th>
                <th scope="col">Length</th>
                <th scope="col">What it moved</th>
              </tr>
            </thead>
            <tbody>${body}</tbody>
          </table>
        </div>
      </section>`;
  }

  return `
    <section class="account-record-section deal-record-section deal-record-calls">
      <h3 class="account-record-section-title">Calls on this deal</h3>
      <p class="muted deal-record-calls-note">What each call moved, from MEDDPICC and technical commit deltas.</p>
      <div class="deal-calls-table-wrap">
        <table class="deal-calls-table">
          <thead>
            <tr>
              <th scope="col">Call</th>
              <th scope="col">Type</th>
              <th scope="col">Date</th>
              <th scope="col">Length</th>
              <th scope="col">What it moved</th>
            </tr>
          </thead>
          <tbody>${body}</tbody>
        </table>
      </div>
    </section>`;
}

function renderOpenItemsPanel(deal) {
  const count = deal?.openTaskCount ?? 0;
  return `
    <section class="account-record-section deal-record-section deal-record-open-items account-record-section--card account-record-section--tight">
      <p class="prep-form-eyebrow account-section-eyebrow">Open items</p>
      ${
        count
          ? `<p class="deal-open-items-summary">${esc(String(count))} open follow-up${count === 1 ? "" : "s"} on this deal</p>`
          : `<p class="muted">No open follow-ups tracked yet.</p>`
      }
    </section>`;
}

function renderDealDetailsCard(deal, account) {
  const meta = account?.metadata || {};
  const rows = [
    ["Created", formatDate(deal.createdAt)],
    ["Updated", formatDate(deal.updatedAt)],
    ["Sub region", meta.sub_region || meta.subRegion || "-"],
    ["Forecast month", deal.forecastMonth || "-"],
    ["SF opportunity", deal.sfOpportunityId || "-"],
  ];

  const body = rows
    .map(
      ([label, value]) =>
        `<div class="deal-reporting-row"><span class="muted">${esc(label)}</span><span>${esc(String(value))}</span></div>`,
    )
    .join("");

  return `
    <section class="account-record-section deal-record-section deal-record-details-card account-record-section--card account-record-section--tight">
      <p class="prep-form-eyebrow account-section-eyebrow">Deal details</p>
      <div class="deal-reporting-body">${body}</div>
    </section>`;
}

/** People on the deal — AE + customer contact tiles (identifiers alongside the SE team). */
function renderDealContactsPanel(detail) {
  const deal = detail.selectedDeal || {};
  const ae = deal?.metadata?.ae;
  const aeText = ae ? (ae.name || ae.email || "") : "";
  const aeLine = aeText
    ? `<div class="deal-reporting-row"><span class="muted">AE</span><span>${esc(aeText)}</span></div>`
    : "";
  const primaryContactId = deal?.primaryContactId || detail.primaryContactId || null;
  return `
    <section class="account-record-section deal-record-section deal-record-contacts-card account-record-section--card account-record-section--tight">
      <p class="prep-form-eyebrow account-section-eyebrow">Contacts</p>
      ${aeLine}
      ${renderContactTileList(detail.contacts || [], { primaryContactId, emptyText: "No contacts yet." })}
    </section>`;
}

function renderReportingFields(deal, account) {
  const meta = account?.metadata || {};
  const rows = [
    ["Created", formatDate(deal.createdAt)],
    ["Updated", formatDate(deal.updatedAt)],
    ["Status", dealStatusLabel(deal.status)],
    ["Stage", STAGE_LABELS[deal.stage] || deal.stage],
    ["Motion", DEAL_TYPE_LABELS[deal.type] || deal.type],
    ["Region", meta.region || "-"],
    ["Sub region", meta.sub_region || meta.subRegion || "-"],
    ["Forecast month", deal.forecastMonth || "-"],
    ["Competitive position", deal.competitivePosition || "-"],
    ["Copilot", deal.copilotFlag != null ? String(deal.copilotFlag) : "-"],
    ["SF opportunity", deal.sfOpportunityId || "-"],
  ];

  const body = rows
    .map(
      ([label, value]) =>
        `<div class="deal-reporting-row"><span class="muted">${esc(label)}</span><span>${esc(String(value))}</span></div>`,
    )
    .join("");

  return `
    <details class="account-record-section deal-record-section deal-record-reporting">
      <summary class="deal-record-reporting-summary">
        <span class="account-record-section-title">Reporting fields</span>
      </summary>
      <div class="deal-reporting-body">${body}</div>
    </details>`;
}

function renderDealHeaderArr(deal) {
  const band = formatDealListMoneyBand(deal?.arrEstimateLow, deal?.arrEstimateHigh, deal?.arrEstimatePoint);
  if (band === "-") return "";
  const agents = deal?.arrInputsJson?.agents;
  const agentNote = agents != null ? `${agents} agents` : "estimate";
  return `
    <div class="deal-header-arr">
      <div class="deal-header-arr-value">${esc(band)}</div>
      <div class="deal-header-arr-label muted">derived · ${esc(agentNote)}</div>
    </div>`;
}

function renderDealStatusPills(detail) {
  const deal = detail.selectedDeal;
  const signal = detail.latestSignal;
  const tc = detail.technicalCommit;
  const pills = [stageBadge(deal?.stage)];
  if (tc?.status) pills.push(tcStatusTag(tc.status));
  if (deal?.competitivePosition) {
    pills.push(`<fw-tag text="${esc(deal.competitivePosition)}" color="green"></fw-tag>`);
  }
  const aiSummary = formatTcValue(tc?.aiAttach);
  if (aiSummary) {
    pills.push(`<fw-tag text="AI · ${esc(aiSummary)}" color="purple"></fw-tag>`);
  }
  if (signal?.traction) {
    pills.push(tractionTag(signal.traction));
    if (signal.daysSilent != null) {
      pills.push(`<fw-tag text="${esc(String(signal.daysSilent))}d silent" color="red"></fw-tag>`);
    }
  }
  return `<div class="deal-record-pills">${pills.join("")}</div>`;
}

function renderDealRecordHeader(detail, backOpts = {}) {
  const deal = detail.selectedDeal;
  const account = detail.account;
  const signal = detail.latestSignal;
  const dealTitle = deal?.title || DEAL_TYPE_LABELS[deal?.type] || "Deal";
  const accountLabel = account?.name || account?.domain || "Account";
  const domain = account?.domain || "";
  const back = backOpts || {};
  const useAccountBack = back.accountId && account?.id === back.accountId;
  const backLabel = useAccountBack
    ? `← ${account?.name || account?.domain || "Account"}`
    : "← All deals";
  const backAction = useAccountBack ? "back-to-account" : "back-to-deal-list";

  return `
    <header class="deal-record-header deal-record-header--labs">
      <button type="button" class="deal-crumb" data-action="${esc(backAction)}">${esc(backLabel)}</button>
      <div class="deal-dhead">
        <div class="deal-dhead-lft">
          <span class="deal-logo" aria-hidden="true">${esc(dealInitials(dealTitle))}</span>
          <div>
            <div class="deal-titlerow">
              <h1 class="deal-record-title">${esc(dealTitle)}</h1>
              ${stagePill(deal?.stage)}
              ${tractionPill(signal?.traction)}
            </div>
            <div class="deal-dom">
              ${esc(domain || accountLabel)}
              ${listMotionBadge(deal?.type)}
            </div>
          </div>
        </div>
        <div class="deal-dhead-acts account-detail-actions">
          <fw-button color="secondary" fill="outline" size="small" data-action="prep">New brief</fw-button>
          <fw-button color="secondary" fill="outline" size="small" data-action="postcall">Post-call</fw-button>
          ${renderDealHeaderArr(deal)}
        </div>
      </div>
    </header>`;
}

/** @param {object} detail @param {object} [viewOpts] */
function renderDealRecord(detail, viewOpts = {}) {
  const deal = detail.selectedDeal;
  const signal = detail.latestSignal;
  const backContext = viewOpts.backContext || null;

  return `
    <div class="lifecycle-detail deal-detail deal-record deal-record--wireframe deal-record--labs">
      <div class="deal-record-top deal-record-top--labs">
        ${renderDealRecordHeader(detail, backContext || {})}
      </div>
      ${renderAiAttachCallout(detail.technicalCommit)}
      ${renderDealScoreStrip(detail)}
      ${renderDealGapLine(detail)}
      <div class="deal-record-layout">
        <div class="deal-record-main">
          ${renderGeneratedSummarySection(
            "Deal summary",
            detail.dealSummary,
            "Generated after the first post-call on this deal; rewritten after every call.",
            { wireframe: true },
          )}
          ${renderRecommendedActionCard(signal)}
          ${renderCustomerVoiceSection(detail.whatWorks, detail.productGaps)}
          ${renderTechnicalCommitSection(detail.technicalCommit)}
          ${renderFitmentSection(deal)}
          ${renderDealProductSignalSection(detail.productGaps, detail.whatWorks)}
          ${renderCallsSection(detail.callRows, { wireframe: true })}
        </div>
        <aside class="deal-record-aside">
          ${renderMeddpiccSidebar(deal, detail.account)}
          ${renderOpenItemsPanel(deal)}
          <div id="deal-arr-module-mount" class="deal-arr-module-mount"></div>
          ${renderDealContactsPanel(detail)}
          ${renderDealDetailsCard(deal, detail.account)}
          ${renderReportingFields(deal, detail.account)}
        </aside>
      </div>
    </div>`;
}

/**
 * Resolve deal nav id — canonical store id, history fallback id, or deal_hist slug alias.
 * @param {object} session
 * @param {string} dealId
 * @returns {Promise<string|null>}
 */
export async function resolveDealNavId(session, dealId) {
  if (!dealId) return null;

  const storeDeal = await safeStoreOp("getDeal", () => getDeal(dealId), null);
  if (storeDeal?.accountId) return dealId;

  const histRows = listDealsFromHistory(session);
  const exactHist = histRows.find((r) => r.deal.id === dealId);
  if (exactHist) return exactHist.deal.id;

  if (dealId.startsWith("deal_hist_")) {
    const slug = dealId.slice("deal_hist_".length);
    const bySlug = histRows.find((r) => {
      const acctSlug = String(r.account?.id || "").replace(/^hist_/, "");
      return acctSlug === slug;
    });
    if (bySlug) return bySlug.deal.id;

    try {
      const rows = await listDealsForSession(session, { resolveOwnerFb: opts.resolveOwnerFb });
      const fromStore = rows.find((r) => {
        const nameSlug = String(r.account?.name || "")
          .toLowerCase()
          .replace(/[^a-z0-9]+/g, "-")
          .slice(0, 40);
        const acctSlug = String(r.account?.id || "").replace(/^hist_/, "");
        return nameSlug === slug || acctSlug === slug || acctSlug.endsWith(slug);
      });
      if (fromStore?.deal?.id) return fromStore.deal.id;
    } catch (err) {
      console.warn("[deal-view] resolveDealNavId store lookup failed:", err?.message || err);
    }
  }

  return dealId;
}

/** @param {HTMLElement} container @param {object} opts @param {string} html @returns {boolean} */
function applyDealViewHtml(container, opts, html) {
  if (opts.shouldApply && !opts.shouldApply()) return false;
  container.innerHTML = html;
  return true;
}

function stopDealViewSubscriptions(container) {
  for (const key of ["_dealsUnsub", "_dealDetailUnsub", "_dealArrUnsub"]) {
    if (typeof container?.[key] === "function") {
      container[key]();
      container[key] = null;
    }
  }
}

/** Instant preview from local history before Firestore resolves. */
function resolveDealPreview(session, dealId) {
  if (!dealId) return null;
  const histRows = listDealsFromHistory(session);
  const histMatch =
    histRows.find((r) => r.deal.id === dealId) ||
    (dealId.startsWith("deal_hist_")
      ? histRows.find((r) => {
          const slug = dealId.slice("deal_hist_".length);
          const acctSlug = String(r.account?.id || "").replace(/^hist_/, "");
          return acctSlug === slug;
        })
      : null);
  if (histMatch) {
    return {
      dealTitle: histMatch.deal.title || histMatch.account.name || "Deal",
      accountLabel: histMatch.account.name || histMatch.account.domain || "Account",
    };
  }
  return { dealTitle: "Deal", accountLabel: "Account" };
}

/** Immediate shell while engagement detail + store enrichments load. */
function renderDealLoadingShell(preview, backOpts = {}) {
  const back = backOpts || {};
  const dealTitle = preview?.dealTitle || "Deal";
  const accountLabel = preview?.accountLabel || "Account";
  const useAccountBack = back.accountId && preview?.accountId === back.accountId;
  const backLabel = useAccountBack
    ? `← ${preview?.accountName || accountLabel || "Account"}`
    : "← All deals";
  const backAction = useAccountBack ? "back-to-account" : "back-to-deal-list";
  return `
    <div class="lifecycle-detail deal-detail deal-record deal-record--loading">
      <div class="deal-record-top deal-record-top--wireframe">
        <header class="account-record-header deal-record-header deal-record-header--wireframe">
          <fw-button class="lifecycle-back" color="secondary" fill="clear" data-action="${esc(backAction)}">${esc(backLabel)}</fw-button>
          <div class="deal-record-header-main">
            <h2 class="deal-record-title">${esc(dealTitle)}</h2>
            <p class="muted deal-record-subtitle">${esc(accountLabel)}</p>
          </div>
        </header>
      </div>
      ${renderLoadingPanel("Loading deal record…")}
    </div>`;
}

/** @param {import("./domain/store.js").Store} store @param {object} deal */
async function enrichDealRecordExtras(store, deal) {
  const CALL_ROW_ENRICH_LIMIT = 12;
  const [
    technicalCommit,
    signals,
    daysInStage,
    stageMedianDays,
    postCalls,
    arrLines,
    dealSummary,
    productGapsRaw,
    whatWorksRaw,
  ] = await Promise.all([
    safeStoreOp(
      "getTechnicalCommitByDeal",
      () => (store.getTechnicalCommitByDeal ? store.getTechnicalCommitByDeal(deal.id) : null),
      null,
    ),
    safeStoreOp(
      "listDealSignalsByDeal",
      () => (store.listDealSignalsByDeal ? store.listDealSignalsByDeal(deal.id, 1) : []),
      [],
    ),
    safeStoreOp("computeDaysInStage", () => computeDaysInStage(store, deal), 0),
    safeStoreOp(
      "computeStageMedianDays",
      () => computeStageMedianDays(store, deal.accountId, deal.stage),
      34,
    ),
    safeStoreOp(
      "listCallSummariesByDeal",
      () => (store.listCallSummariesByDeal ? store.listCallSummariesByDeal(deal.id, 50) : []),
      [],
    ),
    safeStoreOp(
      "listArrLinesByDeal",
      () => (store.listArrLinesByDeal ? store.listArrLinesByDeal(deal.id) : []),
      [],
    ),
    safeStoreOp(
      "getDealSummaryByDeal",
      () => (store.getDealSummaryByDeal ? store.getDealSummaryByDeal(deal.id) : null),
      null,
    ),
    safeStoreOp(
      "listProductGapsByDeal",
      () => (store.listProductGapsByDeal ? store.listProductGapsByDeal(deal.id, 500) : []),
      [],
    ),
    safeStoreOp(
      "listWhatWorksByDeal",
      () => (store.listWhatWorksByDeal ? store.listWhatWorksByDeal(deal.id, 500) : []),
      [],
    ),
  ]);

  const productGaps = rollupProductSignalRows(productGapsRaw);
  const whatWorks = rollupProductSignalRows(whatWorksRaw);

  // #region agent log
  fetch("http://127.0.0.1:7766/ingest/793ffe0c-a3bb-4749-8869-0b3f191d9f2f", {
    method: "POST",
    headers: { "Content-Type": "application/json", "X-Debug-Session-Id": "5dd933" },
    body: JSON.stringify({
      sessionId: "5dd933",
      location: "deal-view.js:enrichDealRecordExtras",
      message: "deal product signal load",
      data: { dealId: deal.id, gapCount: productGaps.length, workCount: whatWorks.length },
      timestamp: Date.now(),
      hypothesisId: "PS-deal-read",
    }),
  }).catch(() => {});
  // #endregion

  const sortedCalls = [...postCalls].sort((a, b) => (b.createdAt || 0) - (a.createdAt || 0));
  const enrichHead = sortedCalls.slice(0, CALL_ROW_ENRICH_LIMIT);
  const enrichTail = sortedCalls.slice(CALL_ROW_ENRICH_LIMIT);

  const headRows = await Promise.all(
    enrichHead.map(async (postCall) => {
      const [meddpiccDeltas, tcDeltas] = await Promise.all([
        safeStoreOp(
          "listMeddpiccDeltasByCall",
          () => (store.listMeddpiccDeltasByCall ? store.listMeddpiccDeltasByCall(postCall.id) : []),
          [],
        ),
        safeStoreOp(
          "listTcDeltasByCall",
          () => (store.listTcDeltasByCall ? store.listTcDeltasByCall(postCall.id) : []),
          [],
        ),
      ]);
      return {
        postCall,
        meddpiccDeltas,
        tcDeltas,
        movement: formatCallMovement(meddpiccDeltas, tcDeltas),
      };
    }),
  );
  const tailRows = enrichTail.map((postCall) => ({
    postCall,
    meddpiccDeltas: [],
    tcDeltas: [],
    movement: null,
  }));
  const callRows = [...headRows, ...tailRows];

  return {
    technicalCommit,
    latestSignal: signals[0] || null,
    daysInStage,
    stageMedianDays,
    callRows,
    arrLines,
    dealSummary,
    productGaps,
    whatWorks,
  };
}

/** Deal record shell when engagement detail lacks a lifecycle (deals nav). */
async function buildDealRecordDetailFromStore(session, deal, resolvedDealId, extras) {
  const store = getStore();
  const account = await safeStoreOp("getAccount", () => store.getAccount(deal.accountId), null);
  if (!account) return null;
  return {
    account,
    selectedDeal: deal,
    selectedDealId: deal.id,
    dealSummary: extras.dealSummary,
    ...extras,
    resolvedDealId,
  };
}

/** @param {object} session @param {string} dealId @param {object} [opts] */
async function loadDealRecordDetail(session, dealId, opts = {}) {
  const resolvedDealId = await resolveDealNavId(session, dealId);
  if (!resolvedDealId) return null;

  const deal = await safeStoreOp("getDeal", () => getDeal(resolvedDealId), null);
  if (!deal?.accountId) {
    const histRow = listDealsFromHistory(session).find((r) => r.deal.id === resolvedDealId);
    if (histRow) {
      const historyRecs = historyRecordsForAccount(session, histRow.account.id);
      const historyExtras = buildDealExtrasFromHistory(histRow.deal, histRow.account, historyRecs);
      let detail = null;
      try {
        detail = await getAccountEngagementDetail(session, histRow.account.id, {
          dealId: histRow.deal.id,
          lifecycleOwnerId: opts.lifecycleOwnerId,
        });
      } catch (err) {
        console.warn("[deal-view] history deal detail failed:", err?.message || err);
      }
      if (detail) {
        return {
          ...detail,
          ...historyExtras,
          selectedDeal: historyExtras.selectedDeal || detail.selectedDeal,
          dealSummary: historyExtras.dealSummary || detail.dealSummary,
          resolvedDealId,
          callRows: historyExtras.callRows?.length ? historyExtras.callRows : detail.callRows || [],
        };
      }
      return {
        account: histRow.account,
        lifecycle: { id: `lc_hist_${histRow.account.id}`, stage: histRow.deal.stage, title: histRow.account.name },
        selectedDeal: historyExtras.selectedDeal || histRow.deal,
        selectedDealId: histRow.deal.id,
        dealSummary: historyExtras.dealSummary,
        resolvedDealId,
        ...historyExtras,
      };
    }
    return null;
  }

  const store = getStore();
  let engagementDetail = null;
  const extrasPromise = enrichDealRecordExtras(store, deal);
  try {
    engagementDetail = await getAccountEngagementDetail(session, deal.accountId, {
      dealId: deal.id,
      lifecycleOwnerId: opts.lifecycleOwnerId,
    });
  } catch (err) {
    console.warn("[deal-view] store deal detail failed:", err?.message || err);
  }

  // NOTE: no onPartialDetail emit here. Rendering a partial record with
  // technicalCommit/latestSignal/callRows empty produced a "TC Pending / Traction — /
  // no ARR" tile that then flickered to the real values. Keep the loading shell until
  // the full detail (with score strip data) is ready, then render ONCE. The realtime
  // subscription patches tiles in place afterward.

  const extras = await extrasPromise;
  if (engagementDetail) {
    const historyRecs = engagementDetail._historyFallback
      ? historyRecordsForAccount(session, deal.accountId)
      : [];
    const historyExtras =
      historyRecs.length ? buildDealExtrasFromHistory(deal, engagementDetail.account, historyRecs) : null;
    return {
      ...engagementDetail,
      resolvedDealId,
      ...extras,
      ...(historyExtras
        ? {
            selectedDeal: historyExtras.selectedDeal || engagementDetail.selectedDeal,
            dealSummary: extras.dealSummary || historyExtras.dealSummary || engagementDetail.dealSummary,
            technicalCommit: extras.technicalCommit || historyExtras.technicalCommit,
            latestSignal: extras.latestSignal || historyExtras.latestSignal,
            daysInStage: extras.daysInStage ?? historyExtras.daysInStage,
            stageMedianDays: extras.stageMedianDays ?? historyExtras.stageMedianDays,
            callRows: extras.callRows?.length ? extras.callRows : historyExtras.callRows,
          }
        : {}),
    };
  }

  return buildDealRecordDetailFromStore(session, deal, resolvedDealId, extras);
}

function wireDealListItemClicks(container, opts) {
  container.querySelectorAll(".deal-list-row[data-deal-id]").forEach((row) => {
    const activate = () => {
      const id = row.getAttribute("data-deal-id");
      if (id) opts.onSelectDeal?.(id);
    };
    row.addEventListener("click", () => activate());
    row.addEventListener("keydown", (e) => {
      if (e.key === "Enter" || e.key === " ") {
        e.preventDefault();
        activate();
      }
    });
  });
}

function wireDealListFilter(container, allRows, opts) {
  const input = container.querySelector("#deal-list-search");
  const listEl = container.querySelector(".deal-list-tbody");
  if (!input || !listEl) return;

  const renderFiltered = (query) => {
    const sorted = sortDealListRows(allRows, opts.listSortKey || "traction");
    const filtered = filterDealRows(sorted, query);
    listEl.innerHTML = filtered.length
      ? filtered.map((row) => renderDealListItem(row)).join("")
      : `<tr><td colspan="8" class="deal-list-no-matches muted">No deals match “${esc(query)}”</td></tr>`;
    wireDealListItemClicks(listEl, opts);
  };

  const run = () => {
    void readFieldValueAsync(input).then((v) => {
      opts.listSearchQuery = v;
      opts.onListSearchQueryChange?.(v);
      renderFiltered(v);
    });
  };

  input.addEventListener("fwInput", run);
  input.addEventListener("input", run);

  if (opts.listSearchQuery) {
    renderFiltered(opts.listSearchQuery);
  }
}

function wireDealListSort(container, allRows, opts) {
  container.querySelectorAll("[data-deal-sort]").forEach((btn) => {
    btn.addEventListener("click", (e) => {
      e.preventDefault();
      e.stopPropagation();
      const key = btn.getAttribute("data-deal-sort");
      if (!key) return;
      opts.listSortKey = key;
      opts.onListSortKeyChange?.(key);

      const thead = container.querySelector(".deal-list-table thead");
      if (thead) {
        thead.outerHTML = renderDealListSortHeader(key);
        wireDealListSort(container, allRows, opts);
      }

      const listEl = container.querySelector(".deal-list-tbody");
      if (listEl) {
        const sorted = sortDealListRows(allRows, key);
        const filtered = filterDealRows(sorted, opts.listSearchQuery || "");
        listEl.innerHTML = filtered.length
          ? filtered.map((row) => renderDealListItem(row)).join("")
          : opts.listSearchQuery
            ? `<tr><td colspan="8" class="deal-list-no-matches muted">No deals match “${esc(opts.listSearchQuery)}”</td></tr>`
            : "";
        wireDealListItemClicks(listEl, opts);
      }
    });
  });
}

function paintDealList(container, opts, rows) {
  if (opts.shouldApply && !opts.shouldApply()) return false;

  const tractionFiltered = filterDealRowsForList(rows, opts.listTractionFilter);
  const sortKey = opts.listSortKey || "traction";
  const sortedRows = sortDealListRows(tractionFiltered, sortKey);
  const listQuery = opts.listSearchQuery || "";
  const filtered = filterDealRows(sortedRows, listQuery);
  const openCount = rows.filter((row) => isOpenPipelineDeal(row.deal)).length;
  const listMetrics = summarizeDealListMetrics(rows);

  if (!filtered.length && !rows.length) {
    return applyDealViewHtml(
      container,
      opts,
      renderDealsEmptyState(
        "No deals yet. Run a prep or post-call on an account to create your first opportunity.",
      ),
    );
  }

  const applied = applyDealViewHtml(
    container,
    opts,
    `
      <div class="lifecycle-list-view deal-list-view deal-list-view--labs">
        <div class="deal-list-toolbar">
          <div class="deal-list-title-group">
            <h1 class="deal-list-heading">${opts.listTractionFilter === "cold" ? "Cold deals" : "Your deals"}</h1>
            <p class="deal-list-subtitle">${esc(dealListSubtitle(openCount, opts))}</p>
          </div>
          <fw-input id="deal-list-search" class="deal-list-search" placeholder="Search deals" value="${esc(listQuery)}" clear-input></fw-input>
        </div>
        <div class="deal-list-metrics-host">${renderDealListMetrics(listMetrics)}</div>
        <div class="deal-list-table-card">
          <div class="deal-list-table-wrap">
            <table class="deal-list-table">
              ${renderDealListSortHeader(sortKey)}
              <tbody class="deal-list-tbody">
                ${filtered.length
                  ? filtered.map((row) => renderDealListItem(row)).join("")
                  : `<tr><td colspan="8" class="deal-list-no-matches muted">No deals match “${esc(listQuery)}”</td></tr>`}
              </tbody>
            </table>
          </div>
        </div>
        <p class="deal-list-footnote">${esc(CALL_QUALITY_SCORE_LABEL)} grades <b>you</b>. MEDPICC grades the <b>deal</b>. When they diverge sharply, the gap is the story.</p>
      </div>`,
  );
  if (!applied) return false;

  wireDealListItemClicks(container, opts);
  wireDealListFilter(container, rows, opts);
  wireDealListSort(container, rows, opts);
  return true;
}

function wireDealRecordEvents(container, session, opts, detail) {
  const onBack = (action) => {
    if (action === "back-to-deal-list") opts.onBackToDealList?.();
    else if (action === "back-to-account") opts.onBackToAccount?.();
  };
  container.querySelectorAll('[data-action="back-to-deal-list"], [data-action="back-to-account"]').forEach((el) => {
    const action = el.getAttribute("data-action");
    el.addEventListener("fwClick", () => onBack(action));
    el.addEventListener("click", () => onBack(action));
  });

  const engage = (view) => {
    invalidateDealListCache();
    const deal = detail.selectedDeal;
    setAccountEngagementContext({
      accountId: detail.account?.id,
      dealId: deal?.id || null,
      prepType: deal?.type === "expansion" ? "expansion" : "new_business",
      lifecycleId: detail.lifecycle?.id || null,
    });
    if (view === "prep") opts.onPrep?.();
    else opts.onPostcall?.();
  };

  container.querySelector('[data-action="prep"]')?.addEventListener("fwClick", () => engage("prep"));
  container.querySelector('[data-action="postcall"]')?.addEventListener("fwClick", () => engage("postcall"));

  wireContactTiles(container, (accountId) => {
    if (opts.onOpenAccount) opts.onOpenAccount(accountId);
  });

  container.querySelectorAll(".deal-calls-row[data-call-id]").forEach((row) => {
    const open = (e) => {
      e?.preventDefault?.();
      e?.stopPropagation?.();
      const id = row.getAttribute("data-call-id");
      if (id) opts.onOpenCall?.(id);
    };
    row.addEventListener("click", open);
    row.addEventListener("keydown", (e) => {
      if (e.key === "Enter" || e.key === " ") {
        e.preventDefault();
        open();
      }
    });
  });
}

/** @param {HTMLElement} container @param {object} session @param {object} opts */
export async function renderDealView(container, session, opts = {}) {
  stopDealViewSubscriptions(container);
  let activeSession = session;
  if (!sessionUserId(activeSession)) {
    try {
      activeSession = (await syncSessionWithDomainStore(activeSession, opts.resolveOwnerFb)) || activeSession;
    } catch (err) {
      console.warn("[deal-view] session sync failed:", err);
    }
  }
  activeSession = withEffectiveUserId(activeSession);

  const userId = sessionUserId(activeSession);
  if (!userId) {
    if (activeSession?.email) {
      container.innerHTML = renderDealsEmptyState(
        "We could not load your profile yet. Refresh the page or sign out and back in.",
      );
    } else {
      container.innerHTML = `<p class="muted">Sign in to view deals.</p>`;
    }
    return;
  }

  if (opts.dealId) {
    const backContext = opts.backContext || null;
    const preview = resolveDealPreview(activeSession, opts.dealId);
    if (backContext?.accountId && preview) {
      preview.accountId = backContext.accountId;
      preview.accountName = preview.accountLabel;
    }
    applyDealViewHtml(container, opts, renderDealLoadingShell(preview, backContext || {}));
    try {
      const detail = await loadDealRecordDetail(activeSession, opts.dealId, opts);
      if (opts.shouldApply && !opts.shouldApply()) return;
      if (!detail) {
        if (opts.onInvalidDealId) {
          opts.onInvalidDealId();
          return;
        }
        applyDealViewHtml(container, opts, `<p class="muted">Deal not found.</p>`);
        return;
      }
      if (!applyDealViewHtml(container, opts, renderDealRecord(detail, { backContext }))) return;
      if (detail.resolvedDealId && detail.resolvedDealId !== opts.dealId) {
        opts.onResolvedDealId?.(detail.resolvedDealId);
      }
      wireDealRecordEvents(container, activeSession, opts, detail);
      const arrMount = container.querySelector("#deal-arr-module-mount");
      if (arrMount && detail.selectedDeal) {
        try {
          mountDealArrModule(arrMount, detail.selectedDeal, detail.arrLines || [], {
            session: activeSession,
            getAuthHeaders: getWorkerAuthHeaders,
          });
        } catch (err) {
          console.warn("[deal-view] ARR module mount failed:", err?.message || err);
        }
      }
      if (typeof opts.subscribeDealDetail === "function") {
        let latestDetail = detail;
        container._dealDetailUnsub = opts.subscribeDealDetail(async (snap) => {
          if (!snap?.deal || (opts.shouldApply && !opts.shouldApply())) return;
          const nextExtras = {
            technicalCommit: snap.technicalCommit,
            latestSignal: snap.dealSignals?.[0] || null,
            arrLines: snap.arrLines || latestDetail.arrLines || [],
            dealSummary: snap.summary,
            productGaps: rollupProductSignalRows(snap.productGaps || []),
            whatWorks: rollupProductSignalRows(snap.whatWorks || []),
            daysInStage: latestDetail.daysInStage,
            stageMedianDays: latestDetail.stageMedianDays,
            callRows: latestDetail.callRows || [],
          };
          const next = {
            ...latestDetail,
            ...nextExtras,
            selectedDeal: snap.deal,
            selectedDealId: snap.deal.id,
            resolvedDealId: snap.deal.id,
          };
          latestDetail = next;
          // Patch the score tiles + AI callout + ARR in place instead of replacing the
          // whole page — avoids the "old tile then new tile" flicker from full innerHTML
          // swaps on every realtime snapshot.
          const strip = container.querySelector("#deal-score-strip");
          if (strip) {
            const fresh = document.createElement("template");
            fresh.innerHTML = renderDealScoreStrip(next).trim();
            const nextStrip = fresh.content.firstElementChild;
            if (nextStrip) {
              strip.replaceWith(nextStrip);
            }
          }
          const callout = container.querySelector("#deal-ai-callout");
          if (callout) {
            const freshCallout = document.createElement("template");
            freshCallout.innerHTML = renderAiAttachCallout(next.technicalCommit).trim();
            const nextCallout = freshCallout.content.firstElementChild;
            if (nextCallout) callout.replaceWith(nextCallout);
          }
          const nextArrMount = container.querySelector("#deal-arr-module-mount");
          if (nextArrMount) {
            mountDealArrModule(nextArrMount, next.selectedDeal, next.arrLines || [], {
              session: activeSession,
              getAuthHeaders: getWorkerAuthHeaders,
            });
          }
        });
      }
      if (typeof opts.subscribeArrLinesByDeal === "function") {
        container._dealArrUnsub = opts.subscribeArrLinesByDeal((arrLines) => {
          if (opts.shouldApply && !opts.shouldApply()) return;
          const arrMount = container.querySelector("#deal-arr-module-mount");
          const currentDeal = container.querySelector(".deal-record") ? detail.selectedDeal : null;
          if (!arrMount || !currentDeal) return;
          mountDealArrModule(arrMount, currentDeal, arrLines || [], {
            session: activeSession,
            getAuthHeaders: getWorkerAuthHeaders,
          });
        });
      }
    } catch (err) {
      console.error("[deal-view] failed to render deal record:", err);
      if (opts.shouldApply && !opts.shouldApply()) return;
      applyDealViewHtml(
        container,
        opts,
        renderDealsEmptyState(
          "Could not load this deal right now. Refresh the page or try again in a moment.",
        ),
      );
    }
    return;
  }

  try {
    const store = getStore();
    let baseRows = [];
    try {
      baseRows = await safeStoreOp(
        "listDealsForSession",
        () => listDealsForSession(activeSession, { resolveOwnerFb: opts.resolveOwnerFb }),
        [],
      );
    } catch (err) {
      console.warn("[deal-view] listDealsForSession failed:", err?.message || err);
    }
    if (!baseRows.length) {
      baseRows = listDealsFromHistory(activeSession);
    }

    const cacheKey = sessionUserId(activeSession) || "";
    const cacheFresh =
      dealListCache?.key === cacheKey &&
      Date.now() - dealListCache.at < DEAL_LIST_TTL_MS;
    const prevCachedRows = cacheFresh ? dealListCache.rows : null;
    if (cacheFresh && prevCachedRows?.length) {
      paintDealList(container, opts, prevCachedRows);
    }

    const shellRows = baseRows.map((row) => ({
      ...row,
      meddpiccScore: resolveDealMeddpicc(row.deal, row.account)?.completionScore ?? null,
      arrPoint: row.deal.arrEstimatePoint ?? null,
      arrLow: row.deal.arrEstimateLow ?? row.deal.arrEstimatePoint ?? null,
      arrHigh: row.deal.arrEstimateHigh ?? row.deal.arrEstimatePoint ?? null,
      tcStatus: null,
      aiAttach: null,
      blocker: null,
      traction: null,
      daysSilent: null,
      arrConfidence: null,
      agentCount: resolveDealAgentCount(row.deal, []),
      pendingActions: row.deal.openTaskCount || 0,
      forecastMonth: row.deal.forecastMonth || null,
      callCount: row.deal.postCallCount || 0,
      subRegion: row.account?.metadata?.sub_region || row.account?.metadata?.subRegion || null,
      _pending: true,
    }));

    if (!cacheFresh) {
      paintDealList(container, opts, shellRows);
    }

    const enrichedRows = await enrichDealListRows(store, baseRows, {
      orgId: activeSession?.orgId,
    });
    dealListCache = { key: cacheKey, at: Date.now(), rows: enrichedRows };

    if (opts.shouldApply && !opts.shouldApply()) return;

    if (!enrichedRows.length) {
      applyDealViewHtml(
        container,
        opts,
        renderDealsEmptyState(
          "No deals yet. Run a prep or post-call on an account to create your first opportunity.",
        ),
      );
      return;
    }

    if (cacheFresh && prevCachedRows && !dealListRowsChanged(prevCachedRows, enrichedRows)) {
      dealListCache = { key: cacheKey, at: Date.now(), rows: enrichedRows };
      return;
    }

    const scrollHost =
      typeof container.closest === "function"
        ? container.closest(".view-panel") || container
        : container;
    const y = scrollHost.scrollTop || 0;
    paintDealList(container, opts, enrichedRows);
    if (typeof scrollHost.scrollTop === "number") scrollHost.scrollTop = y;

    if (typeof opts.subscribeRemoteDeals === "function") {
      container._dealsUnsub = opts.subscribeRemoteDeals(async (deals) => {
        if (opts.shouldApply && !opts.shouldApply()) return;
        const rows = await Promise.all(
          (deals || []).map(async (deal) => {
            const account = deal.accountId && store.getAccount
              ? await safeStoreOp("getAccount", () => store.getAccount(deal.accountId), null)
              : null;
            return { deal, account: account || { id: deal.accountId, name: deal.accountName || "Account" } };
          }),
        );
        const realtimeRows = await enrichDealListRows(store, rows, { orgId: activeSession?.orgId });
        dealListCache = { key: cacheKey, at: Date.now(), rows: realtimeRows };
        const realtimeScrollHost =
          typeof container.closest === "function"
            ? container.closest(".view-panel") || container
            : container;
        const realtimeY = realtimeScrollHost.scrollTop || 0;
        paintDealList(container, opts, realtimeRows);
        if (typeof realtimeScrollHost.scrollTop === "number") realtimeScrollHost.scrollTop = realtimeY;
      });
    }
  } catch (err) {
    console.error("[deal-view] failed to render deals list:", err);
    if (opts.shouldApply && !opts.shouldApply()) return;
    applyDealViewHtml(
      container,
      opts,
      renderDealsEmptyState(
        "Could not load deals right now. Refresh the page or try again in a moment.",
      ),
    );
  }
}
