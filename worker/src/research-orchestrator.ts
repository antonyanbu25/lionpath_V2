import { fetchCompanyWeb } from "./research/providers/company-web";
import { searchPersonWeb } from "./research/providers/person-search";
import { fetchZoomInfoPerson } from "./research/providers/zoominfo";
import type { PersonResearchFragment, ResearchEnv, ResearchInput, ValidatedResearchContext } from "./research/types";
import { validateResearchContext } from "./research/validate";

export type { ResearchEnv, ResearchInput, ValidatedResearchContext } from "./research/types";
export { enrichPrepProspectsFromResearch, synthesizeExperienceSummary } from "./research/validate";

/**
 * Two-phase research orchestrator:
 *   Phase 1 RESEARCH — parallel fetches (company web, LinkedIn/web person search, ZoomInfo fallback)
 *   Phase 2 VALIDATION — merge, dedupe, synthesize experienceSummary for prep prompt injection
 */
export async function runResearch(
  env: ResearchEnv,
  input: ResearchInput,
): Promise<ValidatedResearchContext> {
  const { companyName, domain, emails, prospectName } = input;

  // Phase 1: RESEARCH (parallel)
  const [companyFragments, ...personResults] = await Promise.all([
    fetchCompanyWeb(companyName, domain),
    ...emails.map(async (email) => {
      const fragments: PersonResearchFragment[] = [];

      // Primary: LinkedIn / Google-style web search
      const webHits = await searchPersonWeb(email, companyName, prospectName);
      fragments.push(...webHits);

      // Fallback: ZoomInfo when LinkedIn/web did not yield experience data
      const hasExperience = webHits.some(
        (h) =>
          h.experienceSummary ||
          h.role ||
          h.priorEmployers?.length ||
          h.totalExperience,
      );
      if (!hasExperience) {
        const zi = await fetchZoomInfoPerson(env, email, companyName, prospectName);
        if (zi) fragments.push(zi);
      }

      // Last resort: company-site context tagged to primary prospect email
      return fragments;
    }),
  ]);

  const personFragments = personResults.flat();

  // Phase 2: VALIDATION
  return validateResearchContext(emails, personFragments, companyFragments);
}

