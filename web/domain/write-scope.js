/**
 * The single source of truth for who owns a write and which team/org it lands under.
 * Every dual-write path must call this. Nothing else may read session.teamId for stamping.
 */

import { getStore } from "./store.js";
import { sessionUserId, effectiveSessionUserId } from "./session.js";
import { resolveEffectiveOwnerId } from "./user-resolve.js";

/**
 * @param {object} session
 * @param {{ ownerId?: string|null }} [opts]
 * @returns {Promise<{ ownerId: string, teamId: string|null, orgId: string|null, actorId: string, isProxy: boolean, degraded: boolean, reason: string|null }|null>}
 */
export async function resolveWriteScope(session, opts = {}) {
  if (!session) return null;
  const store = getStore();
  const actorId =
    effectiveSessionUserId(session) || sessionUserId(session) || null;
  if (!actorId) return null;

  const explicitOwner = opts.ownerId || null;
  const ownerId =
    explicitOwner ||
    (await resolveEffectiveOwnerId(session)) ||
    actorId;

  const isProxy = ownerId !== actorId;
  if (isProxy) {
    // Option A: proxy descoped — dual-write rejects reason === "proxy_descoped".
    // Still resolve target owner team/org for authorized flows (e.g. handoff stamping).
    const targetDoc = await store.getUser(ownerId).catch(() => null);
    let teamId = targetDoc?.teamId ?? null;
    let orgId = targetDoc?.orgId ?? null;
    let degraded = !teamId;
    let reason = "proxy_descoped";
    if (!teamId && session.teamId) {
      teamId = session.teamId;
      degraded = true;
      reason = "proxy_descoped";
    }
    if (!orgId && session.orgId) {
      orgId = session.orgId;
      degraded = true;
    }
    return {
      ownerId,
      teamId,
      orgId,
      actorId,
      isProxy: true,
      degraded,
      reason,
    };
  }

  const userDoc = await store.getUser(ownerId).catch(() => null);
  let teamId = userDoc?.teamId ?? null;
  let orgId = userDoc?.orgId ?? null;
  let degraded = false;
  let reason = null;

  if (!teamId && session.teamId) {
    teamId = session.teamId;
    degraded = true;
    reason = "owner_profile_missing_team";
  }
  if (!orgId && session.orgId) {
    orgId = session.orgId;
    degraded = true;
    reason = reason || "owner_profile_missing_org";
  }

  return { ownerId, teamId, orgId, actorId, isProxy: false, degraded, reason };
}
