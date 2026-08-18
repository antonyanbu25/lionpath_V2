import { analyzePostCall, type PostCallInput } from "./analyze";
import type { ProviderEnv } from "../providers/types";
import type { ZoomEnv } from "../zoom";
import { RUBRIC_VERSION, type CallType } from "../rubric-profiles";
import { runPostCallClassify } from "./classify";
import { runPostCallResolve } from "./resolve";
import { runPostCallScorecard } from "./scorecard";
import { buildEffectiveTranscriptForScoring } from "./speaker-attribution";
import type {
  ConfirmedIdentities,
  PostCallGenerateInput,
  PostCallGenerateResult,
  PostCallResolveInput,
} from "./types";
import type { VideoFactsDraft } from "../domain-model/video-facts";

export type Env = ProviderEnv & ZoomEnv;

function topMatchMethod(dealReasons: { signal: string }[] | undefined): string | undefined {
  return dealReasons?.[0]?.signal;
}

/** Stamp analysisVersion 2 + QIP rubricVersion when Pass 3 ran. */
function stampQipAnalysisVersions<T extends { analysis: { analysisVersion?: number; rubricVersion?: string } }>(
  result: T,
): T {
  result.analysis.analysisVersion = 2;
  result.analysis.rubricVersion = RUBRIC_VERSION;
  return result;
}

/**
 * Server-side, canonical identity-context block for the SCORECARD prompt only — distinct
 * from the free-text identities block the confirm page already folds into
 * `additionalContext` for the narrative pass (web/postcall.js `formatConfirmedIdentitiesContext`).
 * Threaded into `runPostCallScorecard` as `identitiesContext` (see scorecard.ts rule requiring
 * SE-execution credit come only from a confirmed SE).
 */
function buildIdentitiesContext(identities: ConfirmedIdentities | null | undefined): string | null {
  if (!identities) return null;
  const lines: string[] = ["Confirmed call identities (authoritative for scoring):"];
  if (identities.seIdentity) lines.push(`- Primary SE: ${identities.seIdentity}`);
  if (identities.secondarySeIdentities?.length) {
    lines.push(`- Secondary SE: ${identities.secondarySeIdentities.join(", ")}`);
  }
  if (identities.aeIdentity) lines.push(`- AE: ${identities.aeIdentity}`);
  if (identities.customerIdentities?.length) {
    lines.push(`- Customer: ${identities.customerIdentities.join(", ")}`);
  }
  if (identities.partnerIdentities?.length) {
    lines.push(`- Partner: ${identities.partnerIdentities.join(", ")}`);
  }
  if (identities.generalManagerIdentities?.length) {
    lines.push(`- General Manager: ${identities.generalManagerIdentities.join(", ")}`);
  }
  if (identities.executiveIdentities?.length) {
    lines.push(`- Executive: ${identities.executiveIdentities.join(", ")}`);
  }
  if (identities.roomAttributions?.length) {
    lines.push(
      "",
      'Meeting-room mic attributions — speech in these spans is credited to the named person ' +
        '(tagged "(via meeting room)" in the transcript below):',
    );
    for (const attribution of identities.roomAttributions) {
      for (const span of attribution.spans || []) {
        const role = span.role ? ` (${span.role})` : "";
        lines.push(
          `- "${attribution.roomLabel}" ${Math.round(span.startS)}s–${Math.round(span.endS)}s → ${span.person}${role}`,
        );
      }
    }
  }
  if (lines.length <= 1) return null;
  return lines.join("\n");
}

