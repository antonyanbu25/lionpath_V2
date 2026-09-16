/**
 * Client-side PDF→email matching and parallel /api/contact/enrich calls.
 */

import { matchProspectKaiaExcerpt } from "./kaia-prospect-match.js";

const EMAIL_RE = /[a-z0-9._%+-]+@[a-z0-9.-]+\.[a-z]{2,}/gi;

function normalizeName(s) {
  return String(s || "")
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9\s]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

/** User SE notes only (exclude injected Kaia blocks). */
export function seNotesForEnrich(payload) {
  const raw = payload.seAdditionalContext ?? payload.additionalContext ?? "";
  return String(raw)
    .replace(/\n?\n?Kaia meeting summary:[\s\S]*$/i, "")
    .replace(/\n?\n?Kaia meeting context:[\s\S]*$/i, "")
    .trim();
}

export function extractNameFromPdfText(text) {
  const lines = String(text || "")
    .split(/\n/)
    .map((l) => l.trim())
    .filter(Boolean);
  for (let i = 0; i < lines.length; i++) {
    if (/^contact/i.test(lines[i])) continue;
    if (/linkedin\.com\/in\//i.test(lines[i])) continue;
    if (
      /^(top skills|aptitudes|languages|honors|publications|summary|extracto|experiencia|experience|education|educación)/i.test(
        lines[i],
      )
    ) {
      break;
    }
    if (lines[i].length >= 6 && lines[i].length <= 80 && /[A-Za-z]/.test(lines[i]) && !/@/.test(lines[i])) {
      const words = lines[i].split(/\s+/);
      if (words.length >= 2 && words.length <= 8) return lines[i];
    }
  }
  return null;
}

function findEmailsInText(text) {
  const matches = text.match(EMAIL_RE) || [];
  const seen = new Set();
  const out = [];
  for (const m of matches) {
    const e = m.toLowerCase();
    if (seen.has(e)) continue;
    seen.add(e);
    out.push(e);
  }
  return out;
}

function slugTokensFromLinkedInUrl(text) {
  const m = text.match(/linkedin\.com\/in\/([a-z0-9-]+)/i);
  if (!m) return [];
  return m[1]
    .toLowerCase()
    .split("-")
    .filter((t) => t.length > 2);
}

function localPart(email) {
  return email.split("@")[0]?.replace(/[.+_-]/g, " ").toLowerCase() || "";
}

/** Match PDF text to a prospect email using email-in-text or LinkedIn slug. */
export function matchPdfToProspect(text, emails) {
  const normalizedProspects = emails.map((e) => e.toLowerCase());
  const inText = findEmailsInText(text);
  for (const e of inText) {
    if (normalizedProspects.includes(e)) return e;
  }
  const slugTokens = slugTokensFromLinkedInUrl(text);
  if (slugTokens.length) {
    for (const prospect of normalizedProspects) {
      const local = localPart(prospect).replace(/\s+/g, "");
      const joined = slugTokens.join("");
      if (joined.includes(local) || local.includes(slugTokens[0] || "")) return prospect;
    }
  }
  return null;
}

export function matchPdfToEmail(pdf, emails, hintName) {
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
      const localNorm = normalizeName(localPart(email));
      const pdfParts = normalizeName(pdfName)
        .split(" ")
        .filter((p) => p.length > 2);
      const localParts = localNorm.split(" ").filter(Boolean);
      if (pdfParts.length && localParts.some((lp) => pdfParts.some((pp) => pp.startsWith(lp) || lp.startsWith(pp)))) {
        return email;
      }
    }
  }
  return null;
}

