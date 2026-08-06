/**
 * Shared QIP category radar — post-call result and call record.
 * 5-axis radar polygon: tips on axes, jewel-tone fill, glowing core.
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

const RING_RADII = [42, 84, 126, 168, 210];

const GRADIENT_STOPS = [
  ["#10a884", "#0ba0b2"],
  ["#0ba0b2", "#e0982a"],
  ["#e0982a", "#e06a4c"],
  ["#e06a4c", "#7a5bd0"],
  ["#7a5bd0", "#10a884"],
];

const AXIS_AT_MAX = AXIS_ANGLES.map((a) => vertex(CX, CY, R, a));

const GRADIENT_DEFS = AXIS_AT_MAX.map(([x1, y1], i) => {
  const [x2, y2] = AXIS_AT_MAX[(i + 1) % 5];
  const [c0, c1] = GRADIENT_STOPS[i];
  return { x1, y1, x2, y2, c0, c1 };
});

const AXIS_COLORS = ["#10a884", "#0ba0b2", "#e0982a", "#e06a4c", "#7a5bd0"];
const AXIS_STROKES = ["#12b892", "#0aacc0", "#eaa236", "#ec7458", "#8a6ce0"];
const LABEL_SCORE_COLORS = ["#0e9c7a", "#0a94a5", "#c9871f", "#d85f42", "#6d54c9"];
const RING_STROKES = ["#f2ece1", "#eee7db", "#eae2d4", "#e6ddcd", "#dcd1be"];

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
  if (ratio <= 0.05) return 0;
  return R * ratio;
}

/** 5-vertex pentagon: one tip per axis (classic radar chart). */
function buildPentagonGeometry(scores) {
  const tips = scores.map((s, i) => vertex(CX, CY, axisRadius(s), AXIS_ANGLES[i]));
  const dataPoly = tips.map((p) => p.map(fmtCoord).join(",")).join(" ");
  return { tips, dataPoly };
}

