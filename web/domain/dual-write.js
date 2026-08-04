/**
 * Bridge prep/post-call flows to the lifecycle domain layer (dual-write).
 */

import { upsertAccountFromPrep, findAccountByCompanyName, collectProspectEmails, ensureSeTeamForPrepActor, invalidateSessionListCache } from "./account-service.js?v=2.1";
import { getOrCreateLifecycle, attachPrep, attachPostCall, attachTask } from "./lifecycle-service.js";
import { applyPrepContactFrameworks, applyPostCallContactFrameworks } from "./contact-service.js";
import { applyQualificationToDeal } from "./meddpicc-qualify-service.js";
import { applyTechnicalCommitToDeal } from "./technical-commit-service.js";
import {
  rollupDealTractionAfterPostCall,
  regenerateSummariesAfterPostCall,
  persistArrAfterPostCall,
  linkContactsToDealRecord,
  createDealWithExplicitTitle,
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
import { getAccountEngagementContext } from "./account-context.js";
import { sessionUserId, effectiveSessionUserId } from "./session.js";
import {
  persistPass6ProductGaps,
  maybeRunGapClusteringAfterPass6,
} from "./product-signal-service.js";

/**
 * Emails of the people on a post-call, customer-confirmed addresses first.
 *
 * The SE types these into the intake form (`prospectEmails`, mirrored as `participantEmails`) and
 * then ticks the customer attendees at the confirm gate. `customerIdentities` are free-form person
 * labels that often, but not always, carry an address. Order is load-bearing:
 * `upsertAccountFromPrep` makes the first email the primary contact, and someone the SE explicitly
 * confirmed as a customer is a better primary than whichever address happened to be typed first.
 * @param {object} payload post-call save payload
 * @returns {string[]} lower-cased, deduped
 */
function postCallParticipantEmails(payload) {
  const seen = new Set();
  /** @type {string[]} */
  const out = [];
  const add = (raw) => {
    const email = String(raw || "").trim().toLowerCase();
    if (!email.includes("@") || seen.has(email)) return;
    seen.add(email);
    out.push(email);
  };
  for (const label of payload?.confirmedIdentities?.customerIdentities || []) {
    const match = String(label || "").match(/[^\s<>,;"']+@[^\s<>,;"']+/);
    if (match) add(match[0]);
  }
  for (const email of payload?.prospectEmails || []) add(email);
  for (const email of payload?.participantEmails || []) add(email);
  return out;
}

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
  const ownerId = effectiveSessionUserId(session) || sessionUserId(session);
  if (!ownerId || !session?.teamId) return null;

  const {
    accountId,
    contactIds,
    primaryContactId,
    contactIdByEmail,
    account,
  } = await upsertAccountFromPrep({
    companyName: payload.companyName,
    // The CRM panel's explicit selection. Was resolved into the payload and then dropped here,
    // so the account the SE picked was re-derived from the typed name and could fork a duplicate.
    accountId: payload.accountId || meta?.accountId || null,
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
    // Set only by the "+ New deal" choice in the pre-call CRM panel. Strict === true so a
    // truthy leftover in a re-submitted stored payload cannot silently fork a second deal.
    createNewDeal: payload.createNewDeal === true,
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

  await linkContactsToDeal(lifecycle.dealId || null, accountId, contactIds, primaryContactId);

  invalidateSessionListCache(session);
  return {
    lifecycle,
    prepBrief,
    accountId,
    contactIds,
    primaryContactId,
    contactIdByEmail,
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
    record?.title?.split("-")[0]?.trim() ||
    "";

  if (!company) {
    console.warn("[dual-write] post-call skipped. no company/account to attach");
    return null;
  }

  // ---- Account + contacts, BEFORE the lifecycle/deal. ---------------------------------------
  // This ordering looks arbitrary and is not. getOrCreateLifecycle → resolveDealForEngagement
  // stamps `primaryContactId` onto the deal it creates and never backfills it, so a deal born
  // before its contacts is permanently pointed at null. Contacts used to be ensured dead last, by
  // applyPostCallContactFrameworks inside a try/catch that only console.warn'd — which is how
  // post-calls shipped an account and a deal with zero contacts and no signal to the caller.
  //
  // The upsert is unconditional now, not just when the account is missing: an account that already
  // exists still needs its participants turned into contacts, and this is the only place that does
  // it before deal creation. It is idempotent (slug lookup, then contacts matched by email).
  //
  // Still NOT atomic, and cannot be — neither local-store nor firestore-store exposes a
  // transaction, so a throw between these writes and the deal write leaves the account and its
  // contacts committed with no deal. That is the cheap direction to fail: re-running the same call
  // re-uses the contacts by email and completes the deal. Failing the other way round (deal
  // without contacts) is what this reordering exists to stop, and it cannot self-heal.
  const participantEmails = postCallParticipantEmails(payload);
  const store = getStore();
  let knownAccount = null;
  if (payload?.createNewAccount) {
    knownAccount = null;
  } else if (payload?.accountId) {
    knownAccount = await store.getAccount(payload.accountId);
  }
  if (!knownAccount && !payload?.createNewAccount) {
    knownAccount = await findAccountByCompanyName(company, payload?.companyDomain);
  }
  const upserted = await upsertAccountFromPrep({
    accountId: payload?.createNewAccount ? null : payload?.accountId || knownAccount?.id || null,
    createNewAccount: payload?.createNewAccount === true,
    // `record.title` ("Acme - Discovery") is a display string: good enough to find an account,
    // not good enough to rename one, so an account we already know keeps its own name.
    companyName: knownAccount?.name || company,
    companyDomain: payload?.companyDomain || knownAccount?.domain || null,
    prospectEmails: participantEmails,
    actorId: ownerId,
  });
  const { contactIds, primaryContactId, contactIdByEmail } = upserted;
  const account = upserted.account || { id: upserted.accountId, name: company };

  await ensureSeTeamForPrepActor(account.id, ownerId);

  const engagementCtx = getAccountEngagementContext();
  const ctxMatchesAccount = engagementCtx.accountId === account.id;
  const prepType = payload?.prepType || (ctxMatchesAccount ? engagementCtx.prepType : undefined);
  let dealId =
    payload?.dealId ||
    record?.dealId ||
    (ctxMatchesAccount && !payload?.createNewDeal ? engagementCtx.dealId : null) ||
    null;

  if (payload?.createNewDeal) {
    const newDeal = await createDealWithExplicitTitle(
      account.id,
      ownerId,
      session.teamId,
      session.orgId || null,
      {
        title: payload.newDealTitle,
        type: payload.newDealType,
        accountName: account.name || company,
      },
    );
    dealId = newDeal.id;
  }

  const lifecycle = await getOrCreateLifecycle(ownerId, account.id, session.teamId, {
    title: account.name || company,
    // Resolved above; the deal created here is the only chance to set it.
    primaryContactId,
    actorId: ownerId,
    orgId: session.orgId || null,
    dealId,
    prepType: prepType || undefined,
    useSessionContext: true,
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
      title: callTitle,
      callIdentityKey: identityKey,
      analysis,
      transcriptMeta: data?.transcriptMeta || record?.transcriptMeta,
      qualityScore: typeof qualityScore === "number" ? qualityScore : null,
      callType,
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
    contactIdByEmail,
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
  const contactIds = [];
  for (const email of emails) {
    const c = store.findContactByAccountEmail ? await store.findContactByAccountEmail(account.id, email) : null;
    if (c?.id) contactIds.push(c.id);
  }

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
