/**
 * All calls list — spec §11.3 (#calls).
 */

import { listPostCallAnalyses } from "./history.js";
import { listAnalysesForSession, filterCallRecordsForList } from "./domain/se-access-service.js";
import { dedupeAnalysesByCallIdentity } from "./call-identity.js";
import { resolveDealId, resolveCallType } from "./call-view.js";
import { formatTypeComposite, typeComposite, isEligibleForAggregate } from "./quality-score.js";
import { getDeal, DEAL_TYPE_LABELS } from "./domain/deal-service.js";
import { getStore } from "./domain/store.js";
import { sessionUserId } from "./domain/session.js";
import { readFieldValueAsync } from "./crayons-ui.js";
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

export const CALL_TYPES = Object.keys(CALL_TYPE_LABELS);

export const DATE_WINDOWS = [
  { id: "7d", label: "Last 7 days", days: 7 },
  { id: "30d", label: "Last 30 days", days: 30 },
  { id: "90d", label: "Last 90 days", days: 90 },
  { id: "all", label: "All time", days: null },
];

function resolveScorecard(record) {
  return record?.scorecard || record?.result?.scorecard || null;
}

function resolveAnalysisMeta(record) {
  return record?.analysisMeta || record?.result?.analysisMeta || {};
}

function isProvisional(record) {
  const sc = resolveScorecard(record);
  const meta = resolveAnalysisMeta(record);
  return !!(sc?.provisional ?? meta.provisional);
}

function isAggregateEligible(record) {
  const sc = resolveScorecard(record);
  const meta = resolveAnalysisMeta(record);
  return isEligibleForAggregate({
    provisional: sc?.provisional ?? meta.provisional,
    confidence: sc?.confidence ?? meta.analysisConfidence,
  });
}

function formatDate(ts) {
  if (!ts) return "—";
  return new Date(ts).toLocaleDateString(undefined, {
    month: "short",
    day: "numeric",
    year: "numeric",
  });
}

function formatShortDate(ts) {
  if (!ts) return "—";
  return new Date(ts).toLocaleDateString(undefined, { month: "short", day: "numeric" });
}

function resolveCallTitle(record) {
  const a = record.analysis || record.result?.analysis || {};
  return record.title || a.callHeader?.title || companyFromRecord(record) || "Call";
}

function windowLabel(windowId) {
  return DATE_WINDOWS.find((w) => w.id === windowId)?.label?.toLowerCase() || "selected window";
}

function formatLength(minutes) {
  if (minutes == null || !Number.isFinite(minutes)) return "—";
  if (minutes < 60) return `${Math.round(minutes * 10) / 10}m`;
  const h = Math.floor(minutes / 60);
  const m = Math.round(minutes % 60);
  return m ? `${h}h ${m}m` : `${h}h`;
}

function companyFromRecord(record) {
  const a = record.analysis || record.result?.analysis || {};
  const title = a.callHeader?.title || record.title || "Call";
  const parts = String(title).split(/[·|–—-]/);
  return (parts[0] || title).trim();
}

export function resolveDurationMinutes(record) {
  const tm = record.transcriptMeta || record.result?.transcriptMeta;
  if (tm?.durationMinutes != null) return tm.durationMinutes;
  const resolve = record.result?.resolve;
  if (resolve?.durationMinutes != null) return resolve.durationMinutes;
  if (resolve?.transcriptMeta?.durationMinutes != null) return resolve.transcriptMeta.durationMinutes;
  const dur = record.analysis?.callHeader?.duration;
  if (dur) {
    const m = /(\d+(?:\.\d+)?)\s*min/i.exec(String(dur));
    if (m) return parseFloat(m[1]);
  }
  return null;
}

function isBlankAction(v) {
  const s = String(v ?? "").trim();
  return !s || s === "—" || /^unknown$/i.test(s) || /^n\/a$/i.test(s);
}

export function hasNextStep(record) {
  const a = record.analysis || record.result?.analysis || {};
  const steps = a.nextSteps || [];
  if (steps.some((s) => s?.action && !isBlankAction(s.action))) return true;
  return !isBlankAction(a.momentum?.topAction);
}

