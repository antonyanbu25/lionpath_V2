/**
 * Role-aware dashboards — SE launchpad + manager team view.
 * Coaching charts exported for coaching.js.
 */

import { listAnalysesWithQuality, listPostCallAnalyses } from "./history.js";
import { dedupeAnalysesByCallIdentity } from "./call-identity.js";
import { normalizeQualityCoach, scoreBand } from "./quality-score.js";
import { aggregateFollowUps } from "./follow-ups.js";
import { listTeamSeEmails, listTeamSeEmailsAsync, displayNameForEmail } from "./auth.js";
import { getStore } from "./domain/store.js";
import { mapEmailToTeamName } from "./domain/org-service.js";
import { renderTaskBoard, renderTaskCharts, aggregateTaskMetrics, listTasks } from "./tasks.js";
import { countPrepsGenerated } from "./precall.js";
import { wireCallLinks } from "./crayons-ui.js";

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
      <fw-card class="dash-dim-card">
        <div class="dash-dim-rows">${rows}</div>
      </fw-card>
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
      <fw-card class="dash-trend-card">
        <p class="muted dash-chart-sub">Last ${n} call${n === 1 ? "" : "s"} · oldest → newest</p>
        <svg class="dash-trend-svg" viewBox="0 0 ${w} ${h}" role="img" aria-label="Overall score trend over recent calls">
          ${gridLines}
          ${bars}
        </svg>
      </fw-card>
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
      <fw-card class="dash-distribution-card">
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
      </fw-card>
    </section>`;
}

export function renderCoachingCharts(metrics) {
  if (!metrics.totalCalls) {
    return `
      <fw-card class="dash-empty">
        <fw-icon class="dash-empty-icon" name="nav-dashboard" size="24" aria-hidden="true"></fw-icon>
        <h2>No coaching data yet</h2>
        <p class="muted">Analyze a few calls to see quality trends, dimension averages, and score distribution.</p>
      </fw-card>`;
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
      <fw-card class="dash-charts-top qc-dashboard">
        ${renderScoreGauge(metrics.avgOverall, 10)}
        ${renderRadarChart(metrics.dimensions)}
      </fw-card>
    </section>
    ${renderDimensionBarChart(metrics.dimensions)}
    <div class="dash-charts-bottom">
      ${renderTrendChart(metrics.scoreTrend)}
      ${renderScoreDistribution(metrics.scoreBands, metrics.totalCalls)}
    </div>`;
}

function renderOverviewEmptyState() {
  return `
    <fw-card class="dash-empty launch-empty">
      <fw-icon class="dash-empty-icon" name="add-note" size="24" aria-hidden="true"></fw-icon>
      <h3>Get started</h3>
      <p class="muted">Run pre-call prep or analyze a recording to populate your task list.</p>
      <p class="task-empty-links">
        <fw-button color="link" data-action="prep">Pre-call prep</fw-button>
        ·
        <fw-button color="link" data-action="analyze">Analyze a recording</fw-button>
      </p>
    </fw-card>`;
}

function renderRecentCallRow(c, { compact = false } = {}) {
  const momCls = momentumClass(c.momentum);
  const scoreCls = barClass(c.overallScore, 10);
  const innerCls = compact ? " launch-recent-inner-side" : "";
  const nextCol = compact
    ? ""
    : `<span class="launch-recent-next muted">${esc(c.nextAction)}</span>`;
  return `
    <fw-button class="launch-recent-row dash-call-link" color="secondary" fill="clear" data-call-id="${esc(c.id)}">
      <span class="launch-recent-inner${innerCls}">
        <span class="launch-recent-company">${esc(c.company)}</span>
        <span class="launch-recent-date muted">${esc(formatShortDate(c.timestamp))}</span>
        <span class="launch-recent-momentum ${momCls}">${esc(c.momentum)}</span>
        ${nextCol}
        <span class="launch-recent-score qc-dim-score ${scoreCls}">${c.overallScore}/10</span>
      </span>
    </fw-button>`;
}

function renderRecentCallsLaunchpad(recentCalls) {
  const compact = recentCalls.slice(0, 5);
  if (!compact.length) {
    return `
      <section class="dash-section launch-recent" aria-labelledby="recent-heading">
        <h2 id="recent-heading" class="dash-section-title">Recent calls</h2>
        ${renderOverviewEmptyState()}
      </section>`;
  }

  const rows = compact.map((c) => renderRecentCallRow(c)).join("");

  return `
    <section class="dash-section launch-recent" aria-labelledby="recent-heading">
      <h2 id="recent-heading" class="dash-section-title">Recent calls</h2>
      <fw-card class="launch-recent-list">${rows}</fw-card>
    </section>`;
}

