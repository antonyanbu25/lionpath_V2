/**
 * Manager proxy ownership — prep/post-call on behalf of a team SE.
 */

import { isManagerRole, listTeamSeEmailsAsync, displayNameForEmail } from "../auth.js";
import { effectiveSessionUserId } from "./session.js";
import { resolveEffectiveOwnerId } from "./user-resolve.js";
import { stableUserIdForEmail } from "./id.js";
import { getStore } from "./store.js";
import { sessionToUser } from "./rbac.js";
import { can } from "./types.js";

export const PROXY_SE_STORAGE_KEY = "se-sp-proxy-se";

/** @typedef {{ id: string, email: string, name: string }} TeamSeOption */

/** @param {object|null|undefined} session */
export function isManagerSession(session) {
  return isManagerRole(session);
}

/** @param {object|null|undefined} session */
export function getStoredProxySe(session) {
  if (!session?.email || typeof sessionStorage === "undefined") return null;
  try {
    const raw = sessionStorage.getItem(`${PROXY_SE_STORAGE_KEY}:${session.email.trim().toLowerCase()}`);
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    if (parsed?.id && parsed?.email) return parsed;
  } catch {
    // ignore
  }
  return null;
}

/** @param {object|null|undefined} session @param {{ id: string, email: string, name?: string }|null} option */
export function setStoredProxySe(session, option) {
  if (!session?.email || typeof sessionStorage === "undefined") return;
  const key = `${PROXY_SE_STORAGE_KEY}:${session.email.trim().toLowerCase()}`;
  if (!option?.id || !option?.email) {
    sessionStorage.removeItem(key);
    return;
  }
  sessionStorage.setItem(
    key,
    JSON.stringify({
      id: option.id,
      email: option.email.trim().toLowerCase(),
      name: option.name || displayNameForEmail(option.email),
    }),
  );
}

/** @param {object|null|undefined} session @returns {Promise<TeamSeOption[]>} */
export async function listTeamSeOptions(session) {
  if (!session?.email) return [];
  const emails = await listTeamSeEmailsAsync(session);
  const store = getStore();
  /** @type {TeamSeOption[]} */
  const out = [];
  const seen = new Set();
  // Self always goes first, and always exists -- the team/org roster fetch
  // depends on live Firestore reads that can come back empty (a manager's
  // own team-visibility lookup has no guaranteed floor otherwise), leaving
  // no way to satisfy the required "Run for SE" field even though the
  // manager is a valid person to run a call against their own account.
  const selfId = effectiveSessionUserId(session);
  const selfEmail = String(session.email || "").trim().toLowerCase();
  if (selfId && selfEmail) {
    out.push({ id: selfId, email: selfEmail, name: `${session.name || displayNameForEmail(selfEmail)} (you)` });
    seen.add(selfEmail);
  }
  for (const email of emails) {
    const normalized = String(email || "").trim().toLowerCase();
    if (!normalized || seen.has(normalized)) continue;
    seen.add(normalized);
    let user =
      (await store.getUserByEmail?.(normalized)) ||
      (await store.getUser?.(stableUserIdForEmail(normalized)));
    if (user?.role && user.role !== "se") continue;
    const id = user?.id || stableUserIdForEmail(normalized);
    out.push({
      id,
      email: normalized,
      name: user?.displayName || displayNameForEmail(normalized),
    });
  }
  return out;
}

/** @param {object|null|undefined} session @param {string} seUserId */
export async function canManagerActForSe(session, seUserId) {
  if (!isManagerRole(session) || !seUserId) return false;
  // Acting as yourself isn't a delegation -- can()'s create_on_behalf check
  // explicitly denies resource.ownerId === user.id (a guard against a
  // manager delegating to themselves), so route the self-selection added in
  // listTeamSeOptions around that check instead of through it.
  if (seUserId === effectiveSessionUserId(session)) return true;
  const options = await listTeamSeOptions(session);
  const target = options.find((o) => o.id === seUserId);
  if (!target) return false;
  const user = sessionToUser(session);
  const store = getStore();
  const seUser = (await store.getUser?.(seUserId)) || null;
  return can(user, "create_on_behalf", {
    ownerId: seUserId,
    teamId: seUser?.teamId || null,
    orgId: session.orgId || seUser?.orgId || null,
    targetRole: "se",
  });
}

/**
 * Domain ownerId for lifecycle/prep/post-call writes.
 * @param {object|null|undefined} session
 * @param {string|null|undefined} proxySeUserId
 * @returns {Promise<string>}
 */
