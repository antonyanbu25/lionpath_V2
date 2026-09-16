/**
 * Concatenated searchable text for RAG document embeddings (write-time).
 */

/** @param {object} summary callSummaries row or buildCallSummary output */
export function buildCallSearchableText(summary, opts = {}) {
  const objectionSummaries = (opts.objectionSummaries || [])
    .map((o) => o?.summary || o?.objectionText || o?.text || o?.label)
    .filter(Boolean);
  const parts = [
    summary?.accountName,
    summary?.dealTitle,
    summary?.title,
    summary?.aiShortForm,
    ...(summary?.topGapKeys || []),
    ...objectionSummaries,
  ];
  return parts.filter(Boolean).join(" ").trim();
}

/** @param {object} account */
export function buildAccountSearchableText(account, contacts = []) {
  const parts = [account?.name, account?.domain, account?.industry, account?.slug];
  for (const c of contacts || []) {
    parts.push(c?.name, c?.email, c?.title);
  }
  return parts.filter(Boolean).join(" ").trim();
}

/** @param {object} deal @param {object|null} [account] */
export function buildDealSearchableText(deal, account = null) {
  const parts = [
    account?.name,
    account?.domain,
    deal?.title,
    deal?.stage,
    deal?.type,
    deal?.status,
  ];
  return parts.filter(Boolean).join(" ").trim();
}