export function renderCoachingNudgeCard(nudgeText) {
  return `
    <section class="dash-section launch-nudge" aria-labelledby="nudge-heading">
      <h2 id="nudge-heading" class="dash-section-title">Coaching nudge</h2>
      <fw-card class="launch-nudge-card">
        <p class="launch-nudge-text">${esc(nudgeText)}</p>
      </fw-card>
    </section>`;
}

function renderSideStats(taskMetrics, callMetrics, prepsCount = 0) {
  const avgScore = callMetrics.avgOverall != null
    ? callMetrics.avgOverall.toFixed(1)
    : "—";
  return `
    <section class="dash-section dash-side-stats" aria-labelledby="side-stats-heading">
      <h2 id="side-stats-heading" class="dash-section-title">Snapshot</h2>
      <div class="dash-side-stats-grid">
        <div class="dash-stat prep-action-block">
          <span class="dash-stat-label">Open tasks</span>
          <span class="dash-stat-value" data-stat="open">${taskMetrics.openTotal}</span>
        </div>
        <div class="dash-stat prep-action-block">
          <span class="dash-stat-label">Preps generated</span>
          <span class="dash-stat-value" data-stat="preps">${prepsCount}</span>
        </div>
        <div class="dash-stat prep-action-block">
          <span class="dash-stat-label">Done this week</span>
          <span class="dash-stat-value good" data-stat="done-week">${taskMetrics.completedThisWeek}</span>
        </div>
        <div class="dash-stat prep-action-block">
          <span class="dash-stat-label">Calls analyzed</span>
          <span class="dash-stat-value" data-stat="calls">${callMetrics.totalCalls}</span>
          <span class="dash-stat-sub">${avgScore !== "—" ? `${avgScore}/10 avg` : "No coaching data"}</span>
        </div>
      </div>
    </section>`;
}

async function updateSideStats(container, email, fetchRemotePreps) {
  const m = aggregateTaskMetrics(listTasks(email));
  const open = container.querySelector('[data-stat="open"]');
  const preps = container.querySelector('[data-stat="preps"]');
  const doneWeek = container.querySelector('[data-stat="done-week"]');
  if (open) open.textContent = String(m.openTotal);
  if (preps) preps.textContent = String(await countPrepsGenerated(fetchRemotePreps));
  if (doneWeek) doneWeek.textContent = String(m.completedThisWeek);
}

function renderRecentCallsSide(recentCalls) {
  const compact = recentCalls.slice(0, 5);
  if (!compact.length) {
    return `
      <section class="dash-section launch-recent dash-side-recent" aria-labelledby="recent-heading">
        <h2 id="recent-heading" class="dash-section-title">Recent calls</h2>
        <p class="muted dash-side-empty">Analyze a recording to see call activity here.</p>
      </section>`;
  }

  const rows = compact.map((c) => renderRecentCallRow(c, { compact: true })).join("");

  return `
    <section class="dash-section launch-recent dash-side-recent" aria-labelledby="recent-heading">
      <h2 id="recent-heading" class="dash-section-title">Recent calls</h2>
      <fw-card class="launch-recent-list">${rows}</fw-card>
    </section>`;
}

function mountDashboardTasks(container, email, opts = {}) {
  const chartsMount = container.querySelector("#task-charts-mount");
  const boardMount = container.querySelector("#task-board-mount");
  if (!boardMount) return;

  const tasks = listTasks(email);
  const fetchRemotePreps = opts.fetchRemotePreps;
  const taskOpts = {
    ...opts,
    onTasksChanged: () => {
      const updated = listTasks(email);
      if (chartsMount) renderTaskCharts(chartsMount, updated);
      void updateSideStats(container, email, fetchRemotePreps);
    },
  };

  if (chartsMount) renderTaskCharts(chartsMount, tasks);
  renderTaskBoard(boardMount, email, taskOpts);
}

/**
 * SE launchpad dashboard.
 * @param {HTMLElement} container
 * @param {string} email
 * @param {{ seName?: string, onOpenCall?: (id: string) => void, onPrep?: () => void, onAnalyze?: () => void, onCoaching?: () => void }} opts
 */
