import type { Prep } from "../schema";
import type { ResearchFact } from "./types";

const UNKNOWN = "unknown";

function isUnknown(v: unknown): boolean {
  if (v == null) return true;
  const s = String(v).trim().toLowerCase();
  return !s || s === UNKNOWN || s === "-";
}

function sourceMap(prep: Prep): Map<string, { url: string; confidence: number }> {
  const map = new Map<string, { url: string; confidence: number }>();
  for (const s of prep.sources || []) {
    map.set(s.label, {
      url: String(s.url || UNKNOWN),
      confidence: Number(s.confidence) || 0,
    });
  }
  return map;
}

function isLowConfidenceSource(src: { url: string; confidence: number } | undefined): boolean {
  if (!src) return true;
  if (isUnknown(src.url) || src.url === UNKNOWN) return true;
  return src.confidence < 55;
}

/** Post-process prep: enforce unknown for unverified claims. */
export function validatePrep(prep: Prep): { prep: Prep; lowConfidence: string[] } {
  const lowConfidence: string[] = [];
  const srcByLabel = sourceMap(prep);

  const facts = (prep.facts || []).map((f) => {
    const src = srcByLabel.get(f.sourceLabel);
    if (!f.sourceLabel || isLowConfidenceSource(src) || isUnknown(f.value)) {
      if (f.key && !isUnknown(f.value)) lowConfidence.push(`fact:${f.key}`);
      return { ...f, value: UNKNOWN };
    }
    return f;
  });

  const signals = (prep.signals || []).map((s) => {
    const src = srcByLabel.get(s.sourceLabel);
    if (!s.sourceLabel || isLowConfidenceSource(src) || isUnknown(s.value)) {
      if (s.label && !isUnknown(s.value)) lowConfidence.push(`signal:${s.label}`);
      return { ...s, value: UNKNOWN };
    }
    return s;
  });

  const fitSnapshot = (prep.fitSnapshot || []).map((row) => {
    if (isUnknown(row.industryNorm)) {
      lowConfidence.push(`fit:${row.label}:industryNorm`);
      return { ...row, industryNorm: UNKNOWN };
    }
    return row;
  });

  const prospects = (prep.prospects || []).map((p) => {
    const src = srcByLabel.get(p.sourceLabel);
    if (!p.sourceLabel || isLowConfidenceSource(src)) {
      lowConfidence.push(`prospect:${p.name || "unknown"}`);
      return {
        ...p,
        name: isUnknown(p.name) ? UNKNOWN : p.name,
        role: isUnknown(p.role) ? UNKNOWN : p.role,
        totalExperience: isUnknown(p.totalExperience) ? UNKNOWN : p.totalExperience,
      };
    }
    return p;
  });

  const sources = (prep.sources || []).map((s) => ({
    ...s,
    url: isUnknown(s.url) ? UNKNOWN : s.url,
  }));

  return {
    prep: {
      ...prep,
      facts,
      signals,
      fitSnapshot,
      prospects,
      sources,
    },
    lowConfidence,
  };
}

/** Collect keys/labels with low confidence for UI highlighting. */
export function findLowConfidenceFacts(facts: ResearchFact[]): string[] {
  return facts
    .filter((f) => isUnknown(f.value) || !f.sourceUrl || f.sourceUrl === UNKNOWN || (f.confidence ?? 0) < 55)
    .map((f) => f.key);
}