/** Assign each PDF to at most one prospect email (email/slug match, then positional fallback). */
export function assignPdfsToEmails(pdfs, emails) {
  const map = new Map();
  const usedEmails = new Set();
  /** @type {typeof pdfs} */
  const unmatchedPdfs = [];

  for (const pdf of pdfs || []) {
    let email = null;
    for (const e of emails) {
      if (usedEmails.has(e)) continue;
      if (matchPdfToEmail(pdf, [e]) === e) {
        email = e;
        break;
      }
    }
    if (!email) {
      email = matchPdfToProspect(pdf.text, emails.filter((e) => !usedEmails.has(e)));
    }
    if (email && !usedEmails.has(email)) {
      usedEmails.add(email);
      map.set(email.toLowerCase(), pdf);
    } else {
      unmatchedPdfs.push(pdf);
    }
  }

  const remainingEmails = emails.filter((e) => !usedEmails.has(e));
  for (let i = 0; i < unmatchedPdfs.length && i < remainingEmails.length; i++) {
    const email = remainingEmails[i];
    usedEmails.add(email);
    map.set(email.toLowerCase(), unmatchedPdfs[i]);
  }

  return map;
}

/**
 * Run enrich API for each prospect that has sources (sequential to avoid Gemini rate limits).
 * @param {{ enrichUrl: string, getToken?: () => Promise<string>, authEnabled?: boolean }} deps
 */
