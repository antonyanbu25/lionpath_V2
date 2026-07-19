/**
 * Centralized entity ID generation — prefixed UUID v4.
 * See docs/ID_STANDARDS.md
 */

/** @typedef {"user"|"team"|"org"|"account"|"contact"|"lifecycle"|"prep"|"postCall"|"task"|"event"} EntityIdType */

export const ID_PREFIXES = {
  user: "usr_",
  team: "team_",
  org: "org_",
  account: "acc_",
  contact: "con_",
  lifecycle: "lc_",
  prep: "prep_",
  postCall: "call_",
  task: "task_",
  event: "evt_",
};

/**
 * Generate a new entity ID with optional type prefix.
 * @param {EntityIdType} [type]
 */
export function newId(type) {
  const prefix = type && ID_PREFIXES[type] ? ID_PREFIXES[type] : "";
  const uuid =
    typeof crypto !== "undefined" && crypto.randomUUID
      ? crypto.randomUUID()
      : `${Date.now()}-${Math.random().toString(36).slice(2, 11)}`;
  return `${prefix}${uuid}`;
}

/**
 * Deterministic internal user id for dummy auth (stable across re-seeds).
 * @param {string} email
 */
export function stableUserIdForEmail(email) {
  const key = String(email || "")
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "");
  return `usr_dummy_${key || "user"}`;
}

/** @deprecated Use stableUserIdForEmail — kept for imports during transition */
export function dummyUidForEmail(email) {
  return stableUserIdForEmail(email);
}

/**
 * Map legacy owner/user ids to current internal ids (local migration helper).
 * @param {string} id
 */
export function normalizeLegacyUserId(id) {
  const raw = String(id || "");
  if (raw.startsWith("usr_")) return raw;
  if (raw.startsWith("dummy-")) {
    return stableUserIdForEmail(raw.slice("dummy-".length));
  }
  return raw;
}
