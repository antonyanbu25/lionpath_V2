/** Quick smoke test for Quality Coach HTML rendering (no browser). */
import { writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { normalizeQualityCoach } from "../quality-score.js";

const esc = (v) =>
  String(v ?? "").replace(/[&<>"']/g, (c) =>
    ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));

function barClass(score, max = 5) {
  const pct = score / max;
  if (pct >= 0.8) return "good";
  if (pct >= 0.6) return "ok";
  return "weak";
}

function scorePct(score, max) {
  if (!max) return 0;
  return Math.min(100, Math.max(0, (score / max) * 100));
}

function renderScoreGauge(score, max = 10) {
  const r = 52;
  const c = 2 * Math.PI * r;
  const dash = c * (score / max);
  const cls = barClass(score, max);
  return `
    <div class="qc-gauge" role="img" aria-label="Overall score ${esc(score)} out of ${esc(max)}">
      <svg class="qc-gauge-svg" viewBox="0 0 120 120" aria-hidden="true">
        <circle class="qc-gauge-track" cx="60" cy="60" r="${r}" />
        <circle class="qc-gauge-fill ${cls}" cx="60" cy="60" r="${r}"
          stroke-dasharray="${dash} ${c}" transform="rotate(-90 60 60)" />
      </svg>
      <div class="qc-gauge-text">
        <span class="qc-gauge-score ${cls}">${esc(score)}</span>
        <span class="qc-gauge-denom">/${esc(max)}</span>
      </div>
    </div>`;
}

const RADAR_DIMENSION_LABELS = {
  discovery: "Discovery",
  demoalignment: "Demo alignment",
  objections: "Objections",
  valuearticulation: "Value articulation",
  nextstepclarity: "Next-step clarity",
  talkbalance: "Talk balance",
};

function normalizeDimensionKey(name) {
  return String(name ?? "").replace(/[\s_-]/g, "").toLowerCase();
}

function radarDimensionLabel(name) {
  const mapped = RADAR_DIMENSION_LABELS[normalizeDimensionKey(name)];
  return mapped || String(name ?? "");
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
  if (!dimensions?.length) return "";
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
      const label = radarDimensionLabel(d.name);
      return `
        <line class="qc-radar-axis" x1="${cx}" y1="${cy}" x2="${x2}" y2="${y2}" />
        ${renderRadarLabelText(label, lx, ly, angle)}`;
    })
    .join("");
  const dataPts = dimensions.map((d, i) => {
    const pct = d.score / d.maxScore;
    const angle = (Math.PI * 2 * i) / n - Math.PI / 2;
    const rad = maxR * pct;
    return `${cx + rad * Math.cos(angle)},${cy + rad * Math.sin(angle)}`;
  });
  const dots = dimensions
    .map((d, i) => {
      const pct = d.score / d.maxScore;
      const angle = (Math.PI * 2 * i) / n - Math.PI / 2;
      const rad = maxR * pct;
      return `<circle class="qc-radar-dot" cx="${cx + rad * Math.cos(angle)}" cy="${cy + rad * Math.sin(angle)}" r="3.5" />`;
    })
    .join("");
  return `
    <div class="qc-radar-wrap">
      <p class="qc-radar-title">Dimension profile</p>
      <svg class="qc-radar" viewBox="0 0 260 260" role="img" aria-label="Radar chart of coaching dimension scores">
        ${rings}
        ${axes}
        <polygon class="qc-radar-data" points="${dataPts.join(" ")}" />
        ${dots}
      </svg>
    </div>`;
}

function renderDimensionRows(dimensions) {
  if (!dimensions?.length) return '<p class="muted">No dimension scores.</p>';
  return dimensions
    .map((d) => {
      const pct = scorePct(d.score, d.maxScore);
      const cls = barClass(d.score, d.maxScore);
      return `
        <details class="qc-dim">
          <summary class="qc-dim-summary">
            <span class="qc-dim-name">${esc(d.name)}</span>
            <span class="qc-dim-bar" aria-hidden="true">
              <span class="qc-dim-bar-fill ${cls}" style="width:${pct}%"></span>
            </span>
            <span class="qc-dim-score ${cls}">${esc(d.score)}/${esc(d.maxScore)}</span>
          </summary>
          <div class="qc-dim-body">
            <p class="qc-dim-feedback">${esc(d.feedback)}</p>
            <blockquote class="qc-dim-evidence"><span class="qc-ev-label">Evidence</span>${esc(d.evidence)}</blockquote>
          </div>
        </details>`;
    })
    .join("");
}

function renderInsightCards(items, title, tone) {
  const list = (items || []).length
    ? `<ul>${(items || []).map((i) => `<li>${esc(i)}</li>`).join("")}</ul>`
    : '<p class="muted">None noted.</p>';
  return `
    <div class="qc-insight qc-insight-${tone}">
      <h4>${esc(title)}</h4>
      ${list}
    </div>`;
}

