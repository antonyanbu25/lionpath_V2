/**
 * Firestore field masks — keep 768-dim embedding vectors off list/query paths.
 */

/** @type {readonly string[]} */
export const CALL_SUMMARY_LIST_FIELDS = [
  "ownerId",
  "ownerName",
  "teamId",
  "orgId",
  "accountId",
  "accountName",
  "dealId",
  "dealTitle",
  "dealStage",
  "dealType",
  "callType",
  "title",
  "aiShortForm",
  "createdAt",
  "updatedAt",
  "qualityScore",
  "qipOverall",
  "qipCategoryScores",
  "analysisConfidence",
  "provisional",
  "rubricVersion",
  "productsDiscussed",
  "topGapKeys",
  "followUpCount",
  "objectionCount",
  "hasVideoFacts",
  "searchTokens",
  "embeddingModel",
];

/** @type {readonly string[]} */
export const ACCOUNT_LIST_FIELDS = [
  "name",
  "domain",
  "slug",
  "industry",
  "programPhase",
  "metadata",
  "seTeam",
  "primarySeUserId",
  "createdAt",
  "updatedAt",
  "embeddingModel",
];

/** @type {readonly string[]} */
export const DEAL_LIST_FIELDS = [
  "accountId",
  "type",
  "stage",
  "status",
  "ownerId",
  "teamId",
  "orgId",
  "primaryContactId",
  "title",
  "prepCount",
  "postCallCount",
  "openTaskCount",
  "latestQualityScore",
  "arrEstimateLow",
  "arrEstimateHigh",
  "arrEstimatePoint",
  "arrActual",
  "arrSource",
  "arrPriceBookVersion",
  "assumptionsBookVersion",
  "arrInputsJson",
  "arrComputedAt",
  "metadata",
  "createdAt",
  "updatedAt",
  "lastActivityAt",
  "embeddingModel",
];

/** Fields for search-index build — list projection plus embedding vector. */
export const CALL_SUMMARY_SEARCH_FIELDS = [...CALL_SUMMARY_LIST_FIELDS, "embedding"];
export const ACCOUNT_SEARCH_FIELDS = [...ACCOUNT_LIST_FIELDS, "embedding"];
export const DEAL_SEARCH_FIELDS = [...DEAL_LIST_FIELDS, "embedding"];

/** @param {object} row */
export function stripEmbeddingFields(row) {
  if (!row || typeof row !== "object") return row;
  const { embedding, ...rest } = row;
  return rest;
}
