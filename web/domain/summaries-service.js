/**
 * Pass 9 — persist dealSummaries + accountSummaries (spec §5, §10, §11.5–§11.6).
 * Evidence-grounded roll-ups in extension collections — never overwrite Account/Deal fields.
 */

import { WORKER_BASE_URL } from "../firebase-config.js";
import { DEAL_TYPE_LABELS } from "./deal-service.js";
import { resolveDealMeddpicc } from "./contact-service.js";
import { getStore } from "./store.js";
import { newId, now } from "./types.js";

const SUMMARIES_URL = `${WORKER_BASE_URL}/api/postcall/summaries`;

/** @type {(() => Promise<string|null>)|null} */
let getAuthToken = null;

/** @param {() => Promise<string|null>} fn */
export function setSummariesAuthGetter(fn) {
  getAuthToken = fn || null;
}

export function clearSummariesAuthGetter() {
  getAuthToken = null;
}

async function authHeaders() {
  /** @type {Record<string, string>} */
  const headers = { "Content-Type": "application/json" };
  if (getAuthToken) {
    try {
      const token = await getAuthToken();
      if (token) headers.Authorization = `Bearer ${token}`;
    } catch {
      /* dummy mode. worker may allow unauthenticated local dev */
    }
  }
  return headers;
}

/**
 * @param {import("./types.js").CallSummaryDoc|import("./types.js").PostCallDoc} call
 * @param {string|null} dealLabel
 */
function buildCallDigestFromSummary(call, dealLabel = null) {
  const date = call.createdAt ? new Date(call.createdAt).toISOString().slice(0, 10) : null;
  return {
    callId: call.id,
    dealId: call.dealId || null,
    dealLabel,
    callType: call.callType || null,
    date,
    callNotes: call.aiShortForm || null,
    momentum: null,
    traction: null,
    openFollowUps: call.followUpCount ?? null,
    objections: call.objectionCount ?? null,
  };
}

/**
 * @param {import("./types.js").PostCallDoc} call
 * @param {string|null} dealLabel
 */
function buildCallDigest(call, dealLabel = null) {
  const header = call.analysis?.callHeader || {};
  const date =
    header.date ||
    (call.createdAt ? new Date(call.createdAt).toISOString().slice(0, 10) : null);
  return {
    callId: call.id,
    dealId: call.dealId || null,
    dealLabel,
    callType: call.callType || call.analysis?.callType || null,
    date,
    callNotes: call.analysis?.callNotes || null,
    momentum: call.analysis?.momentum || null,
    traction: null,
    openFollowUps: null,
    objections: null,
  };
}

async function enrichCallDigestFromSummary(store, call, dealLabel = null) {
  const digest = buildCallDigestFromSummary(call, dealLabel);
  if (call.dealId && store.listDealSignalsByDeal) {
    const signals = await store.listDealSignalsByDeal(call.dealId, 5);
    const forCall = (signals || []).find((s) => s.callId === call.id);
    if (forCall?.traction) digest.traction = forCall.traction;
  }
  return digest;
}

/**
 * @param {import("./store.js").ReturnType<typeof import("./store.js").getStore>} store
 * @param {import("./types.js").PostCallDoc} call
 */
async function enrichCallDigest(store, call, dealLabel = null) {
  const digest = buildCallDigest(call, dealLabel);
  if (store.listFollowUpsByCall) {
    const fus = await store.listFollowUpsByCall(call.id);
    digest.openFollowUps = (fus || []).filter((f) => f.status === "open").length;
  }
  if (store.listObjectionsByCall) {
    const objs = await store.listObjectionsByCall(call.id);
    digest.objections = (objs || []).length;
  }
  if (call.dealId && store.listDealSignalsByDeal) {
    const signals = await store.listDealSignalsByDeal(call.dealId, 5);
    const forCall = (signals || []).find((s) => s.callId === call.id);
    if (forCall?.traction) digest.traction = forCall.traction;
  }
  return digest;
}

