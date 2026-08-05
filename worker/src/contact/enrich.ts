/**
 * Per-contact enrichment: LinkedIn PDF (+ optional Zoom/Kaia) → profile + inferred DISC.
 */

import { extractJson } from "../json";
import { getProviderForPass } from "../providers";
import type { Env } from "../prep/types";
import { fetchKaiaSummary } from "../kaia/fetchShareContent";
import { isKaiaEngageShareUrl } from "../kaia/shareLink";
import {
  ENRICH_LIMIT_KAIA,
  ENRICH_LIMIT_LINKEDIN,
  ENRICH_LIMIT_NOTES,
  ENRICH_LIMIT_ZOOM,
} from "./enrich-limits";
import { matchPdfToProspect } from "../prep/linkedin-pdf";

export interface ContactEnrichSources {
  linkedinPdf?: { fileName: string; text: string };
  zoomTranscriptExcerpt?: string;
  kaiaSummary?: string;
  /** Resolve server-side via public Engage share link when summary is omitted. */
  kaiaMeetingUrl?: string;
  additionalNotes?: string;
}

export interface ContactEnrichRequest {
  email: string;
  name?: string;
  companyName?: string;
  companyDomain?: string;
  sources: ContactEnrichSources;
  userId?: string;
  callId?: string;
}

export interface ContactEnrichProfile {
  name: string;
  role: string;
  totalExperience: string;
  priorEmployers: string[];
  summary: string;
  skills: string[];
  languages: string[];
  education: string[];
  linkedinUrl?: string;
  competitorTouchpoints: string[];
}

export interface ContactEnrichDisc {
  primary: "D" | "I" | "S" | "C" | "unknown";
  secondary?: string;
  confidence: "low" | "medium";
  evidence: string[];
  /** 3 dos + 3 don'ts for running the call with this person, from the DISC read. */
  dos?: string[];
  donts?: string[];
  inferred: true;
  source: "linkedin_pdf" | "zoom" | "kaia" | "merged";
}

export interface ContactEnrichResponse {
  email: string;
  profile: ContactEnrichProfile;
  disc: ContactEnrichDisc;
  influence?: { level: "high" | "medium" | "low" | "unknown"; decisionRole: string };
}

const ENRICH_SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: ["profile", "disc", "influence"],
  properties: {
    profile: {
      type: "object",
      additionalProperties: false,
      required: [
        "name",
        "role",
        "totalExperience",
        "priorEmployers",
        "summary",
        "skills",
        "languages",
        "education",
        "competitorTouchpoints",
      ],
      properties: {
        name: { type: "string" },
        role: { type: "string" },
        totalExperience: { type: "string" },
        priorEmployers: { type: "array", maxItems: 6, items: { type: "string" } },
        summary: { type: "string" },
        skills: { type: "array", maxItems: 8, items: { type: "string" } },
        languages: { type: "array", maxItems: 6, items: { type: "string" } },
        education: { type: "array", maxItems: 4, items: { type: "string" } },
        linkedinUrl: { type: "string" },
        competitorTouchpoints: { type: "array", maxItems: 4, items: { type: "string" } },
      },
    },
    disc: {
      type: "object",
      additionalProperties: false,
      required: ["primary", "confidence", "evidence", "inferred", "source", "dos", "donts"],
      properties: {
        primary: { type: "string", enum: ["D", "I", "S", "C", "unknown"] },
        secondary: { type: "string", enum: ["D", "I", "S", "C", "unknown"] },
        confidence: { type: "string", enum: ["low", "medium"] },
        evidence: { type: "array", maxItems: 4, items: { type: "string" } },
        dos: { type: "array", minItems: 3, maxItems: 3, items: { type: "string" } },
        donts: { type: "array", minItems: 3, maxItems: 3, items: { type: "string" } },
        inferred: { type: "boolean" },
        source: { type: "string", enum: ["linkedin_pdf", "zoom", "kaia", "merged"] },
      },
    },
    influence: {
      type: "object",
      additionalProperties: false,
      required: ["level", "decisionRole"],
      properties: {
        level: { type: "string", enum: ["high", "medium", "low", "unknown"] },
        decisionRole: { type: "string" },
      },
    },
  },
} as const;

export { ENRICH_SCHEMA };

function normalizeName(s: string): string {
  return String(s || "")
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9\s]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