/** Run narrative analysis + Pass 3 scorecard after SE confirmation (or legacy auto-pick). */
export async function runPostCallGenerate(
  env: Env,
  input: PostCallGenerateInput & {
    videoAvailable?: boolean;
    briefContext?: string | null;
    videoFacts?: VideoFactsDraft | null;
  },
): Promise<PostCallGenerateResult> {
  const analysisInput: PostCallInput = {
    transcript: input.transcript,
    recordingUrl: input.recordingUrl,
    recordingPassword: input.recordingPassword,
    companyName: input.companyName,
    meetingTitle: input.meetingTitle,
    meetingDate: input.meetingDate,
    additionalContext: input.additionalContext,
    effort: input.effort,
    lifecycleId: input.lifecycleId,
    dealId: input.dealId,
    userId: input.userId,
    callId: input.callId,
    transcriptCaches: input.transcriptCaches,
  };

  const callType = (input.callType || "discovery") as CallType;
  const videoAvailable = !!input.videoAvailable;
  const transcript = input.transcript?.trim() || "";
  const videoFacts = input.videoFacts ?? null;

  // Identity-aware scoring (v2.2): confirmed identities + meeting-room attributions are
  // authoritative for the SCORECARD pass only — the narrative pass above keeps using the
  // original transcript + the free-text identities block already folded into
  // additionalContext by the confirm page.
  const roomAttributions = input.confirmedIdentities?.roomAttributions ?? null;
  const identitiesContext = buildIdentitiesContext(input.confirmedIdentities);
  const effectiveTranscriptForScoring = transcript
    ? buildEffectiveTranscriptForScoring(transcript, roomAttributions)
    : transcript;
  const transcriptWasRewritten = effectiveTranscriptForScoring !== transcript;
  // `input.transcriptCaches` (Gemini-side context cache) was prepared from the RAW transcript
  // by POST /api/postcall/cache/prepare before confirm. It is not consumed as the scorecard
  // request's own cached transcript content today (only the static rubric prompt is cached
  // there — see resolvePostCallCacheModel/getStaticCache in scorecard.ts), so this is
  // defensive rather than a live bug: if a future change starts feeding transcriptCaches into
  // the scorecard's cachedSystemContent, it must never do so for a rewritten transcript, since
  // the cache content would still reflect the raw (non-identity-rewritten) text.
  const scorecardTranscriptCaches = transcriptWasRewritten ? undefined : input.transcriptCaches;

  const [narrative, scorecardResult] = await Promise.all([
    analyzePostCall(env, analysisInput),
    transcript
      ? runPostCallScorecard(env, {
          transcript: effectiveTranscriptForScoring,
          callType,
          videoAvailable,
          deckLink: input.deckLink,
          deckContent: input.deckContent,
          briefContext: input.briefContext,
          identitiesContext,
          roomAttributions,
          companyName: input.companyName,
          meetingTitle: input.meetingTitle,
          videoFacts,
          userId: input.userId,
          callId: input.callId,
          transcriptCaches: scorecardTranscriptCaches,
        })
      : Promise.resolve(null),
  ]);

  stampQipAnalysisVersions(narrative);

  const confirmed = input.confirmed
    ? {
        accountId: input.accountId ?? null,
        dealId: input.dealId ?? null,
        callType,
        callTypeOverride: input.callTypeOverride,
        dealMatchOverride: input.dealMatchOverride,
      }
    : undefined;

  return {
    ...narrative,
    scorecard: scorecardResult?.scorecard,
    videoFacts: videoFacts || undefined,
    confirmed,
    analysisMeta: {
      callType,
      deckLink: input.deckLink,
      videoAvailable,
      videoPassStatus: videoFacts?.status,
      analysisConfidence: scorecardResult?.analysisConfidence,
      provisional: scorecardResult?.provisional,
      rubricVersion: RUBRIC_VERSION,
    },
  };
}

/** Legacy facade: resolve → classify → auto-pick → generate (no human gate). */
export async function runPostCallLegacyAnalyze(
  env: Env,
  input: PostCallGenerateInput & PostCallResolveInput,
): Promise<PostCallGenerateResult> {
  const resolveResult = await runPostCallResolve(input, { zoomEnv: env, providerEnv: env });
  const classifyResult = await runPostCallClassify(env, {
    transcript: resolveResult.transcript,
    meetingTitle: resolveResult.meetingTitle,
    userId: input.userId,
    callId: input.callId,
  });

  const topDeal = resolveResult.deals[0];
  const accountName = resolveResult.account?.accountName;

  const generated = await runPostCallGenerate(env, {
    ...input,
    transcript: resolveResult.transcript,
    meetingTitle: resolveResult.meetingTitle || input.meetingTitle,
    companyName: input.companyName || accountName,
    dealId: topDeal?.dealId || input.dealId || null,
    accountId: resolveResult.account?.accountId || input.accountId || null,
    callType: classifyResult.primary,
    confirmed: false,
    legacyAutoConfirm: true,
    videoAvailable: resolveResult.videoAvailable,
  });

  return {
    ...generated,
    resolve: resolveResult,
    classify: classifyResult,
    analysisMeta: {
      ...generated.analysisMeta,
      callType: classifyResult.primary,
      callTypeConfidence: classifyResult.confidence,
      callTypeMix: classifyResult.mix,
      matchMethod: topMatchMethod(topDeal?.reasons) || resolveResult.account?.reasons?.[0]?.signal,
      matchConfidence: topDeal?.score || resolveResult.account?.score,
      sourceKind: resolveResult.sourceKind,
      videoAvailable: resolveResult.videoAvailable,
      analysisConfidence:
        generated.analysisMeta?.analysisConfidence ?? resolveResult.analysisConfidence,
      provisional: generated.analysisMeta?.provisional,
      videoThemesNotApplicable: resolveResult.videoThemesNotApplicable,
      deckLink: input.deckLink,
      rubricVersion: RUBRIC_VERSION,
    },
  };
}

