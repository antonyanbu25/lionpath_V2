/**
 * Worker embedding API — precompute document vectors at write time.
 */

import { WORKER_BASE_URL } from "../firebase-config.js";
import { getStore } from "./store.js";
import { now } from "./types.js";
import {
  buildAccountSearchableText,
  buildCallSearchableText,
  buildDealSearchableText,
} from "./rag-embed-text.js";

export const EMBEDDING_MODEL = "text-embedding-004";

/**
 * @param {string} text
 * @returns {Promise<{ embedding: number[], embeddingModel: string }|null>}
 */
export async function fetchEmbedding(text) {
  const trimmed = String(text || "").trim();
  if (!trimmed) return null;

  try {
    const res = await fetch(`${WORKER_BASE_URL}/api/embed`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ text: trimmed }),
    });
    if (!res.ok) return null;
    const data = await res.json();
    if (!Array.isArray(data?.embedding) || !data.embedding.length) return null;
    return {
      embedding: data.embedding,
      embeddingModel: data.embeddingModel || EMBEDDING_MODEL,
    };
  } catch (err) {
    console.warn("[embed-service] fetch failed:", err?.message || err);
    return null;
  }
}

/**
 * @param {object} summary
 * @param {{ objectionSummaries?: object[] }} [opts]
 */
export async function embedAndPersistCallSummary(summary, opts = {}) {
  if (!summary?.id) return null;
  const store = getStore();
  if (!store.upsertCallSummary) return null;

  const text = buildCallSearchableText(summary, opts);
  const result = await fetchEmbedding(text);
  if (!result) return null;

  const row = {
    ...summary,
    embedding: result.embedding,
    embeddingModel: result.embeddingModel,
    updatedAt: now(),
  };
  await store.upsertCallSummary(row);
  return row;
}

/** @param {string} accountId */
export async function embedAndPersistAccount(accountId) {
  if (!accountId) return null;
  const store = getStore();
  if (!store.getAccount || !store.updateAccount) return null;

  const account = await store.getAccount(accountId);
  if (!account) return null;

  const contacts = store.listContactsByAccount ? await store.listContactsByAccount(accountId) : [];
  const text = buildAccountSearchableText(account, contacts);
  const result = await fetchEmbedding(text);
  if (!result) return null;

  return store.updateAccount(accountId, {
    embedding: result.embedding,
    embeddingModel: result.embeddingModel,
    updatedAt: now(),
  });
}

/** @param {string} dealId @param {object|null} [account] */
export async function embedAndPersistDeal(dealId, account = null) {
  if (!dealId) return null;
  const store = getStore();
  if (!store.getDeal || !store.updateDeal) return null;

  const deal = await store.getDeal(dealId);
  if (!deal) return null;

  const acct =
    account ||
    (deal.accountId && store.getAccount ? await store.getAccount(deal.accountId) : null);
  const text = buildDealSearchableText(deal, acct);
  const result = await fetchEmbedding(text);
  if (!result) return null;

  return store.updateDeal(dealId, {
    embedding: result.embedding,
    embeddingModel: result.embeddingModel,
    updatedAt: now(),
  });
}
