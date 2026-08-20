import { esc } from "./shared.js";

/**
 * Portal chart palette — from newportalui.html / dew-theme.css (SE Labs Portal).
 * SVG/canvas charts import these; CSS charts should prefer var(--dew-*).
 */
export const CHART_PALETTE = {
  brand: "#2e897b",
  primary: "#6fb8ac",
  primaryHover: "#5da79a",
  green: "#4a7a5c",
  greenTint: "#e9f1e9",
  amber: "#a5883f",
  amberTint: "#f3ecda",
  red: "#b8544a",
  redTint: "#f4e7df",
  clay: "#c2603f",
  clayTint: "#f6ece7",
  blue: "#4a6fa5",
  blueTint: "#e7eef7",
  purple: "#6b5b95",
  purpleTint: "#eeeaf6",
  text: "#2b2926",
  textSecondary: "#3d3a34",
  textMuted: "#6f6759",
  textFaint: "#a49a88",
  border: "#ece7de",
  hairline: "#f4f0e8",
  surfaceSubtle: "#faf8f4",
  brandTint: "#e3efec",
  primaryTint: "#f0f7f5",
  ringStrokes: ["#f2ece1", "#eee7db", "#eae2d4", "#e6ddcd", "#dcd1be"],
  scaleLabels: ["#c9bfab", "#cec5b2", "#d3cab7"],
  spokeStroke: "#efe8db",
};

/** Five-axis QIP star radar — portal tile accent colors. */
export const QIP_RADAR_AXIS = {
  colors: ["#2e897b", "#4a6fa5", "#4a7a5c", "#a5883f", "#6b5b95"],
  strokes: ["#3a9a8c", "#5a7fb5", "#5a8a6c", "#b5984f", "#7b6ba5"],
  labelScoreColors: ["#256f63", "#3d5f8f", "#3d6649", "#8a722f", "#5a4b7f"],
  gradientStops: [
    ["#2e897b", "#4a6fa5"],
    ["#4a6fa5", "#4a7a5c"],
    ["#4a7a5c", "#a5883f"],
    ["#a5883f", "#6b5b95"],
    ["#6b5b95", "#2e897b"],
  ],
};

/** Score bands for heatmaps and inline chart fills. */
export const CHART_SCORE_BANDS = [
  { min: 0, max: 55, bg: "#f4e7df", fg: "#b8544a" },
  { min: 55, max: 65, bg: "#f3ecda", fg: "#a5883f" },
  { min: 65, max: 75, bg: "#faf8f4", fg: "#6f6759" },
  { min: 75, max: 85, bg: "#e9f1e9", fg: "#4a7a5c" },
  { min: 85, max: 101, bg: "#e3efec", fg: "#2e897b" },
];

export function heatmapShadeForScore(score) {
  if (score == null) return { bg: "var(--surface-muted)", fg: "var(--muted)", label: "-" };
  const v = score;
  for (const band of CHART_SCORE_BANDS) {
    if (v >= band.min && v < band.max) {
      return { bg: band.bg, fg: band.fg, label: String(Math.round(v)) };
    }
  }
  const top = CHART_SCORE_BANDS[CHART_SCORE_BANDS.length - 1];
  return { bg: top.bg, fg: top.fg, label: String(Math.round(v)) };
}

export function qipScoreHex(score) {
  if (score >= 8) return CHART_PALETTE.green;
  if (score >= 6) return CHART_PALETTE.amber;
  return CHART_PALETTE.red;
}

export const TREND_LINE_COLORS = [
  { stroke: "var(--accent)", dash: "" },
  { stroke: "var(--green)", dash: "5 4" },
  { stroke: "var(--amber)", dash: "2 3" },
  { stroke: "var(--danger)", dash: "6 3" },
];

/** Call timeline spine segment fills [bg, fg]. */
export const SPINE_SEGMENT_PALETTE = {
  slides: ["#eeeaf6", "#6b5b95"],
  intro: ["#eeeaf6", "#6b5b95"],
  product: ["#e3efec", "#2e897b"],
  cde: ["#e3efec", "#2e897b"],
  demo: ["#e9f1e9", "#4a7a5c"],
  customer_screen: ["#e7eef7", "#4a6fa5"],
  discovery: ["#e7eef7", "#4a6fa5"],
  pricing: ["#f3ecda", "#a5883f"],
  objection_handling: ["#f4e7df", "#b8544a"],
  next_steps: ["#e3efec", "#2e897b"],
  none: ["#faf8f4", "#8a8072"],
  scene_change: ["#f3ecda", "#a5883f"],
};

export const TIMELINE_MARKER_COLORS = {
  gap: "#b8544a",
  objection: "#a5883f",
  win: "#4a7a5c",
  weak_cta: "#c2603f",
};

export const RADAR_DIMENSION_LABELS = {
  discovery: "Discovery",
  demoalignment: "Demo alignment",
  objections: "Objections",
  valuearticulation: "Value articulation",
  nextstepclarity: "Next-step clarity",
  talkbalance: "Talk balance",
};

export function normalizeDimensionKey(name) {
  return String(name ?? "").replace(/[\s_-]/g, "").toLowerCase();
}

export function radarDimensionLabel(name) {
  return RADAR_DIMENSION_LABELS[normalizeDimensionKey(name)] || String(name ?? "");
}

export function barClass(score, max) {
  const pct = max ? score / max : 0;
  if (pct >= 0.8) return "good";
  if (pct >= 0.6) return "ok";
  return "weak";
}

export function scorePct(score, max) {
  if (!max) return 0;
  return Math.min(100, Math.max(0, (score / max) * 100));
}

export function momentumClass(status) {
  if (status === "Advancing") return "momentum-advancing";
  if (status === "At risk") return "momentum-risk";
  return "momentum-stalled";
}

export function radarLabelAnchor(angle) {
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

export function wrapRadarLabelLines(label) {
  if (label.length <= 14) return [label];
  const lastSpace = label.lastIndexOf(" ");
  if (lastSpace > 0) return [label.slice(0, lastSpace), label.slice(lastSpace + 1)];
  const hyphenIdx = label.indexOf("-");
  if (hyphenIdx > 0 && hyphenIdx < label.length - 1) {
    return [label.slice(0, hyphenIdx + 1), label.slice(hyphenIdx + 1).trim()];
  }
  return [label];
}

export function renderRadarLabelText(label, x, y, angle) {
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
