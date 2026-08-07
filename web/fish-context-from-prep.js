/**
 * Client-side fish sizing from stored prep JSON — mirrors worker fishSizingFromPrepResult
 * so briefs opened from history get About/fish parity.
 */

import { resolveDisplayFacts } from "./precall-render.js?v=2.1.14";

const FISH_FACT_LABELS = {
  "Company size": "Employees",
  "Support team": "Support agents",
  Ownership: "Ownership",
  Industry: "Industry",
};

const UNKNOWN = new Set(["unknown", "n/a", "na", "not found", "unclear", "—", "-"]);

function usableValue(raw) {
  const v = String(raw || "").trim();
  if (!v || v.length < 2) return false;
  return !UNKNOWN.has(v.toLowerCase());
}

/** @param {object} prep */
export function buildFishContextFromPrep(prep) {
  const metrics = [];
  const seen = new Set();
  for (const fact of resolveDisplayFacts(prep)) {
    const label = FISH_FACT_LABELS[fact.key];
    if (!label) continue;
    const value = String(fact.value || "").trim();
    if (!usableValue(value)) continue;
    const key = `${label.toLowerCase()}|${value.toLowerCase()}`;
    if (seen.has(key)) continue;
    seen.add(key);
    metrics.push({ label, value });
    if (metrics.length >= 4) break;
  }
  if (!metrics.length) return prep?.fishContext || null;

  const fromPrep = { metrics, source: "context" };
  const existing = prep?.fishContext?.metrics || [];
  if (!existing.length) return fromPrep;

  const merged = [];
  const labels = new Set();
  for (const m of existing) {
    const key = String(m.label || "").toLowerCase();
    if (!key || labels.has(key)) continue;
    labels.add(key);
    merged.push(m);
  }
  for (const m of fromPrep.metrics) {
    const key = String(m.label || "").toLowerCase();
    if (!key || labels.has(key)) continue;
    labels.add(key);
    merged.push(m);
  }
  return merged.length ? { metrics: merged.slice(0, 4), source: "context" } : fromPrep;
}
