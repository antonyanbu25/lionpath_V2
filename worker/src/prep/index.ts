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
import { applyPdfNameFallbacks } from "./pdf-name-fallback";
import { runResearch } from "../research-orchestrator";
import { resolveMergedAdditionalContext } from "./merged-context";
import { orchestratorToFacts, orchestratorToSnippets } from "./orchestrator-bridge";
import { extractSeContextFacts } from "./se-context-extract";
import { fillResearchGaps } from "./gap-research";
import { factsFromSeContext } from "./se-context-facts";
import { canonicalizePrepSources } from "./canonicalize-sources";
import { buildRecentNews } from "./recent-news";
import { supplementNewsFacts } from "./extract-news";
import { generateDemoGuidance, pruneLeadAssets } from "./demo-guidance";
import { DEMO_ASSET_LABELS } from "../prep-assets";
import { padSources } from "./source-table";
import type { ConfirmedProspectProfile } from "./merge-enrichment";
import type {
  Env,
  PrepInput,
  NormalizedPrepInput,
  PrepResult,
  ResearchFact,
  ResearchMeta,
  ResearchOnlyResult,
  SourceRef,
} from "./types";

export { resolveProspectEmails, deriveDomain, normalizePrepInput, computeInputHash, deriveCompanyNameFromEmail, deriveCompanyNameFromDomain, resolveCompanyName } from "./normalize-input";
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

function applySeContextFacts(
  facts: ResearchFact[],
  sources: SourceRef[],
  additionalContext?: string,
): { facts: ResearchFact[]; sources: SourceRef[] } {
  const se = factsFromSeContext(additionalContext);
  if (!se.facts.length) return { facts, sources };
  return {
    facts: mergeFacts(se.facts, facts),
    sources: mergeSources(se.sources, sources),
  };
}

/** Asset labels actually attached to this prep, for validating guidance recommendations. */
function assetLabelsOf(prep: import("../schema").Prep): string[] {
  return (prep.assets || []).map((a) => a.label);
}

function recentNewsDebug(researchFacts: ResearchFact[], prep: import("../schema").Prep) {
  return {
    newsCategoryFacts: researchFacts.filter((f) => f.category === "news").length,
    recentNewsCount: prep.recentNews?.length ?? 0,
    headlines: (prep.recentNews || []).map((n) => n.headline).slice(0, 4),
  };
}

/**
 * Pain-ish research facts, as demo-guidance input. The real `likelyPains` only exist
 * after synthesis, and guidance runs alongside it — these are the closest pre-synthesis
 * signal available.
 */
function factsToPains(facts: ResearchFact[]): string[] {
  return facts
    .filter((f) => f.category === "signal" || f.category === "support")
    .map((f) => `${f.key}: ${f.value}`)
    .filter((s) => !/unknown/i.test(s))
    .slice(0, 8);
}

/**
 * The account's industry, for demo use-case grounding. Read from the research facts
 * because prep.businessContext.market only exists after synthesis, which runs in
 * parallel with guidance.
 */
function factsToIndustry(facts: ResearchFact[]): string | undefined {
  const hit = facts.find((f) => /^(industry|market|vertical)$/i.test(f.key) && !/unknown/i.test(f.value));
  return hit ? String(hit.value) : undefined;
}

/** Raw signal values, so a use case can be grounded in a tool or channel we observed. */
function factsToSignals(facts: ResearchFact[]): string[] {
  return facts
    .filter((f) => !/unknown/i.test(String(f.value)))
    .map((f) => String(f.value))
    .slice(0, 12);
}

