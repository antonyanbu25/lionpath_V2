import type { IcpFit, Prep } from "../schema";
import { normalizePainCapabilityValue } from "../word-limits";
import { anchorTokens, anchorHitCount } from "./claim-verify";
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

  // incumbent.incumbent_name cross-check (T2.3): the headline incumbent is a
  // free-prose field with no sourceLabel, so a model could write "Intercom" while
  // the sourced "Incumbent tool" signal says "Zendesk" — the SE then sees two
  // different incumbents in the same brief. The signal is the grounded value
  // (it cleared the source gate above); when the two disagree, the sourced
  // signal wins and the model's free-prose value is replaced. When the signal
  // is unknown/unsourced, the model's value stands but is flagged low-confidence
  // so the UI does not present two equally-confident incumbents.
  let incumbent = prep.incumbent;
  const incumbentSignal = signals.find((s) => s.label === "Incumbent tool");
  if (incumbent && incumbentSignal && !isUnknown(incumbentSignal.value)) {
    const model = String(incumbent.incumbent_name || "").trim();
    if (model && !isUnknown(model) && model.toLowerCase() !== String(incumbentSignal.value).toLowerCase()) {
      lowConfidence.push(`incumbent:incumbent_name "${model}" replaced by sourced signal "${incumbentSignal.value}"`);
      incumbent = { ...incumbent, incumbent_name: incumbentSignal.value };
    }
  }

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

  // fitSnapshot grounding gate (T1.2): thisCompany is the most-read claim in the
  // brief, so it must trace to a source the way facts/signals do. A row whose
  // sourceLabel is missing or low-confidence has its thisCompany/industryNorm
  // blanked to "unknown" and its gap forced to parity/Aligned — never passed
  // through on prose. The schema now carries an optional sourceLabel on fitRow;
  // rows produced before it have none and are treated as unsourced (honest:
  // we cannot verify a claim we have no pointer for, so we degrade it).
  const groundedFit = fitSnapshot.map((row) => {
    const src = srcByLabel.get(row.sourceLabel || "");
    if (!row.sourceLabel || isLowConfidenceSource(src)) {
      if (!isUnknown(row.thisCompany) || !isUnknown(row.industryNorm)) {
        lowConfidence.push(`fit:${row.label}:unsourced`);
      }
      return {
        ...row,
        thisCompany: UNKNOWN,
        industryNorm: UNKNOWN,
        gap: "parity" as const,
        gapVerdict: "Aligned",
        sourceLabel: undefined,
      };
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

  // likelyPains grounding gate (T1.5): a pain must reference a token from the
  // research facts, the SE context, the incumbent, or the industry — otherwise
  // it is generic filler the model wrote when it had nothing to say. Drop
  // unanchored pains. An empty result is honest ("no pains identified yet")
  // and is much better than plausible-sounding filler that propagates into
  // painCapabilityValue (the demo script) and demoThesis (the hero tile).
  const painAnchors = anchorTokens([
    ...(prep.facts || []).map((f) => `${f.key} ${f.value}`),
    ...(prep.signals || []).map((s) => `${s.label} ${s.value}`),
    prep.incumbent?.incumbent_name,
    prep.businessContext?.market,
    prep.businessContext?.model,
  ]);
  const gatedPains = (prep.likelyPains || []).filter((p) => {
    if (isUnknown(p)) return false;
    if (!painAnchors.length) return false; // nothing to anchor against → all filler
    return anchorHitCount(p, painAnchors) >= 1;
  });
  if (gatedPains.length !== (prep.likelyPains || []).length) {
    lowConfidence.push(
      `likelyPains:${(prep.likelyPains || []).length - gatedPains.length} unanchored`,
    );
  }

  // Re-derive painCapabilityValue against the gated pains, because
  // normalizePrepOutput built it from the pre-gate likelyPains. A demo script
  // row whose pain was just dropped must not survive. This re-derives ONLY the
  // pcv rows from the gated pains + the existing incoming rows, without
  // re-normalizing the whole prep (which is already normalized).
  const gatedPcv = normalizePainCapabilityValue(prep, gatedPains);

    return {
      prep: {
        ...prep,
        facts,
        signals,
        ...(incumbent ? { incumbent } : {}),
        fitSnapshot: groundedFit,
        likelyPains: gatedPains,
        painCapabilityValue: gatedPcv,
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