export async function renderSeLaunchpad(container, email, opts = {}) {
  const metrics = buildDashboardMetrics(email);
  const taskMetrics = aggregateTaskMetrics(listTasks(email));
  const prepsCount = await countPrepsGenerated(opts.fetchRemotePreps);

  container.innerHTML = `
    <div class="dash-one-pager one-pager launchpad">
      <div class="head dash-head">
        <h1 class="one-pager-title">My dashboard</h1>
        <span class="sub muted">Tasks, priorities, and recent call activity.</span>
      </div>
      <div class="dash-split">
        <div class="dash-split-main">
          <div id="task-charts-mount"></div>
          <div id="task-board-mount"></div>
        </div>
        <aside class="dash-split-side">
          ${renderSideStats(taskMetrics, metrics, prepsCount)}
          ${renderRecentCallsSide(metrics.recentCalls)}
        </aside>
      </div>
    </div>`;

  mountDashboardTasks(container, email, opts);

  wireCallLinks(container, opts.onOpenCall);

  container.querySelectorAll('[data-action="prep"]').forEach((btn) => {
    btn.addEventListener("fwClick", () => opts.onPrep?.());
  });
  container.querySelectorAll('[data-action="analyze"]').forEach((btn) => {
    btn.addEventListener("fwClick", () => opts.onAnalyze?.());
  });
}

function postCallRecordsToAnalyses(records) {
  return (records || []).map((r) => ({
    id: r.id,
    timestamp: r.createdAt,
    title: r.title,
    zoomLink: r.zoomLink,
    analysis: r.analysis,
    result: { analysis: r.analysis, transcriptMeta: r.transcriptMeta },
  }));
}

async function loadTeamPostCallsFromStore(session) {
  try {
    const store = getStore();
    if (session?.isOrgDirector && session?.orgId && store.listPostCallsByOrg) {
      const records = await store.listPostCallsByOrg(session.orgId);
      if (records?.length) return postCallRecordsToAnalyses(records);
    }
    if (session?.teamId) {
      const records = await store.listPostCallsByTeam(session.teamId);
      if (records?.length) return postCallRecordsToAnalyses(records);
    }
  } catch (err) {
    console.warn("Could not load team postCalls from domain store:", err);
  }
  return [];
}

async function resolveEmailToUidMap(store, session, seEmails, isOrgView) {
  const { dummyUidForEmail } = await import("./domain/seed-dev.js");
  const emailToUid = new Map();

  const canBulkOrg =
    isOrgView && session?.orgId && typeof store.listUsersByOrg === "function";
  const canBulkMgr =
    !isOrgView && session?.userId && typeof store.listUsersByManagerId === "function";

  if (canBulkOrg || canBulkMgr) {
    const users = canBulkOrg
      ? await store.listUsersByOrg(session.orgId)
      : await store.listUsersByManagerId(session.userId);
    const byEmail = new Map(
      users.map((u) => [String(u.email || "").trim().toLowerCase(), u])
    );
    const unresolved = [];
    for (const email of seEmails) {
      const user = byEmail.get(String(email || "").trim().toLowerCase());
      if (user?.id) emailToUid.set(email, user.id);
      else unresolved.push(email);
    }
    for (const email of unresolved) {
      const user = await store.getUserByEmail(email);
      emailToUid.set(email, user?.id || dummyUidForEmail(email));
    }
    return emailToUid;
  }

  for (const email of seEmails) {
    const user = await store.getUserByEmail(email);
    emailToUid.set(email, user?.id || dummyUidForEmail(email));
  }
  return emailToUid;
}

