/**
 * Bridge prep/post-call flows to the lifecycle domain layer (dual-write).
 */

import { findAccountByCompanyName, invalidateSessionListCache } from "./account-service.js?v=2.1";
import { resolveEngagementEntities, collectParticipantEmails } from "./engagement-entities.js";
import { getOrCreateLifecycle, attachPrep, attachPostCall, attachTask } from "./lifecycle-service.js";
import { applyPrepContactFrameworks, applyPostCallContactFrameworks } from "./contact-service.js";
import { applyQualificationToDeal } from "./meddpicc-qualify-service.js";
import { applyTechnicalCommitToDeal } from "./technical-commit-service.js";
import {
  rollupDealTractionAfterPostCall,
  regenerateSummariesAfterPostCall,
  persistArrAfterPostCall,
  linkContactsToDealRecord,
} from "./deal-service.js";
import { persistScorecardDraft } from "./scorecard-service.js";
import { persistVideoFactsDraft } from "./video-facts-service.js";
import { persistCallTimelineDraft } from "./timeline-service.js";
import {
  persistFollowUpsDraft,
  persistObjectionsDraft,
  persistMomDraft,
} from "./commitments-service.js";
import { getStore } from "./store.js";
import { newId, now } from "./types.js";
import { callIdentityKey } from "../call-identity.js";
import { callTitleFor, productDiscussedFromContext, aiShortFormFromAnalysis } from "../call-type-labels.js";
import { buildCallSummaryFromPostCall } from "./call-summary.js";
import { sessionUserId, effectiveSessionUserId } from "./session.js";
import { resolveActingWriteContext } from "./acting-owner.js";
import {
  persistPass6ProductGaps,
  maybeRunGapClusteringAfterPass6,
} from "./product-signal-service.js";

/**
 * Link a call's participants to its deal.
 *
 * Delegates to deal-service rather than writing the join here. `Deal` is deal-service's
 * aggregate, and it owns the one policy that keeps the join and `Deal.primaryContactId` in
 * agreement — join-first, single primary, backfill-only repointing so a background post-call
 * cannot silently overwrite an SE-confirmed primary. An earlier version of this function called
 * `store.setPrimaryDealContact` directly, which moved the join's primary while leaving the deal's
 * pointer behind: two writers, two policies, and a deal whose two representations disagreed.
 *
 * Deliberately called after the contact frameworks pass: influence metadata is merged from the
 * transcript there, so the role reaching the join is the analysed one rather than "unknown". Roles
 * are per-deal — a champion on the new-business deal can be an end user on the expansion — which
 * is why they cannot be read off the contact alone.
 *
 * @param {string|null} dealId
 * @param {string} accountId
 * @param {string[]} contactIds
 * @param {string|null} primaryContactId
 */
async function linkContactsToDeal(dealId, accountId, contactIds, primaryContactId) {
  const store = getStore();
  if (!dealId || !contactIds?.length) return;

  const contactsById = new Map(
    (store.listContactsByAccount ? await store.listContactsByAccount(accountId) : []).map((c) => [
      c.id,
      c,
    ]),
  );

  const contacts = contactIds.map((contactId) => ({
    contactId,
    // undefined becomes "unknown" downstream — an unclassified attendee still gets linked.
    role: contactsById.get(contactId)?.metadata?.influence?.decisionRole,
  }));

  await linkContactsToDealRecord(dealId, { contacts, primaryContactId });
}

/**
 * Resolve lifecycle spine after prep generation.
 * @param {object} session
 * @param {object} payload prep form input
 * @param {object} prep generated prep JSON
 * @param {object} meta { company, domain, additionalContext }
 */
