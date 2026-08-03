import { extractNameFromPdfText } from "../contact/enrich";
import { assignExportsToProspects, type LinkedInProfileExport } from "./linkedin-pdf";
import type { Prep } from "../schema";

function linkedInSourceLabel(sources: Prep["sources"]): string {
  const li = (sources || []).find((s) => /linkedin/i.test(s.label));
  return li?.label || "LinkedIn PDF";
}

function exportsByEmail(
  exports: LinkedInProfileExport[],
  emails: string[],
): Map<string, LinkedInProfileExport> {
  const { assignments } = assignExportsToProspects(exports, emails.map((e) => e.toLowerCase()));
  const byEmail = new Map<string, LinkedInProfileExport>();
  for (const exp of exports) {
    const email = assignments.get(exp.fileName);
    if (email) byEmail.set(email.toLowerCase(), exp);
  }
  return byEmail;
}

/** Fill unknown prospect names from assigned LinkedIn PDF exports. */
export function applyPdfNameFallbacks(
  prep: Prep,
  emails: string[],
  exports: LinkedInProfileExport[] | undefined,
): Prep {
  const normalized = (exports || []).filter((e) => e.text?.trim().length >= 40);
  if (!normalized.length || !emails.length) return prep;

  const pdfMap = exportsByEmail(normalized, emails);
  const prospects = [...(prep.prospects || [])];
  const liLabel = linkedInSourceLabel(prep.sources);

  while (prospects.length < emails.length) {
  // sourceLabel deliberately absent. These are seats padded to match the typed email count —
  // no LinkedIn PDF was attached for them. Stamping a "LinkedIn PDF" label made
  // isLinkedInEnrichedProspect() report true for a profile that does not exist, which is why the
  // room rendered a DISC grid and "Inferred from LinkedIn PDF" for an unknown/unknown seat.
    prospects.push({
      name: "unknown",
      role: "unknown",
      totalExperience: "unknown",
      priorEmployers: [],
      competitorTouchpoints: [],
      sourceLabel: "",
    });
  }

  for (let i = 0; i < emails.length; i++) {
    const exp = pdfMap.get(emails[i].toLowerCase());
    if (!exp) continue;
    const p = prospects[i] || ({} as Prep["prospects"][0]);
    const pdfName = extractNameFromPdfText(exp.text);
    const name = String(p.name || "").trim().toLowerCase();
    if (pdfName && (!name || name === "unknown")) {
      prospects[i] = {
        ...p,
        name: pdfName,
        sourceLabel: /linkedin/i.test(String(p.sourceLabel || "")) ? p.sourceLabel! : liLabel,
      };
    }
  }

  return { ...prep, prospects };
}
