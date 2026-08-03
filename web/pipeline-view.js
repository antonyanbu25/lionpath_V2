/**
 * Pipeline deal review — leadership roll-up (spec §11.9, ADDON_ARR_MRR §4).
 * Same enriched deal rows as the SE list; default sort is agent count / ARR, not traction.
 */

import { listDealsForSession } from "./domain/account-service.js?v=2.1";
import { getStore } from "./domain/store.js";
import { resolveOrgForUser } from "./domain/org-service.js";
import { sessionUserId } from "./domain/session.js";
import { sessionToUser } from "./domain/rbac.js";
import { DEAL_TYPE_LABELS } from "./domain/deal-service.js";
import { displayMrrFromArr } from "./deal-arr-module.js";
import {
  enrichDealListRows,
  formatCompactUsd,
  formatTcValue,
  isLowConfidenceArr,
  isOpenPipelineDeal,
  sortPipelineDealRows,
  tractionSortRank,
} from "./deal-view.js";
import { esc } from "./shared.js";

/** Freshworks FY starts February. map YYYY-MM to Qn FYyy label. */
export function fiscalQuarterLabelFromMonth(forecastMonth) {
  const m = /^(\d{4})-(\d{2})$/.exec(String(forecastMonth || "").trim());
  if (!m) return null;
  const year = Number(m[1]);
  const month = Number(m[2]);
  if (!Number.isFinite(year) || !Number.isFinite(month) || month < 1 || month > 12) return null;
  const fy = month >= 2 ? year + 1 : year;
  let q;
  if (month >= 2 && month <= 4) q = 1;
  else if (month >= 5 && month <= 7) q = 2;
  else if (month >= 8 && month <= 10) q = 3;
  else q = 4;
  return `Q${q} FY${String(fy).slice(-2)}`;
}

/** @param {object[]} rows */
export function collectPipelineFilterOptions(rows) {
  const quarters = new Set();
  const subRegions = new Set();
  for (const row of rows) {
    const q = fiscalQuarterLabelFromMonth(row.forecastMonth);
    if (q) quarters.add(q);
    if (row.subRegion) subRegions.add(row.subRegion);
  }
  return {
    quarters: [...quarters].sort().reverse(),
    subRegions: [...subRegions].sort((a, b) => a.localeCompare(b)),
  };
}

/** @param {object[]} rows @param {{ quarter?: string, subRegion?: string }} filters */
export function filterPipelineRows(rows, filters = {}) {
  let out = rows.filter((row) => isOpenPipelineDeal(row.deal));
  if (filters.quarter) {
    out = out.filter((row) => fiscalQuarterLabelFromMonth(row.forecastMonth) === filters.quarter);
  }
  if (filters.subRegion) {
    out = out.filter((row) => row.subRegion === filters.subRegion);
  }
  return out;
}

/** @param {number|null|undefined} confidence */
function arrConfidenceBadge(confidence) {
  if (confidence == null) {
    return `<span class="deal-arr-confidence deal-arr-confidence--unknown" title="Estimate. confidence not established yet">-</span>`;
  }
  const pct = Math.round(confidence * 100);
  let band = "medium";
  if (pct >= 80) band = "high";
  else if (pct < 50) band = "low";
  const note =
    pct < 50
      ? `${pct}% confidence. estimate, not a firm number`
      : `${pct}% confidence`;
  return `<span class="deal-arr-confidence deal-arr-confidence--${band}" title="${esc(note)}">${esc(String(pct))}%</span>`;
}

/** @param {object} row @param {"ARR"|"MRR"} unit */
function renderPipelineMoneyCell(row, unit) {
  const { arrPoint, arrConfidence } = row;
  if (arrPoint == null) return `<span class="muted">-</span>`;
  const amount = unit === "MRR" ? formatCompactUsd(displayMrrFromArr(arrPoint)) : formatCompactUsd(arrPoint);
  const lowConf = isLowConfidenceArr(arrConfidence);
  return `<span class="pipeline-money${lowConf ? " pipeline-money--low-confidence" : ""}"><span class="pipeline-money-amount">${esc(amount)}</span>${arrConfidenceBadge(arrConfidence)}</span>`;
}