export function resolveMomSent(record) {
  const momDraft =
    record.result?.summarise?.momDraft || record.result?.momDraft || null;
  if (momDraft?.sentAt) {
    return { sent: true, label: "Sent", at: momDraft.sentAt };
  }
  const body = momDraft?.editedBody || momDraft?.draftBody || "";
  if (String(body).trim()) {
    return { sent: false, label: "Draft", at: null };
  }
  return { sent: false, label: "—", at: null };
}

export function resolveTcMovement(record) {
  const deltas = record?.result?.tcDeltas || record?.tcDeltas;
  if (Array.isArray(deltas) && deltas.length) {
    const moved = deltas
      .filter((d) => d?.field && d.previous !== d.current)
      .map((d) => String(d.field).replace(/_/g, " "));
    if (moved.length) return moved.slice(0, 3).join(", ");
  }
  const summary = record?.result?.tcDeltaSummary || record?.tcDeltaSummary;
  if (typeof summary === "string" && summary.trim()) return summary.trim();
  return "—";
}

export function countProductGaps(record) {
  const objections =
    record.result?.summarise?.objections || record.result?.objections || [];
  return objections.filter((o) => o?.theme === "product_gap").length;
}

export function resolveQipDisplay(record) {
  const scorecard = resolveScorecard(record);
  const meta = resolveAnalysisMeta(record);
  const callType = scorecard?.callType || resolveCallType(record);
  if (!scorecard?.lines?.length) {
    return { label: "—", provisional: isProvisional(record) };
  }
  const composite = typeComposite(
    [{
      callType,
      rubricVersion: scorecard.rubricVersion || meta.rubricVersion || "1.0",
      lines: scorecard.lines,
      provisional: scorecard.provisional ?? meta.provisional,
      confidence: scorecard.confidence ?? meta.analysisConfidence,
    }],
    callType,
    { includeIneligible: true },
  );
  return {
    label: formatTypeComposite(composite),
    provisional: isProvisional(record),
  };
}

function windowStartMs(windowId) {
  const win = DATE_WINDOWS.find((w) => w.id === windowId) || DATE_WINDOWS[1];
  if (win.days == null) return null;
  return Date.now() - win.days * 24 * 60 * 60 * 1000;
}

/** @param {object[]} records @param {{ callType?: string, window?: string }} filters */
export function filterCallRecords(records, filters = {}) {
  const type = filters.callType || "";
  const start = windowStartMs(filters.window || "30d");
  return records.filter((rec) => {
    if (type && resolveCallType(rec) !== type) return false;
    if (start != null && (rec.timestamp || 0) < start) return false;
    return true;
  });
}

/**
 * Aggregate metrics for filtered calls — provisional rows excluded (§6.6).
 * @param {object[]} filtered
 */
export function aggregateCallListMetrics(filtered) {
  const eligible = filtered.filter(isAggregateEligible);
  let hours = 0;
  let momSent = 0;
  let noNextStep = 0;
  let gapsSurfaced = 0;

  for (const rec of eligible) {
    const mins = resolveDurationMinutes(rec);
    if (mins != null) hours += mins / 60;
    if (resolveMomSent(rec).sent) momSent += 1;
    if (!hasNextStep(rec)) noNextStep += 1;
    gapsSurfaced += countProductGaps(rec);
  }

  const callCount = eligible.length;
  const momRatio = callCount ? momSent / callCount : null;
  const accountKeys = new Set();

  for (const rec of eligible) {
    accountKeys.add(resolveDealId(rec) || companyFromRecord(rec));
  }

  return {
    callCount,
    provisionalExcluded: filtered.length - callCount,
    hours: Math.round(hours * 10) / 10,
    momSent,
    momRatio,
    noNextStep,
    gapsSurfaced,
    gapAccountCount: accountKeys.size,
    avgMinutes: callCount ? Math.round((hours * 60) / callCount) : null,
  };
}

