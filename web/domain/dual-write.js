/**
 * Bridge prep/post-call flows to the lifecycle domain layer (dual-write).
 */

import { upsertAccountFromPrep, findAccountByCompanyName, collectProspectEmails, ensureSeTeamForPrepActor } from "./account-service.js";
import { getOrCreateLifecycle, attachPrep, attachPostCall, attachTask } from "./lifecycle-service.js";
import { applyPrepContactFrameworks, applyPostCallContactFrameworks } from "./contact-service.js";
import { newId, now } from "./types.js";
import { callIdentityKey } from "../call-identity.js";
import { sessionUserId } from "./session.js";

/**
 * Resolve lifecycle spine after prep generation.
 * @param {object} session
 * @param {object} payload prep form input
 * @param {object} prep generated prep JSON
 * @param {object} meta { company, domain, additionalContext }
 */
export async function linkPrepToLifecycle(session, payload, prep, meta) {
  const ownerId = sessionUserId(session);
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
    orgId: session.orgId || null,
  });

  const prepBrief = await attachPrep(
    lifecycle.id,
    {
      id: newId("prep"),
      lifecycleId: lifecycle.id,
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
    });
  }

  return { lifecycle, prepBrief, accountId };
}

/**
 * Resolve lifecycle spine after post-call analysis.
 * @param {object} session
 * @param {object} payload { recordingUrl, recordingPassword }
 * @param {object} data API response { analysis, transcriptMeta }
 * @param {object} record history record from savePostCallHistory
 */
export async function linkPostCallToLifecycle(session, payload, data, record) {
  const ownerId = sessionUserId(session);
  if (!ownerId || !session?.teamId) return null;

  const analysis = data?.analysis || record?.analysis || {};
  const company =
    analysis?.callHeader?.company ||
    analysis?.callHeader?.account ||
    record?.title?.split("—")[0]?.trim() ||
    "";

  let account = company ? await findAccountByCompanyName(company) : null;
  if (!account && company) {
    const { accountId } = await upsertAccountFromPrep({ companyName: company });
    account = { id: accountId, name: company };
  }
  if (!account) return null;

  await ensureSeTeamForPrepActor(account.id, ownerId);

  const lifecycle = await getOrCreateLifecycle(ownerId, account.id, session.teamId, {
    title: account.name || company,
    actorId: ownerId,
    orgId: session.orgId || null,
  });

  const identityKey = callIdentityKey(record || { zoomLink: payload?.recordingUrl, analysis, id: record?.id });
  const qualityScore = analysis?.qualityCoach?.overall ?? analysis?.qualityCoach?.overallScore ?? null;

  const postCall = await attachPostCall(
    lifecycle.id,
    {
      id: record?.id || newId("postCall"),
      lifecycleId: lifecycle.id,
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
    },
    ownerId
  );

  await applyPostCallContactFrameworks(account.id, analysis, {
    lifecycleId: lifecycle.id,
    actorId: ownerId,
    postCallId: postCall.id,
  });

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
