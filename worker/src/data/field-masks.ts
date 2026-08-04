/** Firestore list projections — exclude 768-dim embedding vectors from bulk reads. */

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
] as const;

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
] as const;

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
  "metadata",
  "createdAt",
  "updatedAt",
  "lastActivityAt",
  "embeddingModel",
] as const;

export const CALL_SUMMARY_BACKFILL_FIELDS = [
  ...CALL_SUMMARY_LIST_FIELDS,
  "embedding",
] as const;

export const ACCOUNT_BACKFILL_FIELDS = [...ACCOUNT_LIST_FIELDS, "embedding"] as const;
export const DEAL_BACKFILL_FIELDS = [...DEAL_LIST_FIELDS, "embedding"] as const;