/**
 * @param {object} record
 * @param {Map<string, object>} deals
 * @param {Map<string, object>} accounts
 */
export function buildCallListRow(record, deals, accounts) {
  const dealId = resolveDealId(record);
  const deal = dealId ? deals.get(dealId) : null;
  const account = deal?.accountId ? accounts.get(deal.accountId) : null;
  const callType = resolveCallType(record);
  const qip = resolveQipDisplay(record);
  const mom = resolveMomSent(record);

  return {
    id: record.id,
    timestamp: record.timestamp,
    callType,
    callTypeLabel: CALL_TYPE_LABELS[callType] || callType,
    callTitle: resolveCallTitle(record),
    accountName: account?.name || account?.domain || companyFromRecord(record),
    dealTitle: deal?.title || DEAL_TYPE_LABELS[deal?.type] || "—",
    dateLabel: formatDate(record.timestamp),
    dateShortLabel: formatShortDate(record.timestamp),
    lengthLabel: formatLength(resolveDurationMinutes(record)),
    qipLabel: qip.label,
    qipProvisional: qip.provisional,
    tcMovement: resolveTcMovement(record),
    momLabel: mom.label,
    momSent: mom.sent,
    gapCount: countProductGaps(record),
    hasNextStep: hasNextStep(record),
  };
}

function renderMetricCard(label, value, sub = "", valueClass = "") {
  return `
    <div class="dash-stat prep-action-block call-list-stat">
      <span class="dash-stat-label">${esc(label)}</span>
      <span class="dash-stat-value${valueClass ? ` ${valueClass}` : ""}">${esc(String(value))}</span>
      ${sub ? `<span class="dash-stat-sub muted">${esc(sub)}</span>` : ""}
    </div>`;
}

function renderMetrics(metrics, filters = {}) {
  const windowHint = windowLabel(filters.window || "30d");
  const callsSub =
    metrics.provisionalExcluded > 0
      ? `${metrics.provisionalExcluded} provisional excluded · ${windowHint}`
      : windowHint;
  const hoursSub = metrics.avgMinutes != null ? `avg ${metrics.avgMinutes} min` : "";
  const momValue = metrics.callCount ? `${metrics.momSent} / ${metrics.callCount}` : "—";
  const momSub =
    metrics.callCount && metrics.callCount > metrics.momSent
      ? `${metrics.callCount - metrics.momSent} never sent`
      : metrics.callCount
        ? "all sent"
        : "";
  const noNextPct =
    metrics.callCount > 0 ? Math.round((metrics.noNextStep / metrics.callCount) * 100) : null;
  const noNextSub = noNextPct != null ? `${noNextPct}% of calls` : "";
  const gapsSub =
    metrics.gapAccountCount > 0
      ? `across ${metrics.gapAccountCount} account${metrics.gapAccountCount === 1 ? "" : "s"}`
      : "";

  return `
    <div class="call-list-metrics dash-stats prep-action-grid" aria-label="Call metrics">
      ${renderMetricCard("Calls", metrics.callCount, callsSub)}
      ${renderMetricCard("Hours on calls", metrics.hours.toFixed(1), hoursSub)}
      ${renderMetricCard("Minutes sent", momValue, momSub)}
      ${renderMetricCard("No next step", metrics.noNextStep, noNextSub, metrics.noNextStep ? "call-list-stat-warn" : "")}
      ${renderMetricCard("Gaps surfaced", metrics.gapsSurfaced, gapsSub)}
    </div>`;
}

function callListSubtitle(opts) {
  if (opts.listFilter === "no-next-step") {
    return "Calls with no next step or stalled momentum.";
  }
  if (opts.listFilter === "scored") {
    return "Eligible scored calls across the team.";
  }
  return "Every call you've run. Each one carries its own QIP, technical commit contribution, and minutes.";
}