async function gatherResearch(
  env: Env,
  input: NormalizedPrepInput,
  emails: string[],
): Promise<{
  snippets: import("./types").ResearchSnippet[];
  facts: ResearchFact[];
  sources: SourceRef[];
  cacheHit: boolean;
  playbookSkipped: boolean;
  apolloCredits: number;
  linkedinMatchedEmails: string[];
  mergedContext: string;
  kaiaFetched: boolean;
  stepTimings?: Record<string, number>;
}> {
  const linkedinExports = normalizeLinkedInExports(input.linkedinProfileExports);
  const { matchedEmails } = assignExportsToProspects(
    linkedinExports,
    emails.map((e) => e.toLowerCase()),
  );
  const linkedinMatchedEmails = [...matchedEmails];

  const { cacheHit, bundle, softCacheHit } = resolveCachedResearch(input, emails);
  if (cacheHit && bundle) {
    const tCache = Date.now();
    const { text: mergedContext, kaiaFetched } = await resolveMergedAdditionalContext(input);
    const baseFacts = input.confirmedFacts?.length ? input.confirmedFacts : bundle.facts;
    const withSe = applySeContextFacts(baseFacts, bundle.sources, mergedContext);
    const supplemented = await supplementNewsFacts(
      env,
      bundle.snippets,
      withSe.facts,
      withSe.sources,
      {
        companyName: input.companyName,
        companyDomain: input.companyDomain,
        emails,
        additionalContext: mergedContext,
      },
    );
    return {
      snippets: bundle.snippets,
      facts: supplemented.facts,
      sources: supplemented.sources,
      cacheHit: true,
      playbookSkipped: true,
      apolloCredits: 0,
      linkedinMatchedEmails,
      mergedContext,
      kaiaFetched,
      stepTimings: { cache: Date.now() - tCache, softCacheHit: softCacheHit ? 1 : 0 },
    };
  }

  const pdfSnippets = linkedInPdfSnippets(linkedinExports);

  const playbookInput = {
    companyName: input.companyName,
    companyDomain: input.companyDomain,
    emails,
  };

  const stepTimings: Record<string, number> = {};

  // Parallelize non-Gemini I/O; run playbook alone afterward (Gemini + heavy HTTP together hung).
  const tParallel = Date.now();
  const apolloPromise = env.APOLLO_API_KEY
    ? enrichWithApollo(env, input.companyDomain, emails)
    : Promise.resolve({ facts: [] as ResearchFact[], sources: [] as SourceRef[], creditsUsed: 0 });
  const contextPromise = resolveMergedAdditionalContext(input);
  const orchestratorPromise = runResearch(env, {
    companyName: input.companyName,
    domain: input.companyDomain,
    emails,
  }).catch((err) => {
    console.warn("prep/research-orchestrator skipped:", (err as Error).message);
    return null;
  });

  const [apolloResult, contextResult, orchestratorCtx] = await Promise.all([
    apolloPromise,
    contextPromise,
    orchestratorPromise,
  ]);
  stepTimings.parallelIo = Date.now() - tParallel;

  const { text: mergedContext, kaiaFetched } = contextResult;

  const tPlaybook = Date.now();
  const playbookSnippets = await runPlaybookResearch(env, playbookInput, {
    skipLinkedInForEmails: matchedEmails,
  });
  stepTimings.playbook = Date.now() - tPlaybook;

  const apolloCredits = apolloResult.creditsUsed;
  const apolloFacts = apolloResult.facts;
  const apolloSources = apolloResult.sources;

  let orchestratorSnippets: import("./types").ResearchSnippet[] = [];
  let orchestratorFacts: ResearchFact[] = [];
  let orchestratorSources: SourceRef[] = [];
  if (orchestratorCtx) {
    orchestratorSnippets = orchestratorToSnippets(orchestratorCtx);
    const orch = orchestratorToFacts(orchestratorCtx);
    orchestratorFacts = orch.facts;
    orchestratorSources = orch.sources;
  }

  const allSnippets = [...orchestratorSnippets, ...playbookSnippets, ...pdfSnippets];

  const tExtract = Date.now();
  const [extracted, seExtracted] = await Promise.all([
    extractFacts(env, allSnippets, {
      companyName: input.companyName,
      companyDomain: input.companyDomain,
      emails,
      additionalContext: mergedContext,
    }),
    extractSeContextFacts(env, mergedContext),
  ]);
  stepTimings.extract = Date.now() - tExtract;
  let facts = mergeFacts(apolloFacts, orchestratorFacts, extracted.facts, seExtracted.facts);
  let sources = mergeSources(apolloSources, orchestratorSources, extracted.sources, seExtracted.sources);
  let snippets = allSnippets;

  const withSe = applySeContextFacts(facts, sources, mergedContext);
  facts = withSe.facts;
  sources = withSe.sources;

  const tGap = Date.now();
  const gapFilled = await fillResearchGaps(
    env,
    {
      companyName: input.companyName,
      companyDomain: input.companyDomain,
      emails,
      additionalContext: mergedContext,
    },
    snippets,
    facts,
    sources,
  );
  stepTimings.gap = Date.now() - tGap;
  const afterGap = applySeContextFacts(gapFilled.facts, gapFilled.sources, mergedContext);
  const tNews = Date.now();
  const supplemented = await supplementNewsFacts(
    env,
    gapFilled.snippets,
    afterGap.facts,
    afterGap.sources,
    {
      companyName: input.companyName,
      companyDomain: input.companyDomain,
      emails,
      additionalContext: mergedContext,
    },
  );
  stepTimings.news = Date.now() - tNews;

  return {
    snippets: gapFilled.snippets,
    facts: supplemented.facts,
    sources: supplemented.sources,
    cacheHit: false,
    playbookSkipped: false,
    apolloCredits,
    linkedinMatchedEmails,
    mergedContext,
    kaiaFetched,
    stepTimings,
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
  if (research.stepTimings) Object.assign(timings, research.stepTimings);

  const facts = input.confirmedFacts?.length ? input.confirmedFacts : research.facts;
  const t1 = Date.now();
  const effort = ALLOWED_EFFORT.includes(input.effort || "") ? input.effort! : env.EFFORT || "medium";
  // PREP_SCHEMA.sources requires minItems 3; gap-only research can return fewer.
  const paddedSources = padSources(research.sources, {
    companyDomain: input.companyDomain,
    hasSeContext: !!String(research.mergedContext || "").trim(),
    pdfFileNames: (input.linkedinProfileExports || []).map((e) => e.fileName),
  });

  // Parallel — see the note in runPrepSynthesize.
  const [prepRaw, guidance] = await Promise.all([
    synthesizePrep(
      env,
      {
        companyName: input.companyName,
        companyDomain: input.companyDomain,
        emails,
        additionalContext: research.mergedContext || input.additionalContext,
        meetingType: input.meetingType,
        ae: input.ae,
        effort,
        confirmedProspectProfiles: input.confirmedProspectProfiles,
      },
      facts,
      paddedSources,
    ),
    generateDemoGuidance(
      env,
      {
        companyName: input.companyName,
        likelyPains: factsToPains(facts),
        // Use-case grounding is checked against these tokens — without industry and
        // signals nothing clears the specificity bar and no use cases render.
        industry: factsToIndustry(facts),
        signals: factsToSignals(facts),
        assetLabels: DEMO_ASSET_LABELS,
      },
      input.confirmedProspectProfiles || [],
    ),
  ]);
  timings.synthesize = Date.now() - t1;

  const t2 = Date.now();
  let { prep, lowConfidence } = validatePrep(prepRaw);
  prep = applyConfirmedProfiles(prep, emails, input.confirmedProspectProfiles);
  prep = applyPdfNameFallbacks(prep, emails, input.linkedinProfileExports);
  // Build from full research facts + authoritative sources before canonicalize remaps labels.
  prep.recentNews = buildRecentNews(research.facts, paddedSources);
  // The two calls above mint "Kaia"/"Zoom"/"LinkedIn PDF" labels after synthesis, so
  // they are invisible to the pass inside synthesizePrep. Idempotent, so this only
  // registers the new virtual sources — it renumbers nothing already canonical.
  prep = canonicalizePrepSources(prep, { authoritative: paddedSources }).prep;
  if (guidance) prep.demoGuidance = pruneLeadAssets(guidance, assetLabelsOf(prep));
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
      recentNewsDebug: recentNewsDebug(research.facts, prep),
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
        steps: research.stepTimings || { research: 0 },
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

  const effort = ALLOWED_EFFORT.includes(input.effort || "") ? input.effort! : env.EFFORT || "medium";
  const { text: mergedContext } = await resolveMergedAdditionalContext(input);
  // PREP_SCHEMA.sources requires minItems 3; gap-only research can return fewer.
  const sources = padSources(rawInput.researchBundle?.sources || [], {
    companyDomain: input.companyDomain,
    hasSeContext: !!String(mergedContext || "").trim(),
    pdfFileNames: (input.linkedinProfileExports || []).map((e) => e.fileName),
  });
  // Parallel, not sequential: demo guidance needs the prospects' DISC plus pains and
  // incumbent, never the finished demo script, so it stays off the critical path. It is
  // also the smaller call, so it finishes first and adds ~0s wall clock.
  const [prepRaw, guidance] = await Promise.all([
    synthesizePrep(
      env,
      {
        companyName: input.companyName,
        companyDomain: input.companyDomain,
        emails,
        additionalContext: mergedContext,
        meetingType: input.meetingType,
        ae: input.ae,
        effort,
        confirmedProspectProfiles: input.confirmedProspectProfiles,
      },
      facts,
      sources,
    ),
    generateDemoGuidance(
      env,
      {
        companyName: input.companyName,
        likelyPains: factsToPains(facts),
        // Use-case grounding is checked against these tokens — without industry and
        // signals nothing clears the specificity bar and no use cases render.
        industry: factsToIndustry(facts),
        signals: factsToSignals(facts),
        assetLabels: DEMO_ASSET_LABELS,
      },
      input.confirmedProspectProfiles || [],
    ),
  ]);

  let { prep, lowConfidence } = validatePrep(prepRaw);
  prep = applyConfirmedProfiles(prep, emails, input.confirmedProspectProfiles);
  const researchFacts = rawInput.researchBundle?.facts || facts;
  prep.recentNews = buildRecentNews(researchFacts, sources);
  // Registers the post-synthesis enrichment labels (Kaia / Zoom / LinkedIn PDF).
  prep = canonicalizePrepSources(prep, { authoritative: sources }).prep;
  if (guidance) prep.demoGuidance = pruneLeadAssets(guidance, assetLabelsOf(prep));
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
      {
        cacheHit: false,
        playbookSkipped: true,
        steps: { synthesize: 0 },
        recentNewsDebug: recentNewsDebug(researchFacts, prep),
      },
      computeInputHash(input, emails),
      lowConfidence,
      false,
      1,
      0,
    ),
    researchBundle,
  };
}
