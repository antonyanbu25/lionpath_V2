import type { KaiaShareBundle } from "../prep/types";
import { ENRICH_LIMIT_KAIA } from "../contact/enrich-limits";
import { extractTextFromSummaryJson, formatKaiaMetadataHeader } from "./fetchShareContent";

type SummaryJsonBlock = {
  name?: string;
  type?: string;
  result?: {
    stringOutput?: string;
    listKeyPoints?: Array<{
      title?: string;
      points?: Array<{ text?: string; sources?: Array<{ speaker?: { name?: string } }> }>;
    }>;
  };
};

function normalizeToken(s: string): string {
  return String(s || "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

function tokens(s: string): string[] {
  return normalizeToken(s).split(/\s+/).filter(Boolean);
}

function emailLocalPart(email: string): string {
  const at = email.indexOf("@");
  return at >= 0 ? email.slice(0, at).toLowerCase() : email.toLowerCase();
}

/** Conservative speaker ↔ prospect match (allowlist heuristics only). */
export function prospectMatchesSpeaker(
  email: string,
  hintName: string | undefined,
  speakerName: string,
): boolean {
  const speakerNorm = normalizeToken(speakerName);
  if (!speakerNorm) return false;

  const local = emailLocalPart(email).replace(/[._-]/g, " ");
  const localTokens = tokens(local);
  const speakerToks = tokens(speakerName);

  if (local && (speakerNorm.includes(normalizeToken(local)) || normalizeToken(local).includes(speakerNorm))) {
    return true;
  }

  for (const lt of localTokens) {
    if (lt.length >= 3 && speakerToks.some((st) => st === lt || st.startsWith(lt) || lt.startsWith(st))) {
      return true;
    }
  }

  const hint = hintName?.trim();
  if (hint) {
    const hintToks = tokens(hint);
    const overlap = hintToks.filter((t) => t.length >= 2 && speakerToks.includes(t));
    if (overlap.length >= 1 && overlap.length >= Math.min(2, hintToks.length)) return true;
    if (hintToks.length === 1 && speakerToks.includes(hintToks[0])) return true;
  }

  return false;
}

function parseSummaryBlocks(summaryJson: string | undefined): SummaryJsonBlock[] {
  if (!summaryJson?.trim()) return [];
  try {
    const blocks = JSON.parse(summaryJson) as SummaryJsonBlock[];
    return Array.isArray(blocks) ? blocks : [];
  } catch {
    return [];
  }
}

function extractOutcome(blocks: SummaryJsonBlock[]): string {
  for (const block of blocks) {
    const name = (block.name || block.type || "").toLowerCase();
    if (name.includes("outcome")) {
      return block.result?.stringOutput?.trim() || "";
    }
  }
  return "";
}

function extractMatchedSpeakerSections(blocks: SummaryJsonBlock[], email: string, hintName?: string): string[] {
  const sections: string[] = [];
  for (const block of blocks) {
    const lists = block.result?.listKeyPoints;
    if (!lists?.length) continue;
    for (const section of lists) {
      const matchedPoints: string[] = [];
      for (const pt of section.points || []) {
        const speakers = (pt.sources || []).map((s) => s.speaker?.name || "").filter(Boolean);
        if (speakers.some((sp) => prospectMatchesSpeaker(email, hintName, sp))) {
          if (pt.text?.trim()) matchedPoints.push(`- ${pt.text.trim()}`);
        }
      }
      if (matchedPoints.length) {
        sections.push([section.title, ...matchedPoints].filter(Boolean).join("\n"));
      }
    }
  }
  return sections;
}

export interface MatchProspectExcerptOptions {
  email: string;
  hintName?: string;
  bundle: KaiaShareBundle;
}

/**
 * Build per-prospect Kaia excerpt for enrich (speaker-tagged blocks when matched).
 */
export function matchProspectKaiaExcerpt(options: MatchProspectExcerptOptions): string {
  const { email, hintName, bundle } = options;
  const header = formatKaiaMetadataHeader(bundle);
  const blocks = parseSummaryBlocks(bundle.summaryJson);
  const outcome = extractOutcome(blocks);
  const speakerSections = extractMatchedSpeakerSections(blocks, email, hintName);

  const parts: string[] = [];
  if (header) parts.push(header);
  if (outcome) parts.push(`Outcome:\n${outcome.slice(0, 2000)}`);

  if (speakerSections.length) {
    parts.push("Speaker-specific segments:\n" + speakerSections.join("\n\n"));
  } else if (bundle.summary) {
    parts.push(
      "No speaker-specific Kaia segments matched this email; using meeting-level summary.\n\n" +
        bundle.summary,
    );
  }

  return parts.join("\n\n").trim().slice(0, ENRICH_LIMIT_KAIA);
}