function meddpiccSnapshotText(deal, account) {
  const rollup = resolveDealMeddpicc(deal, account);
  if (!rollup) return null;
  const parts = [];
  for (const [key, slot] of Object.entries(rollup)) {
    const val = slot?.value?.trim();
    if (val) parts.push(`${key}: ${val}`);
  }
  return parts.length ? parts.join("; ") : null;
}

function technicalCommitSnapshotText(tc) {
  if (!tc) return null;
  const parts = [];
  if (tc.status) parts.push(`status=${tc.status}`);
  if (tc.incumbent?.value) parts.push(`incumbent=${tc.incumbent.value}`);
  if (tc.competitor?.value) parts.push(`competitor=${tc.competitor.value}`);
  if (tc.aiAttach?.summary) parts.push(`aiAttach=${tc.aiAttach.summary}`);
  return parts.length ? parts.join("; ") : null;
}

/**
 * Assemble Pass 9 worker input from domain store.
 * @param {string} dealId
 * @param {string} accountId
 */
export async function buildSummariesContext(dealId, accountId) {
  const store = getStore();
  const account = await store.getAccount(accountId);
  if (!account) return null;

  const deals = store.listDealsByAccount ? await store.listDealsByAccount(accountId) : [];
  const deal = dealId ? deals.find((d) => d.id === dealId) || (await store.getDeal?.(dealId)) : null;

  const dealLabelById = new Map(
    (deals || []).map((d) => [
      d.id,
      d.title || DEAL_TYPE_LABELS[d.type] || d.type || "Deal",
    ]),
  );

  /** @type {import("../../worker/src/postcall/summaries.ts").SummaryCallDigest[]} */
  const accountCalls = [];
  if (store.listCallSummariesByAccount) {
    const calls = await store.listCallSummariesByAccount(accountId, 80);
    for (const call of calls || []) {
      const label = call.dealId ? dealLabelById.get(call.dealId) || null : null;
      accountCalls.push(await enrichCallDigestFromSummary(store, call, label));
    }
    accountCalls.sort((a, b) => String(a.date || "").localeCompare(String(b.date || "")));
  }

  /** @type {import("../../worker/src/postcall/summaries.ts").DealSummaryContext|null} */
  let dealContext = null;
  if (deal) {
    const dealCallsRaw = store.listCallSummariesByDeal
      ? await store.listCallSummariesByDeal(deal.id, 50)
      : [];
    const dealCalls = [];
    for (const call of dealCallsRaw || []) {
      dealCalls.push(await enrichCallDigestFromSummary(store, call, deal.title || DEAL_TYPE_LABELS[deal.type]));
    }
    dealCalls.sort((a, b) => String(a.date || "").localeCompare(String(b.date || "")));

    let tc = null;
    if (store.getTechnicalCommitByDeal) {
      tc = await store.getTechnicalCommitByDeal(deal.id);
    }
    let latestTraction = null;
    if (store.listDealSignalsByDeal) {
      const signals = await store.listDealSignalsByDeal(deal.id, 1);
      if (signals?.[0]?.traction) {
        latestTraction = `${signals[0].traction}: ${(signals[0].reasonsJson || []).slice(0, 2).join("; ")}`;
      }
    }

    dealContext = {
      dealId: deal.id,
      dealTitle: deal.title || DEAL_TYPE_LABELS[deal.type] || "Deal",
      dealType: deal.type,
      stage: deal.stage,
      accountName: account.name,
      meddpiccSummary: meddpiccSnapshotText(deal, account),
      technicalCommitSummary: technicalCommitSnapshotText(tc),
      latestTraction,
      calls: dealCalls,
    };
  }

  return {
    deal: dealContext,
    account: {
      accountId,
      accountName: account.name,
      deals: (deals || []).map((d) => ({
        dealId: d.id,
        title: d.title || DEAL_TYPE_LABELS[d.type] || d.type,
        type: d.type,
        stage: d.stage,
        status: d.status,
      })),
      calls: accountCalls,
    },
  };
}

/**
 * @param {object} ctx
 * @param {SummaryDraft} draft
 * @param {"deal"|"account"} kind
 */