export async function linkPrepToLifecycle(session, payload, prep, meta) {
  const entities = await resolveEngagementEntities(session, payload, {
    meta,
    prep,
    researchBundle: meta?.researchBundle,
    contactDrafts: meta?.contactDrafts,
    company: payload.companyName || meta?.company,
  });
  if (!entities) return null;

  const {
    ownerId,
    teamId,
    orgId,
    audit,
    account,
    accountId,
    contactIds,
    primaryContactId,
    prepType,
    dealId,
  } = entities;

  const lifecycle = await getOrCreateLifecycle(ownerId, accountId, teamId, {
    title: account?.name || meta?.company || payload.companyName,
    primaryContactId,
    actorId: ownerId,
    orgId,
    prepType: prepType || payload.prepType,
    dealId: dealId || null,
    useSessionContext: true,
  });

  const prepBrief = await attachPrep(
    lifecycle.id,
    {
      id: newId("prep"),
      lifecycleId: lifecycle.id,
      dealId: lifecycle.dealId || null,
      ownerId,
      teamId,
      orgId: orgId || lifecycle.orgId || null,
      accountId,
      input: payload,
      prep,
      meta: meta || { company: payload.companyName },
      ...audit,
    },
    ownerId
  );

  const emails = collectParticipantEmails(payload);
  if (prep && emails.length) {
    await applyPrepContactFrameworks(accountId, prep, emails, {
      lifecycleId: lifecycle.id,
      actorId: ownerId,
      prepBriefId: prepBrief.id,
      dealId: lifecycle.dealId || null,
    });
  }

  await linkContactsToDeal(lifecycle.dealId || null, accountId, contactIds, primaryContactId);

  invalidateSessionListCache(session);
  return {
    lifecycle,
    prepBrief,
    accountId,
    contactIds,
    primaryContactId,
    dealId: lifecycle.dealId || null,
  };
}

/**
 * Resolve lifecycle spine after post-call analysis.
 * @param {object} session
 * @param {object} payload { recordingUrl, recordingPassword }
 * @param {object} data API response { analysis, transcriptMeta }
 * @param {object} record history record from savePostCallHistory
 */
