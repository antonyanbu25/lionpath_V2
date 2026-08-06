/**
 * Shared QIP category radar — post-call result and call record.
 * Classic 5-axis pentagon radar: concentric grid rings, filled score polygon, center QIP.
 */
import { CATEGORY_KEYS, CATEGORY_LABELS, QIP_RADAR_LABELS } from "./rubric-profiles.js";
import { esc } from "./shared.js";

let qipRadarSeq = 0;

const VB_W = 700;
const VB_H = 600;
const VIEWBOX = `0 0 ${VB_W} ${VB_H}`;

const CX = 350;
const CY = 300;
/** R=210 → outer diameter 420/700 = 60% of card width at score 10 */
const R = 210;
const LABEL_R = 232;

/** Clockwise from north, 72° apart (radians). */
const AXIS_ANGLES = CATEGORY_KEYS.map((_, i) => (i * 2 * Math.PI) / 5);

/** Grid rings at scores 2, 4, 6, 8, 10. */
const RING_RADII = [42, 84, 126, 168, 210];
const SCALE_LABELS = [2, 4, 6, 8, 10];

const AXIS_AT_MAX = AXIS_ANGLES.map((a) => vertex(CX, CY, R, a));

const LABEL_SCORE_COLORS = ["#0e9c7a", "#0a94a5", "#c9871f", "#d85f42", "#6d54c9"];
const RING_STROKES = ["#f2ece1", "#eee7db", "#eae2d4", "#e6ddcd", "#e4dccd"];
const SCALE_COLORS = ["#d8d0c0", "#d3cab7", "#cec5b2", "#c9bfab", "#c9bfab"];

const LABEL_ANCHORS = ["middle", "start", "start", "end", "end"];

function axisLabel(key) {
  return QIP_RADAR_LABELS[key] || CATEGORY_LABELS[key] || key;
}

/** θ clockwise from north: x = cx + r·sinθ, y = cy − r·cosθ */
function vertex(cx, cy, r, theta) {
  return [cx + r * Math.sin(theta), cy - r * Math.cos(theta)];
}

function fmtCoord(v) {
  const n = Number(v);
  if (Math.abs(n - Math.round(n)) < 0.001) return String(Math.round(n));
  return n.toFixed(2).replace(/0+$/, "").replace(/\.$/, "");
}

function formatOverall(score) {
  if (score == null || !Number.isFinite(Number(score))) return null;
  const n = Number(score);
  return n % 1 === 0 ? String(Math.round(n)) : String(Math.round(n * 10) / 10);
}

function labelDisplayLines(key) {
  const raw = axisLabel(key);
  return String(raw).split("\n").map((s) => s.replace(/\s+&\s+/g, " & "));
}

function labelPositions(i) {
  const [x, y] = vertex(CX, CY, LABEL_R, AXIS_ANGLES[i]);
  const anchor = LABEL_ANCHORS[i];
  let lx = x;
  let ly = y;
  let line1Y;
  let line2Y;
  let scoreY;

  if (i === 0) {
    ly = y - 6;
    line1Y = ly - 22;
    line2Y = ly - 10;
    scoreY = ly + 6;
  } else if (i === 1) {
    line1Y = y - 14;
    line2Y = y - 2;
    scoreY = y + 14;
  } else if (i === 2) {
    line1Y = y - 8;
    line2Y = y + 4;
    scoreY = y + 20;
  } else if (i === 3) {
    line1Y = y - 8;
    line2Y = y + 4;
    scoreY = y + 20;
  } else {
    line1Y = y - 14;
    line2Y = y - 2;
    scoreY = y + 14;
  }

  return { anchor, x: lx, line1Y, line2Y, scoreY };
}

function axisRadius(score) {
  const ratio = Math.max(0, Math.min(10, Number(score) || 0)) / 10;
  return R * ratio;
}

/** Pentagon vertices at radius r on each axis. */
function pentagonPoints(r) {
  return AXIS_ANGLES.map((a) => {
    const [x, y] = vertex(CX, CY, r, a);
    return `${fmtCoord(x)},${fmtCoord(y)}`;
  }).join(" ");
}

/** 5-vertex pentagon: one tip per axis (classic radar chart). */
function buildPentagonGeometry(scores) {
  const tips = scores.map((s, i) => vertex(CX, CY, axisRadius(s), AXIS_ANGLES[i]));
  const dataPoly = tips.map((p) => p.map(fmtCoord).join(",")).join(" ");
  return { tips, dataPoly };
}

/**
 * QIP pentagon radar for category scores (0–10 scale).
 * @param {object} [opts]
 * @param {number|null} [opts.overallScore] Shown in glowing core
 * @param {string} [opts.title] Card eyebrow (default Evaluation signal)
 * @param {string} [opts.hint] Subtitle under eyebrow
 * @param {boolean} [opts.animate] Entrance animations (default true)
 */