function tcYesNoTag(status) {
  const s = status || "pending";
  const labels = { yes: "Yes", no: "No", pending: "Pending", at_risk: "At risk" };
  const colors = { yes: "green", no: "red", pending: "yellow", at_risk: "red" };
  return `<fw-tag text="${esc(labels[s] || s)}" color="${colors[s] || "grey"}"></fw-tag>`;
}

function tractionTag(traction) {
  const t = traction || "warm";
  const color = t === "hot" ? "green" : t === "cold" ? "red" : "yellow";
  const label = t.charAt(0).toUpperCase() + t.slice(1);
  return `<fw-tag text="${esc(label)}" color="${color}"></fw-tag>`;
}

function pipelineAiAttachCell(aiAttach) {
  const summary = formatTcValue(aiAttach);
  if (!summary) return `<span class="muted pipeline-ai-attach">-</span>`;
  return `<fw-tag class="pipeline-ai-attach" text="${esc(summary)}" color="purple"></fw-tag>`;
}

function renderPipelineRow(row) {
  const { deal, account } = row;
  const dealTitle = deal.title || DEAL_TYPE_LABELS[deal.type] || "Deal";
  const accountTitle = account?.name || account?.domain || "Account";
  const blocker = row.blocker || "-";

  return `
    <button type="button" class="lifecycle-list-item pipeline-list-item pipeline-row" data-deal-id="${esc(deal.id)}">
      <span class="pipeline-row-grid">
        <span class="pipeline-col pipeline-col--deal">
          <span class="pipeline-deal-title">${esc(dealTitle)}</span>
        </span>
        <span class="pipeline-col pipeline-col--account muted">${esc(accountTitle)}</span>
        <span class="pipeline-col pipeline-col--agents pipeline-num">${row.agentCount != null ? esc(String(row.agentCount)) : "-"}</span>
        <span class="pipeline-col pipeline-col--arr">${renderPipelineMoneyCell(row, "ARR")}</span>
        <span class="pipeline-col pipeline-col--mrr">${renderPipelineMoneyCell(row, "MRR")}</span>
        <span class="pipeline-col pipeline-col--tc">${tcYesNoTag(row.tcStatus)}</span>
        <span class="pipeline-col pipeline-col--blockers muted pipeline-blocker">${esc(blocker)}</span>
        <span class="pipeline-col pipeline-col--traction">${row.traction ? tractionTag(row.traction) : `<span class="muted">-</span>`}</span>
        <span class="pipeline-col pipeline-col--pending pipeline-num">${esc(String(row.pendingActions ?? 0))}</span>
        <span class="pipeline-col pipeline-col--ai">${pipelineAiAttachCell(row.aiAttach)}</span>
      </span>
    </button>`;
}

function renderPipelineSortHeader(sortKey) {
  const btn = (key, label) => {
    const active = sortKey === key;
    return `<button type="button" class="pipeline-sort-btn${active ? " pipeline-sort-btn--active" : ""}" data-pipeline-sort="${esc(key)}" aria-pressed="${active ? "true" : "false"}">${esc(label)}</button>`;
  };
  return `
    <div class="pipeline-grid-header">
      <span class="pipeline-col pipeline-col--deal">Deal</span>
      <span class="pipeline-col pipeline-col--account">Account</span>
      <span class="pipeline-col pipeline-col--agents">${btn("agents", "Agents")}</span>
      <span class="pipeline-col pipeline-col--arr">${btn("arr", "ARR")}</span>
      <span class="pipeline-col pipeline-col--mrr">${btn("mrr", "MRR")}</span>
      <span class="pipeline-col pipeline-col--tc">TC</span>
      <span class="pipeline-col pipeline-col--blockers">Blockers</span>
      <span class="pipeline-col pipeline-col--traction">Traction</span>
      <span class="pipeline-col pipeline-col--pending">Pending</span>
      <span class="pipeline-col pipeline-col--ai">AI attach</span>
    </div>`;
}

function aiAttachAttached(aiAttach) {
  const summary = formatTcValue(aiAttach);
  if (!summary) return false;
  return (
    aiAttach?.agentCount > 0 ||
    aiAttach?.optedInAfterDemo === true ||
    /\bcopilot\b|\bagent\b/i.test(summary)
  );
}

