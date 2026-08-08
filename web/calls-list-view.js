/**
 * Activities list — unified feed of analyzed calls + pre-call briefs (#calls / #activities).
 */

import { listAnalysesForSession, filterCallRecordsForList } from "./domain/se-access-service.js";
import { dedupeAnalysesByCallIdentity } from "./call-identity.js";
import { resolveDealId, resolveCallType } from "./call-view.js";
import { formatTypeComposite, typeComposite, isEligibleForAggregate } from "./quality-score.js";
import { DEAL_TYPE_LABELS, listDealsForAccount } from "./domain/deal-service.js";
import { listDealsFromHistory } from "./domain/account-service.js";
import { getStore } from "./domain/store.js";
import { sessionUserId, withEffectiveUserId } from "./domain/session.js";
import { syncSessionWithDomainStore } from "./auth.js";
import { readFieldValueAsync } from "./crayons-ui.js";
import { esc } from "./shared.js";
import { resolveCallTitleFromRecord, companyFromCallTitle, CALL_TYPE_LABELS } from "./call-type-labels.js";
import {
  loadMergedBriefs,
  parseBriefTimestamp,
  buildBriefListRow,
} from "./briefs-list-view.js";
import {
  ACTIVITY_NOUN,
  ACTIVITY_TYPE_LABEL,
  ACTIVITIES_NAV_LABEL,
  PRECALL_BRIEFS_TYPE_LABEL,
  CALL_QUALITY_SCORE_LABEL,
} from "./user-facing-copy.js";

export const CALL_TYPES = Object.keys(CALL_TYPE_LABELS);

/** Filter value for type dropdown — UI only; not a persisted callType key. */
export const ACTIVITY_FILTER_PRECALL_BRIEFS = "precall_briefs";
/** Sentinel for "All types" — fw-select mishandles empty string value="". */
export const ACTIVITY_FILTER_ALL_TYPES = "all_types";

export const DATE_WINDOWS = [
  { id: "7d", label: "Last 7 days", days: 7 },
  { id: "30d", label: "Last 30 days", days: 30 },
  { id: "90d", label: "Last 90 days", days: 90 },
  { id: "all", label: "All time", days: null },
];

/** Pre-call briefs count as flat 15 minutes in hours invested (SE Labs spec). */
export const BRIEF_MINUTES = 15;

const TC_FIELD_LABELS = {
  incumbent: "Incumbent",
  competitor: "Competitor",
  identifiedRisk: "Identified risk",
  timelineForClosure: "Timeline",
  reasonForEvaluation: "Reason for evaluation",
  aiAttach: "AI attach",
  status: "Status",
};

const TC_RISKY_FIELDS = new Set(["identifiedRisk"]);

const ACTIVITY_SVG = {
  phone:
    '<path d="M22 16.92v3a2 2 0 0 1-2.18 2 19.79 19.79 0 0 1-8.63-3.07 19.5 19.5 0 0 1-6-6 19.79 19.79 0 0 1-3.07-8.67A2 2 0 0 1 4.11 2h3a2 2 0 0 1 2 1.72 12.84 12.84 0 0 0 .7 2.81 2 2 0 0 1-.45 2.11L8.09 9.91a16 16 0 0 0 6 6l1.27-1.27a2 2 0 0 1 2.11-.45 12.84 12.84 0 0 0 2.81.7A2 2 0 0 1 22 16.92z"/>',
  brief:
    '<path d="M12 3H5a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/><path d="M18.5 2.5a2.12 2.12 0 0 1 3 3L12 15l-4 1 1-4Z"/>',
  history:
    '<path d="M3 12a9 9 0 1 0 3-6.7L3 8"/><path d="M3 3v5h5"/><path d="M12 7v5l4 2"/>',
  clock: '<circle cx="12" cy="12" r="10"/><path d="M12 6v6l4 2"/>',
  sparkle:
    '<path d="M9.94 14.06 5 19m5.06-9.94L5 4m9 5.94L19 5m-4.94 9.06L19 19"/><circle cx="12" cy="12" r="3.2"/>',
  building:
    '<rect x="4" y="2" width="16" height="20" rx="2"/><path d="M9 22v-4h6v4"/><path d="M9 6h.01M15 6h.01M9 10h.01M15 10h.01M9 14h.01M15 14h.01"/>',
};

function activityIcon(name, size = 18) {
  const path = ACTIVITY_SVG[name] || ACTIVITY_SVG.history;
  return `<svg class="act-icon" width="${size}" height="${size}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${path}</svg>`;
}

function resolveAccountId(record) {
  const confirmed = record?.result?.confirmed || {};
  if (confirmed.accountId) return confirmed.accountId;
  if (record?.accountId) return record.accountId;
  const resolve = record?.result?.resolve || {};
  if (resolve.accountId) return resolve.accountId;
  const picked =
    resolve.accounts?.find((a) => a.preselected || a.selected) ||
    resolve.accounts?.[0] ||
    null;
  return picked?.id || picked?.accountId || null;
}

function pickDealForAccount(dealsByAccount, accountId) {
  if (!accountId) return null;
  const list = dealsByAccount.get(accountId) || [];
  return list.find((d) => d.status === "active") || list[0] || null;
}

