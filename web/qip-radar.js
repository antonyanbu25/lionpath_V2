/**
 * Shared QIP category radar — post-call result and call record.
 * Mirrors se-labs-evaluation-radar.html: pentagon grid, multi-colour wash
 * clipped to the score polygon, rainbow stroke, coloured vertex dots,
 * overall score in the card header pill.
 *
 * Axis colors live here (AXIS_COLORS) until a clean export from rubric-profiles.js
 * is worthwhile — deferred follow-up; do not hardcode a second palette elsewhere.
 */
import { CATEGORY_KEYS, CATEGORY_LABELS, QIP_RADAR_LABELS } from "./rubric-profiles.js";
import { esc } from "./shared.js";

let qipRadarSeq = 0;

const N = 5;
const MAX = 10;
const VB_W = 600;
const VB_H = 500;
const VIEWBOX = `0 0 ${VB_W} ${VB_H}`;
const CX = 300;
const CY = 250;
const R = 165;
const PAD = 34;
const DOT_R = 5.5;

/** Per-axis colors — Discovery · Solutioning · Business value · Objections · Communication. Monochrome ink → faint steps. */
const AXIS_COLORS = ["#161513", "#3f3d38", "#6b675e", "#8b867c", "#a39e93"];

const LABEL_ANCHORS = ["middle", "start", "start", "end", "end"];

const SANS = "Figtree, system-ui, -apple-system, sans-serif";
const MONO = "IBM Plex Mono, ui-monospace, monospace";

function axisLabel(key) {
  return QIP_RADAR_LABELS[key] || CATEGORY_LABELS[key] || key;
}

/** Labs geometry: θ = −90° + i·72°, x = cx + r·cosθ, y = cy + r·sinθ (north-up). */
function ang(i) {
  return ((-90 + i * (360 / N)) * Math.PI) / 180;
}

function pt(r, i) {
  return [CX + r * Math.cos(ang(i)), CY + r * Math.sin(ang(i))];
}

function fmtCoord(v) {
  const n = Number(v);
  if (!Number.isFinite(n)) return "0";
  return n.toFixed(1);
}

function formatScore(score) {
  const n = Number(score);
  if (!Number.isFinite(n)) return "0.0";
  return (Math.round(n * 10) / 10).toFixed(1);
}

function formatOverall(score) {
  if (score == null || !Number.isFinite(Number(score))) return null;
  return formatScore(score);
}

function labelDisplayLines(key) {
  const raw = axisLabel(key);
  return String(raw)
    .split("\n")
    .map((s) => s.trim())
    .filter(Boolean);
}

function axisRadius(score) {
  const ratio = Math.max(0, Math.min(MAX, Number(score) || 0)) / MAX;
  return R * ratio;
}

function dataPt(score, i) {
  return pt(axisRadius(score), i);
}

function pointsAttr(points) {
  return points.map((p) => `${fmtCoord(p[0])},${fmtCoord(p[1])}`).join(" ");
}

/**
 * QIP pentagon radar for category scores (0–10 scale).
 * @param {object} [opts]
 * @param {number|null} [opts.overallScore] Shown in header overall pill
 * @param {string} [opts.title] Card title (default Evaluation signal)
 * @param {string} [opts.hint] Subtitle under title
 * @param {boolean} [opts.animate] Entrance animations (default true)
 */
