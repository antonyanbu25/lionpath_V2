/** Centralized entity ID generation — prefixed UUID v4. See docs/ID_STANDARDS.md */

export type EntityIdType =
  | "user"
  | "team"
  | "org"
  | "account"
  | "contact"
  | "lifecycle"
  | "prep"
  | "postCall"
  | "task"
  | "event";

export const ID_PREFIXES: Record<EntityIdType, string> = {
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
