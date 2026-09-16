/**
 * Account deal team (seTeam) helpers — backfill, prep bootstrap, display.
 */

import { getStore } from "./store.js";
import { MAX_SE_TEAM_SIZE, now } from "./types.js";
import { listActiveLifecyclesForAccount } from "./lifecycle-service.js";
import { isFirebasePermissionError } from "./safe-store.js";

/** @param {import("./types.js").Account|null|undefined} account */
export function seTeamUserIds(account) {
  const fromTeam = (account?.seTeam || []).map((m) => m.seUserId);
  if (fromTeam.length) return fromTeam;
  return account?.seTeamUserIds || [];
}

/** @param {import("./types.js").Account|null|undefined} account */
export function seTeamTeamIds(account) {
  if (account?.seTeamTeamIds?.length) return account.seTeamTeamIds;
  return [];
}

/**
 * Denormalized scope fields for Firestore rules (cheap membership checks).
 * @param {import("./types.js").Account} account
 * @param {Map<string, import("./types.js").User>|null} [usersById]
 */
export async function buildAccountScopeDenorm(account, usersById = null) {
  const store = getStore();
  const memberIds = (account.seTeam || []).map((m) => m.seUserId);
  const teamIds = new Set();
  for (const memberId of memberIds) {
    const user = usersById?.get(memberId) || (await store.getUser(memberId));
    if (user?.teamId) teamIds.add(user.teamId);
  }
  return {
    seTeamUserIds: memberIds,
    seTeamTeamIds: [...teamIds],
    orgId: account.orgId || null,
  };
}

/** Persist denormalized scope onto account after seTeam mutation. */
export async function syncAccountScopeDenorm(accountId) {
  const store = getStore();
  const account = await store.getAccount(accountId);
  if (!account) return null;
  const denorm = await buildAccountScopeDenorm(account);
  return store.updateAccount(accountId, { ...denorm, updatedAt: now() });
}

/** Copy account scope denorm onto a contact doc. */
export function contactScopeFromAccount(account, contactPatch = {}) {
  return {
    ...contactPatch,
    orgId: account?.orgId || contactPatch.orgId || null,
    seTeamUserIds: seTeamUserIds(account),
    seTeamTeamIds: seTeamTeamIds(account).length
      ? seTeamTeamIds(account)
      : contactPatch.seTeamTeamIds || [],
  };
}

/** Backfill seTeam from active lifecycles when missing (dev/local migration). */
export async function backfillAccountSeTeam(accountId, opts = {}) {
  const store = getStore();
  let account = await store.getAccount(accountId);
  if (!account || (account.seTeam && account.seTeam.length > 0)) {
    return account;
  }

  let lifecycles = [];
  try {
    lifecycles = await listActiveLifecyclesForAccount(
      accountId,
      opts.actorId ? { ownerId: opts.actorId } : {},
    );
  } catch (err) {
    if (isFirebasePermissionError(err)) return account;
    throw err;
  }
  if (!lifecycles.length) return account;

  const sorted = [...lifecycles].sort((a, b) => (a.createdAt || 0) - (b.createdAt || 0));
  const ts = now();
  /** @type {import("./types.js").AccountSeTeamMember[]} */
  const seTeam = [];
  const seen = new Set();

  for (let i = 0; i < sorted.length && seTeam.length < MAX_SE_TEAM_SIZE; i++) {
    const ownerId = sorted[i].ownerId;
    if (seen.has(ownerId)) continue;
    seen.add(ownerId);
    seTeam.push({
      seUserId: ownerId,
      role: seTeam.length === 0 ? "primary" : "secondary",
      addedAt: sorted[i].createdAt || ts,
    });
  }

  const primarySeUserId = seTeam.find((m) => m.role === "primary")?.seUserId || seTeam[0]?.seUserId || null;
  account = await store.updateAccount(accountId, { seTeam, primarySeUserId, updatedAt: ts });
  await syncAccountScopeDenorm(accountId);
  return account;
}

/**
 * On prep: ensure actor is on deal team (primary if empty, else secondary if missing).
 * @returns {Promise<import("./types.js").Account|null>}
 */
export async function ensureSeTeamForPrepActor(accountId, actorId) {
  const store = getStore();
  let account = await backfillAccountSeTeam(accountId, { actorId });
  if (!account) return null;

  const ts = now();
  let seTeam = [...(account.seTeam || [])];

  if (!seTeam.length) {
    seTeam = [{ seUserId: actorId, role: "primary", addedAt: ts, addedBy: actorId }];
    return store.updateAccount(accountId, {
      seTeam,
      primarySeUserId: actorId,
      updatedAt: ts,
    }).then(() => syncAccountScopeDenorm(accountId));
  }

  if (seTeam.some((m) => m.seUserId === actorId)) {
    return account;
  }

  if (seTeam.length >= MAX_SE_TEAM_SIZE) {
    return account;
  }

  seTeam.push({ seUserId: actorId, role: "secondary", addedAt: ts, addedBy: actorId });
  const updated = await store.updateAccount(accountId, { seTeam, updatedAt: ts });
  return syncAccountScopeDenorm(accountId) || updated;
}

/** @param {import("./types.js").User|null|undefined} user */
export function userDisplayFields(user) {
  if (!user) return { id: "", displayName: "Unknown", jobTitle: null, avatarDataUrl: null };
  return {
    id: user.id,
    displayName: user.displayName || user.email || "Unknown",
    jobTitle: user.jobTitle || null,
    avatarDataUrl: user.avatarDataUrl || null,
  };
}

/** Resolve seTeam rows with User display. */
export async function resolveSeTeamDisplay(account) {
  const store = getStore();
  const members = account?.seTeam || [];
  return Promise.all(
    members.map(async (m) => {
      const user = await store.getUser(m.seUserId);
      return { ...m, user: userDisplayFields(user) };
    })
  );
}