function renderQualityCoach(qc) {
  const normalized = normalizeQualityCoach(qc);
  const dims = normalized.dimensions || [];
  return `
    <section class="qc-section">
      <h2>Quality coach</h2>
      <div class="qc-dashboard">
        <div class="qc-hero">
          ${renderScoreGauge(normalized.overallScore, 10)}
          <div class="qc-hero-meta">
            <span class="qc-overall-label">${esc(normalized.overallLabel)}</span>
            <p class="muted qc-hero-hint">Tap a dimension below for feedback and transcript evidence.</p>
          </div>
        </div>
        ${renderRadarChart(dims)}
      </div>
      <div class="qc-scorecard">
        <h3>Scorecard</h3>
        <div class="qc-dim-list">${renderDimensionRows(dims)}</div>
      </div>
      <div class="qc-insights">
        ${renderInsightCards(qc.strengths, "Strengths", "good")}
        ${renderInsightCards(qc.improvements, "Improvements", "ok")}
        ${renderInsightCards(qc.missedOpportunities, "Missed opportunities", "weak")}
      </div>
    </section>`;
}

const sample = {
  overallScore: 4.5,
  overallLabel: "Strong",
  dimensions: [
    { name: "Discovery", score: 4, maxScore: 5, feedback: "Good open questions on pain and timeline.", evidence: "What does your current workflow look like for escalations?" },
    { name: "Demo alignment", score: 5, maxScore: 5, feedback: "Demo mapped directly to stated needs.", evidence: "Let me show the routing rule you mentioned." },
    { name: "Objections", score: 4, maxScore: 5, feedback: "Addressed pricing concern with ROI framing.", evidence: "The per-agent cost typically pays back in quarter one." },
    { name: "Value articulation", score: 5, maxScore: 5, feedback: "Clear business outcomes tied to features.", evidence: "This would cut your first-response time by about 30%." },
    { name: "Next-step clarity", score: 5, maxScore: 5, feedback: "Mutual action plan with dates.", evidence: "I'll send the POC scope by Thursday; you'll loop in IT Friday." },
    { name: "Talk balance", score: 4, maxScore: 5, feedback: "Mostly balanced; one long monologue mid-demo.", evidence: "SE spoke ~55% of the call per transcript." },
  ],
  strengths: ["Strong demo-to-need mapping", "Clear next steps"],
  improvements: ["Shorten mid-demo monologue", "Probe budget earlier"],
  missedOpportunities: ["Did not ask about decision committee"],
};

const html = renderQualityCoach(sample);
const checks = [
  ["gauge", html.includes("qc-gauge")],
  ["radar", html.includes("qc-radar-data")],
  ["6 dimensions", (html.match(/class="qc-dim"/g) || []).length === 6],
  ["accordion", html.includes("<details")],
  ["insights", html.includes("qc-insight-good")],
  ["score 9.0", html.includes("9")],
  ["label Excellent", html.includes("Excellent")],
  ["evidence", html.includes("qc-dim-evidence")],
  ["full radar labels", html.includes("Value articulation") && html.includes("Next-step clarity") && !html.includes("…")],
  ["radar viewBox", html.includes('viewBox="0 0 260 260"')],
];

const failed = checks.filter(([, ok]) => !ok);
if (failed.length) {
  console.error("FAILED:", failed.map(([n]) => n).join(", "));
  process.exit(1);
}

const out = join(dirname(fileURLToPath(import.meta.url)), "..", "qc-preview.html");
const page = `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>QC preview | Janus</title>
    <!-- Dew head — see web/partials/head-dew.html -->
    <link rel="preconnect" href="https://fonts.googleapis.com" />
    <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin />
    <link
      href="https://fonts.googleapis.com/css2?family=Figtree:wght@400;500;600;700;800&family=IBM+Plex+Mono:wght@400;500;600&family=Playfair+Display:ital,wght@0,400;0,500;0,600;0,700;1,400;1,500;1,600&display=swap"
      rel="stylesheet"
    />
    <link
      rel="stylesheet"
      href="https://cdn.jsdelivr.net/npm/@freshworks/crayons@4.3.0-dew.14/css/crayons-min.css"
      crossorigin="anonymous"
    />
    <link rel="stylesheet" href="./dew-theme.css" />
    <link rel="stylesheet" href="./styles.css" />
    <link rel="stylesheet" href="./postcall.css" />
    <link rel="stylesheet" href="./mono-overhaul.css" />
    <script
      type="module"
      src="https://cdn.jsdelivr.net/npm/@freshworks/crayons@4.3.0-dew.14/dist/crayons/crayons.esm.js"
    ></script>
    <script type="module" src="./theme.js"></script>
  </head>
  <body class="qc-preview-page">
    <div class="qc-preview-toolbar">
      <a href="./index.html" class="about-back">← Back to app</a>
      <fw-button class="theme-toggle" data-theme-toggle color="secondary" fill="clear" aria-label="Toggle dark mode">🌙</fw-button>
    </div>
    <fw-card class="qc-preview-card">${html}</fw-card>
  </body>
</html>
`;
writeFileSync(out, page);
console.log("OK — all checks passed; wrote qc-preview.html");
