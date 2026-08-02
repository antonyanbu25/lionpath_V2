import type { IcpFit, Prep } from "../schema";
import { placeAccount } from "./icp-criteria";
import type { ResearchFact } from "./types";

const UNKNOWN = "unknown";

/**
 * Prose the model writes when it found nothing. These are not values — "None identified" is the
 * absence of a finding, worded as one. Left as-is they read as data: the signals grid counted
 * them, so a brief where every lookup came back empty announced "Tech stack & signals (4 found)"
 * above six cells that all said nothing was found. Normalised here rather than in the two mirrored
 * client isUnknown() copies, so the count, the confidence band and the news gate all agree.
 */
const ABSENCE_PHRASES =
  /^(?:none|none\s+(?:identified|found|detected|listed|specified)|not\s+(?:identified|found|detected|present|available|specified|listed|disclosed|applicable)|no\s+(?:data|information|evidence|mention|record)s?(?:\s+found)?|nothing\s+(?:found|identified)|not\s+present\s+on\s+(?:the\s+)?website|unable\s+to\s+(?:determine|verify|identify)|n\/?a)\b[\s.]*$/i;

function isUnknown(v: unknown): boolean {
  if (v == null) return true;
  const s = String(v).trim().toLowerCase();
  if (!s || s === UNKNOWN || s === "-") return true;
  return ABSENCE_PHRASES.test(s);
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

  // supportJD was the one claim that escaped this gate entirely — it is not research-
  // derived unless it traces to a real job posting, so blank it when the label does not
  // resolve to a usable source rather than presenting invented responsibilities.
  let supportJD = prep.supportJD;
  if (supportJD) {
    const src = srcByLabel.get(supportJD.sourceLabel);
    const hasContent = !isUnknown(supportJD.title) || (supportJD.bullets || []).some((b) => !isUnknown(b));
    if (hasContent && (!supportJD.sourceLabel || isLowConfidenceSource(src))) {
      lowConfidence.push("supportJD");
      supportJD = { ...supportJD, title: "", bullets: [] };
    }
  }

  // icpFit escaped this gate entirely, so a criterion resting on an unsourced claim still
  // counted. Demote those to `unknown` and re-place — otherwise the gate would leave a
  // verdict that no longer matches the surviving rows.
  //
  // A demoted GATING criterion also loses its band, which can drop the tier to Unknown.
  // That is correct: we cannot place an account whose employee count we could not source.
  let icpFit = prep.icpFit;
  if (icpFit?.criteria?.length) {
    let demoted = 0;
    const criteria = icpFit.criteria.map((row) => {
      if (row.state === "unknown") return row;
      const src = srcByLabel.get(row.sourceLabel || "");
      if (!row.sourceLabel || isLowConfidenceSource(src)) {
        demoted++;
        return {
          ...row,
          state: "unknown" as const,
          evidence: "",
          sourceLabel: undefined,
          band: undefined,
        };
      }
      return row;
    });
    if (demoted) {
      lowConfidence.push(`icpFit:${demoted} unsourced criteria`);
      const placed = placeAccount(criteria, icpFit.product);
      icpFit = {
        ...icpFit,
        criteria,
        verdict: placed.tier,
        ...(placed.zone ? { zone: placed.zone } : { zone: undefined }),
      } satisfies IcpFit;
    }
  }

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
      ...(supportJD ? { supportJD } : {}),
      ...(icpFit ? { icpFit } : {}),
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
