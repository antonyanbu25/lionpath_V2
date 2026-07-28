import { esc } from "./shared.js";

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
