import type {
  CompanyResearchFragment,
  PersonResearchFragment,
  ResearchCompanyPage,
  ValidatedProspectResearch,
  ValidatedResearchContext,
} from "./types";

function trimWords(text: string, max: number): string {
  const words = String(text ?? "")
    .trim()
    .split(/\s+/)
    .filter(Boolean);
  if (words.length <= max) return words.join(" ");
  return words.slice(0, max).join(" ");
}

function isBlank(v: unknown): boolean {
  const s = String(v ?? "").trim();
  return !s || s === "-" || s.toLowerCase() === "unknown";
}

function pickBest<T>(values: (T | undefined)[], score: (v: T) => number): T | undefined {
  let best: T | undefined;
  let bestScore = -1;
  for (const v of values) {
    if (v === undefined) continue;
    const s = score(v);
    if (s > bestScore) {
      best = v;
      bestScore = s;
    }
  }
  return best;
}

function dedupeStrings(items: string[], max: number): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const raw of items) {
    const s = raw.trim();
    if (!s) continue;
    const key = s.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(s);
    if (out.length >= max) break;
  }
  return out;
}

function synthesizeExperienceSummary(input: {
  experienceSummary?: string;
  totalExperience?: string;
  role?: string;
  priorEmployers?: string[];
  snippets?: string[];
}): string {
  if (!isBlank(input.experienceSummary)) {
    return trimWords(String(input.experienceSummary), 20);
  }
  const parts: string[] = [];
  if (!isBlank(input.totalExperience)) parts.push(String(input.totalExperience));
  if (!isBlank(input.role)) parts.push(String(input.role));
  if (input.priorEmployers?.length) {
    parts.push(`experience at ${input.priorEmployers.slice(0, 2).join(", ")}`);
  }
  if (!parts.length && input.snippets?.length) {
    parts.push(input.snippets[0].slice(0, 80));
  }
  return parts.length ? trimWords(parts.join("; "), 20) : "unknown";
}

/** Phase 2 — merge person fragments with fallback priority: LinkedIn/web → ZoomInfo → company context. */
export function validateProspectResearch(
  email: string,
  fragments: PersonResearchFragment[],
  sourceLabel: string,
): ValidatedProspectResearch {
  const bySource = (src: string) => fragments.filter((f) => f.source === src);
  const linkedIn = bySource("linkedin_search");
  const web = bySource("web_search");
  const zoom = bySource("zoominfo");

  const ordered = [...linkedIn, ...web, ...zoom, ...fragments];
  const best = (field: keyof PersonResearchFragment) =>
    pickBest(
      ordered.map((f) => f[field] as string | undefined),
      (v) => {
        const frag = ordered.find((f) => f[field] === v);
        return frag?.confidence ?? 0;
      },
    );

  const name = best("name") || email.split("@")[0] || "unknown";
  const role = best("role") || "unknown";
  const totalExperience = best("totalExperience") || "unknown";

  const priorEmployers = dedupeStrings(
    ordered.flatMap((f) => f.priorEmployers || []),
    4,
  );
  const competitorTouchpoints = dedupeStrings(
    ordered.flatMap((f) => f.competitorTouchpoints || []),
    4,
  );

  const snippets = ordered.flatMap((f) => f.snippets || []);
  const experienceSummary = synthesizeExperienceSummary({
    experienceSummary: best("experienceSummary"),
    totalExperience,
    role,
    priorEmployers,
    snippets,
  });

  const topFrag = ordered[0];
  const confidence = Math.max(...ordered.map((f) => f.confidence), 0);

  return {
    email,
    name: isBlank(name) ? "unknown" : trimWords(name, 6),
    role: isBlank(role) ? "unknown" : trimWords(role, 8),
    totalExperience: isBlank(totalExperience) ? "unknown" : trimWords(totalExperience, 6),
    experienceSummary,
    priorEmployers,
    competitorTouchpoints,
    sourceLabel,
    sourceUrl: topFrag?.url || "unknown",
    confidence,
  };
}