function matchAccountByCompany(accounts, company) {
  const norm = String(company || "")
    .trim()
    .toLowerCase();
  if (!norm) return null;
  for (const account of accounts.values()) {
    const name = String(account.name || "")
      .trim()
      .toLowerCase();
    if (name && (name === norm || norm.includes(name) || name.includes(norm))) {
      return account;
    }
  }
  return null;
}

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
  if (!ts) return "-";
  return new Date(ts).toLocaleDateString(undefined, {
    month: "short",
    day: "numeric",
    year: "numeric",
  });
}

function formatShortDate(ts) {
  if (!ts) return "-";
  return new Date(ts).toLocaleDateString(undefined, { month: "short", day: "numeric" });
}

function resolveCallTitle(record) {
  return resolveCallTitleFromRecord(record);
}

function firstText(...values) {
  for (const value of values) {
    const text = String(value ?? "").trim();
    if (text && text !== "-") return text;
  }
  return "";
}

function ownAccountNameFromRecord(record) {
  const confirmed = record?.result?.confirmed || {};
  const resolve = record?.result?.resolve || {};
  return firstText(
    record?.accountName,
    record?.account?.name,
    confirmed.accountName,
    confirmed.account?.name,
    resolve.accountName,
    resolve.account?.name,
  );
}

function ownDealTitleFromRecord(record) {
  const confirmed = record?.result?.confirmed || {};
  const resolve = record?.result?.resolve || {};
  return firstText(
    record?.dealTitle,
    record?.dealName,
    record?.deal?.title,
    record?.deal?.name,
    confirmed.dealTitle,
    confirmed.dealName,
    confirmed.deal?.title,
    confirmed.deal?.name,
    resolve.dealTitle,
    resolve.dealName,
    resolve.deal?.title,
    resolve.deal?.name,
  );
}

function companyFromRecord(record) {
  const title = resolveCallTitle(record);
  return companyFromCallTitle(title) || title || ACTIVITY_NOUN;
}

function windowLabel(windowId) {
  return DATE_WINDOWS.find((w) => w.id === windowId)?.label?.toLowerCase() || "selected window";
}

function formatLength(minutes) {
  if (minutes == null || !Number.isFinite(minutes)) return "-";
  if (minutes < 60) return `${Math.round(minutes * 10) / 10}m`;
  const h = Math.floor(minutes / 60);
  const m = Math.round(minutes % 60);
  return m ? `${h}h ${m}m` : `${h}h`;
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
  return !s || s === "-" || /^unknown$/i.test(s) || /^n\/a$/i.test(s);
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
  return { sent: false, label: "-", at: null };
}

export function resolveTcMovement(record) {
  const tags = resolveTcTags(record);
  if (tags.length) return tags.map((t) => t.label).join(", ");
  const summary = record?.result?.tcDeltaSummary || record?.tcDeltaSummary;
  if (typeof summary === "string" && summary.trim()) return summary.trim();
  return "-";
}

/** TC delta fields as display tags (SE Labs activities feed). */
export function resolveTcTags(record) {
  const deltas = record?.result?.tcDeltas || record?.tcDeltas;
  if (!Array.isArray(deltas) || !deltas.length) return [];
  return deltas
    .filter((d) => d?.field && d.previous !== d.current)
    .map((d) => {
      const key = String(d.field);
      return {
        key,
        label:
          TC_FIELD_LABELS[key] ||
          key.replace(/_/g, " ").replace(/([A-Z])/g, " $1").trim().replace(/\b\w/g, (c) => c.toUpperCase()),
        risky: TC_RISKY_FIELDS.has(key),
      };
    })
    .slice(0, 4);
}

