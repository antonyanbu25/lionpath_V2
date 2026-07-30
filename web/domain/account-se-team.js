/**
 * Account deal team (seTeam) helpers — backfill, prep bootstrap, display.
 */

import { getStore } from "./store.js";
import { MAX_SE_TEAM_SIZE, now } from "./types.js";
import { listActiveLifecyclesForAccount } from "./lifecycle-service.js";

/** @param {import("./types.js").Account|null|undefined} account */
export function seTeamUserIds(account) {
  return (account?.seTeam || []).map((m) => m.seUserId);
}

/** Backfill seTeam from active lifecycles when missing (dev/local migration). */
export async function backfillAccountSeTeam(accountId) {
  const store = getStore();
  let account = await store.getAccount(accountId);
  if (!account || (account.seTeam && account.seTeam.length > 0)) {
    return account;
  }

  const lifecycles = await listActiveLifecyclesForAccount(accountId);
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
  return account;
}

/**
 * On prep: ensure actor is on deal team (primary if empty, else secondary if missing).
 * @returns {Promise<import("./types.js").Account|null>}
 */
export async function ensureSeTeamForPrepActor(accountId, actorId) {
  const store = getStore();
  let account = await backfillAccountSeTeam(accountId);
  if (!account) return null;

  const ts = now();
  let seTeam = [...(account.seTeam || [])];

  if (!seTeam.length) {
    seTeam = [{ seUserId: actorId, role: "primary", addedAt: ts, addedBy: actorId }];
    return store.updateAccount(accountId, {
      seTeam,
      primarySeUserId: actorId,
      updatedAt: ts,
    });
  }

  if (seTeam.some((m) => m.seUserId === actorId)) {
    return account;
  }

  if (seTeam.length >= MAX_SE_TEAM_SIZE) {
    return account;
  }

  seTeam.push({ seUserId: actorId, role: "secondary", addedAt: ts, addedBy: actorId });
  return store.updateAccount(accountId, { seTeam, updatedAt: ts });
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