export function renderQipRadar(categoryScores, opts = {}) {
  const title = opts.title || "Evaluation signal";
  const hint = opts.hint || "Five categories · spike length = score / 10";
  const animate = opts.animate !== false;
  const seq = ++qipRadarSeq;
  const uid = `qip-radar-${seq}`;

  const scores = CATEGORY_KEYS.map((key) =>
    Math.max(0, Math.min(10, Number(categoryScores?.[key] ?? 0) || 0)),
  );
  const { tips, dataPoly } = buildPentagonGeometry(scores);
  const overall = formatOverall(opts.overallScore);

  const ariaParts = CATEGORY_KEYS.map((key, i) => `${axisLabel(key).replace(/\n/g, " ")} ${scores[i]}`);
  if (overall) ariaParts.push(`overall ${overall} out of 10`);
  const ariaLabel = esc(`${title}: ${ariaParts.join(", ")}`);

  const animClass = animate ? " qip-star-animated" : " qip-star-static";

  const rings = RING_RADII.map((r, i) => {
    const outer = i === RING_RADII.length - 1;
    const ringCls = outer ? "ring r5 qip-radar-ring qip-radar-ring-outer" : `ring r${i + 1} qip-radar-ring`;
    return `<polygon class="${ringCls}" points="${pentagonPoints(r)}" fill="${outer ? "#fdfbf7" : "none"}" stroke="${RING_STROKES[i]}" stroke-width="${outer ? 1.3 : 1}"/>`;
  }).join("");

  const spokes = AXIS_AT_MAX.map(
    ([x, y]) =>
      `<line class="spoke qip-radar-spoke" x1="${CX}" y1="${CY}" x2="${fmtCoord(x)}" y2="${fmtCoord(y)}"/>`,
  ).join("");

  const scaleLabels = SCALE_LABELS.map((label, i) => {
    const frac = label / 10;
    const y = fmtCoord(CY - R * frac + 8);
    return `<text class="lab qip-radar-scale" x="${CX - 8}" y="${y}" text-anchor="end" font-size="8.5" font-weight="700" fill="${SCALE_COLORS[i]}">${label}</text>`;
  }).join("");

  const dots = tips
    .map(
      (t, i) =>
        `<circle class="gem g${i} qip-radar-dot" cx="${fmtCoord(t[0])}" cy="${fmtCoord(t[1])}" r="4" fill="#fff" stroke="#17a086" stroke-width="2.2"/>`,
    )
    .join("");

  const labelMarkup = CATEGORY_KEYS.map((key, i) => {
    const lines = labelDisplayLines(key);
    const layout = labelPositions(i);
    const line1 = lines[0] || "";
    const line2 = lines[1] || "";
    const displayScore = scores[i] % 1 === 0 ? String(Math.round(scores[i])) : String(Math.round(scores[i] * 10) / 10);
    return `<text class="lab qip-radar-axis-label" x="${fmtCoord(layout.x)}" y="${layout.line1Y}" text-anchor="${layout.anchor}" font-size="12" font-weight="700" fill="#3d3a34">${esc(line1)}</text>
            <text class="lab qip-radar-axis-label" x="${fmtCoord(layout.x)}" y="${layout.line2Y}" text-anchor="${layout.anchor}" font-size="12" font-weight="700" fill="#3d3a34">${esc(line2)}</text>
            <text class="lab qip-radar-value" x="${fmtCoord(layout.x)}" y="${layout.scoreY}" text-anchor="${layout.anchor}" font-size="14.5" font-weight="800" fill="${LABEL_SCORE_COLORS[i]}">${esc(displayScore)}</text>`;
  }).join("");

  const coreText = overall
    ? `<text class="qip-radar-center-label" x="${CX}" y="${CY + 8}" text-anchor="middle" font-size="40" font-weight="800" letter-spacing="-1.5" fill="url(#${uid}-num)">${esc(overall)}</text>`
    : "";

  return `
    <div class="star-card qip-star-card${animClass}">
      <div class="star-head">
        <span class="eyebrow">${esc(title)}</span>
        <span class="hint">${esc(hint)}</span>
      </div>
      <div class="qip-star-stage">
      <svg class="star-svg qip-star-svg qip-radar-svg" viewBox="${VIEWBOX}" preserveAspectRatio="xMidYMid meet" role="img" aria-label="${ariaLabel}">
        <defs>
          <radialGradient id="${uid}-core" cx="40%" cy="34%" r="72%"><stop offset="0" stop-color="#ffffff"/><stop offset="46%" stop-color="#eafaf4"/><stop offset="100%" stop-color="#cdeae0"/></radialGradient>
          <linearGradient id="${uid}-num" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#0e9c7a"/><stop offset="1" stop-color="#0a94a5"/></linearGradient>
          <filter id="${uid}-bBig" x="-70%" y="-70%" width="240%" height="240%"><feGaussianBlur stdDeviation="9"/></filter>
        </defs>
        ${rings}
        <g stroke="#efe8db" stroke-width="1">${spokes}</g>
        ${scaleLabels}
        <g id="${uid}-dataGroup" class="qip-star-data">
          <polygon class="qip-radar-data" points="${dataPoly}" fill="#17a086" fill-opacity="0.24" stroke="#17a086" stroke-width="2.6" stroke-linejoin="round"/>
          <g>${dots}</g>
        </g>
        <g id="${uid}-coreGroup" class="qip-star-core">
          <circle cx="${CX}" cy="${CY}" r="40" fill="#8fe6d2" filter="url(#${uid}-bBig)" opacity=".45"/>
          <circle cx="${CX}" cy="${CY}" r="30" fill="url(#${uid}-core)"/>
          <circle cx="${CX}" cy="${CY}" r="30" fill="none" stroke="#8fd8c8" stroke-width="1.2" opacity=".8"/>
          ${coreText}
        </g>
        ${labelMarkup}
      </svg>
      </div>
    </div>`;
}