export async function resolveActingOwnerId(session, proxySeUserId) {
  if (!isManagerRole(session)) {
    // effectiveSessionUserId is a sync, session-only fallback -- when
    // session.userId isn't populated yet it drops straight to the
    // usr_dummy_<email> placeholder with no attempt to resolve the real id.
    // That placeholder then flows into getOrCreateLifecycle/createLifecycle
    // and gets rejected by resolveInternalId server-side ("no mapping for
    // app_user/usr_dummy_..."), aborting the whole post-call save. Every
    // other call site that risks hitting this placeholder (postcall.js,
    // dashboard.js, app.js) already resolves through resolveEffectiveOwnerId
    // first; this was the one for the acting-owner (SE self) path that hadn't.
    const self = await resolveEffectiveOwnerId(session);
    if (!self) throw new Error("Sign in to continue.");
    return self;
  }
  const id = String(proxySeUserId || getStoredProxySe(session)?.id || "").trim();
  // TEMPORARY: the "Run for SE" picker is hidden for now (its roster fetch
  // depends on a live Firestore read that's been intermittently failing) --
  // fall back to acting as the manager's own account instead of blocking
  // the whole save on a field that's no longer shown. Revert alongside
  // re-enabling wireProxySeSelectors in prep-proxy-se-ui.js.
  if (!id) {
    const self = await resolveEffectiveOwnerId(session);
    if (self) return self;
    throw new Error("Select which SE you are running this for.");
  }
  if (!(await canManagerActForSe(session, id))) {
    throw new Error("Selected SE is not in your team or segment scope.");
  }
  return id;
}

/**
 * Resolve teamId from org team membership when the user doc has no teamId.
 * @param {import("./store.js").DomainStore} store
 * @param {{ id: string, orgId?: string|null }} ownerUser
 */
async function resolveTeamIdFromOrgMembership(store, ownerUser) {
  const orgId = ownerUser?.orgId;
  if (!orgId || !store.listTeamsByOrg) return null;
  const teams = await store.listTeamsByOrg(orgId);
  for (const team of teams || []) {
    if ((team.memberIds || []).includes(ownerUser.id)) {
      return team.id;
    }
  }
  return null;
}

/**
 * Denormalized write context for prep/post-call — ownerId plus target SE's team/org
 * (not the manager session's teamId when proxying).
 * @param {object|null|undefined} session
 * @param {string|null|undefined} proxySeUserId
 * @returns {Promise<{ ownerId: string, teamId: string|null, orgId: string|null }>}
 */
export async function resolveActingWriteContext(session, proxySeUserId) {
  const ownerId = await resolveActingOwnerId(session, proxySeUserId);
  const store = getStore();
  const ownerUser = (await store.getUser?.(ownerId)) || null;
  const orgId = ownerUser?.orgId || session?.orgId || null;
  let teamId = ownerUser?.teamId || null;
  if (!teamId && ownerUser) {
    teamId = await resolveTeamIdFromOrgMembership(store, ownerUser);
  }
  const isSelf = ownerId === effectiveSessionUserId(session);
  if (!teamId && session?.teamId) {
    teamId = session.teamId;
    if (!isSelf) {
      console.warn(
        "[acting-owner] Using session teamId fallback for acting owner",
        ownerId,
      );
    }
  }
  if (!teamId) {
    console.warn("[acting-owner] Could not resolve teamId for acting owner", ownerId);
    throw new Error(
      "Could not resolve team for acting owner. Assign the SE to a team before continuing.",
    );
  }
  return { ownerId, teamId, orgId };
}

/** @param {object|null|undefined} session @param {string|null|undefined} proxySeUserId @returns {Promise<string>} */
export async function resolveActingOwnerEmail(session, proxySeUserId) {
  if (!isManagerRole(session) && session?.email) {
    return String(session.email).trim().toLowerCase();
  }
  const id = await resolveActingOwnerId(session, proxySeUserId);
  const stored = getStoredProxySe(session);
  if (stored?.id === id && stored.email) return stored.email;
  const match = (await listTeamSeOptions(session)).find((o) => o.id === id);
  if (match?.email) return match.email;
  const store = getStore();
  const user = (await store.getUser?.(id)) || null;
  if (user?.email) return String(user.email).trim().toLowerCase();
  throw new Error("Could not resolve SE email for proxy owner.");
}

/**
 * Audit metadata when a manager acts on behalf of an SE.
 * @param {object|null|undefined} session
 * @param {string|null|undefined} proxySeUserId
 */
export function actingAuditFields(session, proxySeUserId) {
  if (!isManagerRole(session)) return {};
  const proxyId = String(proxySeUserId || getStoredProxySe(session)?.id || "").trim();
  if (!proxyId) return {};
  const managerId = effectiveSessionUserId(session);
  if (!managerId || managerId === proxyId) return {};
  return { createdByUserId: managerId, createdByRole: "manager" };
}

/** @param {object|null|undefined} session @param {string|null|undefined} proxySeUserId */
export function proxySeRequiredMessage(session, proxySeUserId) {
  if (!isManagerRole(session)) return "";
  const id = String(proxySeUserId || getStoredProxySe(session)?.id || "").trim();
  return id ? "" : "Select which SE you are running this for.";
}