export async function linkPostCallToLifecycle(session, payload, data, record) {
  const summarise = data?.summarise || null;
  const analysis = {
    ...(data?.analysis || record?.analysis || {}),
  };
  // Pass 7 call notes live in the analysis blob; MoM does not.
  if (typeof summarise?.callNotes === "string" && summarise.callNotes.trim()) {
    analysis.callNotes = summarise.callNotes;
  }
  const company =
    payload?.companyName ||
    analysis?.callHeader?.company ||
    analysis?.callHeader?.account ||
    record?.title?.split("-")[0]?.trim() ||
    "";

  if (!company && !payload?.accountId) {
    console.warn("[dual-write] post-call skipped. no company/account to attach");
    return null;
  }

  // Account + contacts BEFORE lifecycle/deal — see resolveEngagementEntities / engagement-entities.js.
  const entities = await resolveEngagementEntities(session, payload, {
    record,
    company,
  });
  if (!entities) return null;

  const {
    ownerId,
    teamId,
    orgId,
    audit,
    account,
    contactIds,
    primaryContactId,
    participantEmails,
    prepType,
    dealId,
  } = entities;

  const lifecycle = await getOrCreateLifecycle(ownerId, account.id, teamId, {
    title: account.name || company,
    primaryContactId,
    actorId: ownerId,
    orgId,
    dealId,
    prepType: prepType || payload.prepType,
    useSessionContext: true,
    viaWorkerDealCreate: true,
  });

  const identityKey = callIdentityKey(record || { zoomLink: payload?.recordingUrl, analysis, id: record?.id });
  const qip = data?.scorecard;
  const qualityScore =
    typeof qip?.overall === "number"
      ? qip.overall
      : typeof qip?.rawScore === "number"
        ? qip.rawScore
        : analysis?.qualityCoach?.overall ?? analysis?.qualityCoach?.overallScore ?? null;

  const callType = data?.analysisMeta?.callType || data?.confirmed?.callType || payload?.callType || null;
  const callTitle =
    callTitleFor(callType, account.name, {
      productDiscussed: productDiscussedFromContext({
        pass6: data?.pass6,
        arrCompute: data?.arrCompute,
        analysis,
      }),
      aiShortForm: aiShortFormFromAnalysis(analysis),
    }) ||
    record?.title ||
    null;

  const postCallDraft = {
    id: record?.id || newId("postCall"),
    lifecycleId: lifecycle.id,
    dealId: lifecycle.dealId || null,
    ownerId,
    teamId,
    orgId: orgId || lifecycle.orgId || null,
    accountId: account.id,
    zoomLink: payload?.recordingUrl || record?.zoomLink,
    title: callTitle,
    callIdentityKey: identityKey,
    analysis,
    transcriptMeta: data?.transcriptMeta || record?.transcriptMeta,
    qualityScore: typeof qualityScore === "number" ? qualityScore : null,
    callType,
    analysisConfidence: data?.analysisMeta?.analysisConfidence ?? qip?.confidence ?? null,
    provisional: data?.analysisMeta?.provisional ?? qip?.provisional ?? false,
    rubricVersion: data?.analysisMeta?.rubricVersion || qip?.rubricVersion || null,
    createdAt: record?.timestamp || now(),
    ...audit,
  };
  const callSummary = buildCallSummaryFromPostCall(postCallDraft, {
    qip: qip
      ? {
          overall: qip.overall ?? qualityScore,
          categoryScores: qip.categoryScores,
          confidence: qip.confidence ?? data?.analysisMeta?.analysisConfidence,
          provisional: qip.provisional ?? data?.analysisMeta?.provisional,
          rubricVersion: qip.rubricVersion ?? data?.analysisMeta?.rubricVersion,
        }
      : undefined,
    pass6: data?.pass6,
    arrCompute: data?.arrCompute,
    accountName: account.name,
  });

  const postCall = await attachPostCall(lifecycle.id, postCallDraft, ownerId, callSummary);

  if (qip) {
    try {
      await persistScorecardDraft(qip, {
        callId: postCall.id,
        dealId: lifecycle.dealId || dealId || null,
        ownerId,
        teamId,
        orgId: orgId || lifecycle.orgId || null,
        accountId: account.id,
      });
    } catch (err) {
      console.warn("[dual-write] scorecard persist failed:", err?.message || err);
    }
  }

  const videoFacts = data?.videoFacts;
  if (videoFacts) {
    try {
      await persistVideoFactsDraft(videoFacts, {
        callId: postCall.id,
        dealId: lifecycle.dealId || dealId || null,
        ownerId,
        teamId,
        orgId: orgId || lifecycle.orgId || null,
        accountId: account.id,
      });
    } catch (err) {
      console.warn("[dual-write] videoFacts persist failed:", err?.message || err);
    }
  }

  const timeline = data?.timeline;
  if (timeline) {
    try {
      await persistCallTimelineDraft(timeline, {
        callId: postCall.id,
        dealId: lifecycle.dealId || dealId || null,
        ownerId,
        teamId,
        orgId: orgId || lifecycle.orgId || null,
      });
    } catch (err) {
      console.warn("[dual-write] timeline persist failed:", err?.message || err);
    }
  }

  const persistCtx = {
    callId: postCall.id,
    dealId: lifecycle.dealId || dealId || null,
    ownerId,
    teamId,
    orgId: orgId || lifecycle.orgId || null,
    accountId: account.id,
  };

  if (summarise?.followUps) {
    try {
      await persistFollowUpsDraft(summarise.followUps, persistCtx);
    } catch (err) {
      console.warn("[dual-write] followUps persist failed:", err?.message || err);
    }
  }

  if (summarise?.objections) {
    try {
      await persistObjectionsDraft(summarise.objections, persistCtx);
    } catch (err) {
      console.warn("[dual-write] objections persist failed:", err?.message || err);
    }
  }

  if (summarise?.momDraft) {
    try {
      await persistMomDraft(summarise.momDraft, persistCtx);
    } catch (err) {
      console.warn("[dual-write] momDraft persist failed:", err?.message || err);
    }
  }

  const qualification = data?.qualification || null;
  if (qualification && lifecycle.dealId) {
    try {
      await applyQualificationToDeal(lifecycle.dealId, account.id, qualification, persistCtx);
    } catch (err) {
      console.warn("[dual-write] qualification persist failed:", err?.message || err);
    }
  }

  // Before the traction rollup — it reads the deal's current commit snapshot.
  const technicalCommit = data?.technicalCommit || null;
  if (technicalCommit && lifecycle.dealId) {
    try {
      await applyTechnicalCommitToDeal(
        lifecycle.dealId,
        account.id,
        technicalCommit,
        data?.tcDeltas || [],
        persistCtx,
      );
    } catch (err) {
      console.warn("[dual-write] technical commit persist failed:", err?.message || err);
    }
  }

  if (lifecycle.dealId) {
    try {
      await rollupDealTractionAfterPostCall(lifecycle.dealId, {
        ...persistCtx,
        analysis,
        qualification,
        summarise,
        technicalCommit,
        callCreatedAt: postCall.createdAt || postCall.updatedAt || now(),
      });
    } catch (err) {
      console.warn("[dual-write] traction rollup failed:", err?.message || err);
    }
  }

  const arrCompute = data?.arrCompute || null;
  if (arrCompute && lifecycle.dealId) {
    try {
      await persistArrAfterPostCall(lifecycle.dealId, arrCompute, persistCtx);
    } catch (err) {
      console.warn("[dual-write] arr persist failed:", err?.message || err);
    }
  }

  const pass6 = data?.pass6 || null;
  if (pass6 && (pass6.productGaps?.length || pass6.whatWorks?.length)) {
    try {
      const store = getStore();
      await persistPass6ProductGaps(store, pass6, {
        ...persistCtx,
        postCallId: postCall.id,
      });
      const orgId = session.orgId || lifecycle.orgId || persistCtx.orgId || null;
      if (orgId) {
        void maybeRunGapClusteringAfterPass6(store, orgId);
      }
    } catch (err) {
      console.warn("[dual-write] pass6 product signal persist failed:", err?.message || err);
    }
  }

  if (account.id) {
    try {
      await regenerateSummariesAfterPostCall(lifecycle.dealId || dealId || null, account.id, persistCtx);
    } catch (err) {
      console.warn("[dual-write] summaries regenerate failed:", err?.message || err);
    }
  }

  // Non-fatal from here on, but reported: everything below enriches records that already exist.
  // Collected rather than only logged, because a console.warn is not a signal a caller can act on
  // — that is exactly how the missing-contacts bug above stayed invisible.
  /** @type {string[]} */
  const warnings = [];

  // Enrichment only now (influence, DISC, MEDDPICC from the transcript). The contacts themselves
  // were ensured before the deal, so a throw here costs detail, not records.
  try {
    await applyPostCallContactFrameworks(account.id, analysis, {
      lifecycleId: lifecycle.id,
      actorId: ownerId,
      postCallId: postCall.id,
      dealId: lifecycle.dealId || null,
      qualification,
      participantEmails,
    });
  } catch (err) {
    warnings.push(`contact frameworks: ${err?.message || err}`);
    console.warn("[dual-write] contact frameworks failed:", err?.message || err);
  }

  try {
    await linkContactsToDeal(
      lifecycle.dealId || dealId || null,
      account.id,
      contactIds,
      primaryContactId,
    );
  } catch (err) {
    warnings.push(`deal contact links: ${err?.message || err}`);
    console.warn("[dual-write] deal contact link failed:", err?.message || err);
  }

  // Identity stamping: AE on the deal, and {ae, primary/secondary SE, contacts} on
  // the call. Runs last so seTeam (incl. any auto-added secondary SE) and the
  // participant contacts already exist.
  try {
    await stampCallIdentities({
      account,
      lifecycle,
      postCall,
      confirmedIdentities: payload?.confirmedIdentities || {},
      participantEmails,
    });
  } catch (err) {
    warnings.push(`identity stamp: ${err?.message || err}`);
    console.warn("[dual-write] identity stamp failed:", err?.message || err);
  }

  invalidateSessionListCache(session);
  return {
    lifecycle,
    postCall,
    accountId: account.id,
    contactIds,
    primaryContactId,
    warnings,
  };
}

