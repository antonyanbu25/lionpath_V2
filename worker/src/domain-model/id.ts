/** Centralized entity ID generation — prefixed UUID v4. See docs/ID_STANDARDS.md */

export type EntityIdType =
  | "user"
  | "team"
  | "org"
  | "account"
  | "contact"
  | "lifecycle"
  | "deal"
  | "prep"
  | "postCall"
  | "task"
  | "event"
  | "rubric"
  | "scorecard"
  | "scorecardLine"
  | "scoreOverride"
  | "videoFacts"
  | "timelineSegment"
  | "timelineMarker"
  | "followUp"
  | "objection"
  | "momDraft"
  | "meddpiccDelta"
  | "technicalCommit"
  | "tcDelta"
  | "dealSummary"
  | "accountSummary"
  | "productGap"
  | "whatWorks"
  | "gapCluster";

export const ID_PREFIXES: Record<EntityIdType, string> = {
  user: "usr_",
  team: "team_",
  org: "org_",
  account: "acc_",
  contact: "con_",
  lifecycle: "lc_",
  deal: "deal_",
  prep: "prep_",
  postCall: "call_",
  task: "task_",
  event: "evt_",
  rubric: "rub_",
  scorecard: "scr_",
  scorecardLine: "scl_",
  scoreOverride: "sov_",
  videoFacts: "vf_",
  timelineSegment: "tls_",
  timelineMarker: "tlm_",
  followUp: "fu_",
  objection: "obj_",
  momDraft: "mom_",
  meddpiccDelta: "mdd_",
  technicalCommit: "tc_",
  tcDelta: "tcd_",
  dealSummary: "dsum_",
  accountSummary: "asum_",
  productGap: "pgap_",
  whatWorks: "ww_",
  gapCluster: "gclus_",
};

/** Generate a new entity ID with optional type prefix. */
export function newId(type?: EntityIdType): string {
  const prefix = type ? ID_PREFIXES[type] : "";
  const uuid = crypto.randomUUID();
  return `${prefix}${uuid}`;
}

/** Deterministic internal user id for dummy auth seeds. */
export function stableUserIdForEmail(email: string): string {
  const key = String(email || "")
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "");
  return `usr_dummy_${key || "user"}`;
}

/** Map legacy owner/user ids to current internal ids. */
export function normalizeLegacyUserId(id: string): string {
  const raw = String(id || "");
  if (raw.startsWith("usr_")) return raw;
  if (raw.startsWith("dummy-")) {
    return stableUserIdForEmail(raw.slice("dummy-".length));
  }
  return raw;
}
