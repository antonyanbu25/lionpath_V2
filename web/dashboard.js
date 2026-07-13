/**

 * SE call quality dashboard — aggregates qualityCoach scores across stored analyses.

 */



import { listAnalysesWithQuality } from "./history.js";
import { normalizeQualityCoach, scoreBand } from "./quality-score.js";



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



function radarDimensionLabel(name) {

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

  const withQc = analyses.filter((a) => a.analysis?.qualityCoach);

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

      scoreBands: { excellent: 0, good: 0, developing: 0, needsFocus: 0 },

    };

  }



  let overallSum = 0;

  const dimMap = new Map();

  const scoreBands = { excellent: 0, good: 0, developing: 0, needsFocus: 0 };



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
    return {
      id: r.id,
      title: r.title,
      timestamp: r.timestamp,
      overallScore: qc.overallScore,
      overallLabel: qc.overallLabel,
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



function formatDate(ts) {

  if (!ts) return "";

  return new Date(ts).toLocaleString(undefined, {

    month: "short",

    day: "numeric",

    hour: "numeric",

    minute: "2-digit",

  });

}



function formatTrendLabel(ts, idx, total) {

  if (!ts) return `#${idx + 1}`;

  const d = new Date(ts);

  if (total <= 4) {

    return d.toLocaleString(undefined, { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" });

  }

  return d.toLocaleString(undefined, { month: "short", day: "numeric" });

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

    <section class="card dash-section dash-dim-chart">

      <h2>Dimension averages</h2>

      <div class="dash-dim-rows">${rows}</div>

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

    <section class="card dash-section dash-trend-section">

      <h2>Score trend</h2>

      <p class="muted dash-chart-sub">Last ${n} call${n === 1 ? "" : "s"} · oldest → newest</p>

      <svg class="dash-trend-svg" viewBox="0 0 ${w} ${h}" role="img" aria-label="Overall score trend over recent calls">

        ${gridLines}

        ${bars}

      </svg>

    </section>`;

}



function renderScoreDistribution(bands, total) {

  if (!total) return "";

  const segments = [

    { key: "excellent", label: "Excellent (8+)", count: bands.excellent, cls: "good" },

    { key: "good", label: "Good (6–8)", count: bands.good, cls: "ok" },

    { key: "developing", label: "Developing (4–6)", count: bands.developing, cls: "ok" },

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

    <section class="card dash-section dash-distribution-section">

      <h2>Score distribution</h2>

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

    </section>`;

}



function renderStatCards(metrics) {

  if (!metrics.totalCalls) {

    return `

      <div class="dash-empty card">

        <h2>No calls analyzed yet</h2>

        <p class="muted">Run a post-call analysis to see your quality metrics here.</p>

      </div>`;

  }



  const avgCls = barClass(metrics.avgOverall, 10);

  const best = metrics.bestDimension;

  const worst = metrics.worstDimension;



  return `

    <div class="dash-stats">

      <div class="dash-stat card">

        <span class="dash-stat-label">Calls analyzed</span>

        <span class="dash-stat-value">${metrics.totalCalls}</span>

      </div>

      <div class="dash-stat card">

        <span class="dash-stat-label">Avg overall score</span>

        <span class="dash-stat-value ${avgCls}">${metrics.avgOverall.toFixed(1)}<span class="dash-stat-denom">/10</span></span>

      </div>

      <div class="dash-stat card">

        <span class="dash-stat-label">Strongest dimension</span>

        <span class="dash-stat-value good">${esc(best?.name || "—")}</span>

        <span class="dash-stat-sub">${best ? `${best.avgScore.toFixed(1)}/${best.maxScore}` : ""}</span>

      </div>

      <div class="dash-stat card">

        <span class="dash-stat-label">Focus area</span>

        <span class="dash-stat-value weak">${esc(worst?.name || "—")}</span>

        <span class="dash-stat-sub">${worst ? `${worst.avgScore.toFixed(1)}/${worst.maxScore}` : ""}</span>

      </div>

    </div>`;

}



function renderChartsTop(metrics) {

  return `

    <section class="card dash-section dash-charts-top">

      ${renderScoreGauge(metrics.avgOverall, 10)}

      ${renderRadarChart(metrics.dimensions)}

    </section>`;

}



function renderRecentTable(recentCalls) {

  if (!recentCalls.length) return "";

  const rows = recentCalls

    .map((c) => {

      const cls = barClass(c.overallScore, 10);

      return `

        <tr data-call-id="${esc(c.id)}">

          <td><button type="button" class="link-btn dash-call-link" data-call-id="${esc(c.id)}">${esc(c.title)}</button></td>

          <td class="qc-dim-score ${cls}">${c.overallScore}/10</td>

          <td class="muted dash-recent-label">${esc(c.overallLabel)}</td>

          <td class="muted dash-recent-when">${esc(formatDate(c.timestamp))}</td>

        </tr>`;

    })

    .join("");

  return `

    <section class="card dash-section dash-recent-compact">

      <h2>Recent calls</h2>

      <table class="dash-recent-table">

        <thead><tr><th>Call</th><th>Score</th><th>Label</th><th>When</th></tr></thead>

        <tbody>${rows}</tbody>

      </table>

    </section>`;

}



/**

 * @param {HTMLElement} container

 * @param {string} email

 * @param {{ onOpenCall?: (id: string) => void }} opts

 */

export function renderDashboard(container, email, opts = {}) {

  const metrics = buildDashboardMetrics(email);

  const hasData = metrics.totalCalls > 0;



  container.innerHTML = `

    <div class="dash-header">

      <h1>My dashboard</h1>

      <p class="muted">Cumulative call quality from your analyzed recordings.</p>

    </div>

    ${renderStatCards(metrics)}

    ${hasData ? `

      ${renderChartsTop(metrics)}

      ${renderDimensionBarChart(metrics.dimensions)}

      <div class="dash-charts-bottom">

        ${renderTrendChart(metrics.scoreTrend)}

        ${renderScoreDistribution(metrics.scoreBands, metrics.totalCalls)}

      </div>

    ` : ""}

    ${renderRecentTable(metrics.recentCalls)}`;



  container.querySelectorAll(".dash-call-link").forEach((btn) => {

    btn.onclick = () => opts.onOpenCall?.(btn.dataset.callId);

  });

}