export function resolveQipScoreNumeric(record) {
  const scorecard = resolveScorecard(record);
  const meta = resolveAnalysisMeta(record);
  if (typeof scorecard?.overall === "number" && Number.isFinite(scorecard.overall)) {
    return scorecard.overall;
  }
  if (typeof scorecard?.rawScore === "number" && Number.isFinite(scorecard.rawScore)) {
    return scorecard.rawScore / 10;
  }
  if (!scorecard?.lines?.length) return null;
  const callType = scorecard?.callType || resolveCallType(record);
  const composite = typeComposite(
    [
      {
        callType,
        rubricVersion: scorecard.rubricVersion || meta.rubricVersion || "1.0",
        lines: scorecard.lines,
        provisional: scorecard.provisional ?? meta.provisional,
        confidence: scorecard.confidence ?? meta.analysisConfidence,
      },
    ],
    callType,
    { includeIneligible: true },
  );
  return composite?.score ?? null;
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
    return { label: "-", provisional: isProvisional(record) };
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

/** Normalize TYPE filter — empty / all_types means no type restriction. */
export function normalizeActivityTypeFilter(raw) {
  const t = String(raw ?? "").trim();
  if (!t || t === ACTIVITY_FILTER_ALL_TYPES) return "";
  return t;
}

/** @param {object[]} records @param {{ callType?: string, window?: string }} filters */
export function filterCallRecords(records, filters = {}) {
  const type = normalizeActivityTypeFilter(filters.callType);
  const start = windowStartMs(filters.window || "30d");
  return records.filter((rec) => {
    if (type === ACTIVITY_FILTER_PRECALL_BRIEFS) return false;
    if (type && resolveCallType(rec) !== type) return false;
    if (start != null && (rec.timestamp || 0) < start) return false;
    return true;
  });
}

/**
 * Unified Activities feed: time-sorted briefs + calls.
 * Type "" / all_types = all; "precall_briefs" = briefs only; other values = matching callType keys only.
 * @param {object[]} callRecords
 * @param {object[]} briefs
 * @param {{ callType?: string, window?: string, includeBriefs?: boolean }} [filters]
 * @returns {{ kind: 'call'|'brief', timestamp: number, record?: object, brief?: object }[]}
 */
export function mergeActivityFeed(callRecords, briefs, filters = {}) {
  const type = normalizeActivityTypeFilter(filters.callType);
  const start = windowStartMs(filters.window || "30d");
  const includeBriefs = filters.includeBriefs !== false;
  /** @type {{ kind: 'call'|'brief', timestamp: number, record?: object, brief?: object }[]} */
  const items = [];

  if (type !== ACTIVITY_FILTER_PRECALL_BRIEFS) {
    for (const record of callRecords || []) {
      if (type && resolveCallType(record) !== type) continue;
      const timestamp = record.timestamp || 0;
      if (start != null && timestamp < start) continue;
      items.push({ kind: "call", timestamp, record });
    }
  }

  if (includeBriefs && (!type || type === ACTIVITY_FILTER_PRECALL_BRIEFS)) {
    for (const brief of briefs || []) {
      const timestamp = parseBriefTimestamp(brief);
      if (start != null && timestamp < start) continue;
      items.push({ kind: "brief", timestamp, brief });
    }
  }

  return items.sort((a, b) => b.timestamp - a.timestamp);
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
 * KPI rollup for the unified Activities feed (briefs + calls), aligned with SE Labs.
 * @param {{ kind: 'call'|'brief', record?: object, brief?: object }[]} feed
 */
export function aggregateActivityFeedMetrics(feed) {
  let hours = 0;
  let scoreSum = 0;
  let scoreCount = 0;
  let briefCount = 0;
  let callCount = 0;
  const accounts = new Set();

  for (const item of feed || []) {
    if (item.kind === "brief") {
      briefCount += 1;
      hours += BRIEF_MINUTES / 60;
      const company = item.brief?.company || item.brief?.meta?.company || item.brief?.meta?.accountName;
      if (company) accounts.add(String(company).trim());
      continue;
    }
    callCount += 1;
    const rec = item.record;
    const mins = resolveDurationMinutes(rec);
    if (mins != null) hours += mins / 60;
    accounts.add(companyFromRecord(rec));
    if (isAggregateEligible(rec)) {
      const score = resolveQipScoreNumeric(rec);
      if (score != null) {
        scoreSum += score;
        scoreCount += 1;
      }
    }
  }

  return {
    total: (feed || []).length,
    briefCount,
    callCount,
    hours: Math.round(hours * 10) / 10,
    avgQuality: scoreCount ? Math.round((scoreSum / scoreCount) * 10) / 10 : null,
    scoreCount,
    accountsInPlay: accounts.size,
  };
}

/**
 * @param {object} record
 * @param {Map<string, object>} deals
 * @param {Map<string, object>} accounts
 */
export function buildCallListRow(record, deals, accounts, dealsByAccount = new Map(), opts = {}) {
  const dealId = resolveDealId(record);
  let deal = dealId ? deals.get(dealId) : null;
  let accountId = resolveAccountId(record);
  let account = accountId ? accounts.get(accountId) : null;

  if (!deal) {
    deal = pickDealForAccount(dealsByAccount, accountId);
  }

  if (!account && !accountId) {
    account = matchAccountByCompany(accounts, companyFromRecord(record));
    if (account) accountId = account.id;
  }

  if (!deal && accountId) {
    deal = pickDealForAccount(dealsByAccount, accountId);
  }

  if (deal && !account && deal.accountId) {
    account = accounts.get(deal.accountId) || null;
  }

  const callType = resolveCallType(record);
  const qip = resolveQipDisplay(record);
  const mom = resolveMomSent(record);

  const dealTitle =
    deal?.title ||
    DEAL_TYPE_LABELS[deal?.type] ||
    ownDealTitleFromRecord(record) ||
    (!opts.recordOnly && dealId && String(dealId).startsWith("deal_hist_")
      ? account?.name || ownAccountNameFromRecord(record) || "-"
      : "-");

  return {
    id: record.id,
    timestamp: record.timestamp,
    callType,
    callTypeLabel: CALL_TYPE_LABELS[callType] || callType,
    callTitle: resolveCallTitle(record),
    accountName:
      account?.name ||
      account?.domain ||
      ownAccountNameFromRecord(record) ||
      (opts.recordOnly ? "-" : companyFromRecord(record)),
    dealTitle,
    dateLabel: formatDate(record.timestamp),
    dateShortLabel: formatShortDate(record.timestamp),
    lengthLabel: formatLength(resolveDurationMinutes(record)),
    qipLabel: qip.label,
    qipScore: resolveQipScoreNumeric(record),
    qipProvisional: qip.provisional,
    tcMovement: resolveTcMovement(record),
    tcTags: resolveTcTags(record),
    momLabel: mom.label,
    momSent: mom.sent,
    gapCount: countProductGaps(record),
    hasNextStep: hasNextStep(record),
  };
}

function renderActivityKpis(metrics) {
  const cards = [
    {
      label: ACTIVITIES_NAV_LABEL,
      icon: "history",
      tile: "mocha",
      value: String(metrics.total),
      unit: "",
      delta: `${metrics.briefCount} brief${metrics.briefCount === 1 ? "" : "s"} · ${metrics.callCount} call${metrics.callCount === 1 ? "" : "s"}`,
    },
    {
      label: "Hours invested",
      icon: "clock",
      tile: "espresso",
      value: metrics.hours.toFixed(1),
      unit: "h",
      delta: "briefs counted at 15m",
    },
    {
      label: `Avg ${CALL_QUALITY_SCORE_LABEL.toLowerCase()}`,
      icon: "sparkle",
      tile: "sand",
      value: metrics.avgQuality != null ? metrics.avgQuality.toFixed(1) : "—",
      unit: metrics.avgQuality != null ? "/10" : "",
      delta:
        metrics.scoreCount > 0
          ? `from ${metrics.scoreCount} call${metrics.scoreCount === 1 ? "" : "s"} · v2.1`
          : "no eligible scores yet",
    },
    {
      label: "Accounts in play",
      icon: "building",
      tile: "taupe",
      value: String(metrics.accountsInPlay),
      unit: "",
      delta: "with activity this period",
    },
  ];

  return `
    <div class="act-kpis" aria-label="Activity metrics">
      ${cards
        .map(
          (k) => `
        <div class="act-kpi act-kpi--${esc(k.tile)}">
          <div class="act-kpi-top">
            <span class="act-kpi-label">${esc(k.label)}</span>
            <span class="act-kpi-tile">${activityIcon(k.icon, 20)}</span>
          </div>
          <div class="act-kpi-bot">
            <span class="act-kpi-val">${esc(k.value)}${k.unit ? `<u>${esc(k.unit)}</u>` : ""}</span>
            <span class="act-kpi-delta">${esc(k.delta)}</span>
          </div>
        </div>`,
        )
        .join("")}
    </div>`;
}

function renderQualityCell(row) {
  if (row.qipScore == null || !Number.isFinite(row.qipScore)) {
    return row.qipProvisional
      ? `<span class="act-dash">Provisional</span>`
      : `<span class="act-dash">—</span>`;
  }
  const pct = Math.max(0, Math.min(100, (row.qipScore / 10) * 100));
  return `<div class="act-quality">
    <span class="act-quality-num">${row.qipScore.toFixed(1)}<s>/10</s></span>
    <span class="act-quality-bar"><span class="act-quality-fill" style="width:${pct}%"></span></span>
  </div>`;
}

function renderTcTagsCell(tags) {
  if (!tags?.length) return `<span class="act-dash">—</span>`;
  return `<div class="act-tags">${tags
    .map((t) => `<span class="act-tag${t.risky ? " act-tag--risk" : ""}">${esc(t.label)}</span>`)
    .join("")}</div>`;
}

function renderActivityTitleCell(kind, title, callTypeLabel) {
  const isCall = kind === "call";
  const tileClass = isCall ? "act-row-icon--call" : "act-row-icon--brief";
  const icon = isCall ? "phone" : "brief";
  const badge = isCall
    ? `<span class="act-badge act-badge--call">${esc(ACTIVITY_NOUN)}</span>`
    : `<span class="act-badge act-badge--brief">Brief</span>`;
  const typeHint =
    isCall && callTypeLabel
      ? ` <span class="act-name-hint">· ${esc(callTypeLabel)}</span>`
      : "";
  return `<div class="act-row-title">
    <span class="act-row-icon ${tileClass}">${activityIcon(icon, 17)}</span>
    <span class="act-row-meta">
      <span class="act-row-name">${esc(title)}${typeHint}</span>
      ${badge}
    </span>
  </div>`;
}

function renderAccountCell(name) {
  return name && name !== "-"
    ? `<span class="act-cell-strong">${esc(name)}</span>`
    : `<span class="act-dash">—</span>`;
}

function renderDealCell(title) {
  return title && title !== "-"
    ? `<span class="act-cell-strong">${esc(title)}</span>`
    : `<span class="act-dash">—</span>`;
}

function renderCallTableRow(row) {
  return `
    <tr class="act-feed-row" data-row-id="call:${esc(row.id)}" data-call-id="${esc(row.id)}" data-activity-kind="call" tabindex="0" role="button">
      <td>${renderActivityTitleCell("call", row.callTitle, row.callTypeLabel)}</td>
      <td class="act-cell-type">${esc(row.callTypeLabel)}</td>
      <td data-enrich-cell="account">${renderAccountCell(row.accountName)}</td>
      <td data-enrich-cell="deal">${renderDealCell(row.dealTitle)}</td>
      <td class="act-cell-date">${esc(row.dateShortLabel)}</td>
      <td class="act-cell-mono">${esc(row.lengthLabel)}</td>
      <td>${renderQualityCell(row)}</td>
      <td>${renderTcTagsCell(row.tcTags)}</td>
    </tr>`;
}

function renderBriefTableRow(brief, deals = new Map(), accounts = new Map(), dealsByAccount = new Map()) {
  const row = buildBriefListRow(brief);
  const ts = parseBriefTimestamp(brief);
  const dateShort = ts ? formatShortDate(ts) : row.whenLabel || "-";
  const cells = buildBriefEnrichmentCells(brief, deals, accounts, dealsByAccount);
  return `
    <tr class="act-feed-row" data-row-id="brief:${esc(row.id)}" data-brief-id="${esc(row.id)}" data-activity-kind="brief" tabindex="0" role="button">
      <td>${renderActivityTitleCell("brief", row.company, row.kind)}</td>
      <td class="act-cell-type">${esc(row.kind)}</td>
      <td data-enrich-cell="account">${renderAccountCell(cells.accountName)}</td>
      <td data-enrich-cell="deal">${renderDealCell(cells.dealTitle)}</td>
      <td class="act-cell-date">${esc(dateShort)}</td>
      <td class="act-cell-mono">${BRIEF_MINUTES}m</td>
      <td><span class="act-dash">—</span></td>
      <td><span class="act-dash">—</span></td>
    </tr>`;
}

function buildBriefEnrichmentCells(brief, deals = new Map(), accounts = new Map(), dealsByAccount = new Map()) {
  const row = buildBriefListRow(brief);
  const dealId = brief?.meta?.dealId || brief?.input?.dealId || null;
  let deal = dealId ? deals.get(dealId) : null;
  let accountId = brief?.meta?.accountId || brief?.input?.accountId || null;
  let account = accountId ? accounts.get(accountId) : null;
  if (!account) {
    account = matchAccountByCompany(accounts, row.company);
    if (account) accountId = account.id;
  }
  if (!deal && accountId) deal = pickDealForAccount(dealsByAccount, accountId);
  const dealTitle =
    deal?.title ||
    DEAL_TYPE_LABELS[deal?.type] ||
    (dealId && String(dealId).startsWith("deal_hist_")
      ? account?.name || row.company || "-"
      : deal || accountId
        ? account?.name || row.company || "-"
        : "-");
  // If we still only have company and enriched deals exist for that account name, use it.
  const resolvedDealTitle =
    dealTitle !== "-"
      ? dealTitle
      : (() => {
          const matched = matchAccountByCompany(accounts, row.company);
          if (!matched) return "-";
          const d = pickDealForAccount(dealsByAccount, matched.id);
          return d?.title || DEAL_TYPE_LABELS[d?.type] || matched.name || "-";
        })();
  return {
    accountName: row.company || account?.name || "-",
    dealTitle: resolvedDealTitle,
  };
}

function renderActivityFeedRow(item, deals, accounts, dealsByAccount = new Map(), opts = {}) {
  if (item.kind === "brief") return renderBriefTableRow(item.brief, deals, accounts, dealsByAccount);
  return renderCallTableRow(buildCallListRow(item.record, deals, accounts, dealsByAccount, opts));
}

function patchActivityEnrichmentCells(container, feed, deals, accounts, dealsByAccount = new Map()) {
  const rows = new Map();
  container.querySelectorAll("[data-row-id]").forEach((row) => {
    rows.set(row.getAttribute("data-row-id"), row);
  });

  for (const item of feed || []) {
    const id = item.kind === "brief" ? item.brief?.id : item.record?.id;
    if (!id) continue;
    const row = rows.get(`${item.kind}:${id}`);
    if (!row) continue;

    const cells =
      item.kind === "brief"
        ? buildBriefEnrichmentCells(item.brief, deals, accounts, dealsByAccount)
        : (() => {
            const callRow = buildCallListRow(item.record, deals, accounts, dealsByAccount);
            return { accountName: callRow.accountName, dealTitle: callRow.dealTitle };
          })();

    const accountCell = row.querySelector('[data-enrich-cell="account"]');
    const dealCell = row.querySelector('[data-enrich-cell="deal"]');
    if (accountCell) accountCell.innerHTML = renderAccountCell(cells.accountName);
    if (dealCell) dealCell.innerHTML = renderDealCell(cells.dealTitle);
  }
}

function renderCallsEmptyState(message) {
  return `
    <div class="lifecycle-empty call-list-empty">
      <fw-card>
        <fw-icon name="phone" size="24" aria-hidden="true"></fw-icon>
        <h2>${esc(ACTIVITIES_NAV_LABEL)}</h2>
        <p class="muted">${esc(message)}</p>
      </fw-card>
    </div>`;
}

function wireCallListClicks(container, opts) {
  container.querySelectorAll(".act-feed-row").forEach((row) => {
    const activate = () => {
      const briefId = row.getAttribute("data-brief-id");
      if (briefId) {
        opts.onSelectBrief?.(briefId);
        return;
      }
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
    const rawType = typeSelect ? await readFieldValueAsync(typeSelect) : opts.callType || "";
    const callType = normalizeActivityTypeFilter(rawType);
    const window = windowSelect ? await readFieldValueAsync(windowSelect) : opts.window || "30d";
    opts.onFiltersChange?.({ callType, window });
    if (opts.liveFilters) {
      opts.liveFilters.callType = callType;
      opts.liveFilters.window = window || "30d";
    }
    render({ callType, window });
  };

  typeSelect?.addEventListener("fwChange", () => { void run(); });
  windowSelect?.addEventListener("fwChange", () => { void run(); });
}

async function enrichDealsAndAccounts(records, session = null, briefs = []) {
  const deals = new Map();
  const accounts = new Map();
  /** @type {Map<string, object[]>} */
  const dealsByAccount = new Map();
  const dealIds = new Set();
  const accountIds = new Set();
  const store = getStore();

  const batchGetByIds = async (collection, ids, fallbackGet, label) => {
    const unique = [...new Set([...ids].filter(Boolean))];
    if (!unique.length) return [];
    if (typeof store.getReadModels === "function") {
      try {
        return await store.getReadModels(collection, unique);
      } catch (err) {
        console.warn(`[calls-list] batch ${label} load skipped:`, err?.message || err);
      }
    }
    return Promise.all(
      unique.map(async (id) => {
        try {
          return fallbackGet ? await fallbackGet(id) : null;
        } catch (err) {
          console.warn(`[calls-list] ${label} skipped:`, id, err?.message || err);
          return null;
        }
      }),
    );
  };

  for (const rec of records) {
    const did = resolveDealId(rec);
    if (did) dealIds.add(did);
    const aid = resolveAccountId(rec);
    if (aid) accountIds.add(aid);
  }

  for (const brief of briefs || []) {
    const did = brief?.meta?.dealId || brief?.input?.dealId || null;
    if (did) dealIds.add(did);
    const aid = brief?.meta?.accountId || brief?.input?.accountId || null;
    if (aid) accountIds.add(aid);
  }

  const fetchedDeals = await batchGetByIds(
    "deals",
    dealIds,
    (id) => (store.getDeal ? store.getDeal(id) : null),
    "getDeal",
  );
  for (const deal of fetchedDeals || []) {
    if (!deal?.id) continue;
    deals.set(deal.id, deal);
    if (deal.accountId) accountIds.add(deal.accountId);
  }

  // History-synthesized deal_hist_* ids are not in Firestore — fill from local history.
  const missingDealIds = [...dealIds].filter((id) => !deals.has(id));
  if (missingDealIds.length && session?.email) {
    try {
      const histRows = listDealsFromHistory(session);
      for (const row of histRows || []) {
        const deal = row?.deal;
        if (!deal?.id) continue;
        if (!deals.has(deal.id)) deals.set(deal.id, deal);
        if (deal.accountId) {
          accountIds.add(deal.accountId);
          if (row.account && !accounts.has(deal.accountId)) accounts.set(deal.accountId, row.account);
          const list = dealsByAccount.get(deal.accountId) || [];
          if (!list.some((d) => d.id === deal.id)) list.push(deal);
          dealsByAccount.set(deal.accountId, list);
        }
      }
      // Map missing deal_hist_* ids (e.g. deal_hist_acc_xxx) to history rows by account/company.
      for (const missingId of missingDealIds) {
        if (deals.has(missingId)) continue;
        const recsForDeal = (records || []).filter((r) => resolveDealId(r) === missingId);
        const linkedAccountId = recsForDeal.map((r) => resolveAccountId(r)).find(Boolean);
        const linkedCompany = recsForDeal
          .map((r) => companyFromRecord(r))
          .find((c) => c && c !== ACTIVITY_NOUN);

        let histMatch =
          (linkedAccountId &&
            (histRows || []).find(
              (r) => r.deal?.accountId === linkedAccountId || r.account?.id === linkedAccountId,
            )) ||
          (linkedCompany &&
            (histRows || []).find(
              (r) =>
                String(r.account?.name || "")
                  .trim()
                  .toLowerCase() === linkedCompany.trim().toLowerCase(),
            )) ||
          null;

        if (!histMatch && String(missingId).startsWith("deal_hist_")) {
          const slug = String(missingId).slice("deal_hist_".length);
          histMatch =
            (histRows || []).find((r) => {
              const acctSlug = String(r.account?.id || "").replace(/^hist_/, "");
              return (
                acctSlug === slug ||
                r.account?.id === slug ||
                r.deal?.id === missingId ||
                String(r.deal?.id || "").endsWith(slug)
              );
            }) || null;
        }

        if (histMatch?.deal) {
          const aliasDeal = {
            ...histMatch.deal,
            id: missingId,
            accountId: linkedAccountId || histMatch.deal.accountId || histMatch.account?.id,
          };
          deals.set(missingId, aliasDeal);
          const aid = aliasDeal.accountId;
          if (aid) {
            accountIds.add(aid);
            if (histMatch.account && !accounts.has(aid)) accounts.set(aid, histMatch.account);
            const list = dealsByAccount.get(aid) || [];
            if (!list.some((d) => d.id === missingId)) list.push(aliasDeal);
            dealsByAccount.set(aid, list);
          }
          continue;
        }

        // Last resort: synthesize a display stub from linked account/company on the call record.
        if (String(missingId).startsWith("deal_hist_") && (linkedAccountId || linkedCompany)) {
          const account = linkedAccountId ? accounts.get(linkedAccountId) : null;
          const stub = {
            id: missingId,
            accountId: linkedAccountId || account?.id || null,
            type: "new_business",
            status: "active",
            stage: "demo",
            title: account?.name || linkedCompany || "Deal",
          };
          deals.set(missingId, stub);
          if (stub.accountId) {
            const list = dealsByAccount.get(stub.accountId) || [];
            if (!list.some((d) => d.id === missingId)) list.push(stub);
            dealsByAccount.set(stub.accountId, list);
          }
        }
      }
    } catch (err) {
      console.warn("[calls-list] listDealsFromHistory skipped:", err?.message || err);
    }
  }

  const unmatchedCompanies = new Set();
  for (const rec of records) {
    if (resolveAccountId(rec)) continue;
    const company = companyFromRecord(rec);
    if (company && company !== ACTIVITY_NOUN) unmatchedCompanies.add(company);
  }
  for (const brief of briefs || []) {
    if (brief?.meta?.accountId || brief?.input?.accountId) continue;
    const company = brief?.company || brief?.meta?.company || "";
    if (company && company !== ACTIVITY_NOUN) unmatchedCompanies.add(company);
  }

  if (unmatchedCompanies.size && store.listAccounts) {
    try {
      const allAccounts = await store.listAccounts({ limit: 500 });
      const accountMap = new Map();
      for (const account of allAccounts || []) {
        if (account?.id) accountMap.set(account.id, account);
      }
      for (const company of unmatchedCompanies) {
        const matched = matchAccountByCompany(accountMap, company);
        if (matched?.id) accountIds.add(matched.id);
      }
    } catch (err) {
      console.warn("[calls-list] listAccounts skipped:", err?.message || err);
    }
  }

  const missingAccountIds = new Set([...accountIds].filter((id) => !accounts.has(id)));
  const fetchedAccounts = await batchGetByIds(
    "accounts",
    missingAccountIds,
    (id) => (store.getAccount ? store.getAccount(id) : null),
    "getAccount",
  );
  for (const account of fetchedAccounts || []) {
    if (account?.id && !accounts.has(account.id)) accounts.set(account.id, account);
  }

  await Promise.all(
    [...accountIds].map(async (accountId) => {
      try {
        const list = await listDealsForAccount(accountId);
        if (list.length) {
          dealsByAccount.set(accountId, list);
          for (const deal of list) deals.set(deal.id, deal);
        }
      } catch (err) {
        console.warn("[calls-list] listDealsForAccount skipped:", accountId, err?.message || err);
      }
    }),
  );

  return { deals, accounts, dealsByAccount };
}

/** @type {WeakMap<object, { deals: Map, accounts: Map, promise?: Promise<any> }>} */
const enrichCache = new WeakMap();

/** @param {HTMLElement} container @param {object} session @param {object} opts */
export async function renderCallsListView(container, session, opts = {}) {
  let activeSession = session;
  if (!sessionUserId(activeSession)) {
    try {
      activeSession = (await syncSessionWithDomainStore(activeSession, opts.resolveOwnerFb)) || activeSession;
    } catch (err) {
      console.warn("[calls-list] session sync failed:", err);
    }
  }
  activeSession = withEffectiveUserId(activeSession);

  if (!activeSession?.email) {
    container.innerHTML = `<p class="muted">Sign in to view activities.</p>`;
    return;
  }

  try {
    let allRecords = [];
    try {
      allRecords = await listAnalysesForSession(activeSession, {
          teamScope: opts.teamScope === true,
          resolveOwnerFb: opts.resolveOwnerFb,
          fetchRemoteHistory: opts.fetchRemoteHistory,
          syncRemoteHistory: opts.syncRemoteHistory !== false,
          dedupeByCallIdentity: false,
        });
    } catch (loadErr) {
      console.warn("[calls-list] session analyses failed, using local history:", loadErr?.message || loadErr);
      const { listPostCallAnalyses } = await import("./history.js");
      allRecords = listPostCallAnalyses(activeSession.email);
    }
    const listFiltered = filterCallRecordsForList(allRecords, opts.listFilter);
    const includeBriefs = !opts.listFilter;
    let allBriefs = [];
    if (includeBriefs) {
      try {
        allBriefs = await loadMergedBriefs({ fetchAllRemotePreps: opts.fetchAllRemotePreps });
      } catch (briefErr) {
        console.warn("[calls-list] briefs load failed:", briefErr?.message || briefErr);
      }
    }

    if (!listFiltered.length && !allBriefs.length) {
      container.innerHTML = renderCallsEmptyState(
        opts.listFilter
          ? "No activities match this filter."
          : "No activities yet. Generate a pre-call brief or analyze a recording from Post-call to populate this list.",
      );
      return;
    }

    const filters = {
      callType: normalizeActivityTypeFilter(opts.callType),
      window: opts.window || "30d",
    };
    const liveFilters = opts.liveFilters || filters;
    liveFilters.callType = filters.callType;
    liveFilters.window = filters.window;

    const emptyMaps = { deals: new Map(), accounts: new Map(), dealsByAccount: new Map() };
    let enrichState = enrichCache.get(listFiltered);
    if (!enrichState) {
      enrichState = {
        deals: emptyMaps.deals,
        accounts: emptyMaps.accounts,
        dealsByAccount: emptyMaps.dealsByAccount,
      };
      enrichCache.set(listFiltered, enrichState);
      enrichState.promise = enrichDealsAndAccounts(listFiltered, activeSession, allBriefs).then((result) => {
        enrichState.deals = result.deals;
        enrichState.accounts = result.accounts;
        enrichState.dealsByAccount = result.dealsByAccount;
        return result;
      });
    }

    const typeSelectValue = filters.callType || ACTIVITY_FILTER_ALL_TYPES;
    const typeOptions = [
      `<fw-select-option value="${ACTIVITY_FILTER_ALL_TYPES}"${!filters.callType ? " selected" : ""}>All types</fw-select-option>`,
      `<fw-select-option value="${ACTIVITY_FILTER_PRECALL_BRIEFS}"${filters.callType === ACTIVITY_FILTER_PRECALL_BRIEFS ? " selected" : ""}>${esc(PRECALL_BRIEFS_TYPE_LABEL)}</fw-select-option>`,
      ...CALL_TYPES.map(
        (t) =>
          `<fw-select-option value="${esc(t)}"${filters.callType === t ? " selected" : ""}>${esc(CALL_TYPE_LABELS[t])}</fw-select-option>`,
      ),
    ].join("");
    const windowOptions = DATE_WINDOWS.map(
      (w) =>
        `<fw-select-option value="${esc(w.id)}"${filters.window === w.id ? " selected" : ""}>${esc(w.label)}</fw-select-option>`,
    ).join("");

    const paint = (activeFilters, dealMap = enrichState.deals, accountMap = enrichState.accounts) => {
      const dealsByAccount = enrichState.dealsByAccount || emptyMaps.dealsByAccount;
      const normalized = {
        callType: normalizeActivityTypeFilter(activeFilters?.callType),
        window: activeFilters?.window || "30d",
        includeBriefs,
      };
      const feed = mergeActivityFeed(listFiltered, allBriefs, normalized);
      const feedMetrics = aggregateActivityFeedMetrics(feed);
      const metricsEl = container.querySelector(".call-list-metrics-host");
      const feedSubEl = container.querySelector(".act-feed-sub");
      const tbody = container.querySelector(".act-feed-body");
      const renderOpts = {
        recordOnly: !(dealMap?.size || accountMap?.size || dealsByAccount?.size),
      };
      if (metricsEl) {
        metricsEl.innerHTML =
          activeFilters.callType === ACTIVITY_FILTER_PRECALL_BRIEFS
            ? renderActivityKpis({ ...feedMetrics, avgQuality: null, scoreCount: 0 })
            : renderActivityKpis(feedMetrics);
      }
      if (feedSubEl) {
        feedSubEl.textContent = `${feed.length} activit${feed.length === 1 ? "y" : "ies"} · newest first`;
      }
      if (tbody) {
        tbody.innerHTML = feed.length
          ? feed
              .map((item) => renderActivityFeedRow(item, dealMap, accountMap, dealsByAccount, renderOpts))
              .join("")
          : `<tr><td colspan="8" class="act-feed-empty muted">No activities match these filters.</td></tr>`;
        wireCallListClicks(tbody.closest(".call-list-view") || container, opts);
      }
    };

    const initialFeed = mergeActivityFeed(listFiltered, allBriefs, {
      ...filters,
      includeBriefs,
    });
    const initialMetrics = aggregateActivityFeedMetrics(initialFeed);

    container.innerHTML = `
      <div class="lifecycle-list-view call-list-view call-list-view--labs">
        <div class="act-header">
          <h1 class="call-list-heading">${opts.listFilter ? "Filtered activities" : ACTIVITIES_NAV_LABEL}</h1>
          <div class="act-filters">
            <label class="act-filter">
              <span class="act-filter-label">Type</span>
              <fw-select id="calls-filter-type" label="" value="${esc(typeSelectValue)}" hide-label>${typeOptions}</fw-select>
            </label>
            <label class="act-filter">
              <span class="act-filter-label">When</span>
              <fw-select id="calls-filter-window" label="" value="${esc(filters.window)}" hide-label>${windowOptions}</fw-select>
            </label>
          </div>
        </div>
        <div class="call-list-metrics-host">${renderActivityKpis(initialMetrics)}</div>
        <section class="act-feed-card">
          <div class="act-feed-head">
            <h2 class="act-feed-title">Activity feed</h2>
            <span class="act-feed-sub">${initialFeed.length} activit${initialFeed.length === 1 ? "y" : "ies"} · newest first</span>
          </div>
          <div class="act-table-wrap">
            <table class="act-table">
              <thead>
                <tr>
                  <th scope="col">Activity</th>
                  <th scope="col">Type</th>
                  <th scope="col">Account</th>
                  <th scope="col">Deal</th>
                  <th scope="col">Date</th>
                  <th scope="col">Length</th>
                  <th scope="col">${esc(CALL_QUALITY_SCORE_LABEL)}</th>
                  <th scope="col">Technical commit moved</th>
                </tr>
              </thead>
              <tbody class="act-feed-body">
                ${initialFeed
                  .map((item) =>
                    renderActivityFeedRow(item, emptyMaps.deals, emptyMaps.accounts, emptyMaps.dealsByAccount, {
                      recordOnly: true,
                    }),
                  )
                  .join("")}
              </tbody>
            </table>
          </div>
        </section>
      </div>`;

    wireCallListFilters(container, listFiltered, enrichState.deals, enrichState.accounts, { ...opts, liveFilters }, paint);

    void enrichState.promise?.then(() => {
      const activeFilters = {
        callType: liveFilters.callType || "",
        window: liveFilters.window || "30d",
        includeBriefs,
      };
      const activeFeed = mergeActivityFeed(listFiltered, allBriefs, activeFilters);
      patchActivityEnrichmentCells(
        container,
        activeFeed,
        enrichState.deals,
        enrichState.accounts,
        enrichState.dealsByAccount || emptyMaps.dealsByAccount,
      );
    });
  } catch (err) {
    console.error("[calls-list-view] failed to render:", err);
    container.innerHTML = renderCallsEmptyState(
      "Could not load activities right now. Refresh the page or try again in a moment.",
    );
  }
}

/** Dashboard KPI counts — mirrors Activities list (deduped, provisional excluded, all-time). */
export function buildLaunchpadCallMetricsFromRecords(records) {
  const deduped = dedupeAnalysesByCallIdentity(records || []);
  const allTime = aggregateCallListMetrics(filterCallRecords(deduped, { window: "all" }));
  const week = aggregateCallListMetrics(filterCallRecords(deduped, { window: "7d" }));
  return {
    totalCalls: allTime.callCount,
    callsThisWeek: week.callCount,
    records: deduped,
  };
}

export function buildLaunchpadCallMetrics(email) {
  return buildLaunchpadCallMetricsFromRecords(listPostCallAnalyses(email));
}