function renderCallListItem(row) {
  const qipHtml = row.qipProvisional
    ? `<span class="call-list-qip">${esc(row.qipLabel)} <span class="qip-provisional-badge" title="Shadow mode — excluded from averages">Provisional</span></span>`
    : `<span class="call-list-qip">${esc(row.qipLabel)}</span>`;
  const momCls = row.momSent ? "call-list-mom--sent" : row.momLabel === "Draft" ? "call-list-mom--draft" : "muted";

  return `
    <button type="button" class="lifecycle-list-item call-list-item call-list-row" data-call-id="${esc(row.id)}">
      <span class="call-list-row-grid">
        <span class="call-list-col call-list-col--title">
          <span class="call-list-row-call-title">${esc(row.callTitle)}</span>
          <span class="call-list-row-mobile-meta muted">${esc(row.dateShortLabel)} · ${esc(row.lengthLabel)}</span>
        </span>
        <span class="call-list-col call-list-col--type">${esc(row.callTypeLabel)}</span>
        <span class="call-list-col call-list-col--account">${esc(row.accountName)}</span>
        <span class="call-list-col call-list-col--deal">${esc(row.dealTitle)}</span>
        <span class="call-list-col call-list-col--date call-list-date-short muted">${esc(row.dateShortLabel)}</span>
        <span class="call-list-col call-list-col--length muted">${esc(row.lengthLabel)}</span>
        <span class="call-list-col call-list-col--qip">${qipHtml}</span>
        <span class="call-list-col call-list-col--tc muted">${esc(row.tcMovement)}</span>
        <span class="call-list-col call-list-col--mom ${momCls}">${esc(row.momLabel)}</span>
      </span>
    </button>`;
}

function renderCallsEmptyState(message) {
  return `
    <div class="lifecycle-empty call-list-empty">
      <fw-card>
        <fw-icon name="phone" size="24" aria-hidden="true"></fw-icon>
        <h2>All calls</h2>
        <p class="muted">${esc(message)}</p>
      </fw-card>
    </div>`;
}