/** Parse a confirmed AE label into a structured {name, email}. */
function aeFromLabel(label) {
  const s = String(label || "").trim();
  if (!s) return null;
  return s.includes("@") ? { name: s, email: s.toLowerCase() } : { name: s };
}

/**
 * Stamp call identifiers: AE onto the deal (structured), and
 * {aeName, aeEmail, primarySeUserId, secondarySeUserIds, contactIds} onto the call.
 */
async function stampCallIdentities({ account, lifecycle, postCall, confirmedIdentities, participantEmails }) {
  const store = getStore();
  const freshAccount = (await store.getAccount(account.id)) || account;
  const seTeam = freshAccount?.seTeam || [];
  const primarySeUserId =
    freshAccount?.primarySeUserId || seTeam.find((m) => m.role === "primary")?.seUserId || null;
  const secondarySeUserIds = seTeam.filter((m) => m.role === "secondary").map((m) => m.seUserId);

  const ae = aeFromLabel(confirmedIdentities?.aeIdentity);

  const emails = (participantEmails || [])
    .map((e) => String(e || "").trim().toLowerCase())
    .filter((e) => e.includes("@"));
  // Independent per-email lookups — parallelize (flagged by test-no-await-in-loop.mjs).
  const contactLookups = store.findContactByAccountEmail
    ? await Promise.all(emails.map((email) => store.findContactByAccountEmail(account.id, email)))
    : [];
  const contactIds = contactLookups.filter((c) => c?.id).map((c) => c.id);

  const identities = {
    aeName: ae?.name || null,
    aeEmail: ae?.email || null,
    primarySeUserId,
    secondarySeUserIds,
    contactIds,
  };
  await store.upsertPostCall({ ...postCall, identities, updatedAt: now() });

  // Structured AE on the deal (merge; never overwrite a known email with a bare name).
  const dealId = postCall.dealId || lifecycle.dealId || null;
  if (ae && dealId && store.getDeal && store.updateDeal) {
    const deal = await store.getDeal(dealId);
    if (deal) {
      const merged = { ...(deal.metadata?.ae || {}), ...ae };
      await store.updateDeal(dealId, { metadata: { ...(deal.metadata || {}), ae: merged } });
    }
  }
}

/**
 * Link imported task to lifecycle when company/context known.
 */
export async function linkTaskToLifecycle(session, task, lifecycleId) {
  if (!lifecycleId) return null;
  const sessionOwnerId = sessionUserId(session);
  const proxySeUserId =
    task?.proxySeUserId ||
    (task?.ownerId && task.ownerId !== sessionOwnerId ? task.ownerId : null);
  const { ownerId, teamId, orgId } = await resolveActingWriteContext(session, proxySeUserId);
  if (!ownerId || !teamId) return null;

  return attachTask(
    lifecycleId,
    {
      ...task,
      id: task.id || newId("task"),
      lifecycleId,
      ownerId,
      teamId,
      orgId: orgId || null,
      accountId: task.accountId,
      createdAt: task.createdAt || now(),
    },
    ownerId
  );
}

/** Find lifecycle by company name for current user. */
export async function findLifecycleForCompany(session, companyName, domain) {
  const ownerId = sessionUserId(session);
  if (!ownerId || !session?.teamId) return null;
  const account = await findAccountByCompanyName(companyName, domain);
  if (!account) return null;
  const { getStore } = await import("./store.js");
  const store = getStore();
  return store.findActiveLifecycle(ownerId, account.id);
}
