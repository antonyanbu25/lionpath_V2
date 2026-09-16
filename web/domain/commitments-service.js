/**
 * Persist Pass 7 drafts to followUps / objections / momDrafts collections.
 * Never auto-sends MoM — sentAt stays null until a human send action.
 */

import { getStore } from "./store.js";
import { newId, now } from "./types.js";

/**
 * @param {object[]} drafts — FollowUpDraft[]
 * @param {{ callId: string, dealId?: string|null, ownerId: string, teamId: string, orgId: string, accountId: string }} ctx
 * @returns {object[]}
 */
export function buildFollowUpsDetail(drafts, ctx) {
  if (!ctx?.callId || !ctx?.ownerId) return [];
  const ts = now();
  const rows = [];
  for (const draft of drafts || []) {
    if (!draft?.description) continue;
    rows.push({
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
    });
  }
  return rows;
}

export async function persistFollowUpsDraft(drafts, ctx) {
  const rows = buildFollowUpsDetail(drafts, ctx);
  if (!rows.length) return [];

  const store = getStore();
  const existing = store.listFollowUpsByCall ? await store.listFollowUpsByCall(ctx.callId) : [];
  for (const prev of existing || []) {
    if (store.deleteFollowUp) await store.deleteFollowUp(prev.id);
  }
  for (const row of rows) {
    await store.upsertFollowUp(row);
  }
  return rows;
}

/**
 * @param {object[]} drafts — ObjectionDraft[]
 * @param {{ callId: string, ownerId: string, teamId: string, orgId: string, accountId: string }} ctx
 * @returns {object[]}
 */
export function buildObjectionsDetail(drafts, ctx) {
  if (!ctx?.callId || !ctx?.ownerId) return [];
  const ts = now();
  const rows = [];
  for (const draft of drafts || []) {
    if (!draft?.objectionText) continue;
    rows.push({
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
    });
  }
  return rows;
}

export async function persistObjectionsDraft(drafts, ctx) {
  const rows = buildObjectionsDetail(drafts, ctx);
  if (!rows.length) return [];

  const store = getStore();
  const existing = store.listObjectionsByCall ? await store.listObjectionsByCall(ctx.callId) : [];
  for (const prev of existing || []) {
    if (store.deleteObjection) await store.deleteObjection(prev.id);
  }
  for (const row of rows) {
    await store.upsertObjection(row);
  }
  return rows;
}

/**
 * @param {object} draft — MomDraftDraft
 * @param {object|null} [prev]
 * @param {{ callId: string, ownerId: string, teamId: string, orgId: string, accountId: string }} ctx
 * @returns {object|null}
 */
export function buildMomDraftDetail(draft, ctx, prev = null) {
  if (!draft?.draftBody || !ctx?.callId || !ctx?.ownerId) return null;
  const ts = now();

  if (prev?.sentAt) {
    return {
      ...prev,
      draftBody: draft.draftBody,
      outcome: draft.outcome ?? prev.outcome ?? null,
      keyPoints: draft.keyPoints ?? prev.keyPoints ?? null,
      actionItems: draft.actionItems ?? prev.actionItems ?? null,
      updatedAt: ts,
    };
  }

  return {
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
}

export async function persistMomDraft(draft, ctx) {
  const store = getStore();
  const existing = store.listMomDraftsByCall ? await store.listMomDraftsByCall(ctx.callId) : [];
  const prev = (existing || [])[0] || null;
  const row = buildMomDraftDetail(draft, ctx, prev);
  if (!row) return null;

  if (prev?.sentAt) {
    await store.upsertMomDraft(row);
    return row;
  }

  for (const old of existing || []) {
    if (store.deleteMomDraft && old.id !== prev?.id) await store.deleteMomDraft(old.id);
  }
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

  if (store.getPostCall && store.upsertPostCall) {
    const postCall = await store.getPostCall(callId);
    if (postCall?.detail) {
      await store.upsertPostCall({
        ...postCall,
        detail: { ...postCall.detail, momDrafts: [row] },
        updatedAt: now(),
      });
      return row;
    }
  }

  if (store.upsertMomDraft) await store.upsertMomDraft(row);
  return row;
}
