/**
 * LinkedIn PDF exports (SE upload) — match to prospects and extract facts.
 */

import { extractJson } from "../json";
import { getProvider } from "../providers";
import type { Env, PrepInput, ResearchFact, ResearchSnippet, SourceRef } from "./types";

const EMAIL_RE = /[a-z0-9._%+-]+@[a-z0-9.-]+\.[a-z]{2,}/gi;

export interface LinkedInProfileExport {
  fileName: string;
  text: string;
}

export function normalizeLinkedInExports(
  raw: LinkedInProfileExport[] | undefined,
): LinkedInProfileExport[] {
  if (!Array.isArray(raw) || !raw.length) return [];
  const out: LinkedInProfileExport[] = [];
  for (const item of raw.slice(0, 5)) {
    const fileName = String(item?.fileName || "profile.pdf").slice(0, 200);
    let text = String(item?.text || "")
      .replace(/[\x00-\x08\x0b\x0c\x0e-\x1f]/g, " ")
      .trim();
    if (text.length > 20_000) text = text.slice(0, 20_000);
    if (text.length < 40) continue;
    out.push({ fileName, text });
  }
  return out;
}

export function findEmailsInText(text: string): string[] {
  const matches = text.match(EMAIL_RE) || [];
  const seen = new Set<string>();
  const out: string[] = [];
  for (const m of matches) {
    const e = m.toLowerCase();
    if (seen.has(e)) continue;
    seen.add(e);
    out.push(e);
  }
  return out;
}

function slugTokensFromLinkedInUrl(text: string): string[] {
  const m = text.match(/linkedin\.com\/in\/([a-z0-9-]+)/i);
  if (!m) return [];
  return m[1]
    .toLowerCase()
    .split("-")
    .filter((t) => t.length > 2);
}

function localPart(email: string): string {
  return email.split("@")[0]?.replace(/[.+]/g, " ").toLowerCase() || "";
}

/** Match one PDF text to a prospect email from the form list. */
export function matchPdfToProspect(text: string, prospectEmails: string[]): string | null {
  const normalizedProspects = prospectEmails.map((e) => e.toLowerCase());
  const inText = findEmailsInText(text);

  for (const e of inText) {
    if (normalizedProspects.includes(e)) return e;
  }

  const slugTokens = slugTokensFromLinkedInUrl(text);
  if (slugTokens.length) {
    for (const prospect of normalizedProspects) {
      const local = localPart(prospect).replace(/\s+/g, "");
      const joined = slugTokens.join("");
      if (joined.includes(local) || local.includes(slugTokens[0] || "")) {
        return prospect;
      }
    }
  }

  return null;
}

export function assignExportsToProspects(
  exports: LinkedInProfileExport[],
  prospectEmails: string[],
): { assignments: Map<string, string | null>; matchedEmails: Set<string> } {
  const assignments = new Map<string, string | null>();
  const matchedEmails = new Set<string>();
  const usedEmails = new Set<string>();

  for (const exp of exports) {
    let matched = matchPdfToProspect(exp.text, prospectEmails);
    if (matched && usedEmails.has(matched)) matched = null;
    if (matched) {
      usedEmails.add(matched);
      matchedEmails.add(matched);
    }
    assignments.set(exp.fileName, matched);
  }

  return { assignments, matchedEmails };
}

export function emailsWithLinkedInPdfCoverage(matched: Set<string>): string[] {
  return [...matched];
}

export function linkedInPdfSnippets(exports: LinkedInProfileExport[]): ResearchSnippet[] {
  const t = Date.now();
  return exports.map((e) => ({
    query: `linkedin-pdf:${e.fileName}`,
    snippet: e.text.slice(0, 12_000),
    fetchedAt: t,
  }));
}

const PDF_FACTS_SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: ["facts", "sources"],
  properties: {
    facts: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        required: ["key", "value", "sourceLabel", "sourceUrl", "confidence", "category"],
        properties: {
          key: { type: "string" },
          value: { type: "string" },
          sourceLabel: { type: "string" },
          sourceUrl: { type: "string" },
          confidence: { type: "integer" },
          category: { type: "string", enum: ["prospect"] },
        },
      },
    },
    sources: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        required: ["label", "title", "url", "confidence"],
        properties: {
          label: { type: "string" },
          title: { type: "string" },
          url: { type: "string" },
          confidence: { type: "integer" },
        },
      },
    },
  },
} as const;

export async function extractLinkedInPdfFacts(
  env: Env,
  exports: LinkedInProfileExport[],
  assignments: Map<string, string | null>,
): Promise<{ facts: ResearchFact[]; sources: SourceRef[] }> {
  if (!exports.length) return { facts: [], sources: [] };

  const blocks = exports.map((e, i) => {
    const assigned = assignments.get(e.fileName);
    return [
      `--- PDF ${i + 1}: ${e.fileName} ---`,
      assigned ? `Matched prospect email: ${assigned}` : "Matched prospect email: unknown",
      e.text.slice(0, 10_000),
    ].join("\n");
  });

  const provider = getProvider(env);
  const result = await provider.generate({
    system: `Extract prospect facts from LinkedIn PDF export text ONLY. Do not invent.
Output facts with category "prospect". Keys like: Name, Role, Location, Summary, Experience, Skills, Languages, LinkedIn URL.
sourceLabel must be "LinkedIn PDF". sourceUrl: linkedin URL from text or "linkedin-pdf:{filename}".
confidence 85-95. JSON only.`,
    user: blocks.join("\n\n"),
    maxTokens: 3000,
    temperature: 0,
    research: false,
    effort: "low",
    jsonSchema: PDF_FACTS_SCHEMA as unknown as Record<string, unknown>,
  });

  const parsed = extractJson<{ facts: ResearchFact[]; sources: SourceRef[] }>(result.text);
  const facts = (parsed.facts || []).map((f) => ({
    ...f,
    category: "prospect" as const,
    sourceLabel: f.sourceLabel || "LinkedIn PDF",
    confidence: f.confidence ?? 90,
  }));
  const sources = parsed.sources?.length
    ? parsed.sources
    : [{ label: "LinkedIn PDF", title: "SE uploaded LinkedIn export", url: "linkedin-pdf:upload", confidence: 90 }];

  return { facts, sources };
}

export function linkedInFingerprint(exports: LinkedInProfileExport[]): string {
  return exports
    .map((e) => `${e.fileName}:${e.text.length}:${e.text.slice(0, 200)}`)
    .sort()
    .join("|");
}
