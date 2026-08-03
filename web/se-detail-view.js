/**
 * SE detail screen — wireframe #se, spec §11.8.
 * Per-type QIP averages, theme scores, accounts, calls, receipts. Never a blended composite.
 */

import { esc } from "./shared.js";
import { themeLabel } from "./theme-library.js";
import { barClass } from "./chart-shared.js";
import { aggregateQualityMetrics } from "./dashboard.js";
import {
  assertSeProfileAccess,
  listAccountsForSeProfile,
  enrichDealRowsWithTraction,
  normalizeSeEmail,
} from "./domain/se-access-service.js";
import { listDealsForSession, deriveAccountHealth } from "./domain/account-service.js?v=2.1";
import { getStore } from "./domain/store.js";
import { wireCallLinks } from "./crayons-ui.js";
import { displayNameForEmail } from "./auth.js";
import { dedupeAnalysesByCallIdentity } from "./call-identity.js";
import { listAnalysesWithQuality } from "./history.js";

const QIP_SCORE_MAX = 100;
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

function formatCompactUsd(n) {
  if (n == null || !Number.isFinite(n)) return "-";
  if (n >= 1_000_000) return `$${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `$${Math.round(n / 1_000)}K`;
  return `$${Math.round(n)}`;
}

function formatArrBand(low, high) {
  if (low != null && high != null && low !== high) {
    return `${formatCompactUsd(low)}–${formatCompactUsd(high)}`;
  }
  return formatCompactUsd(low ?? high);
}

function formatShortDate(ts) {
  if (!ts) return "-";
  return new Date(ts).toLocaleDateString(undefined, { month: "short", day: "numeric" });
}

function formatEvidenceTimestamp(atS) {
  if (atS == null || !Number.isFinite(atS)) return "";
  const m = Math.floor(atS / 60);
  const s = Math.floor(atS % 60);
  return `${m}:${String(s).padStart(2, "0")}`;
}

function renderPerTypeMetrics(byType) {
  if (!byType?.length) {
    return `<div class="dash-stat prep-action-block"><span class="dash-stat-label">Call types</span><span class="dash-stat-value dash-stat-text">-</span></div>`;
  }
  return byType
    .map((t) => {
      const label = CALL_TYPE_LABELS[t.callType] || t.callType;
      const score = t.score;
      const cls = score != null ? barClass(score, QIP_SCORE_MAX) : "";
      const display = score != null ? String(Math.round(score)) : "-";
      const count = t.callCount || 0;
      return `
        <div class="dash-stat prep-action-block se-metric-card se-type-stat">
          <span class="dash-stat-label">${esc(label)} average</span>
          <span class="dash-stat-value se-metric-num ${cls}">${esc(display)}</span>
          <span class="dash-stat-sub muted se-metric-hint">${count} call${count === 1 ? "" : "s"}</span>
        </div>`;
    })
    .join("");
}

function renderSummaryMetrics(summary) {
  return `
    <div class="dash-stat prep-action-block se-metric-card">
      <span class="dash-stat-label">Accounts</span>
      <span class="dash-stat-value se-metric-num">${summary.accountCount}</span>
      <span class="dash-stat-sub muted se-metric-hint">${summary.multiDealAccounts} multi-deal</span>
    </div>
    <div class="dash-stat prep-action-block se-metric-card">
      <span class="dash-stat-label">ARR owned</span>
      <span class="dash-stat-value se-metric-num">${esc(formatCompactUsd(summary.arrOwned))}</span>
      <span class="dash-stat-sub muted se-metric-hint">${summary.openDeals} open deals</span>
    </div>
    <div class="dash-stat prep-action-block se-metric-card">
      <span class="dash-stat-label">Cold</span>
      <span class="dash-stat-value se-metric-num weak">${summary.coldCount}</span>
      <span class="dash-stat-sub muted se-metric-hint">${esc(formatCompactUsd(summary.coldArr))} at risk</span>
    </div>`;
}

function renderThemeRows(themeRows, expandThemeKey, onThemeClick) {
  if (!themeRows.length) {
    return `<p class="muted">No theme scores yet. analyze calls to populate this panel.</p>`;
  }
  const sorted = [...themeRows].sort((a, b) => a.avgScore - b.avgScore);
  return sorted
    .map((d) => {
      const pct = Math.min(100, Math.max(0, (d.avgScore / QIP_SCORE_MAX) * 100));
      const cls = barClass(d.avgScore, QIP_SCORE_MAX);
      const expanded = d.name === expandThemeKey ? " se-theme-row--expanded" : "";
      const delta =
        d.delta != null
          ? `<span class="se-theme-delta ${d.delta >= 0 ? "good" : "weak"}">${d.delta >= 0 ? "+" : ""}${d.delta.toFixed(0)} vs team</span>`
          : "";
      return `
        <button type="button" class="se-theme-row dash-drill-link${expanded}" data-drill="theme" data-theme-key="${esc(d.name)}">
          <span class="dash-dim-label">${esc(themeLabel(d.name))}</span>
          <span class="qc-dim-bar dash-dim-bar" aria-hidden="true">
            <span class="qc-dim-bar-fill ${cls}" style="width:${pct}%"></span>
          </span>
          <span class="qc-dim-score ${cls} dash-dim-score">${Math.round(d.avgScore)}</span>
          ${delta}
        </button>`;
    })
    .join("");
}

function renderReceipts(receipts, themeKey, ownerEmail) {
  if (!receipts.length) {
    return `<p class="muted">No timestamped evidence for ${esc(themeLabel(themeKey))} yet.</p>`;
  }
  return receipts
    .map((r) => {
      const ts = formatEvidenceTimestamp(r.atS);
      const dateLabel = formatShortDate(r.timestamp);
      const meta = [r.company, dateLabel, ts].filter(Boolean).join(" · ");
      return `
        <article class="coaching-ev coaching-ev--bad">
          <button type="button" class="coaching-receipt-link dash-call-link" data-call-id="${esc(r.callId)}" data-call-tab="qip" data-expand-theme="${esc(r.themeKey)}" data-call-owner="${esc(ownerEmail)}">
            <div class="coaching-ev-ts">${esc(meta)}</div>
            <div class="coaching-ev-body">${esc(r.quote)}</div>
          </button>
        </article>`;
    })
    .join("");
}

function renderAccountsTable(accounts) {
  if (!accounts.length) {
    return `<p class="muted">No accounts assigned yet.</p>`;
  }
  const rows = accounts
    .map(
      (a) => `
      <tr class="se-account-row">
        <td>
          <button type="button" class="se-drill-account dash-drill-link" data-account-id="${esc(a.accountId)}">${esc(a.name)}</button>
        </td>
        <td class="num">${a.dealCount}</td>
        <td class="num">${esc(formatArrBand(a.arrLow, a.arrHigh))}</td>
        <td class="num">${a.callCount}</td>
        <td><span class="health-pill health-pill--${esc(a.health.tone)}">${esc(a.health.label)}</span></td>
        <td class="muted num">${a.lastTouchDays != null ? `${a.lastTouchDays}d` : "-"}</td>
      </tr>`,
    )
    .join("");
  return `
    <div class="manager-table-wrap se-accounts-table-wrap">
      <table class="se-accounts-table">
        <thead>
          <tr>
            <th scope="col" class="se-table-col-name">Account</th>
            <th scope="col">Deals</th>
            <th scope="col">ARR</th>
            <th scope="col">Calls</th>
            <th scope="col">Health</th>
            <th scope="col">Last touch</th>
          </tr>
        </thead>
        <tbody>${rows}</tbody>
      </table>
    </div>`;
}

function renderCallsTable(calls, ownerEmail) {
  if (!calls.length) {
    return `<p class="muted">No scored calls yet.</p>`;
  }
  const rows = calls
    .slice(0, 20)
    .map((c) => {
      const conf = c.confidencePct != null ? `${c.confidencePct}%` : "-";
      return `
        <tr>
          <td class="se-table-col-name">
            <button type="button" class="dash-call-link" data-call-id="${esc(c.id)}" data-call-tab="qip" data-call-owner="${esc(ownerEmail)}">${esc(c.callTitle || c.company)}</button>
          </td>
          <td>${esc(c.callTypeLabel)}</td>
          <td class="muted">${esc(c.company)}</td>
          <td class="muted se-table-col-date">${esc(formatShortDate(c.timestamp))}</td>
          <td>${esc(conf)}</td>
          <td><span class="qc-dim-score">${esc(c.scoreLabel || "-")}</span></td>
        </tr>`;
    })
    .join("");
  return `
    <div class="manager-table-wrap se-calls-table-wrap">
      <table class="se-calls-table">
        <thead>
          <tr>
            <th scope="col" class="se-table-col-name">Call</th>
            <th scope="col">Type</th>
            <th scope="col">Account</th>
            <th scope="col">Date</th>
            <th scope="col">Conf</th>
            <th scope="col">Score</th>
          </tr>
        </thead>
        <tbody>${rows}</tbody>
      </table>
    </div>`;
}

function daysSince(ts) {
  if (!ts) return null;
  return Math.max(0, Math.floor((Date.now() - ts) / (24 * 60 * 60 * 1000)));
}

/** @param {object[]} coachingRecords @param {string} themeKey @param {number} limit */
function collectThemeReceipts(coachingRecords, themeKey, limit = 5) {
  if (!themeKey) return [];
  const receipts = [];
  for (const rec of coachingRecords) {
    const sc = rec.result?.scorecard || rec.analysis?.qualityCoach;
    const lines = sc?.lines;
    if (!lines?.length) continue;
    const line = lines.find((l) => l.themeKey === themeKey && l.applicable !== false);
    if (!line) continue;
    const evidence = (line.evidence || line.evidenceJson || []).filter((e) => e?.quote);
    if (!evidence.length) continue;
    const ev = evidence[0];
    const title = rec.analysis?.callHeader?.title || rec.title || "Call";
    const company = String(title).split(/[·|–—-]/)[0]?.trim() || title;
    receipts.push({
      callId: rec.id,
      company,
      timestamp: rec.timestamp,
      themeKey,
      lineScore: line.score,
      quote: ev.quote,
      atS: ev.atS,
    });
  }
  return receipts.sort((a, b) => a.lineScore - b.lineScore).slice(0, limit);
}

async function buildSeDetailView(session, targetEmail, opts = {}) {
  await assertSeProfileAccess(session, targetEmail);
  const email = normalizeSeEmail(targetEmail);
  const analyses = dedupeAnalysesByCallIdentity(listAnalysesWithQuality(email));
  const metrics = aggregateQualityMetrics(analyses);
  const accountRows = await listAccountsForSeProfile(session, email);
  const store = getStore();
  const allDeals = enrichDealRowsWithTraction(store, await listDealsForSession(session));
  const enrichedDeals = await allDeals;

  const seDealIds = new Set();
  for (const row of accountRows) {
    for (const deal of row.deals || []) {
      if (deal?.id) seDealIds.add(deal.id);
    }
  }
  const seDeals = enrichedDeals.filter((r) => seDealIds.has(r.deal?.id));

  let coldCount = 0;
  let coldArr = 0;
  let arrOwned = 0;
  for (const row of seDeals) {
    if (row.deal?.status !== "active") continue;
    const point = row.deal.arrEstimatePoint ?? 0;
    arrOwned += point;
    if (row.traction === "cold") {
      coldCount += 1;
      coldArr += point;
    }
  }

  const multiDealAccounts = accountRows.filter((r) => (r.deals?.length || 0) > 1).length;
  const themeRows = (metrics.dimensions || []).map((d) => {
    const teamAvg = opts.teamThemeAverages?.get(d.name) ?? null;
    const delta =
      teamAvg != null && d.avgScore != null ? Math.round((d.avgScore - teamAvg) * 10) / 10 : null;
    return { ...d, teamAvg, delta };
  });

  const expandTheme = opts.expandThemeKey || metrics.worstDimension?.name || null;
  const receiptsTheme = expandTheme || metrics.worstDimension?.name;
  const receipts = receiptsTheme ? collectThemeReceipts(analyses, receiptsTheme, 5) : [];

  return {
    email,
    name: displayNameForEmail(email),
    metrics,
    byType: metrics.byType || [],
    themeRows,
    expandThemeKey: expandTheme,
    receipts,
    receiptsTheme,
    accounts: accountRows.map((row) => {
      const deals = row.deals || [];
      const arrLow = deals.reduce((min, d) => {
        const v = d.arrEstimateLow ?? d.arrEstimatePoint;
        return v != null && (min == null || v < min) ? v : min;
      }, null);
      const arrHigh = deals.reduce((max, d) => {
        const v = d.arrEstimateHigh ?? d.arrEstimatePoint;
        return v != null && (max == null || v > max) ? v : max;
      }, null);
      const callCount = deals.reduce((n, d) => n + (d.postCallCount || 0), 0);
      const lastTouchDays = daysSince(row.lastActivityAt);
      const health = deriveAccountHealth(null, lastTouchDays, row.lastActivityAt);
      return {
        accountId: row.account.id,
        name: row.account.name,
        dealCount: deals.length,
        arrLow,
        arrHigh,
        callCount,
        health,
        lastTouchDays,
      };
    }),
    calls: metrics.scoredCalls || [],
    summary: {
      accountCount: accountRows.length,
      multiDealAccounts,
      openDeals: seDeals.filter((r) => r.deal?.status === "active").length,
      arrOwned,
      coldCount,
      coldArr,
    },
  };
}

function mountSeDetailView(container, view, opts = {}) {
  container.querySelectorAll("[data-drill='theme']").forEach((btn) => {
    const theme = btn.dataset.themeKey;
    if (!theme) return;
    const activate = () => opts.onExpandTheme?.(theme);
    btn.addEventListener("click", activate);
    btn.addEventListener("fwClick", activate);
  });

  container.querySelectorAll(".se-drill-account").forEach((btn) => {
    const id = btn.dataset.accountId;
    if (!id) return;
    const activate = () => opts.onOpenAccount?.(id);
    btn.addEventListener("click", activate);
    btn.addEventListener("fwClick", activate);
  });

  wireCallLinks(container, (id, callOpts = {}) => {
    opts.onOpenCall?.(id, {
      tab: callOpts.tab || "qip",
      expandTheme: callOpts.expandTheme,
      ownerEmail: callOpts.ownerEmail || view.email,
    });
  });
}

/**
 * @param {HTMLElement} container
 * @param {object|null} session
 * @param {{ targetEmail: string, expandThemeKey?: string, teamThemeAverages?: Map<string, number|null>, onOpenCall?: Function, onOpenAccount?: Function, onExpandTheme?: Function, onBack?: Function, reportsTo?: string }} opts
 */
export async function renderSeDetailView(container, session, opts = {}) {
  const targetEmail = opts.targetEmail;
  if (!targetEmail) {
    container.innerHTML = `<p class="muted">No SE selected.</p>`;
    return;
  }

  try {
    const view = await buildSeDetailView(session, targetEmail, {
      expandThemeKey: opts.expandThemeKey,
      teamThemeAverages: opts.teamThemeAverages,
    });

    const themeLabelText = view.receiptsTheme ? themeLabel(view.receiptsTheme) : "-";
    const receiptSub =
      view.metrics.worstDimension && view.receiptsTheme
        ? `${themeLabelText} · ${view.metrics.worstDimension.avgScore.toFixed(0)} · scored on ${view.metrics.worstDimension.count} calls`
        : "";

    container.innerHTML = `
      <div class="dash-one-pager one-pager se-detail-view se-detail-view--wireframe">
        <div class="head dash-head se-detail-head">
          <div class="se-detail-identity">
            <div class="se-detail-avatar" aria-hidden="true">${esc(view.name.slice(0, 2).toUpperCase())}</div>
            <div>
              <h1 class="one-pager-title">${esc(view.name)}</h1>
              <p class="sub muted">Solution Engineer${opts.reportsTo ? ` · reports to ${esc(opts.reportsTo)}` : ""}</p>
            </div>
          </div>
          ${opts.onBack ? `<fw-button color="secondary" fill="outline" size="small" id="se-detail-back">← Team</fw-button>` : ""}
        </div>

        <div class="dash-stats prep-action-grid se-detail-stats se-detail-metrics-wire">
          ${renderPerTypeMetrics(view.byType)}
          ${renderSummaryMetrics(view.summary)}
        </div>

        <div class="se-detail-grid">
          <div class="card-wire card-wire--tight se-themes-card">
            <h2 class="se-card-title">Themes</h2>
            <p class="muted se-card-sub">Against team average · click for the calls</p>
            <div class="se-theme-rows">${renderThemeRows(view.themeRows, view.expandThemeKey)}</div>
          </div>
          <div class="card-wire card-wire--tight se-receipts-card">
            <h2 class="se-card-title">Weakest theme · the receipts</h2>
            <p class="muted se-receipts-sub">${esc(receiptSub)}</p>
            <div class="se-receipt-list">${renderReceipts(view.receipts, view.receiptsTheme, view.email)}</div>
          </div>
        </div>

        <div class="card-wire se-table-card">
          <div class="prep-form-eyebrow se-table-eyebrow">Their accounts</div>
          ${renderAccountsTable(view.accounts)}
        </div>

        <div class="card-wire se-table-card">
          <div class="prep-form-eyebrow se-table-eyebrow">Their calls</div>
          ${renderCallsTable(view.calls, view.email)}
        </div>
      </div>`;

    container._seDetailView = view;
    opts.onBack && container.querySelector("#se-detail-back")?.addEventListener("fwClick", opts.onBack);
    opts.onBack && container.querySelector("#se-detail-back")?.addEventListener("click", opts.onBack);
    mountSeDetailView(container, view, opts);
  } catch (err) {
    console.error("[se-detail] render failed:", err);
    container.innerHTML = `
      <fw-card class="dash-empty">
        <h2>Access denied</h2>
        <p class="muted">${esc(err?.message || "You cannot view this SE profile.")}</p>
      </fw-card>`;
  }
}