/** @param {object[]} rows */
export function summarizePipelineRows(rows) {
  const pipelineArr = rows.reduce((sum, r) => sum + (r.arrPoint || 0), 0);
  const tcYes = rows.filter((r) => r.tcStatus === "yes");
  const hot = rows.filter((r) => r.traction === "hot");
  const cold = rows.filter((r) => r.traction === "cold");
  const withTc = rows.filter((r) => r.tcStatus);
  const aiAttached = withTc.filter((r) => aiAttachAttached(r.aiAttach));
  return {
    dealCount: rows.length,
    pipelineArr,
    tcYesCount: tcYes.length,
    tcYesArr: tcYes.reduce((s, r) => s + (r.arrPoint || 0), 0),
    hotCount: hot.length,
    hotArr: hot.reduce((s, r) => s + (r.arrPoint || 0), 0),
    coldCount: cold.length,
    coldArr: cold.reduce((s, r) => s + (r.arrPoint || 0), 0),
    aiAttachPct: withTc.length ? Math.round((aiAttached.length / withTc.length) * 100) : null,
    aiAttachCount: aiAttached.length,
  };
}

function renderPipelineMetrics(summary) {
  const aiVal = summary.aiAttachPct != null ? `${summary.aiAttachPct}%` : "-";
  const aiSub =
    summary.aiAttachCount != null && summary.dealCount
      ? `${summary.aiAttachCount} of ${summary.dealCount}`
      : "of deals with TC";
  return `
    <div class="dash-stats prep-action-grid pipeline-stats pipeline-metrics-wire">
      <div class="dash-stat prep-action-block pipeline-metric-card">
        <span class="dash-stat-label">Pipeline ARR</span>
        <span class="dash-stat-value pipeline-metric-num">${esc(formatCompactUsd(summary.pipelineArr))}</span>
        <span class="dash-stat-sub muted pipeline-metric-hint">${summary.dealCount} open deals</span>
      </div>
      <div class="dash-stat prep-action-block pipeline-metric-card">
        <span class="dash-stat-label">TC = yes</span>
        <span class="dash-stat-value pipeline-metric-num">${summary.tcYesCount} / ${summary.dealCount}</span>
        <span class="dash-stat-sub muted pipeline-metric-hint">${esc(formatCompactUsd(summary.tcYesArr))}</span>
      </div>
      <div class="dash-stat prep-action-block pipeline-metric-card">
        <span class="dash-stat-label">Hot</span>
        <span class="dash-stat-value pipeline-metric-num good">${summary.hotCount}</span>
        <span class="dash-stat-sub muted pipeline-metric-hint">${esc(formatCompactUsd(summary.hotArr))}</span>
      </div>
      <div class="dash-stat prep-action-block pipeline-metric-card">
        <span class="dash-stat-label">Cold</span>
        <span class="dash-stat-value pipeline-metric-num weak">${summary.coldCount}</span>
        <span class="dash-stat-sub muted pipeline-metric-hint">${esc(formatCompactUsd(summary.coldArr))}</span>
      </div>
      <div class="dash-stat prep-action-block pipeline-metric-card">
        <span class="dash-stat-label">AI attach</span>
        <span class="dash-stat-value pipeline-metric-num">${esc(aiVal)}</span>
        <span class="dash-stat-sub muted pipeline-metric-hint">${esc(aiSub)}</span>
      </div>
    </div>`;
}

function renderPipelineFilters(options, filters) {
  const quarterOpts = [
    `<option value="">All quarters</option>`,
    ...options.quarters.map(
      (q) => `<option value="${esc(q)}"${filters.quarter === q ? " selected" : ""}>${esc(q)}</option>`,
    ),
  ].join("");
  const subOpts = [
    `<option value="">All sub-regions</option>`,
    ...options.subRegions.map(
      (sr) =>
        `<option value="${esc(sr)}"${filters.subRegion === sr ? " selected" : ""}>${esc(sr)}</option>`,
    ),
  ].join("");
  return `
    <div class="pipeline-filters">
      <label class="pipeline-filter">
        <span class="pipeline-filter-label">Quarter</span>
        <select id="pipeline-quarter-filter" class="pipeline-filter-select">${quarterOpts}</select>
      </label>
      <label class="pipeline-filter">
        <span class="pipeline-filter-label">Sub-region</span>
        <select id="pipeline-subregion-filter" class="pipeline-filter-select">${subOpts}</select>
      </label>
    </div>`;
}

