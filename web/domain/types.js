export { newId, stableUserIdForEmail, dummyUidForEmail, normalizeLegacyUserId, ID_PREFIXES } from "./id.js";
import { isFreeMailDomain } from "./constants.js";

/**
 * @typedef {"se" | "manager" | "pm" | "admin"} UserRole
 * @typedef {"active"|"inactive"} UserStatus
 * @typedef {{ id: string, email: string, authUid: string|null, displayName: string, role: UserRole, teamId: string|null, orgId: string|null, managerId: string|null, jobTitle: string|null, status: UserStatus, avatarDataUrl?: string|null, createdAt: number, updatedAt: number }} User
 * @typedef {{ id: string, name: string, orgId: string|null, managerId: string, memberIds: string[], createdAt: number, updatedAt: number }} Team
 * @typedef {{ id: string, name: string, directorId: string, seniorLeaderIds: string[], teamIds: string[], createdAt: number, updatedAt: number }} Org
 * @typedef {"primary"|"secondary"} SeTeamRole
 * @typedef {{ seUserId: string, role: SeTeamRole, addedAt: number, addedBy?: string }} AccountSeTeamMember
 * @typedef {{ id: string, name: string, domain: string|null, slug: string, industry?: string, programPhase?: "new_business"|"live"|"expansion", metadata?: object, seTeam?: AccountSeTeamMember[], primarySeUserId?: string|null, embedding?: number[]|null, embeddingModel?: string|null, createdAt: number, updatedAt: number }} Account
 * @typedef {"new_business"|"expansion"} DealType
 * @typedef {"active"|"paused"|"archived"|"closed_won_grace"} DealStatus
 * @typedef {{ value?: string, status?: "unknown"|"partial"|"confirmed", source?: string, updatedAt?: number, contactId?: string }} MeddpiccFieldSlot
 * @typedef {{ metrics?: MeddpiccFieldSlot, economicBuyer?: MeddpiccFieldSlot, decisionCriteria?: MeddpiccFieldSlot, decisionProcess?: MeddpiccFieldSlot, paperProcess?: MeddpiccFieldSlot, identifyPain?: MeddpiccFieldSlot, champion?: MeddpiccFieldSlot, competition?: MeddpiccFieldSlot, lastUpdatedAt?: number, completionScore?: number }} MeddpiccRollup
 * Deal.latestQualityScore is deprecated — QIP belongs on the call, not the deal (POST_CALL_SPEC_V2 §2.1). Field retained until migration.
 * @typedef {{ name?: string, email?: string }} DealAe   Account Executive on the deal (name and/or email).
 * @typedef {{ id: string, accountId: string, type: DealType, stage: LifecycleStage, status: DealStatus, ownerId: string, teamId: string, orgId: string, primaryContactId: string|null, title: string, prepCount: number, postCallCount: number, openTaskCount: number, latestQualityScore?: number|null, wonAt?: number|null, lostAt?: number|null, wonAtInferred?: boolean, lastActorId?: string|null, arrEstimateLow?: number|null, arrEstimateHigh?: number|null, arrEstimatePoint?: number|null, arrActual?: number|null, arrSource?: "derived_from_agents"|"opp_amount"|"se_override"|null, arrPriceBookVersion?: string|null, assumptionsBookVersion?: string|null, arrInputsJson?: object|null, arrComputedAt?: number|null, metadata?: { meddpicc?: MeddpiccRollup, ae?: DealAe }, embedding?: number[]|null, embeddingModel?: string|null, createdAt: number, updatedAt: number, lastActivityAt: number }} Deal
 * @typedef {{ id: string, accountId: string, email: string, name?: string, title?: string, role?: string, metadata?: object, createdAt: number, updatedAt: number }} Contact
 * Deal↔Contact is many-to-many, mirroring Salesforce's OpportunityContactRole: an account's
 * contacts are not automatically on every one of its deals, and a contact carries a different
 * role on each deal they touch. `Deal.primaryContactId` is retained as the denormalised pointer
 * to the row with isPrimary — the join row is authoritative, the field is the fast read.
 * @typedef {"economic_buyer"|"champion"|"evaluator"|"influencer"|"technical_buyer"|"end_user"|"unknown"} DealContactRole
 * @typedef {{ id: string, dealId: string, contactId: string, accountId: string, ownerId: string, teamId: string, orgId: string, role: DealContactRole, isPrimary: boolean, createdAt: number, updatedAt: number }} DealContact
 * @typedef {"contact_created"|"field_updated"|"disc_updated"|"influence_updated"|"linked_from_prep"|"linked_from_postcall"} ContactEventType
 * @typedef {{ id: string, contactId: string, type: ContactEventType, actorId: string, timestamp: number, payload: object }} ContactEvent
 * @typedef {"research"|"discovery"|"demo"|"evaluation"|"business_case"|"closed_won"|"closed_lost"|"nurture"} LifecycleStage
 * @typedef {"active"|"paused"|"archived"} LifecycleStatus
 * Lifecycle.latestQualityScore is deprecated — mirror of deprecated Deal field (POST_CALL_SPEC_V2 §2.1). Field retained until migration.
 * @typedef {{ id: string, dealId?: string|null, ownerId: string, teamId: string, orgId: string, accountId: string, primaryContactId: string|null, stage: LifecycleStage, status: LifecycleStatus, title: string, createdAt: number, updatedAt: number, lastActivityAt: number, prepCount: number, postCallCount: number, openTaskCount: number, latestQualityScore?: number|null }} Lifecycle
 * @typedef {"lifecycle_created"|"stage_changed"|"prep_generated"|"postcall_analyzed"|"task_created"|"task_completed"|"contact_updated"|"lifecycle_archived"|"artifact_imported"|"se_added"|"se_removed"|"primary_se_changed"} LifecycleEventType
 * @typedef {{ id: string, lifecycleId: string, type: LifecycleEventType, actorId: string, timestamp: number, payload: object }} LifecycleEvent
 * @typedef {{ id: string, lifecycleId: string, dealId?: string|null, ownerId: string, teamId: string, orgId: string, accountId: string, input: object, prep: object, meta: { company: string, domain?: string, additionalContext?: string }, createdAt: number }} PrepBrief
 * @typedef {{ aeName?: string|null, aeEmail?: string|null, primarySeUserId?: string|null, secondarySeUserIds?: string[], contactIds?: string[] }} CallIdentities   AE + primary/secondary SE + customer contacts on a call.
 * @typedef {{ videoFacts?: object[], timelineSegments?: object[], timelineMarkers?: object[], technicalCommit?: object|null, tcDeltas?: object[], meddpiccDeltas?: object[], objections?: object[], followUps?: object[], momDrafts?: object[], dealSignals?: object[], productGaps?: object[], whatWorks?: object[] }} PostCallDetailMap
 * @typedef {{ id: string, lifecycleId: string, dealId?: string|null, ownerId: string, teamId: string, orgId: string, accountId: string, zoomLink?: string, title?: string, callIdentityKey: string, analysis: object, transcriptMeta?: unknown, qualityScore?: number|null, analysisGcsUri?: string|null, analysisByteSize?: number|null, transcriptMetaGcsUri?: string|null, transcriptMetaByteSize?: number|null, detail?: PostCallDetailMap|null, detailGcsUri?: string|null, detailByteSize?: number|null, arrSnapshot?: object|null, identities?: CallIdentities, createdAt: number, updatedAt: number }} PostCallDoc
 * @typedef {{ id: string, ownerId: string, ownerName?: string|null, teamId: string, orgId?: string|null, accountId: string, accountName?: string|null, dealId?: string|null, dealTitle?: string|null, dealStage?: string|null, dealType?: string|null, callType?: string|null, title?: string|null, aiShortForm?: string|null, createdAt: number, updatedAt: number, qualityScore?: number|null, qipOverall?: number|null, qipCategoryScores?: object|null, analysisConfidence?: number|null, provisional?: boolean, rubricVersion?: string|null, productsDiscussed?: string[], topGapKeys?: string[], followUpCount?: number, objectionCount?: number, hasVideoFacts?: boolean, searchTokens?: string[], embedding?: number[]|null, embeddingModel?: string|null }} CallSummaryDoc
 * @typedef {{ id: string, lifecycleId: string, dealId?: string|null, ownerId: string, teamId: string, orgId: string, accountId: string, title: string, status: string, source: string, sourceKey?: string, callId?: string, company?: string, due?: string, dueDate?: number|null, createdAt: number, completedAt?: number }} TaskDoc
 */