async function persistSummaryDraft(ctx, draft, kind) {
  if (!draft?.summary?.trim()) return null;
  const store = getStore();
  const ts = now();

  if (kind === "deal" && ctx.dealId) {
    if (!store.upsertDealSummary) return draft;
    const existing = store.getDealSummaryByDeal
      ? await store.getDealSummaryByDeal(ctx.dealId)
      : null;
    const row = {
      id: existing?.id || newId("dealSummary"),
      dealId: ctx.dealId,
      accountId: ctx.accountId,
      summary: draft.summary.trim(),
      generatedAt: ts,
      sourceCallIds: draft.sourceCallIds || [],
      ownerId: ctx.ownerId,
      teamId: ctx.teamId,
      orgId: ctx.orgId || "",
      createdAt: existing?.createdAt || ts,
      updatedAt: ts,
    };
    await store.upsertDealSummary(row);
    return row;
  }

  if (kind === "account" && ctx.accountId) {
    if (!store.upsertAccountSummary) return draft;
    const existing = store.getAccountSummaryByAccount
      ? await store.getAccountSummaryByAccount(ctx.accountId)
      : null;
    const row = {
      id: existing?.id || newId("accountSummary"),
      accountId: ctx.accountId,
      summary: draft.summary.trim(),
      generatedAt: ts,
      sourceCallIds: draft.sourceCallIds || [],
      ownerId: ctx.ownerId,
      teamId: ctx.teamId,
      orgId: ctx.orgId || "",
      createdAt: existing?.createdAt || ts,
      updatedAt: ts,
    };
    await store.upsertAccountSummary(row);
    return row;
  }

  return null;
}

/**
 * Enqueue Pass 9 summary regeneration via Gemini Batch (fire-and-forget).
 * @param {string|null} dealId
 * @param {string} accountId
 * @param {object} ctx
 */
export async function enqueueSummariesAfterPostCall(dealId, accountId, ctx) {
  if (!accountId || !ctx?.ownerId) return null;

  const { WORKER_BASE_URL } = await import("../firebase-config.js");
  const url = `${WORKER_BASE_URL}/api/batch/summaries/enqueue`;
  const headers = { "Content-Type": "application/json" };
  if (typeof getAuthToken === "function") {
    try {
      const token = await getAuthToken();
      if (token) headers.Authorization = `Bearer ${token}`;
    } catch {
      /* local dev */
    }
  }

  const res = await fetch(url, {
    method: "POST",
    headers,
    credentials: "include",
    body: JSON.stringify({
      dealId: dealId || null,
      accountId,
      ownerId: ctx.ownerId,
      teamId: ctx.teamId,
      orgId: ctx.orgId || "",
    }),
  });
  if (!res.ok) {
    const errText = await res.text().catch(() => "");
    throw new Error(errText || `summaries batch enqueue HTTP ${res.status}`);
  }
  return res.json();
}

/**
 * Pass 9 after post-call — rewrite deal + account summaries from all call evidence.
 * @param {string|null} dealId
 * @param {string} accountId
 * @param {object} ctx
 */
export async function regenerateDealAndAccountSummaries(dealId, accountId, ctx) {
  if (!accountId || !ctx?.ownerId) return null;

  const input = await buildSummariesContext(dealId, accountId);
  if (!input?.account?.calls?.length) return null;

  const headers = await authHeaders();
  const res = await fetch(SUMMARIES_URL, {
    method: "POST",
    headers,
    body: JSON.stringify(input),
  });
  if (!res.ok) {
    const errText = await res.text().catch(() => "");
    throw new Error(errText || `summaries HTTP ${res.status}`);
  }
  const result = await res.json();

  const persistCtx = {
    dealId: dealId || null,
    accountId,
    ownerId: ctx.ownerId,
    teamId: ctx.teamId,
    orgId: ctx.orgId || "",
  };

  const dealRow =
    dealId && result.dealSummary
      ? await persistSummaryDraft(persistCtx, result.dealSummary, "deal")
      : null;
  const accountRow = result.accountSummary
    ? await persistSummaryDraft(persistCtx, result.accountSummary, "account")
    : null;

  return { dealSummary: dealRow, accountSummary: accountRow };
}

/** @typedef {{ summary: string, sourceCallIds: string[] }} SummaryDraft */