export function buildResearchPromptBlock(
  companySnippets: string[],
  prospects: ValidatedProspectResearch[],
): string {
  const lines = [
    "=== PRE-RESEARCH CONTEXT (use for prospects[] — do NOT leave experienceSummary unknown when data exists below) ===",
  ];

  if (companySnippets.length) {
    lines.push("", "Company web snippets:");
    companySnippets.slice(0, 3).forEach((s, i) => lines.push(`  C${i + 1}: ${s.slice(0, 400)}`));
  }

  for (const p of prospects) {
    lines.push(
      "",
      `Prospect ${p.email}:`,
      `  name: ${p.name}`,
      `  role: ${p.role}`,
      `  totalExperience: ${p.totalExperience}`,
      `  experienceSummary: ${p.experienceSummary}`,
      `  priorEmployers: ${p.priorEmployers.join(", ") || "none"}`,
      `  competitorTouchpoints: ${p.competitorTouchpoints.join(", ") || "none"}`,
      `  source: ${p.sourceLabel} (${p.sourceUrl})`,
    );
  }

  lines.push(
    "",
    "When pre-research has role/experience/employers, copy into prospects[] fields verbatim (respect word caps).",
    "=== END PRE-RESEARCH ===",
  );
  return lines.join("\n");
}

export function validateResearchContext(
  emails: string[],
  personFragments: PersonResearchFragment[],
  companyFragments: CompanyResearchFragment[],
): ValidatedResearchContext {
  const companySnippets = dedupeStrings(companyFragments.flatMap((f) => f.snippets), 5);

  // Keep each snippet attributed to the page it came from. The flatMap above drops
  // fragment.url, which is why company-web facts reached the brief with no verifiable
  // source URL. `companyPages` is declared on ValidatedResearchContext but nothing filled
  // it, so orchestrator-bridge always took its unattributed fallback.
  const seenSnippets = new Set<string>();
  const companyPages: ResearchCompanyPage[] = [];
  for (const frag of companyFragments) {
    if (!frag.url) continue;
    for (const snippet of frag.snippets) {
      const text = String(snippet || "").trim();
      if (!text || seenSnippets.has(text)) continue;
      seenSnippets.add(text);
      companyPages.push({ url: frag.url, snippet: text, confidence: frag.confidence });
    }
  }

  const prospects = emails.map((email, i) => {
    const frags = personFragments.filter((f) => f.email === email);
    const sourceLabel = `R${i + 1}`;
    return validateProspectResearch(email, frags, sourceLabel);
  });

  return {
    companySnippets,
    ...(companyPages.length ? { companyPages } : {}),
    prospects,
    promptBlock: buildResearchPromptBlock(companySnippets, prospects),
  };
}

/** Backfill parsed prep prospects when LLM omitted experience fields but pre-research found them. */
export function enrichPrepProspectsFromResearch(
  prospects: ValidatedProspectResearch[],
  prepProspects: Array<{
    name?: string;
    role?: string;
    totalExperience?: string;
    experienceSummary?: string;
    priorEmployers?: string[];
    competitorTouchpoints?: string[];
    sourceLabel?: string;
  }>,
): void {
  for (let i = 0; i < prepProspects.length; i++) {
    const p = prepProspects[i];
    const r = prospects[i] || prospects.find((x) => x.email === (p as { email?: string }).email);
    if (!r) continue;

    if (isBlank(p.name) && !isBlank(r.name)) p.name = r.name;
    if (isBlank(p.role) && !isBlank(r.role)) p.role = r.role;
    if (isBlank(p.totalExperience) && !isBlank(r.totalExperience)) p.totalExperience = r.totalExperience;
    if (isBlank(p.experienceSummary) && !isBlank(r.experienceSummary)) {
      p.experienceSummary = r.experienceSummary;
    }
    if (!(p.priorEmployers?.length) && r.priorEmployers.length) {
      p.priorEmployers = [...r.priorEmployers];
    }
    if (!(p.competitorTouchpoints?.length) && r.competitorTouchpoints.length) {
      p.competitorTouchpoints = [...r.competitorTouchpoints];
    }
    if (isBlank(p.sourceLabel) && r.sourceLabel) p.sourceLabel = r.sourceLabel;
  }
}

export { synthesizeExperienceSummary };