/**
 * Jewel-tone QIP radar for category scores (0–10 scale).
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
  const uid = `qip-star-${seq}`;

  const scores = CATEGORY_KEYS.map((key) =>
    Math.max(0, Math.min(10, Number(categoryScores?.[key] ?? 0) || 0)),
  );
  const { tips, dataPoly } = buildPentagonGeometry(scores);
  const overall = formatOverall(opts.overallScore);

  const ariaParts = CATEGORY_KEYS.map((key, i) => `${axisLabel(key).replace(/\n/g, " ")} ${scores[i]}`);
  if (overall) ariaParts.push(`overall ${overall} out of 10`);
  const ariaLabel = esc(`${title}: ${ariaParts.join(", ")}`);

  const animClass = animate ? " qip-star-animated" : " qip-star-static";

  const gradients = GRADIENT_DEFS.map(
    (g, i) =>
      `<linearGradient id="${uid}-g${i}" gradientUnits="userSpaceOnUse" x1="${fmtCoord(g.x1)}" y1="${fmtCoord(g.y1)}" x2="${fmtCoord(g.x2)}" y2="${fmtCoord(g.y2)}"><stop offset="0" stop-color="${g.c0}"/><stop offset="1" stop-color="${g.c1}"/></linearGradient>`,
  ).join("");

  const wedgePolys = AXIS_AT_MAX.map((_, i) => {
    const [x1, y1] = AXIS_AT_MAX[i];
    const [x2, y2] = AXIS_AT_MAX[(i + 1) % 5];
    return `<polygon points="${CX},${CY} ${fmtCoord(x1)},${fmtCoord(y1)} ${fmtCoord(x2)},${fmtCoord(y2)}" fill="url(#${uid}-g${i})"/>`;
  }).join("");

  const edgePaths = CATEGORY_KEYS.map((_, i) => {
    const [x1, y1] = tips[i];
    const [x2, y2] = tips[(i + 1) % 5];
    return `<path d="M ${fmtCoord(x1)},${fmtCoord(y1)} L ${fmtCoord(x2)},${fmtCoord(y2)}" stroke="${AXIS_STROKES[i]}" stroke-width="2.4" stroke-linecap="round" fill="none"/>`;
  }).join("");

  const halos = tips
    .map(
      (t, i) =>
        `<circle class="halo g${i}" cx="${fmtCoord(t[0])}" cy="${fmtCoord(t[1])}" r="10" fill="${AXIS_COLORS[i]}" filter="url(#${uid}-bMed)" opacity=".5"/>`,
    )
    .join("");

  const gems = tips
    .map(
      (t, i) =>
        `<circle class="gem g${i}" cx="${fmtCoord(t[0])}" cy="${fmtCoord(t[1])}" r="4.5" fill="${AXIS_COLORS[i]}" stroke="#fff" stroke-width="2.2"/>`,
    )
    .join("");

  const rings = RING_RADII.map((r, i) => {
    const outer = i === RING_RADII.length - 1;
    return `<circle class="ring r${i + 1}" cx="${CX}" cy="${CY}" r="${fmtCoord(r)}" fill="none" stroke="${RING_STROKES[i]}" stroke-width="${outer ? 1.1 : 1}"${outer ? ' stroke-dasharray="2 5"' : ""}/>`;
  }).join("");

  const spokes = AXIS_AT_MAX.map(
    ([x, y]) => `<line class="spoke" x1="${CX}" y1="${CY}" x2="${fmtCoord(x)}" y2="${fmtCoord(y)}"/>`,
  ).join("");

  const labelMarkup = CATEGORY_KEYS.map((key, i) => {
    const lines = labelDisplayLines(key);
    const layout = labelPositions(i);
    const line1 = lines[0] || "";
    const line2 = lines[1] || "";
    const displayScore = scores[i] % 1 === 0 ? String(Math.round(scores[i])) : String(Math.round(scores[i] * 10) / 10);
    return `<text class="lab" x="${fmtCoord(layout.x)}" y="${layout.line1Y}" text-anchor="${layout.anchor}" font-size="12" font-weight="700" fill="#3d3a34">${esc(line1)}</text>
            <text class="lab" x="${fmtCoord(layout.x)}" y="${layout.line2Y}" text-anchor="${layout.anchor}" font-size="12" font-weight="700" fill="#3d3a34">${esc(line2)}</text>
            <text class="lab" x="${fmtCoord(layout.x)}" y="${layout.scoreY}" text-anchor="${layout.anchor}" font-size="14.5" font-weight="800" fill="${LABEL_SCORE_COLORS[i]}">${esc(displayScore)}</text>`;
  }).join("");

  const coreText = overall
    ? `<text x="${CX}" y="${CY + 9}" text-anchor="middle" font-size="28" font-weight="800" letter-spacing="-1.5" fill="url(#${uid}-num)">${esc(overall)}</text>`
    : "";

  const scaleY = (frac) => fmtCoord(CY - R * frac + 8);

  return `
    <div class="star-card qip-star-card${animClass}">
      <div class="star-head">
        <span class="eyebrow">${esc(title)}</span>
        <span class="hint">${esc(hint)}</span>
      </div>
      <div class="qip-star-stage">
      <svg class="star-svg qip-star-svg qip-radar-svg" viewBox="${VIEWBOX}" preserveAspectRatio="xMidYMid meet" role="img" aria-label="${ariaLabel}">
        <defs>
          ${gradients}
          <radialGradient id="${uid}-core" cx="40%" cy="34%" r="72%"><stop offset="0" stop-color="#ffffff"/><stop offset="46%" stop-color="#eafaf4"/><stop offset="100%" stop-color="#cdeae0"/></radialGradient>
          <radialGradient id="${uid}-sheen" cx="50%" cy="46%" r="58%"><stop offset="0" stop-color="#ffffff" stop-opacity=".42"/><stop offset="100%" stop-color="#ffffff" stop-opacity="0"/></radialGradient>
          <linearGradient id="${uid}-num" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#0e9c7a"/><stop offset="1" stop-color="#0a94a5"/></linearGradient>
          <filter id="${uid}-bBig" x="-70%" y="-70%" width="240%" height="240%"><feGaussianBlur stdDeviation="9"/></filter>
          <filter id="${uid}-bMed" x="-60%" y="-60%" width="220%" height="220%"><feGaussianBlur stdDeviation="5"/></filter>
          <clipPath id="${uid}-dataClip"><polygon points="${dataPoly}"/></clipPath>
        </defs>
        ${rings}
        <g stroke="#efe8db" stroke-width="1">${spokes}</g>
        <text class="lab" x="${CX - 8}" y="${scaleY(1)}" text-anchor="end" font-size="8.5" font-weight="700" fill="#c9bfab">10</text>
        <text class="lab" x="${CX - 8}" y="${scaleY(0.8)}" text-anchor="end" font-size="8.5" font-weight="700" fill="#cec5b2">8</text>
        <text class="lab" x="${CX - 8}" y="${scaleY(0.6)}" text-anchor="end" font-size="8.5" font-weight="700" fill="#d3cab7">6</text>
        <g id="${uid}-dataGroup" class="qip-star-data">
          <polygon class="aura" points="${dataPoly}" fill="#1aa88f" filter="url(#${uid}-bBig)" opacity=".3"/>
          <g clip-path="url(#${uid}-dataClip)" opacity=".82">${wedgePolys}</g>
          <polygon points="${dataPoly}" fill="url(#${uid}-sheen)" opacity=".35"/>
          <g fill="none" stroke-width="1.2" opacity=".55">${edgePaths}</g>
          ${halos}
          <g>${gems}</g>
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