export async function enrichProspectsParallel(deps, { emails, pdfs, payload, onProgress }) {
  const pdfMap = assignPdfsToEmails(pdfs, emails);
  const zoomExcerpt = payload.zoomTranscriptExcerpt || "";
  const kaiaContent = payload.kaiaContent;
  const kaiaSummaryFallback = payload.kaiaSummary || "";
  const notes = seNotesForEnrich(payload);
  const results = [];

  for (let idx = 0; idx < emails.length; idx++) {
    const email = emails[idx];
    const pdf = pdfMap.get(email.toLowerCase());
    const sources = {};
    if (pdf?.text) sources.linkedinPdf = { fileName: pdf.fileName, text: pdf.text };
    if (zoomExcerpt) sources.zoomTranscriptExcerpt = zoomExcerpt;

    if (kaiaContent?.summary) {
      sources.kaiaSummary = matchProspectKaiaExcerpt({
        email,
        hintName: payload.prospectName,
        bundle: kaiaContent,
      });
    } else if (kaiaSummaryFallback) {
      sources.kaiaSummary = kaiaSummaryFallback;
    }

    if (notes) sources.additionalNotes = notes;

    const hasSource =
      sources.linkedinPdf?.text?.trim() ||
      sources.zoomTranscriptExcerpt?.trim() ||
      sources.kaiaSummary?.trim() ||
      sources.additionalNotes?.trim();
    if (!hasSource) continue;

    onProgress?.(idx + 1, emails.length);

    const headers = { "content-type": "application/json" };
    if (deps.authEnabled && deps.getToken) {
      headers.Authorization = `Bearer ${await deps.getToken()}`;
    }
    try {
      const res = await fetch(deps.enrichUrl, {
        method: "POST",
        headers,
        body: JSON.stringify({
          email,
          companyName: payload.companyName,
          companyDomain: payload.companyDomain,
          sources,
        }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        console.warn(`[prep] enrich failed for ${email}:`, data.error || res.statusText);
        continue;
      }
      results.push(data);
    } catch (err) {
      console.warn(`[prep] enrich error for ${email}:`, err?.message || err);
    }
  }

  return results;
}

/** Map enrich API responses to worker confirmedProspectProfiles shape. */
export function toConfirmedProspectProfiles(enrichResponses) {
  return (enrichResponses || []).map((r) => ({
    email: r.email,
    profile: r.profile,
    disc: r.disc,
    influence: r.influence,
  }));
}

function linkedInSourceLabel(sources) {
  const li = (sources || []).find((s) => /linkedin/i.test(s.label));
  return li?.label || "LinkedIn PDF";
}

function enrichmentSourceLabel(discSource, liLabel) {
  switch (discSource) {
    case "kaia":
      return "Kaia";
    case "merged":
      return "LinkedIn + Kaia";
    case "zoom":
      return "Zoom";
    default:
      return liLabel;
  }
}

/** Drop synthesize-only dos when donts are missing (stale brief / failed enrich). */
export function sanitizeIncompleteDiscHints(prep) {
  if (!prep?.prospects?.length) return prep;
  return {
    ...prep,
    prospects: prep.prospects.map((p) => {
      if (!p.discHint) return p;
      const dos = (p.discHint.dos || []).filter((d) => d && d !== "unknown");
      const donts = (p.discHint.donts || []).filter((d) => d && d !== "unknown");
      if (dos.length > 0 && donts.length === 0) {
        return { ...p, discHint: { ...p.discHint, dos: [], donts: [] } };
      }
      return p;
    }),
  };
}

/** Deterministic merge: enrichment wins over model output (mirrors worker merge-enrichment.ts). */
export function mergeEnrichmentsIntoPrep(prep, emails, enrichments) {
  if (!prep || !enrichments?.length) return prep;

  const byEmail = new Map(enrichments.map((e) => [String(e.email || "").toLowerCase(), e]));
  const prospects = [...(prep.prospects || [])];
  const liLabel = linkedInSourceLabel(prep.sources);

  while (prospects.length < emails.length) {
    prospects.push({
      name: "unknown",
      role: "unknown",
      totalExperience: "unknown",
      priorEmployers: [],
      competitorTouchpoints: [],
      sourceLabel: liLabel,
    });
  }

  for (let i = 0; i < emails.length; i++) {
    const email = String(emails[i] || "").toLowerCase();
    const en = byEmail.get(email);
    if (!en) continue;

    const p = prospects[i] || {};
    const profile = en.profile || {};
    prospects[i] = {
      ...p,
      name: profile.name && profile.name !== "unknown" ? profile.name : p.name,
      role: profile.role && profile.role !== "unknown" ? profile.role : p.role,
      totalExperience:
        profile.totalExperience && profile.totalExperience !== "unknown"
          ? profile.totalExperience
          : p.totalExperience,
      priorEmployers: profile.priorEmployers?.length ? profile.priorEmployers : p.priorEmployers,
      competitorTouchpoints: en ? profile.competitorTouchpoints || [] : p.competitorTouchpoints,
      summary: profile.summary || p.summary,
      skills: profile.skills?.length ? profile.skills : p.skills,
      languages: profile.languages?.length ? profile.languages : p.languages,
      education: profile.education?.length ? profile.education : p.education,
      sourceLabel: enrichmentSourceLabel(en.disc?.source, liLabel),
      discHint: en.disc
        ? (() => {
            const donts = en.disc.donts || [];
            const dos = donts.length ? en.disc.dos || [] : [];
            return {
              primary: en.disc.primary || "unknown",
              secondary: en.disc.secondary,
              confidence: en.disc.confidence || "low",
              evidence: en.disc.evidence || [],
              dos,
              donts,
              inferred: true,
              source: en.disc.source,
            };
          })()
        : p.discHint,
      influence: en.influence || p.influence,
    };
  }

  return { ...prep, prospects };
}

/** When enrich missed a contact, use the matched PDF name for tab labels. */
export function applyPdfNameFallbacks(prep, emails, pdfs) {
  if (!prep || !emails?.length || !pdfs?.length) return prep;
  const pdfMap = assignPdfsToEmails(pdfs, emails);
  const prospects = [...(prep.prospects || [])];
  const liLabel =
    (prep.sources || []).find((s) => /linkedin/i.test(s.label))?.label || "LinkedIn PDF";

  while (prospects.length < emails.length) {
    prospects.push({
      name: "unknown",
      role: "unknown",
      totalExperience: "unknown",
      priorEmployers: [],
      competitorTouchpoints: [],
      sourceLabel: liLabel,
    });
  }

  for (let i = 0; i < emails.length; i++) {
    const pdf = pdfMap.get(String(emails[i]).toLowerCase());
    if (!pdf) continue;
    const p = prospects[i] || {};
    const pdfName = extractNameFromPdfText(pdf.text);
    const nameUnknown = !p.name || String(p.name).trim().toLowerCase() === "unknown";
    if (pdfName && nameUnknown) {
      prospects[i] = {
        ...p,
        name: pdfName,
        sourceLabel: /linkedin/i.test(String(p.sourceLabel || "")) ? p.sourceLabel : liLabel,
      };
    }
  }

  return { ...prep, prospects };
}
