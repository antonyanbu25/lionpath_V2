import { esc } from "./shared.js";

/**
 * Portal chart palette — monochrome editorial scale (feat/mono-ui-overhaul).
 * SVG/canvas charts import these; CSS charts should prefer var(--dew-*).
 * Hue families map to ink density: red → ink, amber → mid gray, green → dark gray.
 */
export const CHART_PALETTE = {
  brand: "#161513",
  primary: "#3f3d38",
  primaryHover: "#57534b",
  green: "#3f3d38",
  greenTint: "#eceae4",
  amber: "#6b675e",
  amberTint: "#f0eee8",
  red: "#161513",
  redTint: "#e9e6df",
  clay: "#57534b",
  clayTint: "#eceae4",
  blue: "#3f3d38",
  blueTint: "#eceae4",
  purple: "#161513",
  purpleTint: "#eceae4",
  text: "#161513",
  textSecondary: "#57534b",
  textMuted: "#7a756b",
  textFaint: "#a39e93",
  border: "#e0dcd3",
  hairline: "#e8e5de",
  surfaceSubtle: "#f1efe9",
  brandTint: "#e9e6df",
  primaryTint: "#efede8",
  ringStrokes: ["#e8e5de", "#e4e0d7", "#e0dcd3", "#dcd8ce", "#d8d4c9"],
  scaleLabels: ["#a39e93", "#a8a399", "#ada89e"],
  spokeStroke: "#e8e5de",
};

/** Five-axis QIP star radar — grayscale axis steps, ink → faint. */
export const QIP_RADAR_AXIS = {
  colors: ["#161513", "#3f3d38", "#57534b", "#7a756b", "#a39e93"],
  strokes: ["#35322c", "#57534b", "#6b675e", "#8b867c", "#b3aea4"],
  labelScoreColors: ["#161513", "#3f3d38", "#57534b", "#6b675e", "#8b867c"],
  gradientStops: [
    ["#161513", "#3f3d38"],
    ["#3f3d38", "#57534b"],
    ["#57534b", "#7a756b"],
    ["#7a756b", "#a39e93"],
    ["#a39e93", "#161513"],
  ],
};

/** Score bands for heatmaps — ink density carries severity (dark = needs attention). */
export const CHART_SCORE_BANDS = [
  { min: 0, max: 55, bg: "#161513", fg: "#f4f2ed" },
  { min: 55, max: 65, bg: "#57534b", fg: "#f4f2ed" },
  { min: 65, max: 75, bg: "#e0dcd3", fg: "#161513" },
  { min: 75, max: 85, bg: "#eceae4", fg: "#161513" },
  { min: 85, max: 101, bg: "#f5f3ee", fg: "#161513" },
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
  slides: ["#eceae4", "#161513"],
  intro: ["#eceae4", "#161513"],
  product: ["#e9e6df", "#161513"],
  cde: ["#e9e6df", "#161513"],
  demo: ["#eceae4", "#3f3d38"],
  customer_screen: ["#eceae4", "#3f3d38"],
  discovery: ["#eceae4", "#3f3d38"],
  pricing: ["#f0eee8", "#6b675e"],
  objection_handling: ["#e9e6df", "#161513"],
  next_steps: ["#e9e6df", "#161513"],
  none: ["#f5f3ee", "#7a756b"],
  scene_change: ["#f0eee8", "#6b675e"],
};

export const TIMELINE_MARKER_COLORS = {
  gap: "#161513",
  objection: "#6b675e",
  win: "#3f3d38",
  weak_cta: "#57534b",
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