/** @type {LifecycleStage[]} */
export const LIFECYCLE_STAGES = [
  "research",
  "discovery",
  "demo",
  "evaluation",
  "business_case",
  "closed_won",
  "closed_lost",
  "nurture",
];

/** @type {Record<LifecycleStage, string>} */
export const STAGE_LABELS = {
  research: "Research",
  discovery: "Discovery",
  demo: "Demo",
  evaluation: "Evaluation",
  business_case: "Business Case",
  closed_won: "Closed Won",
  closed_lost: "Closed Lost",
  nurture: "Nurture",
};

/** @type {Record<LifecycleEventType, string>} */
export const EVENT_LABELS = {
  lifecycle_created: "Lifecycle created",
  stage_changed: "Stage changed",
  prep_generated: "Prep generated",
  postcall_analyzed: "Post-call analyzed",
  task_created: "Task created",
  task_completed: "Task completed",
  contact_updated: "Contact updated",
  lifecycle_archived: "Lifecycle archived",
  artifact_imported: "Artifact imported",
  se_added: "SE added to deal team",
  se_removed: "SE removed from deal team",
  primary_se_changed: "Primary SE changed",
};

/** Max SEs on an account deal team (1 primary + up to 3 secondary). */
export const MAX_SE_TEAM_SIZE = 4;

