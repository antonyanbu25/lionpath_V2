/**
 * Thin list projection for postCalls — callSummaries collection (~2KB per doc).
 */
import { canonicalCallType } from "../call-type-labels.js";
import { aiShortFormFromAnalysis, productDiscussedFromContext } from "../call-type-labels.js";
import { now } from "./types.js";

const SEARCH_TOKEN_MAX = 40;
const TOP_GAP_MAX = 8;
const PRODUCTS_MAX = 12;

/** @param {string[]} parts */
export function buildSearchTokens(parts) {
  const tokens = new Set();
  for (const raw of parts || []) {
    for (const w of String(raw || "")
      .toLowerCase()
      .split(/\W+/)) {
      if (w.length >= 2) tokens.add(w);
    }
  }
  return [...tokens].slice(0, SEARCH_TOKEN_MAX);
}

/**
 * @param {object} gap
 * @returns {string|null}
 */
function gapKeyFromRow(gap) {
  return gap?.gapKey || gap?.key || gap?.themeKey || gap?.label || null;
}

/**
 * Build a callSummaries doc from data already in hand at persist time.
 * @param {object} ctx
 */
export function buildCallSummary(ctx) {
  const ts = ctx.updatedAt ?? ctx.createdAt ?? now();
  const qip = ctx.qip || null;
  const analysis = ctx.analysis || {};
  const summarise = ctx.summarise || {};
  const pass6 = ctx.pass6 || null;
  const productsDiscussed = productDiscussedFromContext({
    pass6,
    arrCompute: ctx.arrCompute,
    analysis,
  });
  const productList = productsDiscussed
    ? [productsDiscussed]
    : (pass6?.productGaps || [])
        .map((g) => g?.product || g?.productName)
        .filter(Boolean)
        .slice(0, PRODUCTS_MAX);

  const topGapKeys = (pass6?.productGaps || [])
    .map(gapKeyFromRow)
    .filter(Boolean)
    .slice(0, TOP_GAP_MAX);

  const followUps = summarise.followUps || ctx.followUps || [];
  const objections = summarise.objections || ctx.objections || [];

  const aiShortForm =
    ctx.aiShortForm ||
    aiShortFormFromAnalysis(analysis) ||
    null;

  const qualityScore =
    typeof ctx.qualityScore === "number"
      ? ctx.qualityScore
      : typeof qip?.overall === "number"
        ? qip.overall
        : typeof qip?.rawScore === "number"
          ? qip.rawScore
          : analysis?.qualityCoach?.overall ?? analysis?.qualityCoach?.overallScore ?? null;

  const callType = canonicalCallType(
    ctx.callType || ctx.analysisMeta?.callType || analysis?.callType || "demo",
  );

  return {
    id: ctx.id,
    ownerId: ctx.ownerId,
    ownerName: ctx.ownerName || null,
    teamId: ctx.teamId,
    orgId: ctx.orgId || null,
    accountId: ctx.accountId,
    accountName: ctx.accountName || null,
    dealId: ctx.dealId || null,
    dealTitle: ctx.dealTitle || null,
    dealStage: ctx.dealStage || null,
    dealType: ctx.dealType || null,
    callType,
    title: ctx.title || null,
    aiShortForm,
    createdAt: ctx.createdAt ?? ts,
    updatedAt: ts,
    qualityScore: typeof qualityScore === "number" ? qualityScore : null,
    qipOverall:
      typeof qip?.overall === "number"
        ? qip.overall
        : typeof qualityScore === "number"
          ? qualityScore
          : null,
    qipCategoryScores: qip?.categoryScores || null,
    analysisConfidence:
      ctx.analysisConfidence ??
      ctx.analysisMeta?.analysisConfidence ??
      qip?.confidence ??
      null,
    provisional: !!(ctx.provisional ?? ctx.analysisMeta?.provisional ?? qip?.provisional),
    rubricVersion: ctx.rubricVersion || ctx.analysisMeta?.rubricVersion || qip?.rubricVersion || "2.1",
    productsDiscussed: productList,
    topGapKeys,
    followUpCount: Array.isArray(followUps) ? followUps.length : ctx.followUpCount ?? 0,
    objectionCount: Array.isArray(objections) ? objections.length : ctx.objectionCount ?? 0,
    hasVideoFacts: !!(ctx.hasVideoFacts ?? ctx.videoFacts),
    searchTokens: buildSearchTokens([
      ctx.title,
      ctx.accountName,
      ctx.dealTitle,
      callType,
      aiShortForm,
      ctx.ownerName,
      ...(productList || []),
    ]),
    embedding: ctx.embedding ?? null,
    embeddingModel: ctx.embeddingModel ?? null,
  };
}

