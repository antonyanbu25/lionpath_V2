import { normalizeAccountSlug } from "../domain-model/account";
import { enrichWithApollo } from "../enrichment/apollo";
import { computeInputHash, normalizePrepInput, resolveProspectEmails } from "./normalize-input";
import { runPlaybookResearch } from "./research";
import { extractFacts } from "./extract-facts";
import { synthesizePrep } from "./synthesize";
import { validatePrep, findLowConfidenceFacts } from "./validate-prep";
import { buildResearchBundle, resolveCachedResearch } from "./cache";
import {
  assignExportsToProspects,
  linkedInPdfSnippets,
  normalizeLinkedInExports,
} from "./linkedin-pdf";
import { mergeEnrichmentsIntoPrep } from "./merge-enrichment";
import type { ConfirmedProspectProfile } from "./merge-enrichment";
import type {
  Env,
  PrepInput,
  PrepResult,
  ResearchFact,
  ResearchMeta,
  ResearchOnlyResult,
  SourceRef,
} from "./types";

export { resolveProspectEmails, deriveDomain, normalizePrepInput, computeInputHash } from "./normalize-input";
export type { PrepInput, PrepResult, ResearchOnlyResult, Env } from "./types";

const ALLOWED_EFFORT = ["low", "medium", "high", "xhigh", "max"];

function mergeFacts(...groups: ResearchFact[][]): ResearchFact[] {
  const seen = new Set<string>();
  const out: ResearchFact[] = [];
  for (const group of groups) {
    for (const f of group) {
      const key = `${f.category || ""}:${f.key}:${f.value}`;
      if (seen.has(key)) continue;
      seen.add(key);
      out.push(f);
    }
  }
  return out;
}

function mergeSources(...groups: SourceRef[][]): SourceRef[] {
  const byLabel = new Map<string, SourceRef>();
  for (const group of groups) {
    for (const s of group) {
      if (!byLabel.has(s.label)) byLabel.set(s.label, s);
    }
  }
  return [...byLabel.values()];
}

async function gatherResearch(
  env: Env,
  input: PrepInput,
  emails: string[],
): Promise<{
  snippets: import("./types").ResearchSnippet[];
  facts: ResearchFact[];
  sources: SourceRef[];
  cacheHit: boolean;
  playbookSkipped: boolean;
  apolloCredits: number;
  linkedinMatchedEmails: string[];
}> {
  const linkedinExports = normalizeLinkedInExports(input.linkedinProfileExports);
  const { matchedEmails } = assignExportsToProspects(
    linkedinExports,
    emails.map((e) => e.toLowerCase()),
  );
  const linkedinMatchedEmails = [...matchedEmails];

  const { cacheHit, bundle } = resolveCachedResearch(input, emails);
  if (cacheHit && bundle) {
    return {
      snippets: bundle.snippets,
      facts: input.confirmedFacts?.length ? input.confirmedFacts : bundle.facts,
      sources: bundle.sources,
      cacheHit: true,
      playbookSkipped: true,
      apolloCredits: 0,
      linkedinMatchedEmails,
    };
  }

  let apolloCredits = 0;
  let apolloFacts: ResearchFact[] = [];
  let apolloSources: SourceRef[] = [];
  let firmographics: Record<string, unknown> | undefined;

  if (env.APOLLO_API_KEY) {
    const apollo = await enrichWithApollo(env, input.companyDomain, emails);
    apolloFacts = apollo.facts;
    apolloSources = apollo.sources;
    firmographics = apollo.firmographics;
    apolloCredits = apollo.creditsUsed;
    void firmographics;
  }

  const snippets = await runPlaybookResearch(
    env,
    {
      companyName: input.companyName,
      companyDomain: input.companyDomain,
      emails,
    },
    { skipLinkedInForEmails: matchedEmails },
  );

  const pdfSnippets = linkedInPdfSnippets(linkedinExports);
  const allSnippets = [...snippets, ...pdfSnippets];

  const extracted = await extractFacts(env, allSnippets, {
    companyName: input.companyName,
    companyDomain: input.companyDomain,
    emails,
    additionalContext: input.additionalContext,
  });

  const facts = mergeFacts(apolloFacts, extracted.facts);
  const sources = mergeSources(apolloSources, extracted.sources);

  return {
    snippets: allSnippets,
    facts,
    sources,
    cacheHit: false,
    playbookSkipped: false,
    apolloCredits,
    linkedinMatchedEmails,
  };
}

function buildResearchMeta(
  partial: Omit<ResearchMeta, "inputHash" | "lowConfidence">,
  inputHash: string,
  lowConfidence: string[],
  devMode: boolean,
  llmCalls: number,
  apolloCredits: number,
): ResearchMeta {
  const meta: ResearchMeta = {
    ...partial,
    inputHash,
    lowConfidence,
  };
  if (devMode) {
    meta.costEstimate = { llmCalls, apolloCredits };
  }
  return meta;
}

function applyConfirmedProfiles(
  prep: import("../schema").Prep,
  emails: string[],
  profiles?: ConfirmedProspectProfile[],
): import("../schema").Prep {
  if (!profiles?.length) return prep;
  return mergeEnrichmentsIntoPrep(prep, emails, profiles);
}

