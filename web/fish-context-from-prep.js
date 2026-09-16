/**
 * Client-side fish sizing from stored prep JSON — mirrors worker fishSizingFromPrepResult
 * so briefs opened from history get About/fish parity.
 */

import { resolveDisplayFacts } from "./precall-render.js?v=2.1.14";
import { normalizeFishSizingMetrics } from "./fish-sizing-buckets.js?v=2.1.46";

/** Only the three canonical fish-sizing facts — not Industry, Ownership, etc. */
const FISH_FACT_LABELS = {
  "Company size": "Employees",
  "Support team": "Support agents",
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
  }

  const fromPrep = normalizeFishSizingMetrics(metrics);
  if (!fromPrep.length) return prep?.fishContext ? { ...prep.fishContext, metrics: normalizeFishSizingMetrics(prep.fishContext.metrics) } : null;

  const existing = normalizeFishSizingMetrics(prep?.fishContext?.metrics || []);
  if (!existing.length) return { metrics: fromPrep, source: "context" };

  const merged = [];
  const types = new Set();
  for (const m of [...existing, ...fromPrep]) {
    if (!m.type || types.has(m.type)) continue;
    types.add(m.type);
    merged.push(m);
  }
  return merged.length ? { metrics: merged, source: "context" } : { metrics: fromPrep, source: "context" };
}
