/**
 * Role-aware dashboards — SE launchpad + manager team view.
 * Coaching charts exported for coaching.js.
 */

import { listAnalysesWithQuality, listPostCallAnalyses } from "./history.js";
import { dedupeAnalysesByCallIdentity } from "./call-identity.js";
import { normalizeQualityCoach, scoreBand } from "./quality-score.js";
import { aggregateFollowUps, renderFollowUpsSection } from "./follow-ups.js";
import { listTeamSeEmails, displayNameForEmail } from "./auth.js";

function esc(v) {
  return String(v ?? "").replace(/[&<>"']/g, (c) =>
    ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
}

const RADAR_DIMENSION_LABELS = {
  discovery: "Discovery",
  demoalignment: "Demo alignment",
  objections: "Objections",
  valuearticulation: "Value articulation",
  nextstepclarity: "Next-step clarity",
  talkbalance: "Talk balance",
};

const DIMENSION_ORDER = [
  "discovery",
  "demoalignment",
  "objections",
  "valuearticulation",
  "nextstepclarity",
  "talkbalance",
];

function normalizeDimensionKey(name) {
  return String(name ?? "").replace(/[\s_-]/g, "").toLowerCase();
}

export function radarDimensionLabel(name) {
  return RADAR_DIMENSION_LABELS[normalizeDimensionKey(name)] || String(name ?? "");
}

function barClass(score, max) {
  const pct = max ? score / max : 0;
  if (pct >= 0.8) return "good";
  if (pct >= 0.6) return "ok";
  return "weak";
}

function scorePct(score, max) {
  if (!max) return 0;
  return Math.min(100, Math.max(0, (score / max) * 100));
}

function sortDimensions(dimensions) {
  return [...dimensions].sort((a, b) => {
    const ia = DIMENSION_ORDER.indexOf(normalizeDimensionKey(a.name));
    const ib = DIMENSION_ORDER.indexOf(normalizeDimensionKey(b.name));
    if (ia === -1 && ib === -1) return a.name.localeCompare(b.name);
    if (ia === -1) return 1;
    if (ib === -1) return -1;
    return ia - ib;
  });
}

/**
 * @param {object[]} analyses — records from history.js
 */
export function aggregateQualityMetrics(analyses) {
  const deduped = dedupeAnalysesByCallIdentity(analyses);
  const withQc = deduped.filter((a) => a.analysis?.qualityCoach);
  const totalCalls = withQc.length;

  if (!totalCalls) {
    return {
      totalCalls: 0,
      avgOverall: null,
      dimensions: [],
      bestDimension: null,
      worstDimension: null,
      recentCalls: [],
      scoreTrend: [],
      scoreBands: { excellent: 0, strong: 0, good: 0, developing: 0, needsFocus: 0 },
    };
  }

  let overallSum = 0;
  const dimMap = new Map();
  const scoreBands = { excellent: 0, strong: 0, good: 0, developing: 0, needsFocus: 0 };

  for (const rec of withQc) {
    const qc = normalizeQualityCoach(rec.analysis.qualityCoach);
    const overall = qc.overallScore ?? 0;
    overallSum += overall;
    scoreBands[scoreBand(overall)] += 1;
    for (const d of qc.dimensions || []) {
      const key = normalizeDimensionKey(d.name);
      const cur = dimMap.get(key) || {
        name: d.name,
        scoreSum: 0,
        maxScore: d.maxScore || 5,
        count: 0,
      };
      cur.scoreSum += d.score ?? 0;
      cur.count += 1;
      cur.maxScore = d.maxScore || cur.maxScore;
      dimMap.set(key, cur);
    }
  }

  const dimensions = sortDimensions(
    [...dimMap.values()].map((d) => ({
      name: d.name,
      avgScore: d.scoreSum / d.count,
      maxScore: d.maxScore,
      count: d.count,
    })),
  );

  const ranked = [...dimensions].sort((a, b) => b.avgScore / b.maxScore - a.avgScore / a.maxScore);
  const bestDimension = ranked[0] || null;
  const worstDimension = ranked[ranked.length - 1] || null;

  const recentCalls = withQc.slice(0, 10).map((r) => {
    const qc = normalizeQualityCoach(r.analysis.qualityCoach);
    const mom = r.analysis?.momentum || {};
    const company = companyFromRecord(r);
    const nextStep = (r.analysis?.nextSteps || []).find((s) => s.action)?.action
      || mom.topAction
      || "—";
    return {
      id: r.id,
      title: r.title,
      company,
      timestamp: r.timestamp,
      overallScore: qc.overallScore,
      overallLabel: qc.overallLabel,
      momentum: mom.status || "Stalled",
      nextAction: nextStep,
    };
  });

  const scoreTrend = [...recentCalls].reverse();

  return {
    totalCalls,
    avgOverall: overallSum / totalCalls,
    dimensions,
    bestDimension,
    worstDimension,
    recentCalls,
    scoreTrend,
    scoreBands,
  };
}

export function buildDashboardMetrics(email) {
  return aggregateQualityMetrics(listAnalysesWithQuality(email));
}

function companyFromRecord(record) {
  const a = record.analysis || {};
  const title = a.callHeader?.title || record.title || "Call";
  const parts = String(title).split(/[·|–—-]/);
  return (parts[0] || title).trim();
}

function formatDate(ts) {
  if (!ts) return "";
  return new Date(ts).toLocaleString(undefined, {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
}

function formatShortDate(ts) {
  if (!ts) return "";
  return new Date(ts).toLocaleDateString(undefined, { month: "short", day: "numeric" });
}

function formatTrendLabel(ts, idx, total) {
  if (!ts) return `#${idx + 1}`;
  const d = new Date(ts);
  if (total <= 4) {
    return d.toLocaleString(undefined, { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" });
  }
  return d.toLocaleString(undefined, { month: "short", day: "numeric" });
}

function momentumClass(status) {
  if (status === "Advancing") return "momentum-advancing";
  if (status === "At risk") return "momentum-risk";
  return "momentum-stalled";
}

export function buildCoachingNudge(email, metrics) {
  const deduped = dedupeAnalysesByCallIdentity(listPostCallAnalyses(email));
  const themes = new Map();

  for (const rec of deduped) {
    const missed = rec.analysis?.qualityCoach?.missedOpportunities || [];
    for (const m of missed) {
      const t = String(m ?? "").trim();
      if (!t || t.toLowerCase() === "unknown") continue;
      themes.set(t, (themes.get(t) || 0) + 1);
    }
  }

  const recurring = [...themes.entries()]
    .filter(([, c]) => c >= 2)
    .sort((a, b) => b[1] - a[1])[0];

  if (recurring) {
    return `Recurring missed opportunity: "${recurring[0]}" across ${recurring[1]} calls.`;
  }
  if (metrics.worstDimension) {
    const w = metrics.worstDimension;
    return `Your lowest dimension is ${radarDimensionLabel(w.name)} (${w.avgScore.toFixed(1)}/${w.maxScore} avg).`;
  }
  if (metrics.totalCalls) {
    return "Review dimension breakdowns below to spot coaching themes.";
  }
  return "Analyze a few calls to unlock personalized coaching insights.";
}

function renderScoreGauge(score, max = 10) {
  const r = 52;
  const c = 2 * Math.PI * r;
  const dash = c * (score / max);
  const cls = barClass(score, max);
  const display = Number.isFinite(score) ? score.toFixed(1) : "—";
  return `
    <div class="dash-gauge-wrap">
      <p class="dash-chart-title">Average overall score</p>
      <div class="qc-gauge dash-gauge" role="img" aria-label="Average overall score ${esc(display)} out of ${esc(max)}">
        <svg class="qc-gauge-svg" viewBox="0 0 120 120" aria-hidden="true">
          <circle class="qc-gauge-track" cx="60" cy="60" r="${r}" />
          <circle class="qc-gauge-fill ${cls}" cx="60" cy="60" r="${r}"
            stroke-dasharray="${dash} ${c}" transform="rotate(-90 60 60)" />
        </svg>
        <div class="qc-gauge-text">
          <span class="qc-gauge-score ${cls}">${esc(display)}</span>
          <span class="qc-gauge-denom">/${esc(max)}</span>
        </div>
      </div>
    </div>`;
}

function radarLabelAnchor(angle) {
  const cos = Math.cos(angle);
  const sin = Math.sin(angle);
  let anchor = "middle";
  if (cos > 0.25) anchor = "start";
  else if (cos < -0.25) anchor = "end";
  let baseline = "middle";
  if (sin > 0.35) baseline = "hanging";
  else if (sin < -0.35) baseline = "alphabetic";
  return { anchor, baseline };
}

function wrapRadarLabelLines(label) {
  if (label.length <= 14) return [label];
  const lastSpace = label.lastIndexOf(" ");
  if (lastSpace > 0) return [label.slice(0, lastSpace), label.slice(lastSpace + 1)];
  const hyphenIdx = label.indexOf("-");
  if (hyphenIdx > 0 && hyphenIdx < label.length - 1) {
    return [label.slice(0, hyphenIdx + 1), label.slice(hyphenIdx + 1).trim()];
  }
  return [label];
}

function renderRadarLabelText(label, x, y, angle) {
  const lines = wrapRadarLabelLines(label);
  const { anchor, baseline } = radarLabelAnchor(angle);
  if (lines.length === 1) {
    return `<text class="qc-radar-label" x="${x}" y="${y}" text-anchor="${anchor}" dominant-baseline="${baseline}">${esc(lines[0])}</text>`;
  }
  const lineHeight = 1.15;
  const startDy = baseline === "middle" ? `${-0.55 * lineHeight}em` : "0";
  const tspans = lines
    .map((line, i) => `<tspan x="${x}" dy="${i === 0 ? startDy : `${lineHeight}em`}">${esc(line)}</tspan>`)
    .join("");
  return `<text class="qc-radar-label" x="${x}" y="${y}" text-anchor="${anchor}" dominant-baseline="${baseline}">${tspans}</text>`;
}

function renderRadarChart(dimensions) {
  if (!dimensions?.length) {
    return `<div class="dash-radar-empty muted">No dimension data yet.</div>`;
  }
  const n = dimensions.length;
  const cx = 130;
  const cy = 130;
  const maxR = 58;
  const labelR = maxR + 32;
  const rings = [0.25, 0.5, 0.75, 1]
    .map((level) => {
      const pts = [];
      for (let i = 0; i < n; i++) {
        const angle = (Math.PI * 2 * i) / n - Math.PI / 2;
        pts.push(`${cx + maxR * level * Math.cos(angle)},${cy + maxR * level * Math.sin(angle)}`);
      }
      return `<polygon class="qc-radar-grid" points="${pts.join(" ")}" />`;
    })
    .join("");
  const axes = dimensions
    .map((d, i) => {
      const angle = (Math.PI * 2 * i) / n - Math.PI / 2;
      const x2 = cx + maxR * Math.cos(angle);
      const y2 = cy + maxR * Math.sin(angle);
      const lx = cx + labelR * Math.cos(angle);
      const ly = cy + labelR * Math.sin(angle);
      return `
        <line class="qc-radar-axis" x1="${cx}" y1="${cy}" x2="${x2}" y2="${y2}" />
        ${renderRadarLabelText(radarDimensionLabel(d.name), lx, ly, angle)}`;
    })
    .join("");
  const dataPts = dimensions.map((d, i) => {
    const pct = d.avgScore / d.maxScore;
    const angle = (Math.PI * 2 * i) / n - Math.PI / 2;
    const rad = maxR * pct;
    return `${cx + rad * Math.cos(angle)},${cy + rad * Math.sin(angle)}`;
  });
  const dots = dimensions
    .map((d, i) => {
      const pct = d.avgScore / d.maxScore;
      const angle = (Math.PI * 2 * i) / n - Math.PI / 2;
      const rad = maxR * pct;
      return `<circle class="qc-radar-dot" cx="${cx + rad * Math.cos(angle)}" cy="${cy + rad * Math.sin(angle)}" r="3.5" />`;
    })
    .join("");
  return `
    <div class="qc-radar-wrap dash-radar-wrap">
      <p class="qc-radar-title">Average dimension profile</p>
      <svg class="qc-radar" viewBox="0 0 260 260" role="img" aria-label="Radar chart of average dimension scores">
        ${rings}
        ${axes}
        <polygon class="qc-radar-data" points="${dataPts.join(" ")}" />
        ${dots}
      </svg>
    </div>`;
}

function renderDimensionBarChart(dimensions) {
  if (!dimensions.length) return "";
  const rows = dimensions
    .map((d) => {
      const pct = scorePct(d.avgScore, d.maxScore);
      const cls = barClass(d.avgScore, d.maxScore);
      return `
        <div class="dash-dim-row">
          <span class="dash-dim-label">${esc(radarDimensionLabel(d.name))}</span>
          <span class="qc-dim-bar dash-dim-bar" aria-hidden="true">
            <span class="qc-dim-bar-fill ${cls}" style="width:${pct}%"></span>
          </span>
          <span class="qc-dim-score ${cls} dash-dim-score">${d.avgScore.toFixed(1)}/${d.maxScore}</span>
        </div>`;
    })
    .join("");
  return `
    <section class="dash-section dash-dim-chart">
      <h2 class="dash-section-title">Dimension averages</h2>
      <div class="card dash-dim-card">
        <div class="dash-dim-rows">${rows}</div>
      </div>
    </section>`;
}

function renderTrendChart(trend) {
  if (!trend.length) return "";
  const w = 320;
  const h = 140;
  const padL = 28;
  const padR = 12;
  const padT = 12;
  const padB = 32;
  const chartW = w - padL - padR;
  const chartH = h - padT - padB;
  const n = trend.length;
  const barGap = n > 1 ? Math.min(8, chartW / (n * 4)) : 0;
  const barW = n ? (chartW - barGap * (n - 1)) / n : chartW;
  const maxScore = 10;

  const bars = trend
    .map((c, i) => {
      const score = c.overallScore ?? 0;
      const barH = (score / maxScore) * chartH;
      const x = padL + i * (barW + barGap);
      const y = padT + chartH - barH;
      const cls = barClass(score, maxScore);
      const label = formatTrendLabel(c.timestamp, i, n);
      return `
        <g class="dash-trend-bar-group">
          <rect class="dash-trend-bar ${cls}" x="${x}" y="${y}" width="${barW}" height="${barH}" rx="3"
            aria-label="${esc(label)}: ${score}/10" />
          <text class="dash-trend-label" x="${x + barW / 2}" y="${h - 8}" text-anchor="middle">${esc(label)}</text>
          <text class="dash-trend-value ${cls}" x="${x + barW / 2}" y="${y - 4}" text-anchor="middle">${score}</text>
        </g>`;
    })
    .join("");

  const gridLines = [0, 5, 10]
    .map((v) => {
      const y = padT + chartH - (v / maxScore) * chartH;
      return `
        <line class="dash-trend-grid" x1="${padL}" y1="${y}" x2="${w - padR}" y2="${y}" />
        <text class="dash-trend-axis" x="${padL - 6}" y="${y + 4}" text-anchor="end">${v}</text>`;
    })
    .join("");

  return `
    <section class="dash-section dash-trend-section">
      <h2 class="dash-section-title">Score trend</h2>
      <div class="card dash-trend-card">
        <p class="muted dash-chart-sub">Last ${n} call${n === 1 ? "" : "s"} · oldest → newest</p>
        <svg class="dash-trend-svg" viewBox="0 0 ${w} ${h}" role="img" aria-label="Overall score trend over recent calls">
          ${gridLines}
          ${bars}
        </svg>
      </div>
    </section>`;
}

function renderScoreDistribution(bands, total) {
  if (!total) return "";
  const segments = [
    { key: "excellent", label: "Excellent (9+)", count: bands.excellent, cls: "good" },
    { key: "strong", label: "Strong (7–8.9)", count: bands.strong, cls: "ok" },
    { key: "good", label: "Good (5.5–6.9)", count: bands.good, cls: "ok" },
    { key: "developing", label: "Developing (4–5.4)", count: bands.developing, cls: "ok" },
    { key: "needsFocus", label: "Needs focus (<4)", count: bands.needsFocus, cls: "weak" },
  ];
  const r = 44;
  const c = 2 * Math.PI * r;
  let angleOffset = -90;
  const arcs = segments
    .filter((s) => s.count > 0)
    .map((s) => {
      const frac = s.count / total;
      const dash = c * frac;
      const rot = angleOffset;
      angleOffset += frac * 360;
      return `<circle class="dash-donut-seg ${s.cls}" cx="60" cy="60" r="${r}"
        stroke-dasharray="${dash} ${c - dash}" transform="rotate(${rot} 60 60)" />`;
    })
    .join("");

  const legend = segments
    .map((s) => {
      const pct = total ? Math.round((s.count / total) * 100) : 0;
      return `
        <div class="dash-donut-legend-item">
          <span class="dash-donut-swatch ${s.cls}" aria-hidden="true"></span>
          <span class="dash-donut-legend-label">${esc(s.label)}</span>
          <span class="dash-donut-legend-count qc-dim-score ${s.cls}">${s.count} <span class="muted">(${pct}%)</span></span>
        </div>`;
    })
    .join("");

  return `
    <section class="dash-section dash-distribution-section">
      <h2 class="dash-section-title">Score distribution</h2>
      <div class="card dash-distribution-card">
        <div class="dash-distribution">
          <div class="dash-donut-wrap" role="img" aria-label="Call score distribution across ${total} calls">
            <svg class="dash-donut-svg" viewBox="0 0 120 120" aria-hidden="true">
              <circle class="dash-donut-track" cx="60" cy="60" r="${r}" />
              ${arcs}
            </svg>
            <div class="dash-donut-center">
              <span class="dash-donut-total">${total}</span>
              <span class="dash-donut-total-label">calls</span>
            </div>
          </div>
          <div class="dash-donut-legend">${legend}</div>
        </div>
      </div>
    </section>`;
}

export function renderCoachingCharts(metrics) {
  if (!metrics.totalCalls) {
    return `
      <div class="dash-empty card">
        <div class="dash-empty-icon" aria-hidden="true">📈</div>
        <h2>No coaching data yet</h2>
        <p class="muted">Analyze a few calls to see quality trends, dimension averages, and score distribution.</p>
      </div>`;
  }

  const avgCls = barClass(metrics.avgOverall, 10);
  return `
    <div class="dash-stats prep-action-grid coaching-stats">
      <div class="dash-stat prep-action-block">
        <span class="dash-stat-label">Calls analyzed</span>
        <span class="dash-stat-value">${metrics.totalCalls}</span>
      </div>
      <div class="dash-stat prep-action-block">
        <span class="dash-stat-label">Avg overall score</span>
        <span class="dash-stat-value ${avgCls}">${metrics.avgOverall.toFixed(1)}<span class="dash-stat-denom">/10</span></span>
      </div>
      <div class="dash-stat prep-action-block">
        <span class="dash-stat-label">Strongest dimension</span>
        <span class="dash-stat-value dash-stat-text good">${esc(radarDimensionLabel(metrics.bestDimension?.name) || "—")}</span>
        <span class="dash-stat-sub">${metrics.bestDimension ? `${metrics.bestDimension.avgScore.toFixed(1)}/${metrics.bestDimension.maxScore}` : ""}</span>
      </div>
      <div class="dash-stat prep-action-block">
        <span class="dash-stat-label">Focus area</span>
        <span class="dash-stat-value dash-stat-text weak">${esc(radarDimensionLabel(metrics.worstDimension?.name) || "—")}</span>
        <span class="dash-stat-sub">${metrics.worstDimension ? `${metrics.worstDimension.avgScore.toFixed(1)}/${metrics.worstDimension.maxScore}` : ""}</span>
      </div>
    </div>
    <section class="dash-section">
      <h2 class="dash-section-title">Quality overview</h2>
      <div class="card dash-charts-top qc-dashboard">
        ${renderScoreGauge(metrics.avgOverall, 10)}
        ${renderRadarChart(metrics.dimensions)}
      </div>
    </section>
    ${renderDimensionBarChart(metrics.dimensions)}
    <div class="dash-charts-bottom">
      ${renderTrendChart(metrics.scoreTrend)}
      ${renderScoreDistribution(metrics.scoreBands, metrics.totalCalls)}
    </div>`;
}

function renderActionStrip() {
  return `
    <section class="launch-hero" aria-label="Quick actions">
      <div class="launch-action-strip">
        <button type="button" class="launch-action-btn launch-action-primary" data-action="prep">
          <span class="launch-action-icon" aria-hidden="true">📋</span>
          <span class="launch-action-text">
            <span class="launch-action-label">Prep a call</span>
            <span class="launch-action-sub muted">Discovery brief in minutes</span>
          </span>
        </button>
        <button type="button" class="launch-action-btn" data-action="analyze">
          <span class="launch-action-icon" aria-hidden="true">🎙</span>
          <span class="launch-action-text">
            <span class="launch-action-label">Analyze a recording</span>
            <span class="launch-action-sub muted">Post-call summary &amp; coaching</span>
          </span>
        </button>
      </div>
    </section>`;
}

function renderRecentCallsLaunchpad(recentCalls) {
  if (!recentCalls.length) {
    return `
      <section class="dash-section launch-recent" aria-labelledby="recent-heading">
        <h2 id="recent-heading" class="dash-section-title">Recent calls</h2>
        <div class="dash-empty card launch-empty">
          <div class="dash-empty-icon" aria-hidden="true">🎙</div>
          <h3>No calls yet</h3>
          <p class="muted">Analyze a Zoom recording to see momentum and next actions here.</p>
        </div>
      </section>`;
  }

  const rows = recentCalls.map((c) => {
    const momCls = momentumClass(c.momentum);
    const scoreCls = barClass(c.overallScore, 10);
    return `
      <button type="button" class="launch-recent-row dash-call-link" data-call-id="${esc(c.id)}">
        <span class="launch-recent-company">${esc(c.company)}</span>
        <span class="launch-recent-date muted">${esc(formatShortDate(c.timestamp))}</span>
        <span class="launch-recent-momentum ${momCls}">${esc(c.momentum)}</span>
        <span class="launch-recent-next muted">${esc(c.nextAction)}</span>
        <span class="launch-recent-score qc-dim-score ${scoreCls}">${c.overallScore}/10</span>
      </button>`;
  }).join("");

  return `
    <section class="dash-section launch-recent" aria-labelledby="recent-heading">
      <h2 id="recent-heading" class="dash-section-title">Recent calls</h2>
      <div class="launch-recent-list card">${rows}</div>
    </section>`;
}

function renderCoachingNudge(nudgeText) {
  return `
    <section class="dash-section launch-nudge" aria-labelledby="nudge-heading">
      <h2 id="nudge-heading" class="dash-section-title">Coaching nudge</h2>
      <div class="card launch-nudge-card">
        <p class="launch-nudge-text">${esc(nudgeText)}</p>
        <button type="button" class="link-btn launch-nudge-link" data-action="coaching">See full coaching →</button>
      </div>
    </section>`;
}

/**
 * SE launchpad dashboard.
 * @param {HTMLElement} container
 * @param {string} email
 * @param {{ seName?: string, onOpenCall?: (id: string) => void, onPrep?: () => void, onAnalyze?: () => void, onCoaching?: () => void }} opts
 */
export function renderSeLaunchpad(container, email, opts = {}) {
  const metrics = buildDashboardMetrics(email);
  const followUps = aggregateFollowUps(email, { seName: opts.seName });
  const nudge = buildCoachingNudge(email, metrics);

  container.innerHTML = `
    <div class="dash-one-pager one-pager launchpad">
      <div class="head dash-head">
        <h1 class="one-pager-title">My dashboard</h1>
        <span class="sub muted">Your SE launchpad — prep, analyze, and stay on top of follow-ups.</span>
      </div>
      ${renderActionStrip()}
      ${renderFollowUpsSection(followUps)}
      ${renderRecentCallsLaunchpad(metrics.recentCalls)}
      ${renderCoachingNudge(nudge)}
    </div>`;

  container.querySelectorAll(".dash-call-link").forEach((btn) => {
    btn.onclick = () => opts.onOpenCall?.(btn.dataset.callId);
  });

  container.querySelector('[data-action="prep"]')?.addEventListener("click", () => opts.onPrep?.());
  container.querySelector('[data-action="analyze"]')?.addEventListener("click", () => opts.onAnalyze?.());
  container.querySelector('[data-action="coaching"]')?.addEventListener("click", () => opts.onCoaching?.());
}

function buildTeamMetrics() {
  const seEmails = listTeamSeEmails();
  const allAnalyses = [];
  const seRows = [];

  for (const email of seEmails) {
    const analyses = listAnalysesWithQuality(email);
    const deduped = dedupeAnalysesByCallIdentity(analyses);
    allAnalyses.push(...deduped);
    const metrics = aggregateQualityMetrics(analyses);
    const followUps = aggregateFollowUps(email);
    seRows.push({
      email,
      name: displayNameForEmail(email),
      calls: metrics.totalCalls,
      avgScore: metrics.avgOverall,
      focusArea: metrics.worstDimension ? radarDimensionLabel(metrics.worstDimension.name) : "—",
      overdue: followUps.overdue,
    });
  }

  const teamMetrics = aggregateQualityMetrics(allAnalyses);
  return { teamMetrics, seRows };
}

function renderManagerSeTable(seRows) {
  if (!seRows.length) {
    return `<p class="muted">No SE accounts configured.</p>`;
  }
  const rows = seRows.map((se) => {
    const avgCls = se.avgScore != null ? barClass(se.avgScore, 10) : "";
    const avg = se.avgScore != null ? `${se.avgScore.toFixed(1)}/10` : "—";
    const overdueCls = se.overdue > 0 ? "weak" : "good";
    return `
      <tr>
        <td>${esc(se.name)}</td>
        <td>${se.calls}</td>
        <td><span class="qc-dim-score ${avgCls}">${esc(avg)}</span></td>
        <td>${esc(se.focusArea)}</td>
        <td><span class="qc-dim-score ${overdueCls}">${se.overdue}</span></td>
      </tr>`;
  }).join("");

  return `
    <section class="dash-section manager-table-section">
      <h2 class="dash-section-title">Per-SE overview</h2>
      <div class="card manager-table-card">
        <div class="manager-table-wrap">
          <table class="manager-se-table">
            <thead>
              <tr>
                <th scope="col">SE</th>
                <th scope="col">Calls</th>
                <th scope="col">Avg score</th>
                <th scope="col">Focus area</th>
                <th scope="col">Overdue</th>
              </tr>
            </thead>
            <tbody>${rows}</tbody>
          </table>
        </div>
      </div>
    </section>`;
}

/**
 * Manager team dashboard.
 * @param {HTMLElement} container
 */
export function renderManagerDashboard(container) {
  const { teamMetrics, seRows } = buildTeamMetrics();
  const hasData = teamMetrics.totalCalls > 0;

  container.innerHTML = `
    <div class="dash-one-pager one-pager manager-view">
      <div class="head dash-head">
        <h1 class="one-pager-title">Manager dashboard</h1>
        <span class="sub muted">Team-wide call quality — deduped by recording, scoped across all SEs.</span>
      </div>
      ${hasData ? `
        <div class="dash-stats prep-action-grid manager-stats">
          <div class="dash-stat prep-action-block">
            <span class="dash-stat-label">Team calls analyzed</span>
            <span class="dash-stat-value">${teamMetrics.totalCalls}</span>
          </div>
          <div class="dash-stat prep-action-block">
            <span class="dash-stat-label">Team avg score</span>
            <span class="dash-stat-value ${barClass(teamMetrics.avgOverall, 10)}">${teamMetrics.avgOverall.toFixed(1)}<span class="dash-stat-denom">/10</span></span>
          </div>
          <div class="dash-stat prep-action-block">
            <span class="dash-stat-label">Team focus area</span>
            <span class="dash-stat-value dash-stat-text weak">${esc(radarDimensionLabel(teamMetrics.worstDimension?.name) || "—")}</span>
          </div>
          <div class="dash-stat prep-action-block">
            <span class="dash-stat-label">SEs tracked</span>
            <span class="dash-stat-value">${seRows.length}</span>
          </div>
        </div>
        <section class="dash-section">
          <h2 class="dash-section-title">Team quality overview</h2>
          <div class="card dash-charts-top qc-dashboard">
            ${renderScoreGauge(teamMetrics.avgOverall, 10)}
            ${renderRadarChart(teamMetrics.dimensions)}
          </div>
        </section>
        ${renderDimensionBarChart(teamMetrics.dimensions)}
        <div class="dash-charts-bottom">
          ${renderTrendChart(teamMetrics.scoreTrend)}
          ${renderScoreDistribution(teamMetrics.scoreBands, teamMetrics.totalCalls)}
        </div>
      ` : `
        <div class="dash-empty card">
          <div class="dash-empty-icon" aria-hidden="true">👥</div>
          <h2>No team data yet</h2>
          <p class="muted">SEs need to analyze calls before team metrics appear here.</p>
        </div>
      `}
      ${renderManagerSeTable(seRows)}
    </div>`;
}

/**
 * @param {HTMLElement} container
 * @param {string} email
 * @param {{ seName?: string, onOpenCall?: (id: string) => void, onPrep?: () => void, onAnalyze?: () => void, onCoaching?: () => void }} opts
 */
export function renderDashboard(container, email, opts = {}) {
  renderSeLaunchpad(container, email, opts);
}