async function buildTeamMetrics(session) {
  const isOrgView = session?.isOrgDirector === true;
  const seEmails = session
    ? await listTeamSeEmailsAsync(session)
    : listTeamSeEmails();

  const storePostCalls = await loadTeamPostCallsFromStore(session);
  const store = getStore();
  const teamNameByEmail = isOrgView ? await mapEmailToTeamName(seEmails) : new Map();
  const emailToUid = await resolveEmailToUidMap(store, session, seEmails, isOrgView);

  const allAnalyses = [];
  const seRows = [];

  for (const email of seEmails) {
    let analyses = listAnalysesWithQuality(email);
    const uid = emailToUid.get(email);

    if (!analyses.length && storePostCalls.length && uid) {
      const fromStore = storePostCalls.filter((r) => r.ownerId === uid);
      analyses = postCallRecordsToAnalyses(fromStore).filter((r) => r.analysis?.qualityCoach);
    }

    const deduped = dedupeAnalysesByCallIdentity(analyses);
    allAnalyses.push(...deduped);
    const metrics = aggregateQualityMetrics(analyses);
    const followUps = aggregateFollowUps(email);
    seRows.push({
      email,
      name: displayNameForEmail(email),
      teamName: teamNameByEmail.get(email) || null,
      calls: metrics.totalCalls,
      avgScore: metrics.avgOverall,
      focusArea: metrics.worstDimension ? radarDimensionLabel(metrics.worstDimension.name) : "—",
      overdue: followUps.overdue,
    });
  }

  if (!allAnalyses.length && storePostCalls.length) {
    const dedupedStore = dedupeAnalysesByCallIdentity(
      postCallRecordsToAnalyses(storePostCalls).filter((r) => r.analysis?.qualityCoach)
    );
    allAnalyses.push(...dedupedStore);
  }

  const teamMetrics = aggregateQualityMetrics(allAnalyses);
  return { teamMetrics, seRows, isOrgView };
}

function renderManagerSeTable(seRows, isOrgView = false) {
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
        ${isOrgView ? `<td>${esc(se.teamName || "—")}</td>` : ""}
        <td>${se.calls}</td>
        <td><span class="qc-dim-score ${avgCls}">${esc(avg)}</span></td>
        <td>${esc(se.focusArea)}</td>
        <td><span class="qc-dim-score ${overdueCls}">${se.overdue}</span></td>
      </tr>`;
  }).join("");

  return `
    <section class="dash-section manager-table-section">
      <h2 class="dash-section-title">Per-SE overview</h2>
      <fw-card class="manager-table-card">
        <div class="manager-table-wrap">
          <table class="manager-se-table">
            <thead>
              <tr>
                <th scope="col">SE</th>
                ${isOrgView ? `<th scope="col">Team</th>` : ""}
                <th scope="col">Calls</th>
                <th scope="col">Avg score</th>
                <th scope="col">Focus area</th>
                <th scope="col">Overdue</th>
              </tr>
            </thead>
            <tbody>${rows}</tbody>
          </table>
        </div>
      </fw-card>
    </section>`;
}

/**
 * Manager team dashboard.
 * @param {HTMLElement} container
 * @param {object} [session]
 */
export async function renderManagerDashboard(container, session) {
  const { teamMetrics, seRows, isOrgView } = await buildTeamMetrics(session);
  const hasData = teamMetrics.totalCalls > 0;
  const title = isOrgView ? "Org dashboard" : "Manager dashboard";
  const subtitle = isOrgView
    ? "Org-wide call quality — all teams under your org."
    : "Team-wide call quality — deduped by recording, scoped across all SEs.";

  container.innerHTML = `
    <div class="dash-one-pager one-pager manager-view">
      <div class="head dash-head">
        <h1 class="one-pager-title">${esc(title)}</h1>
        <span class="sub muted">${esc(subtitle)}</span>
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
          <fw-card class="dash-charts-top qc-dashboard">
            ${renderScoreGauge(teamMetrics.avgOverall, 10)}
            ${renderRadarChart(teamMetrics.dimensions)}
          </fw-card>
        </section>
        ${renderDimensionBarChart(teamMetrics.dimensions)}
        <div class="dash-charts-bottom">
          ${renderTrendChart(teamMetrics.scoreTrend)}
          ${renderScoreDistribution(teamMetrics.scoreBands, teamMetrics.totalCalls)}
        </div>
      ` : `
        <fw-card class="dash-empty">
          <fw-icon class="dash-empty-icon" name="agent" size="24" aria-hidden="true"></fw-icon>
          <h2>No team data yet</h2>
          <p class="muted">SEs need to analyze calls before team metrics appear here.</p>
        </fw-card>
      `}
      ${renderManagerSeTable(seRows, isOrgView)}
    </div>`;
}

/**
 * @param {HTMLElement} container
 * @param {string} email
 * @param {{ seName?: string, onOpenCall?: (id: string) => void, onPrep?: () => void, onAnalyze?: () => void, onCoaching?: () => void }} opts
 */
export async function renderDashboard(container, email, opts = {}) {
  await renderSeLaunchpad(container, email, opts);
}