export async function runPostCallConfirmedPipeline(
  env: Env,
  input: PostCallGenerateInput & {
    resolveSnapshot?: import("./types").PostCallResolveResult;
    classifySnapshot?: import("./types").PostCallClassifyResult;
    videoFacts?: VideoFactsDraft | null;
  },
): Promise<PostCallGenerateResult> {
  if (!input.callType) {
    throw Object.assign(new Error("callType is required after confirmation."), { status: 400 });
  }

  let transcript = input.transcript?.trim();
  let resolveResult = input.resolveSnapshot;
  if (!transcript && input.recordingUrl) {
    resolveResult = resolveResult || (await runPostCallResolve(input, { zoomEnv: env, providerEnv: env }));
    transcript = resolveResult.transcript;
  }
  if (!transcript) {
    throw Object.assign(new Error("transcript or recordingUrl is required."), { status: 400 });
  }

  const classifyResult =
    input.classifySnapshot ||
    (await runPostCallClassify(env, {
      transcript,
      meetingTitle: input.meetingTitle || resolveResult?.meetingTitle,
      userId: input.userId,
      callId: input.callId,
    }));

  const selectedDeal = resolveResult?.deals.find((d) => d.dealId === input.dealId);
  const callType = input.callType as CallType;

  const callTypeOverride =
    input.callTypeOverride ||
    (callType !== classifyResult.primary
      ? { from: classifyResult.primary, to: callType, at: Date.now() }
      : undefined);

  const preselectedId = resolveResult?.deals.find((d) => d.preselected)?.dealId;
  const dealMatchOverride =
    input.dealMatchOverride ||
    (input.dealId && preselectedId && input.dealId !== preselectedId
      ? { from: preselectedId, to: input.dealId, at: Date.now() }
      : undefined);

  const generated = await runPostCallGenerate(env, {
    ...input,
    transcript,
    meetingTitle: input.meetingTitle || resolveResult?.meetingTitle,
    companyName: input.companyName || resolveResult?.account?.accountName,
    callType,
    confirmed: true,
    callTypeOverride,
    dealMatchOverride,
    videoAvailable: resolveResult?.videoAvailable ?? false,
    videoFacts: input.videoFacts ?? null,
  });

  return {
    ...generated,
    resolve: resolveResult,
    classify: classifyResult,
    videoFacts: generated.videoFacts || input.videoFacts || undefined,
    confirmed: {
      accountId: input.accountId ?? resolveResult?.account?.accountId ?? null,
      dealId: input.dealId ?? null,
      callType,
      callTypeOverride,
      dealMatchOverride,
    },
    analysisMeta: {
      ...generated.analysisMeta,
      callType,
      callTypeConfidence: classifyResult.confidence,
      callTypeMix: classifyResult.mix,
      matchMethod: topMatchMethod(selectedDeal?.reasons) || resolveResult?.account?.reasons?.[0]?.signal,
      matchConfidence: selectedDeal?.score || resolveResult?.account?.score,
      sourceKind: resolveResult?.sourceKind,
      videoAvailable: resolveResult?.videoAvailable ?? false,
      videoPassStatus: generated.analysisMeta?.videoPassStatus || input.videoFacts?.status,
      analysisConfidence:
        generated.analysisMeta?.analysisConfidence ?? resolveResult?.analysisConfidence,
      provisional: generated.analysisMeta?.provisional,
      videoThemesNotApplicable: resolveResult?.videoThemesNotApplicable,
      deckLink: input.deckLink,
      rubricVersion: RUBRIC_VERSION,
    },
  };
}