function wireCallListClicks(container, opts) {
  container.querySelectorAll(".call-list-item").forEach((row) => {
    const activate = () => {
      const id = row.getAttribute("data-call-id");
      if (id) opts.onSelectCall?.(id);
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

function wireCallListFilters(container, allRecords, deals, accounts, opts, render) {
  const typeSelect = container.querySelector("#calls-filter-type");
  const windowSelect = container.querySelector("#calls-filter-window");

  const run = async () => {
    const callType = typeSelect ? await readFieldValueAsync(typeSelect) : opts.callType || "";
    const window = windowSelect ? await readFieldValueAsync(windowSelect) : opts.window || "30d";
    opts.onFiltersChange?.({ callType, window });
    render({ callType, window });
  };

  typeSelect?.addEventListener("fwChange", () => { void run(); });
  windowSelect?.addEventListener("fwChange", () => { void run(); });
}

async function enrichDealsAndAccounts(records) {
  const deals = new Map();
  const accounts = new Map();
  const dealIds = [...new Set(records.map((r) => resolveDealId(r)).filter(Boolean))];
  for (const id of dealIds) {
    const deal = await getDeal(id);
    if (deal) deals.set(id, deal);
  }
  const store = getStore();
  const accountIds = [...new Set([...deals.values()].map((d) => d.accountId).filter(Boolean))];
  for (const id of accountIds) {
    const account = store.getAccount ? await store.getAccount(id) : null;
    if (account) accounts.set(id, account);
  }
  return { deals, accounts };
}

/** @param {HTMLElement} container @param {object} session @param {object} opts */
export async function renderCallsListView(container, session, opts = {}) {
  const userId = sessionUserId(session);
  if (!userId) {
    if (session?.email) {
      container.innerHTML = renderCallsEmptyState(
        "We could not load your profile yet. Refresh the page or sign out and back in.",
      );
    } else {
      container.innerHTML = `<p class="muted">Sign in to view calls.</p>`;
    }
    return;
  }

  try {
    const allRecords = dedupeAnalysesByCallIdentity(
      opts.teamScope
        ? await listAnalysesForSession(session, { teamScope: true })
        : listPostCallAnalyses(session.email),
    );
    const listFiltered = filterCallRecordsForList(allRecords, opts.listFilter);
    if (!listFiltered.length) {
      container.innerHTML = renderCallsEmptyState(
        opts.listFilter
          ? "No calls match this filter."
          : "No calls yet — analyze a recording from Post-call to populate this list.",
      );
      return;
    }

    const { deals, accounts } = await enrichDealsAndAccounts(listFiltered);
    const filters = {
      callType: opts.callType || "",
      window: opts.window || "30d",
    };

    const typeOptions = [
      `<fw-select-option value="">All types</fw-select-option>`,
      ...CALL_TYPES.map(
        (t) =>
          `<fw-select-option value="${esc(t)}"${filters.callType === t ? " selected" : ""}>${esc(CALL_TYPE_LABELS[t])}</fw-select-option>`,
      ),
    ].join("");
    const windowOptions = DATE_WINDOWS.map(
      (w) =>
        `<fw-select-option value="${esc(w.id)}"${filters.window === w.id ? " selected" : ""}>${esc(w.label)}</fw-select-option>`,
    ).join("");

    const paint = (activeFilters) => {
      const filtered = filterCallRecords(listFiltered, activeFilters);
      const metrics = aggregateCallListMetrics(filtered);
      const rows = filtered.map((rec) => buildCallListRow(rec, deals, accounts));
      const listEl = container.querySelector(".call-list-compact");
      const metricsEl = container.querySelector(".call-list-metrics-host");
      if (metricsEl) metricsEl.innerHTML = renderMetrics(metrics, activeFilters);
      if (listEl) {
        listEl.innerHTML = rows.length
          ? rows.map((row) => renderCallListItem(row)).join("")
          : `<p class="muted call-list-no-matches">No calls match these filters.</p>`;
        wireCallListClicks(listEl, opts);
      }
    };

    container.innerHTML = `
      <div class="lifecycle-list-view call-list-view call-list-view--compact">
        <div class="call-list-toolbar call-list-toolbar--compact">
          <div class="call-list-title-group">
            <h1 class="call-list-heading">${opts.listFilter ? "Filtered calls" : "All calls"}</h1>
            <p class="call-list-subtitle muted">${esc(callListSubtitle(opts))}</p>
          </div>
          <div class="call-list-filters">
            <fw-select id="calls-filter-type" label="Call type" value="${esc(filters.callType)}">${typeOptions}</fw-select>
            <fw-select id="calls-filter-window" label="Date window" value="${esc(filters.window)}">${windowOptions}</fw-select>
          </div>
        </div>
        <div class="call-list-metrics-host">${renderMetrics(aggregateCallListMetrics(filterCallRecords(listFiltered, filters)), filters)}</div>
        <div class="call-list-table-card card-wire">
          <div class="call-list-grid-header" aria-hidden="true">
            <span class="call-list-col call-list-col--title">Call</span>
            <span class="call-list-col call-list-col--type">Type</span>
            <span class="call-list-col call-list-col--account">Account</span>
            <span class="call-list-col call-list-col--deal">Deal</span>
            <span class="call-list-col call-list-col--date">Date</span>
            <span class="call-list-col call-list-col--length">Len</span>
            <span class="call-list-col call-list-col--qip">QIP</span>
            <span class="call-list-col call-list-col--tc">TC moved</span>
            <span class="call-list-col call-list-col--mom">MoM</span>
          </div>
          <div class="lifecycle-list call-list-compact">
            ${filterCallRecords(listFiltered, filters)
              .map((rec) => renderCallListItem(buildCallListRow(rec, deals, accounts)))
              .join("")}
          </div>
        </div>
        <p class="call-list-footnote muted">QIP lives here because it grades the call. Scores are only comparable within a call type — demo against demo, discovery against discovery.</p>
      </div>`;

    wireCallListClicks(container, opts);
    wireCallListFilters(container, listFiltered, deals, accounts, opts, paint);
  } catch (err) {
    console.error("[calls-list-view] failed to render:", err);
    container.innerHTML = renderCallsEmptyState(
      "Could not load calls right now. Refresh the page or try again in a moment.",
    );
  }
}
