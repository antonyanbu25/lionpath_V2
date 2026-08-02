/**
 * Build the research source table in CODE, not in the LLM.
 *
 * Previously extract-facts asked the model to invent both the S-label and the URL for
 * every fact. With no URLs in its input it wrote "unknown", and labels drifted outside
 * the range it had been shown (the S4/S7 problem). Now the table is authoritative:
 * the model may only copy a label we gave it, and every URL comes from here.
 */

import { DIRECT_FETCH_CONFIDENCE, GROUNDED_CONFIDENCE } from "./citations";
import { SE_SOURCE } from "./se-context-facts";
import { sourceDisplayName } from "./source-display";
import type { ResearchFact, ResearchSnippet, SourceRef } from "./types";

export interface SourceTable {
  /** Ordered source list, labels S{offset+1}… plus "SE" when context is present. */
  sources: SourceRef[];
  byLabel: Map<string, SourceRef>;
  /** Labels available to each snippet, parallel to the input array. */
  labelsForSnippet: string[][];
  /** Pass to the next extraction round so its labels do not collide with this one. */
  nextSourceOffset: number;
}

/**
 * Highest S-number already used, so a later round can continue the numbering.
 * Non-S labels ("SE", "LinkedIn PDF", "R1") are ignored.
 */
export function maxSourceOffset(sources: SourceRef[]): number {
  let max = 0;
  for (const s of sources) {
    const m = /^S(\d+)$/.exec(s.label);
    if (m) max = Math.max(max, Number(m[1]));
  }
  return max;
}

/** Human-readable "Sources for this snippet" line for the extraction prompt. */
export function formatSnippetSources(labels: string[], table: SourceTable): string {
  if (!labels.length) return "Sources for this snippet: none — do not attribute facts to this snippet.";
  const parts = labels.map((label) => {
    const s = table.byLabel.get(label);
    return s ? `${label} = ${s.title}` : label;
  });
  return `Sources for this snippet: ${parts.join(" | ")}`;
}

/**
 * @param snippets research snippets, in the order they will appear in the prompt
 * @param opts.offset label numbering starts at offset+1 (use nextSourceOffset from a prior round)
 * @param opts.seContext include the "SE" source for SE-note-derived facts
 */
export function buildSourceTable(
  snippets: ResearchSnippet[],
  opts: { offset?: number; seContext?: boolean } = {},
): SourceTable {
  const offset = opts.offset ?? 0;
  const sources: SourceRef[] = [];
  const byLabel = new Map<string, SourceRef>();
  const byUrl = new Map<string, SourceRef>();
  const labelsForSnippet: string[][] = [];
  let n = offset;

  const add = (url: string, title: string, confidence: number): SourceRef => {
    const existing = byUrl.get(url);
    if (existing) return existing;
    const label = `S${++n}`;
    const source: SourceRef = { label, title, url, confidence };
    source.displayName = sourceDisplayName(source);
    sources.push(source);
    byLabel.set(label, source);
    byUrl.set(url, source);
    return source;
  };

  for (const snippet of snippets) {
    const labels: string[] = [];

    if (snippet.citations?.length) {
      for (const c of snippet.citations) {
        if (!c.uri) continue;
        const title = c.title || c.domain || "Web source";
        labels.push(add(c.uri, title, c.confidence ?? GROUNDED_CONFIDENCE).label);
      }
    } else {
      // No citations: synthesize an entry from what the snippet's origin tells us.
      const synthetic = syntheticSource(snippet);
      if (synthetic) {
        labels.push(add(synthetic.url, synthetic.title, synthetic.confidence).label);
      }
    }

    labelsForSnippet.push(labels);
  }

  // SE context is not a snippet, so it is appended with its own stable label.
  if (opts.seContext && !byLabel.has(SE_SOURCE.label)) {
    sources.push(SE_SOURCE);
    byLabel.set(SE_SOURCE.label, SE_SOURCE);
  }

  return { sources, byLabel, labelsForSnippet, nextSourceOffset: n };
}

function syntheticSource(
  snippet: ResearchSnippet,
): { url: string; title: string; confidence: number } | null {
  if (snippet.origin === "linkedin_pdf") {
    const fileName = snippet.query.replace(/^linkedin-pdf:/, "") || "upload";
    return {
      url: `linkedin-pdf:${fileName}`,
      title: `LinkedIn PDF — ${fileName}`,
      confidence: 90,
    };
  }
  if (snippet.origin === "company_web") {
    const url = snippet.query.replace(/^company_web:/, "");
    if (/^https?:\/\//i.test(url)) {
      return { url, title: "Company website", confidence: DIRECT_FETCH_CONFIDENCE };
    }
    return { url: "company-web", title: "Company website", confidence: 65 };
  }
  // A grounded snippet with no citations has nothing verifiable behind it, and an
  // orchestrator snippet without a URL is the same. Better no source than a fake one.
  return null;
}

/**
 * Drop sources no fact cites.
 *
 * A grounded round returns a citation per chunk the model consulted, which is far more
 * than it drew facts from — one run produced 57 sources for 26 facts. sources[] is the
 * citation list the SE actually reads, so unreferenced entries are pure noise.
 */
export function pruneUnreferencedSources(
  sources: SourceRef[],
  facts: ResearchFact[],
): SourceRef[] {
  const used = new Set(facts.map((f) => f.sourceLabel));
  const kept = sources.filter((s) => used.has(s.label));
  return kept.length ? kept : sources;
}

/**
 * Confidence for a source we constructed rather than retrieved. Must stay under the 55 gate
 * used by validate-prep.ts, recent-news.ts and word-limits.ts, so a padded entry can fill the
 * schema's minimum without ever counting as evidence for a claim.
 */
export const SYNTHETIC_SOURCE_CONFIDENCE = 50;

/**
 * PREP_SCHEMA.sources requires minItems 3 (schema.ts:368). Gap-only search can
 * legitimately produce fewer, so top up with entries we know are real before synthesis.
 */
export function padSources(
  sources: SourceRef[],
  ctx: { companyDomain: string; hasSeContext?: boolean; pdfFileNames?: string[] },
  min = 3,
): SourceRef[] {
  if (sources.length >= min) return sources;
  const out = [...sources];
  const has = (url: string) => out.some((s) => s.url === url);
  // Continue past the highest existing number. Scanning for the first *free* slot
  // emitted a low number after a high one (given [S7] it produced S2).
  let n = maxSourceOffset(out);
  const nextLabel = () => `S${++n}`;
  const push = (title: string, url: string, confidence: number) => {
    const source: SourceRef = { label: nextLabel(), title, url, confidence };
    source.displayName = sourceDisplayName(source);
    out.push(source);
  };

  const homepage = `https://${ctx.companyDomain}`;
  if (out.length < min && ctx.companyDomain && !has(homepage)) {
    // Below the shared 55 evidence gate on purpose. This URL is synthesised from the domain and
    // never fetched, so it is a navigational chip, not evidence. At 60 it cleared every gate that
    // asks "is this claim sourced?" — validate-prep (twice), recent-news, and word-limits' band —
    // which let an unverified claim render with a Medium-confidence source it was never read from.
    push("Company website", homepage, SYNTHETIC_SOURCE_CONFIDENCE);
  }
  for (const fileName of ctx.pdfFileNames || []) {
    if (out.length >= min) break;
    const url = `linkedin-pdf:${fileName}`;
    if (!has(url)) push(`LinkedIn PDF — ${fileName}`, url, 90);
  }
  if (out.length < min && ctx.hasSeContext && !has(SE_SOURCE.url)) {
    out.push({ ...SE_SOURCE });
  }
  return out;
}