/** Extract likely person name from LinkedIn PDF text (line after Contact block). */
export function extractNameFromPdfText(text: string): string | null {
  const lines = text.split(/\n/).map((l) => l.trim()).filter(Boolean);
  for (let i = 0; i < lines.length; i++) {
    if (/^contact/i.test(lines[i])) continue;
    if (/linkedin\.com\/in\//i.test(lines[i])) continue;
    if (/^(top skills|aptitudes|languages|honors|publications|summary|extracto|experiencia|experience|education|educación)/i.test(lines[i])) {
      break;
    }
    if (lines[i].length >= 6 && lines[i].length <= 80 && /[A-Za-z]/.test(lines[i]) && !/@/.test(lines[i])) {
      const words = lines[i].split(/\s+/);
      if (words.length >= 2 && words.length <= 8) return lines[i];
    }
  }
  return null;
}

/** Match PDF export to prospect email using email, slug, or name. */
export function matchPdfToEmail(
  pdf: { fileName: string; text: string },
  emails: string[],
  hintName?: string,
): string | null {
  const byEmail = matchPdfToProspect(pdf.text, emails);
  if (byEmail) return byEmail;

  const pdfName = extractNameFromPdfText(pdf.text);
  const targetNorm = hintName ? normalizeName(hintName) : "";

  if (pdfName && targetNorm) {
    const pdfNorm = normalizeName(pdfName);
    if (pdfNorm === targetNorm || pdfNorm.includes(targetNorm) || targetNorm.includes(pdfNorm)) {
      return emails[0] || null;
    }
  }

  if (pdfName) {
    for (const email of emails) {
      const local = email.split("@")[0]?.replace(/[.+_-]/g, " ");
      const localNorm = normalizeName(local);
      const pdfNorm = normalizeName(pdfName);
      const pdfParts = pdfNorm.split(" ").filter((p) => p.length > 2);
      const localParts = localNorm.split(" ").filter(Boolean);
      if (pdfParts.length && localParts.some((lp) => pdfParts.some((pp) => pp.startsWith(lp) || lp.startsWith(pp)))) {
        return email;
      }
    }
  }

  return null;
}

/** Assign PDFs to emails (max one PDF per email). */
export function assignPdfsToEmails(
  pdfs: { fileName: string; text: string }[],
  emails: string[],
): Map<string, { fileName: string; text: string }> {
  const map = new Map<string, { fileName: string; text: string }>();
  const used = new Set<string>();

  for (const pdf of pdfs) {
    let email: string | null = null;
    for (const e of emails) {
      if (used.has(e)) continue;
      if (matchPdfToEmail(pdf, [e], undefined) === e) {
        email = e;
        break;
      }
    }
    if (!email) email = matchPdfToProspect(pdf.text, emails.filter((e) => !used.has(e)));
    if (email && !used.has(email)) {
      used.add(email);
      map.set(email, pdf);
    }
  }
  return map;
}

function hasAnySource(sources: ContactEnrichSources): boolean {
  return !!(
    sources.linkedinPdf?.text?.trim() ||
    sources.zoomTranscriptExcerpt?.trim() ||
    sources.kaiaSummary?.trim() ||
    sources.kaiaMeetingUrl?.trim() ||
    sources.additionalNotes?.trim()
  );
}

function buildUserPrompt(req: ContactEnrichRequest): string {
  const parts: string[] = [
    `Prospect email: ${req.email}`,
    req.name ? `Hint name: ${req.name}` : "",
    req.companyName ? `Company: ${req.companyName}` : "",
    req.companyDomain ? `Domain: ${req.companyDomain}` : "",
    "",
  ];

  if (req.sources.linkedinPdf?.text) {
    parts.push(`--- LinkedIn PDF (${req.sources.linkedinPdf.fileName}) ---`);
    parts.push(req.sources.linkedinPdf.text.slice(0, ENRICH_LIMIT_LINKEDIN));
    parts.push("");
  }
  if (req.sources.zoomTranscriptExcerpt) {
    parts.push("--- Zoom transcript excerpt ---");
    parts.push(req.sources.zoomTranscriptExcerpt.slice(0, ENRICH_LIMIT_ZOOM));
    parts.push("");
  }
  if (req.sources.kaiaSummary) {
    parts.push("--- Kaia meeting summary ---");
    parts.push(req.sources.kaiaSummary.slice(0, ENRICH_LIMIT_KAIA));
    parts.push("");
  }
  if (req.sources.additionalNotes) {
    parts.push("--- Additional notes ---");
    parts.push(req.sources.additionalNotes.slice(0, ENRICH_LIMIT_NOTES));
  }

  return parts.filter(Boolean).join("\n");
}

function inferDiscSource(sources: ContactEnrichSources): "linkedin_pdf" | "zoom" | "kaia" | "merged" {
  const hasLi = !!sources.linkedinPdf?.text?.trim();
  const hasZoom = !!sources.zoomTranscriptExcerpt?.trim();
  const hasKaia = !!sources.kaiaSummary?.trim();
  const count = [hasLi, hasZoom, hasKaia].filter(Boolean).length;
  if (count > 1) return "merged";
  if (hasZoom) return "zoom";
  if (hasKaia) return "kaia";
  return "linkedin_pdf";
}

async function resolveEnrichSources(sources: ContactEnrichSources): Promise<ContactEnrichSources> {
  const next = { ...sources };
  if (!next.kaiaSummary?.trim() && next.kaiaMeetingUrl?.trim()) {
    if (!isKaiaEngageShareUrl(next.kaiaMeetingUrl)) {
      throw Object.assign(new Error("Invalid Kaia meeting URL (engage.freshworks.com share links only)."), {
        status: 400,
      });
    }
    const fetched = await fetchKaiaSummary(next.kaiaMeetingUrl.trim());
    if (!fetched.ok) {
      throw Object.assign(
        new Error(
          fetched.reason === "forbidden" || fetched.reason === "auth_required"
            ? "This Kaia link requires login; use a public share link or paste summary in Additional context."
            : "Could not fetch Kaia summary from the share link.",
        ),
        { status: 400 },
      );
    }
    next.kaiaSummary = fetched.text;
  }
  return next;
}

export async function enrichContact(env: Env, req: ContactEnrichRequest): Promise<ContactEnrichResponse> {
  const email = String(req.email || "")
    .trim()
    .toLowerCase();
  if (!email || !email.includes("@")) {
    throw Object.assign(new Error("Valid email is required."), { status: 400 });
  }
  const sources = await resolveEnrichSources(req.sources);
  if (!hasAnySource(sources)) {
    throw Object.assign(new Error("At least one source (linkedinPdf, zoom, kaia, or notes) is required."), {
      status: 400,
    });
  }

  const discSource = inferDiscSource(sources);
  const linkedInOnly = discSource === "linkedin_pdf";
  const kaiaSpeakerScoped = !!req.sources.kaiaSummary?.includes("Speaker-specific segments:");

  const provider = getProviderForPass("contact/enrich", env);
  const enrichPrompt = {
    system: `You extract a prospect profile and infer DISC from provided text ONLY. Do not invent employers, dates, or traits not supported by the text.

Profile: fill name, role, totalExperience (e.g. "28+ years" from Experience section), priorEmployers (company names from Experience, max 6), summary (2-4 sentences), skills, languages, education lines, linkedinUrl if present. competitorTouchpoints ONLY if support tools (Zendesk, Intercom, etc.) are mentioned; else [].

DISC: This is an INFERRED behavioral guess, NOT a formal assessment. primary must be D, I, S, or C (or unknown if insufficient). Include 1-4 short evidence quotes from the source text. confidence: low unless multiple consistent cues; medium only with strong textual evidence. ${linkedInOnly ? "LinkedIn-only sources: confidence MUST be low or medium, never high." : "If Zoom/Kaia dialogue present, medium is allowed for DISC."}
${kaiaSpeakerScoped ? "Kaia excerpt is speaker-scoped: use ONLY quotes from speaker-specific segments for DISC evidence when present." : ""}
dos / donts: REQUIRED — exactly 3 items in each array. How to run THIS conversation given the DISC read. Imperative, max 12 words, specific to this person's evidence. A do is a behaviour that lands with them; a dont is one that loses them. Not restatements of the DISC letter, and not generic sales advice. The donts array must contain 3 distinct anti-patterns — never leave donts empty.
source field: ${discSource}
inferred: true

Influence: from job title — GM/Director/VP → high + economic_buyer or champion; assistant/analyst → medium/low.

Output JSON only.`,
    user: buildUserPrompt({ ...req, sources }),
    maxTokens: 3500,
    temperature: 0,
    research: false,
    effort: "low" as const,
    jsonSchema: ENRICH_SCHEMA as unknown as Record<string, unknown>,
    passName: "contact/enrich",
    userId: req.userId,
    callId: req.callId,
  };

  let result = await provider.generate(enrichPrompt);
  let parsed = extractJson<{
    profile: ContactEnrichProfile;
    disc: ContactEnrichDisc;
    influence: { level: string; decisionRole: string };
  }>(result.text);

  if ((parsed.disc?.donts?.length ?? 0) < 3) {
    result = await provider.generate({
      ...enrichPrompt,
      user: `${enrichPrompt.user}\n\nRETRY: Your previous response omitted disc.donts or had fewer than 3. Return valid JSON with disc.dos AND disc.donts each containing exactly 3 strings.`,
    });
    parsed = extractJson<typeof parsed>(result.text);
  }

  const disc = parsed.disc || ({} as ContactEnrichDisc);
  disc.inferred = true;
  disc.source = discSource;
  if (linkedInOnly && (disc.confidence as string) === "high") disc.confidence = "medium";

  return {
    email,
    profile: parsed.profile || {
      name: req.name || "unknown",
      role: "unknown",
      totalExperience: "unknown",
      priorEmployers: [],
      summary: "",
      skills: [],
      languages: [],
      education: [],
      competitorTouchpoints: [],
    },
    disc,
    influence: parsed.influence as ContactEnrichResponse["influence"],
  };
}

/** Stub: fetch Zoom transcript excerpt for enrich (not configured). */
export async function fetchZoomExcerptForEnrich(
  _url: string,
  _passcode?: string,
): Promise<{ ok: false; reason: string } | { ok: true; text: string }> {
  return { ok: false, reason: "not_configured" };
}

export { fetchKaiaSummary } from "../kaia/fetchShareContent";