/** @type {Record<ContactEventType, string>} */
export const CONTACT_EVENT_LABELS = {
  contact_created: "Contact created",
  field_updated: "Field updated",
  disc_updated: "DISC updated",
  influence_updated: "Influence updated",
  linked_from_prep: "Linked from prep",
  linked_from_postcall: "Linked from post-call",
};

/**
 * Buying-committee roles on a deal. Vocabulary taken from the Omni persona hooks in the ICP KB
 * (`worker/src/icp/freshdesk-omni.md` "Persona hooks") so the brief and the CRM speak the same
 * language, and aligned with Salesforce's OpportunityContactRole picklist.
 * @type {DealContactRole[]}
 */
export const DEAL_CONTACT_ROLES = [
  "economic_buyer",
  "champion",
  "evaluator",
  "influencer",
  "technical_buyer",
  "end_user",
  "unknown",
];

/** @type {Record<DealContactRole, string>} */
export const DEAL_CONTACT_ROLE_LABELS = {
  economic_buyer: "Economic buyer",
  champion: "Champion",
  evaluator: "Evaluator",
  influencer: "Influencer",
  technical_buyer: "Technical buyer",
  end_user: "End user",
  unknown: "Unknown",
};

/** Unrecognised roles coerce to "unknown" rather than being rejected — a bad role must not
 *  cost us the link itself, which is the part that carries meaning. */
export function normalizeDealContactRole(role) {
  const r = String(role || "").trim().toLowerCase().replace(/[\s-]+/g, "_");
  return DEAL_CONTACT_ROLES.includes(/** @type {DealContactRole} */ (r)) ? r : "unknown";
}

/** Stable join id, matching the documented `{parentId_childId}` convention in RELATIONSHIPS.md. */
export function dealContactId(dealId, contactId) {
  return `${String(dealId || "").trim()}_${String(contactId || "").trim()}`;
}

/** Normalize company name to lookup slug. prefers corporate domain; ignores free-mail. */
export function normalizeAccountSlug(name, domain) {
  if (domain && !isFreeMailDomain(domain)) {
    const fromDomain = String(domain)
      .toLowerCase()
      .replace(/^www\./, "")
      .replace(/[^a-z0-9.-]+/g, "")
      .slice(0, 48);
    if (fromDomain) return fromDomain;
  }
  const fromName = String(name || "account")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 48);
  return fromName || "account";
}

/** Extract primary domain from email. */
export function domainFromEmail(email) {
  const parts = String(email || "").trim().toLowerCase().split("@");
  if (parts.length !== 2 || !parts[1]) return null;
  return parts[1].replace(/^www\./, "");
}

/** MVP: first post-call auto-advances research → discovery. */
export function stageAfterFirstPostCall(current) {
  if (current === "research") return "discovery";
  return current;
}

/** @param {UserRole} role */
export function isManagerRole(role) {
  return role === "manager" || role === "admin";
}

/** @param {User|null} user @param {string} action @param {{ ownerId?: string, teamId?: string, orgId?: string, seTeamUserIds?: string[], accountOrgId?: string|null }} [resource] */
export function can(user, action, resource = {}) {
  if (!user) return false;
  if (user.role === "admin") return true;

  const isOwner = resource.ownerId && user.id === resource.ownerId;
  const sameTeam = user.teamId && user.teamId === resource.teamId;
  const sameOrg = user.orgId && resource.orgId && user.orgId === resource.orgId;
  const accountSameOrg =
    user.orgId && resource.accountOrgId && user.orgId === resource.accountOrgId;
  const isManager = user.role === "manager";
  const isOrgDirector = user.isOrgDirector === true;
  const seTeamIds = resource.seTeamUserIds || [];
  const onSeTeam = seTeamIds.includes(user.id);

  switch (action) {
    case "read":
      if (isOwner) return true;
      if (onSeTeam) return true;
      if (isManager && isOrgDirector && (sameOrg || accountSameOrg)) return true;
      if (isManager && sameTeam) return true;
      return false;
    case "read_account": {
      if (onSeTeam) return true;
      if (isOwner) return true;
      if (isManager && isOrgDirector && accountSameOrg) return true;
      const seTeamTeamIds = resource.seTeamTeamIds || [];
      if (isManager && user.teamId && seTeamTeamIds.includes(user.teamId)) return true;
      return false;
    }
    case "manage_account_team":
      if (isManager && isOrgDirector && accountSameOrg) return true;
      if (isManager && user.teamId && seTeamIds.length) return true;
      return false;
    case "create":
    case "update":
      return user.role === "se" && (isOwner || onSeTeam);
    case "delete":
      return user.role === "admin";
    case "manage_team":
    case "manage_users":
      return user.role === "admin";
    case "read_product_signal":
      return user.role === "pm" && sameOrg;
    default:
      return false;
  }
}

export function now() {
  return Date.now();
}
