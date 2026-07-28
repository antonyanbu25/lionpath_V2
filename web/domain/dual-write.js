/**
 * Bridge prep/post-call flows to the lifecycle domain layer (dual-write).
 */

import { upsertAccountFromPrep, findAccountByCompanyName, collectProspectEmails, ensureSeTeamForPrepActor } from "./account-service.js";
import { getOrCreateLifecycle, attachPrep, attachPostCall, attachTask } from "./lifecycle-service.js";
import { applyPrepContactFrameworks, applyPostCallContactFrameworks } from "./contact-service.js";
import { applyQualificationToDeal } from "./meddpicc-qualify-service.js";
import { applyTechnicalCommitToDeal } from "./technical-commit-service.js";
import {
  rollupDealTractionAfterPostCall,
  regenerateSummariesAfterPostCall,
  persistArrAfterPostCall,
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
import { getAccountEngagementContext } from "./account-context.js";
import { sessionUserId, effectiveSessionUserId } from "./session.js";
import {
  persistPass6ProductGaps,
  maybeRunGapClusteringAfterPass6,
} from "./product-signal-service.js";

/**
 * Resolve lifecycle spine after prep generation.
 * @param {object} session
 * @param {object} payload prep form input
 * @param {object} prep generated prep JSON
 * @param {object} meta { company, domain, additionalContext }
 */
export async function linkPrepToLifecycle(session, payload, prep, meta) {
  const ownerId = effectiveSessionUserId(session) || sessionUserId(session);
  if (!ownerId || !session?.teamId) return null;

  const { accountId, primaryContactId, account } = await upsertAccountFromPrep({
    companyName: payload.companyName,
    companyDomain: payload.companyDomain || meta?.companyDomain,
    prospectEmail: payload.prospectEmail,
    prospectEmails: payload.prospectEmails,
    domain: meta?.domain || meta?.companyDomain,
    prep,
    researchBundle: meta?.researchBundle,
    contactDrafts: meta?.contactDrafts,
    actorId: ownerId,
  });

  await ensureSeTeamForPrepActor(accountId, ownerId);

  const lifecycle = await getOrCreateLifecycle(ownerId, accountId, session.teamId, {
    title: account?.name || meta?.company || payload.companyName,
    primaryContactId,
    actorId: ownerId,
    orgId: session.orgId || account?.orgId || null,
    prepType: payload.prepType || "new_business",
    dealId: payload.dealId || meta?.dealId || null,
  });

  const prepBrief = await attachPrep(
    lifecycle.id,
    {
      id: newId("prep"),
      lifecycleId: lifecycle.id,
      dealId: lifecycle.dealId || null,
      ownerId,
      teamId: session.teamId,
      orgId: session.orgId || lifecycle.orgId || null,
      accountId,
      input: payload,
      prep,
      meta: meta || { company: payload.companyName },
    },
    ownerId
  );

  const emails = collectProspectEmails({
    prospectEmail: payload.prospectEmail,
    prospectEmails: payload.prospectEmails,
  });
  if (prep && emails.length) {
    await applyPrepContactFrameworks(accountId, prep, emails, {
      lifecycleId: lifecycle.id,
      actorId: ownerId,
      prepBriefId: prepBrief.id,
      dealId: lifecycle.dealId || null,
    });
  }

  return { lifecycle, prepBrief, accountId, dealId: lifecycle.dealId || null };
}

/**
 * Resolve lifecycle spine after post-call analysis.
 * @param {object} session
 * @param {object} payload { recordingUrl, recordingPassword }
 * @param {object} data API response { analysis, transcriptMeta }
 * @param {object} record history record from savePostCallHistory
 */
export async function linkPostCallToLifecycle(session, payload, data, record) {
  const ownerId = effectiveSessionUserId(session) || sessionUserId(session);
  if (!ownerId || !session?.teamId) return null;

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
    record?.title?.split("—")[0]?.trim() ||
    "";

  let account = company ? await findAccountByCompanyName(company) : null;
  if (!account && company) {
    const { accountId } = await upsertAccountFromPrep({
      companyName: company,
      domain: payload?.companyDomain || null,
      actorId: ownerId,
    });
    account = { id: accountId, name: company };
  }
  if (!account) {
    console.warn("[dual-write] post-call skipped — no company/account to attach");
    return null;
  }

  await ensureSeTeamForPrepActor(account.id, ownerId);

  const engagementCtx = getAccountEngagementContext();
  const ctxMatchesAccount = engagementCtx.accountId === account.id;
  const prepType = payload?.prepType || (ctxMatchesAccount ? engagementCtx.prepType : undefined);
  const dealId =
    payload?.dealId ||
    record?.dealId ||
    (ctxMatchesAccount ? engagementCtx.dealId : null) ||
    null;

  const lifecycle = await getOrCreateLifecycle(ownerId, account.id, session.teamId, {
    title: account.name || company,
    actorId: ownerId,
    orgId: session.orgId || null,
    dealId,
    prepType: prepType || undefined,
    useSessionContext: true,
  });

  const identityKey = callIdentityKey(record || { zoomLink: payload?.recordingUrl, analysis, id: record?.id });
  const qip = data?.scorecard;
  const qualityScore =
    typeof qip?.rawScore === "number"
      ? qip.rawScore
      : analysis?.qualityCoach?.overall ?? analysis?.qualityCoach?.overallScore ?? null;

  const postCall = await attachPostCall(
    lifecycle.id,
    {
      id: record?.id || newId("postCall"),
      lifecycleId: lifecycle.id,
      dealId: lifecycle.dealId || null,
      ownerId,
      teamId: session.teamId,
      orgId: session.orgId || lifecycle.orgId || null,
      accountId: account.id,
      zoomLink: payload?.recordingUrl || record?.zoomLink,
      title: record?.title,
      callIdentityKey: identityKey,
      analysis,
      transcriptMeta: data?.transcriptMeta || record?.transcriptMeta,
      qualityScore: typeof qualityScore === "number" ? qualityScore : null,
      callType: data?.analysisMeta?.callType || data?.confirmed?.callType || payload?.callType || null,
      analysisConfidence: data?.analysisMeta?.analysisConfidence ?? qip?.confidence ?? null,
      provisional: data?.analysisMeta?.provisional ?? qip?.provisional ?? false,
      rubricVersion: data?.analysisMeta?.rubricVersion || qip?.rubricVersion || null,
    },
    ownerId
  );

  if (qip) {
    try {
      await persistScorecardDraft(qip, {
        callId: postCall.id,
        ownerId,
        teamId: session.teamId,
        orgId: session.orgId || lifecycle.orgId || null,
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
        ownerId,
        teamId: session.teamId,
        orgId: session.orgId || lifecycle.orgId || null,
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
        ownerId,
        teamId: session.teamId,
        orgId: session.orgId || lifecycle.orgId || null,
      });
    } catch (err) {
      console.warn("[dual-write] timeline persist failed:", err?.message || err);
    }
  }

  const persistCtx = {
    callId: postCall.id,
    dealId: lifecycle.dealId || dealId || null,
    ownerId,
    teamId: session.teamId,
    orgId: session.orgId || lifecycle.orgId || null,
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

  try {
    await applyPostCallContactFrameworks(account.id, analysis, {
      lifecycleId: lifecycle.id,
      actorId: ownerId,
      postCallId: postCall.id,
      dealId: lifecycle.dealId || null,
      qualification,
    });
  } catch (err) {
    console.warn("[dual-write] contact frameworks failed:", err?.message || err);
  }

  return { lifecycle, postCall, accountId: account.id };
}

/**
 * Link imported task to lifecycle when company/context known.
 */
export async function linkTaskToLifecycle(session, task, lifecycleId) {
  const ownerId = sessionUserId(session);
  if (!ownerId || !session?.teamId || !lifecycleId) return null;

  return attachTask(
    lifecycleId,
    {
      ...task,
      id: task.id || newId("task"),
      lifecycleId,
      ownerId,
      teamId: session.teamId,
      orgId: session.orgId || null,
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
