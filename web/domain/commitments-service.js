/**
 * Persist Pass 7 drafts to followUps / objections / momDrafts collections.
 * Never auto-sends MoM — sentAt stays null until a human send action.
 */

import { getStore } from "./store.js";
import { newId, now } from "./types.js";

/**
 * @param {object[]} drafts — FollowUpDraft[]
 * @param {{ callId: string, dealId?: string|null, ownerId: string, teamId: string, orgId: string, accountId: string }} ctx
 */
export async function persistFollowUpsDraft(drafts, ctx) {
  if (!ctx?.callId || !ctx?.ownerId) return [];
  const store = getStore();
  const existing = store.listFollowUpsByCall ? await store.listFollowUpsByCall(ctx.callId) : [];
  for (const prev of existing || []) {
    if (store.deleteFollowUp) await store.deleteFollowUp(prev.id);
  }

  const ts = now();
  const rows = [];
  for (const draft of drafts || []) {
    if (!draft?.description) continue;
    const row = {
      id: newId("followUp"),
      callId: ctx.callId,
      dealId: ctx.dealId || null,
      description: draft.description,
      owner: draft.owner || "se",
      dueDate: draft.dueDate ?? null,
      status: draft.status || "open",
      sourceQuote: draft.sourceQuote ?? null,
      ownerId: ctx.ownerId,
      teamId: ctx.teamId || "",
      orgId: ctx.orgId || "",
      accountId: ctx.accountId || "",
      createdAt: ts,
      updatedAt: ts,
    };
    await store.upsertFollowUp(row);
    rows.push(row);
  }
  return rows;
}

/**
 * @param {object[]} drafts — ObjectionDraft[]
 * @param {{ callId: string, ownerId: string, teamId: string, orgId: string, accountId: string }} ctx
 */
export async function persistObjectionsDraft(drafts, ctx) {
  if (!ctx?.callId || !ctx?.ownerId) return [];
  const store = getStore();
  const existing = store.listObjectionsByCall ? await store.listObjectionsByCall(ctx.callId) : [];
  for (const prev of existing || []) {
    if (store.deleteObjection) await store.deleteObjection(prev.id);
  }

  const ts = now();
  const rows = [];
  for (const draft of drafts || []) {
    if (!draft?.objectionText) continue;
    const row = {
      id: newId("objection"),
      callId: ctx.callId,
      objectionText: draft.objectionText,
      handling: draft.handling ?? null,
      landed: !!draft.landed,
      theme: draft.theme ?? null,
      ownerId: ctx.ownerId,
      teamId: ctx.teamId || "",
      orgId: ctx.orgId || "",
      accountId: ctx.accountId || "",
      createdAt: ts,
      updatedAt: ts,
    };
    await store.upsertObjection(row);
    rows.push(row);
  }
  return rows;
}

/**
 * Upsert one MoM draft per call. Never sets sentAt/sentBy.
 * If a draft was already sent, keep sentAt/sentBy/editedBody and refresh draftBody only.
 * @param {object} draft — MomDraftDraft
 * @param {{ callId: string, ownerId: string, teamId: string, orgId: string, accountId: string }} ctx
 */
export async function persistMomDraft(draft, ctx) {
  if (!draft?.draftBody || !ctx?.callId || !ctx?.ownerId) return null;

  const store = getStore();
  const existing = store.listMomDraftsByCall ? await store.listMomDraftsByCall(ctx.callId) : [];
  const prev = (existing || [])[0] || null;
  const ts = now();

  // Already sent — preserve send audit; refresh model draft for reference only.
  if (prev?.sentAt) {
    const row = {
      ...prev,
      draftBody: draft.draftBody,
      outcome: draft.outcome ?? prev.outcome ?? null,
      keyPoints: draft.keyPoints ?? prev.keyPoints ?? null,
      actionItems: draft.actionItems ?? prev.actionItems ?? null,
      updatedAt: ts,
    };
    await store.upsertMomDraft(row);
    return row;
  }

  for (const old of existing || []) {
    if (store.deleteMomDraft && old.id !== prev?.id) await store.deleteMomDraft(old.id);
  }

  const row = {
    id: prev?.id || newId("momDraft"),
    callId: ctx.callId,
    draftBody: draft.draftBody,
    editedBody: prev?.editedBody ?? null,
    outcome: draft.outcome ?? null,
    keyPoints: Array.isArray(draft.keyPoints) ? draft.keyPoints : [],
    actionItems: Array.isArray(draft.actionItems) ? draft.actionItems : [],
    sentAt: null,
    sentBy: null,
    ownerId: ctx.ownerId,
    teamId: ctx.teamId || "",
    orgId: ctx.orgId || "",
    accountId: ctx.accountId || "",
    createdAt: prev?.createdAt || ts,
    updatedAt: ts,
  };
  await store.upsertMomDraft(row);
  return row;
}

/**
 * Human send action — never called by Pass 7.
 * @param {string} callId
 * @param {string} sentBy — User.id
 * @param {string} [editedBody]
 */
export async function markMomSent(callId, sentBy, editedBody) {
  if (!callId || !sentBy) return null;
  const store = getStore();
  const existing = store.listMomDraftsByCall ? await store.listMomDraftsByCall(callId) : [];
  const prev = (existing || [])[0];
  if (!prev) return null;
  const row = {
    ...prev,
    editedBody: editedBody != null ? editedBody : prev.editedBody,
    sentAt: now(),
    sentBy,
    updatedAt: now(),
  };
  await store.upsertMomDraft(row);
  return row;
}