/**
 * Map callSummaries → analysis-compatible records for list UIs (no hydration).
 * @param {object[]} summaries
 */
export function callSummariesToAnalyses(summaries) {
  return (summaries || []).map((s) => {
    const analysisMeta = {
      callType: canonicalCallType(s.callType || "demo"),
      rubricVersion: s.rubricVersion || "2.1",
      analysisConfidence: s.analysisConfidence ?? null,
      provisional: !!s.provisional,
    };
    const scorecard =
      s.qipOverall != null || s.qipCategoryScores
        ? {
            callType: analysisMeta.callType,
            rubricVersion: analysisMeta.rubricVersion,
            overall: s.qipOverall ?? s.qualityScore ?? null,
            categoryScores: s.qipCategoryScores || {},
            confidence: s.analysisConfidence ?? null,
            provisional: analysisMeta.provisional,
            lines: [],
          }
        : null;
    return {
      id: s.id,
      timestamp: s.createdAt,
      title: s.title,
      ownerId: s.ownerId,
      ownerName: s.ownerName,
      accountId: s.accountId,
      accountName: s.accountName,
      dealId: s.dealId,
      dealTitle: s.dealTitle,
      callType: s.callType,
      qualityScore: s.qualityScore,
      aiShortForm: s.aiShortForm,
      analysis: {
        callHeader: {
          company: s.accountName,
          title: s.title,
        },
        momentum: null,
      },
      scorecard,
      analysisMeta,
      result: {
        analysis: {
          callHeader: { company: s.accountName, title: s.title },
        },
        scorecard,
        analysisMeta,
      },
    };
  });
}

/**
 * Derive a summary from an existing full postCall (+ optional enrichments).
 * Used by backfill script.
 * @param {object} postCall
 * @param {object} [enrich]
 */
export function buildCallSummaryFromPostCall(postCall, enrich = {}) {
  const analysis = postCall.analysis || {};
  return buildCallSummary({
    id: postCall.id,
    ownerId: postCall.ownerId,
    ownerName: enrich.ownerName ?? postCall.ownerName ?? null,
    teamId: postCall.teamId,
    orgId: postCall.orgId,
    accountId: postCall.accountId,
    accountName: enrich.accountName ?? analysis?.callHeader?.company ?? analysis?.callHeader?.account ?? null,
    dealId: postCall.dealId ?? null,
    dealTitle: enrich.dealTitle ?? null,
    dealStage: enrich.dealStage ?? null,
    dealType: enrich.dealType ?? null,
    callType: postCall.callType,
    title: postCall.title,
    analysis,
    qip: enrich.qip || {
      overall: enrich.qipOverall ?? postCall.qualityScore ?? null,
      categoryScores: enrich.qipCategoryScores ?? null,
      confidence: postCall.analysisConfidence,
      provisional: postCall.provisional,
      rubricVersion: postCall.rubricVersion,
    },
    qualityScore: postCall.qualityScore,
    analysisConfidence: postCall.analysisConfidence,
    provisional: postCall.provisional,
    rubricVersion: postCall.rubricVersion,
    pass6: enrich.pass6,
    arrCompute: enrich.arrCompute,
    followUpCount: enrich.followUpCount,
    objectionCount: enrich.objectionCount,
    hasVideoFacts: enrich.hasVideoFacts,
    createdAt: postCall.createdAt,
    updatedAt: postCall.updatedAt ?? postCall.createdAt,
  });
}