/** @param {object} session @param {object} [opts] */
export async function buildPipelineView(session, opts = {}) {
  const store = getStore();
  const allRows = await enrichDealListRows(store, await listDealsForSession(session));
  const filterOptions = collectPipelineFilterOptions(allRows);
  const filters = {
    quarter: opts.quarterFilter || "",
    subRegion: opts.subRegionFilter || "",
  };
  const filtered = filterPipelineRows(allRows, filters);
  const sortKey = opts.sortKey || "agents";
  const sorted = sortPipelineDealRows(filtered, sortKey);
  const user = sessionToUser(session);
  const org = user ? await resolveOrgForUser(user) : null;
  const orgLabel = org?.name || org?.region || "Org";

  return {
    rows: sorted,
    allRowCount: allRows.length,
    filterOptions,
    filters,
    sortKey,
    summary: summarizePipelineRows(sorted),
    orgLabel,
  };
}

function mountPipelineView(container, view, opts = {}) {
  const quarterEl = container.querySelector("#pipeline-quarter-filter");
  const subEl = container.querySelector("#pipeline-subregion-filter");

  quarterEl?.addEventListener("change", () => {
    opts.onFiltersChange?.({
      quarterFilter: quarterEl.value || "",
      subRegionFilter: subEl?.value || "",
    });
  });
  subEl?.addEventListener("change", () => {
    opts.onFiltersChange?.({
      quarterFilter: quarterEl?.value || "",
      subRegionFilter: subEl?.value || "",
    });
  });

  container.querySelectorAll("[data-pipeline-sort]").forEach((btn) => {
    const key = btn.dataset.pipelineSort;
    if (!key) return;
    const activate = () => opts.onSortKeyChange?.(key);
    btn.addEventListener("click", activate);
    btn.addEventListener("fwClick", activate);
  });

  container.querySelectorAll(".pipeline-row").forEach((row) => {
    const dealId = row.dataset.dealId;
    if (!dealId) return;
    const open = () => opts.onSelectDeal?.(dealId);
    row.addEventListener("click", open);
    row.addEventListener("fwClick", open);
    row.addEventListener("keydown", (e) => {
      if (e.key === "Enter" || e.key === " ") {
        e.preventDefault();
        open();
      }
    });
  });
}

/**
 * @param {HTMLElement} container
 * @param {object} session
 * @param {{ quarterFilter?: string, subRegionFilter?: string, sortKey?: string, onFiltersChange?: Function, onSortKeyChange?: Function, onSelectDeal?: Function }} opts
 */
export async function renderPipelineView(container, session, opts = {}) {
  if (!session?.isOrgDirector) {
    container.innerHTML = `<p class="muted">Pipeline review is available to org leadership only.</p>`;
    return;
  }

  const userId = sessionUserId(session);
  if (!userId) {
    container.innerHTML = `<p class="muted">Sign in to view pipeline review.</p>`;
    return;
  }

  try {
    const view = await buildPipelineView(session, opts);
    const { rows, summary, orgLabel, sortKey, filters } = view;
    const sortHint =
      sortKey === "agents"
        ? "descending by agent count and ARR"
        : sortKey === "arr"
          ? "sorted by ARR (then agent count)"
          : "sorted by MRR (then agent count)";

    container.innerHTML = `
      <div class="pipeline-view pipeline-view--wireframe">
        <header class="pipeline-head">
          <div class="pipeline-head-text">
            <h1 class="pipeline-title">Pipeline deal review</h1>
            <p class="pipeline-subtitle muted">${esc(orgLabel)} · ${esc(sortHint)}</p>
          </div>
          ${renderPipelineFilters(view.filterOptions, filters)}
        </header>
        ${renderPipelineMetrics(summary)}
        <div class="card-wire pipeline-table-card">
          ${renderPipelineSortHeader(sortKey)}
          <div class="pipeline-list">
            ${
              rows.length
                ? rows.map((row) => renderPipelineRow(row)).join("")
                : `<p class="muted pipeline-empty">No open deals match these filters.</p>`
            }
          </div>
        </div>
        <p class="pipeline-footnote muted">Same table as the SE deal list, different default sort. Leadership wants the big ones first; the SE wants the rotting ones first.</p>
      </div>`;

    mountPipelineView(container, view, opts);
  } catch (err) {
    console.error("[pipeline-view]", err);
    container.innerHTML = `<p class="muted">Could not load pipeline review.</p>`;
  }
}