export function renderQipRadar(categoryScores, opts = {}) {
  const title = opts.title || "Evaluation signal";
  const hint = opts.hint || "Five categories, each scored out of 10";
  const animate = opts.animate !== false;
  const seq = ++qipRadarSeq;
  const uid = `qip-radar-${seq}`;

  const scores = CATEGORY_KEYS.map((key) =>
    Math.max(0, Math.min(MAX, Number(categoryScores?.[key] ?? 0) || 0)),
  );
  const tips = scores.map((s, i) => dataPt(s, i));
  const dataPoly = pointsAttr(tips);
  const overall = formatOverall(opts.overallScore);

  const ariaParts = CATEGORY_KEYS.map(
    (key, i) => `${axisLabel(key).replace(/\n/g, " ")} ${formatScore(scores[i])}`,
  );
  if (overall) ariaParts.push(`overall ${overall} out of 10`);
  const ariaLabel = esc(`${title}: ${ariaParts.join(", ")}`);

  const animClass = animate ? " qip-star-animated" : " qip-star-static";

  const radialDefs = tips
    .map((p, i) => {
      const color = AXIS_COLORS[i];
      return `<radialGradient id="${uid}-g${i}" gradientUnits="userSpaceOnUse" cx="${fmtCoord(p[0])}" cy="${fmtCoord(p[1])}" r="${fmtCoord(R * 0.72)}">
          <stop offset="0%" stop-color="${color}" stop-opacity="0.42"/>
          <stop offset="70%" stop-color="${color}" stop-opacity="0.10"/>
          <stop offset="100%" stop-color="${color}" stop-opacity="0"/>
        </radialGradient>`;
    })
    .join("");

  const strokeDef = `<linearGradient id="${uid}-stroke" gradientUnits="userSpaceOnUse" x1="${CX - R}" y1="${CY - R}" x2="${CX + R}" y2="${CY + R}">
      <stop offset="0%" stop-color="#161513"/>
      <stop offset="28%" stop-color="#3f3d38"/>
      <stop offset="52%" stop-color="#a39e93"/>
      <stop offset="76%" stop-color="#8b867c"/>
      <stop offset="100%" stop-color="#6b675e"/>
    </linearGradient>`;

  const clipDef = `<clipPath id="${uid}-poly"><polygon points="${dataPoly}"/></clipPath>`;

  const rings = [2, 4, 6, 8, 10]
    .map((lv) => {
      const outer = lv === 10;
      const pts = pointsAttr(Array.from({ length: N }, (_, j) => pt((lv / MAX) * R, j)));
      const ringCls = outer
        ? "ring r5 qip-radar-ring qip-radar-ring-outer"
        : `ring r${lv / 2} qip-radar-ring`;
      const stroke = outer ? "#d8d4c9" : "#e8e5de";
      const opacity = outer ? "1" : "0.7";
      return `<polygon class="${ringCls}" points="${pts}" fill="none" stroke="${stroke}" stroke-width="1" opacity="${opacity}" style="fill:none;stroke:${stroke}"/>`;
    })
    .join("");

  const spokes = Array.from({ length: N }, (_, i) => {
    const [x, y] = pt(R, i);
    return `<line class="spoke qip-radar-spoke" x1="${CX}" y1="${CY}" x2="${fmtCoord(x)}" y2="${fmtCoord(y)}" stroke="#e8e5de" stroke-width="1" opacity="0.55"/>`;
  }).join("");

  const scaleLabels = [2, 4, 6, 8, 10]
    .map((lv) => {
      const y = CY - (lv / MAX) * R;
      return `<text class="lab qip-radar-scale" x="${CX - 10}" y="${fmtCoord(y + 3)}" text-anchor="end" font-family="${MONO}" font-size="9" fill="#a39e93">${lv}</text>`;
    })
    .join("");

  const washRects = tips
    .map(
      (_, i) =>
        `<rect class="qip-radar-wash" x="${CX - R - 20}" y="${CY - R - 20}" width="${2 * R + 40}" height="${2 * R + 40}" fill="url(#${uid}-g${i})"/>`,
    )
    .join("");

  const dots = tips
    .map((t, i) => {
      const color = AXIS_COLORS[i];
      return `<circle class="gem g${i} qip-radar-dot" cx="${fmtCoord(t[0])}" cy="${fmtCoord(t[1])}" r="${DOT_R}" fill="${color}" stroke="#fff" stroke-width="2.5" style="fill:${color};stroke:#fff" data-axis-color="${color}"/>`;
    })
    .join("");

  const labelMarkup = CATEGORY_KEYS.map((key, i) => {
    const lines = labelDisplayLines(key);
    const [lx, ly] = pt(R + PAD, i);
    const anchor = LABEL_ANCHORS[i];
    const color = AXIS_COLORS[i];
    const displayScore = formatScore(scores[i]);
    const line1 = lines[0] || "";
    const line2 = lines[1] || "";
    return `<text class="lab qip-radar-axis-label" x="${fmtCoord(lx)}" y="${fmtCoord(ly - 20)}" text-anchor="${anchor}" font-family="${SANS}" font-size="12.5" font-weight="600" fill="#57534b">${esc(line1)}</text>
            <text class="lab qip-radar-axis-label" x="${fmtCoord(lx)}" y="${fmtCoord(ly - 5)}" text-anchor="${anchor}" font-family="${SANS}" font-size="12.5" font-weight="600" fill="#57534b">${esc(line2)}</text>
            <text class="lab qip-radar-value" x="${fmtCoord(lx)}" y="${fmtCoord(ly + 17)}" text-anchor="${anchor}" font-family="${MONO}" font-size="18" font-weight="600" fill="${color}" style="font-size:18px;fill:${color}">${esc(displayScore)}</text>`;
  }).join("");

  const overallPill = overall
    ? `<div class="star-overall-pill"><b>${esc(overall)}</b><span>overall</span></div>`
    : "";

  return `
    <div class="star-card qip-star-card${animClass}">
      <div class="star-head">
        <div class="star-head-copy">
          <span class="star-title eyebrow">${esc(title)}</span>
          <span class="hint">${esc(hint)}</span>
        </div>
        ${overallPill}
      </div>
      <div class="qip-star-stage">
      <svg class="star-svg qip-star-svg qip-radar-svg" viewBox="${VIEWBOX}" preserveAspectRatio="xMidYMid meet" role="img" aria-label="${ariaLabel}">
        <defs>
          ${radialDefs}
          ${strokeDef}
          ${clipDef}
        </defs>
        ${rings}
        ${spokes}
        ${scaleLabels}
        <g id="${uid}-dataGroup" class="qip-star-data">
          <g clip-path="url(#${uid}-poly)">${washRects}</g>
          <polygon class="qip-radar-data" points="${dataPoly}" fill="none" stroke="url(#${uid}-stroke)" stroke-width="2.5" stroke-linejoin="round" style="fill:none;stroke-width:2.5"/>
          ${dots}
          <circle class="qip-radar-center" cx="${CX}" cy="${CY}" r="2.5" fill="#7a756b" opacity="0.4"/>
        </g>
        ${labelMarkup}
      </svg>
      </div>
    </div>`;
}
