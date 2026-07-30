import type { ContactEnrichDisc, ContactEnrichProfile, ContactEnrichResponse } from "../contact/enrich";
import type { Prep, ProspectProfile } from "../schema";

export interface ConfirmedProspectProfile {
  email: string;
  profile: ContactEnrichProfile;
  disc: ContactEnrichDisc;
  influence?: { level: "high" | "medium" | "low" | "unknown"; decisionRole: string };
}

function linkedInSourceLabel(sources: Prep["sources"]): string {
  const li = sources.find((s) => /linkedin/i.test(s.label));
  return li?.label || "LinkedIn PDF";
}

function enrichmentSourceLabel(
  discSource: ContactEnrichDisc["source"] | undefined,
  liLabel: string,
): string {
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

/** Deterministic merge: enrichment wins over model output for matching emails (by index). */
export function mergeEnrichmentsIntoPrep(
  prep: Prep,
  emails: string[],
  enrichments: ConfirmedProspectProfile[],
): Prep {
  if (!enrichments.length) return prep;

  const byEmail = new Map(enrichments.map((e) => [e.email.toLowerCase(), e]));
  const prospects = [...(prep.prospects || [])];
  const liLabel = linkedInSourceLabel(prep.sources || []);

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
    const email = emails[i].toLowerCase();
    const en = byEmail.get(email);
    if (!en) continue;

    const p = prospects[i] || ({} as ProspectProfile);
    const profile = en.profile;
    prospects[i] = {
      ...p,
      name: profile.name && profile.name !== "unknown" ? profile.name : p.name,
      role: profile.role && profile.role !== "unknown" ? profile.role : p.role,
      totalExperience:
        profile.totalExperience && profile.totalExperience !== "unknown"
          ? profile.totalExperience
          : p.totalExperience,
      priorEmployers: profile.priorEmployers?.length ? profile.priorEmployers : p.priorEmployers,
      competitorTouchpoints: profile.competitorTouchpoints?.length
        ? profile.competitorTouchpoints
        : p.competitorTouchpoints,
      summary: profile.summary || p.summary,
      skills: profile.skills?.length ? profile.skills : p.skills,
      languages: profile.languages?.length ? profile.languages : p.languages,
      education: profile.education?.length ? profile.education : p.education,
      sourceLabel: enrichmentSourceLabel(en.disc.source, liLabel),
      discHint: {
        primary: en.disc.primary || "unknown",
        secondary: en.disc.secondary,
        confidence: en.disc.confidence || "low",
        evidence: en.disc.evidence || [],
        inferred: true,
        source: en.disc.source,
      },
      influence: en.influence || p.influence,
    };
  }

  return { ...prep, prospects };
}

export function enrichResponsesToConfirmed(
  responses: ContactEnrichResponse[],
): ConfirmedProspectProfile[] {
  return responses.map((r) => ({
    email: r.email,
    profile: r.profile,
    disc: r.disc,
    influence: r.influence,
  }));
}