/** Full pipeline: research → extract → synthesize → validate. */
export async function generatePrep(env: Env, rawInput: PrepInput): Promise<PrepResult> {
  const input = normalizePrepInput(rawInput);
  if (input.prepType === "expansion") {
    throw Object.assign(new Error("Expansion prep is not yet available."), { status: 501 });
  }

  const emails = resolveProspectEmails(input);
  const inputHash = computeInputHash(input, emails);
  const timings: Record<string, number> = {};
  const t0 = Date.now();

  const research = await gatherResearch(env, input, emails);
  timings.research = Date.now() - t0;

  const facts = input.confirmedFacts?.length ? input.confirmedFacts : research.facts;
  const t1 = Date.now();
  const effort = ALLOWED_EFFORT.includes(input.effort || "") ? input.effort! : env.EFFORT || "medium";

  const prepRaw = await synthesizePrep(
    env,
    {
      companyName: input.companyName,
      companyDomain: input.companyDomain,
      emails,
      additionalContext: input.additionalContext,
      meetingType: input.meetingType,
      ae: input.ae,
      effort,
      confirmedProspectProfiles: input.confirmedProspectProfiles,
    },
    facts,
    research.sources,
  );
  timings.synthesize = Date.now() - t1;

  const t2 = Date.now();
  let { prep, lowConfidence } = validatePrep(prepRaw);
  prep = applyConfirmedProfiles(prep, emails, input.confirmedProspectProfiles);
  timings.validate = Date.now() - t2;

  const researchBundle = buildResearchBundle(input, emails, {
    facts,
    sources: research.sources,
    snippets: research.snippets,
    enrichmentProvider: env.APOLLO_API_KEY ? "apollo" : null,
  });

  const llmCalls = research.cacheHit ? 1 : 5 + emails.length + 1;
  const researchMeta = buildResearchMeta(
    {
      cacheHit: research.cacheHit,
      playbookSkipped: research.playbookSkipped,
      steps: timings,
      linkedinMatchedEmails: research.linkedinMatchedEmails,
    },
    inputHash,
    [...lowConfidence, ...findLowConfidenceFacts(facts)],
    !!env.APOLLO_API_KEY,
    llmCalls,
    research.apolloCredits,
  );

  const contactDrafts = emails.map((email, i) => {
    const prospect = prep.prospects?.[i];
    return {
      email,
      name: prospect?.name,
      role: prospect?.role,
      metadata: {
        research: {
          lastResearchedAt: researchBundle.lastResearchedAt,
          experienceSummary: prospect?.totalExperience,
          priorEmployers: prospect?.priorEmployers,
          competitorTouchpoints: prospect?.competitorTouchpoints,
          summary: prospect?.summary,
          skills: prospect?.skills,
          languages: prospect?.languages,
          education: prospect?.education,
        },
      },
    };
  });

  return { prep, researchMeta, researchBundle, contactDrafts };
}

/** Research-only step for human-in-the-loop confirmation. */
export async function runPrepResearch(env: Env, rawInput: PrepInput): Promise<ResearchOnlyResult> {
  const input = normalizePrepInput(rawInput);
  if (input.prepType === "expansion") {
    throw Object.assign(new Error("Expansion prep is not yet available."), { status: 501 });
  }

  const emails = resolveProspectEmails(input);
  const inputHash = computeInputHash(input, emails);
  const research = await gatherResearch(env, input, emails);

  const researchBundle = buildResearchBundle(input, emails, {
    facts: research.facts,
    sources: research.sources,
    snippets: research.snippets,
    enrichmentProvider: env.APOLLO_API_KEY ? "apollo" : null,
  });

  const lowConfidence = findLowConfidenceFacts(research.facts);
  const slug = normalizeAccountSlug(input.companyName, input.companyDomain);

  return {
    accountDraft: {
      name: input.companyName,
      domain: input.companyDomain,
      slug,
    },
    contactDrafts: emails.map((email) => ({ email })),
    facts: research.facts,
    sources: research.sources,
    snippets: research.snippets,
    lowConfidence,
    researchBundle,
    researchMeta: buildResearchMeta(
      {
        cacheHit: research.cacheHit,
        playbookSkipped: research.playbookSkipped,
        steps: { research: 0 },
        linkedinMatchedEmails: research.linkedinMatchedEmails,
      },
      inputHash,
      lowConfidence,
      !!env.APOLLO_API_KEY,
      research.cacheHit ? 0 : 5 + emails.length,
      research.apolloCredits,
    ),
  };
}

/** Synthesize brief from confirmed facts (second step of human loop). */
export async function runPrepSynthesize(
  env: Env,
  rawInput: PrepInput & { confirmedFacts: ResearchFact[]; researchBundle?: import("./types").ResearchBundle },
): Promise<PrepResult> {
  const input = normalizePrepInput(rawInput);
  const emails = resolveProspectEmails(input);
  const facts = rawInput.confirmedFacts || [];
  const sources = rawInput.researchBundle?.sources || [];

  const effort = ALLOWED_EFFORT.includes(input.effort || "") ? input.effort! : env.EFFORT || "medium";
  const prepRaw = await synthesizePrep(
    env,
    {
      companyName: input.companyName,
      companyDomain: input.companyDomain,
      emails,
      additionalContext: input.additionalContext,
      meetingType: input.meetingType,
      ae: input.ae,
      effort,
      confirmedProspectProfiles: input.confirmedProspectProfiles,
    },
    facts,
    sources,
  );

  let { prep, lowConfidence } = validatePrep(prepRaw);
  prep = applyConfirmedProfiles(prep, emails, input.confirmedProspectProfiles);
  const researchBundle =
    rawInput.researchBundle ||
    buildResearchBundle(input, emails, {
      facts,
      sources,
      snippets: [],
      enrichmentProvider: env.APOLLO_API_KEY ? "apollo" : null,
    });

  return {
    prep,
    researchMeta: buildResearchMeta(
      { cacheHit: false, playbookSkipped: true, steps: { synthesize: 0 } },
      computeInputHash(input, emails),
      lowConfidence,
      false,
      1,
      0,
    ),
    researchBundle,
  };
}
