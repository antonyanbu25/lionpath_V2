/**
 * Dev seed data — Freshworks CX SE org (Vipin → senior managers → squad managers → ICs).
 */

import { DUMMY_USERS } from "../dummy-users.js";
import { getStore } from "./store.js";
import { now } from "./types.js";
import { stableUserIdForEmail } from "./id.js";
import { getOrg, isOrgLeader, userWithDirectorFlag } from "./org-service.js";

import {
  DEMO_ORG_ID,
  SQUAD_TEAM_IDS,
  TEAM_AJAY_ID,
  TEAM_NIKIL_ID,
  TEAM_PREETHI_SRI_ID,
  TEAM_PREETHI_SRIRAM_ID,
} from "./constants.js";

export { stableUserIdForEmail as dummyUidForEmail };

const VIPIN_EMAIL = "vipin.thomas@freshworks.com";
const SENIOR_LEADER_EMAILS = [
  "antony.sagayaraj@freshworks.com",
  "preethi.sri@freshworks.com",
  "preethi.sriram@freshworks.com",
];

function managerIdForProfile(profile) {
  if (profile.managerId) return profile.managerId;
  if (profile.managerEmail) return stableUserIdForEmail(profile.managerEmail);
  return null;
}

/** Seed org, teams, and users if not already present. Idempotent. */
export async function seedDevDomainIfNeeded() {
  const store = getStore();
  const ts = now();

  const directorId = stableUserIdForEmail(VIPIN_EMAIL);
  const seniorLeaderIds = SENIOR_LEADER_EMAILS.map((e) => stableUserIdForEmail(e));

  const teamMembers = {
    [TEAM_AJAY_ID]: [],
    [TEAM_NIKIL_ID]: [],
    [TEAM_PREETHI_SRI_ID]: [],
    [TEAM_PREETHI_SRIRAM_ID]: [],
  };

  const squadManagers = {
    [TEAM_AJAY_ID]: stableUserIdForEmail("ajay.raghavan@freshworks.com"),
    [TEAM_NIKIL_ID]: stableUserIdForEmail("nikil.ravi@freshworks.com"),
    [TEAM_PREETHI_SRI_ID]: stableUserIdForEmail("manager.preethi.sri@freshworks.com"),
    [TEAM_PREETHI_SRIRAM_ID]: stableUserIdForEmail("manager.preethi.sriram@freshworks.com"),
  };

  for (const [email, profile] of Object.entries(DUMMY_USERS)) {
    const userId = stableUserIdForEmail(email);
    const existing = (await store.getUser(userId)) || (await store.getUserByEmail(email));
    const managerId = managerIdForProfile(profile);

    const userDoc = {
      id: userId,
      email,
      authUid: existing?.authUid ?? null,
      displayName: profile.name,
      role: profile.role,
      teamId: profile.teamId ?? null,
      orgId: profile.orgId ?? DEMO_ORG_ID,
      managerId: managerId,
      jobTitle: profile.jobTitle ?? existing?.jobTitle ?? null,
      avatarDataUrl: existing?.avatarDataUrl ?? null,
      status: existing?.status ?? "active",
      createdAt: existing?.createdAt ?? ts,
      updatedAt: ts,
    };

    await store.upsertUser({ ...existing, ...userDoc });

    if (profile.role === "se" && profile.teamId && teamMembers[profile.teamId]) {
      teamMembers[profile.teamId].push(userId);
    }
  }

  const org = await store.getOrg?.(DEMO_ORG_ID);
  const orgDoc = {
    id: DEMO_ORG_ID,
    name: "Freshworks CX Solution Engineering",
    directorId,
    seniorLeaderIds,
    teamIds: SQUAD_TEAM_IDS,
    createdAt: org?.createdAt ?? ts,
    updatedAt: ts,
  };
  await store.upsertOrg?.(orgDoc);

  async function upsertTeam(teamId, name, managerId, memberIds) {
    const team = await store.getTeam(teamId);
    const mergedMembers = [...new Set([...(team?.memberIds || []), ...memberIds])];
    await store.upsertTeam({
      id: teamId,
      name: team?.name || name,
      orgId: DEMO_ORG_ID,
      managerId: team?.managerId || managerId,
      memberIds: mergedMembers,
      createdAt: team?.createdAt ?? ts,
      updatedAt: ts,
    });
  }

  await upsertTeam(TEAM_AJAY_ID, "Ajay Squad", squadManagers[TEAM_AJAY_ID], teamMembers[TEAM_AJAY_ID]);
  await upsertTeam(TEAM_NIKIL_ID, "Nikil Squad", squadManagers[TEAM_NIKIL_ID], teamMembers[TEAM_NIKIL_ID]);
  await upsertTeam(TEAM_PREETHI_SRI_ID, "Preethi Sri Squad", squadManagers[TEAM_PREETHI_SRI_ID], teamMembers[TEAM_PREETHI_SRI_ID]);
  await upsertTeam(TEAM_PREETHI_SRIRAM_ID, "Preethi Sriram Squad", squadManagers[TEAM_PREETHI_SRIRAM_ID], teamMembers[TEAM_PREETHI_SRIRAM_ID]);
}

/** Resolve team member emails for manager views (single team). */
export async function listTeamMemberEmails(teamId) {
  const store = getStore();
  const team = await store.getTeam(teamId);
  if (!team?.memberIds?.length) return [];

  const emails = [];
  for (const memberId of team.memberIds) {
    const user = await store.getUser(memberId);
    if (user?.email && user.role === "se") emails.push(user.email);
  }
  return emails;
}

/** Load user profile from store and merge into session. */
export async function enrichSessionFromStore(session) {
  const lookupId = session?.userId || session?.uid;
  if (!lookupId && !session?.email) return session;

  await seedDevDomainIfNeeded();
  const store = getStore();

  let user = lookupId ? await store.getUser(lookupId) : null;
  if (!user && session.email) {
    user = await store.getUserByEmail(session.email);
  }

  if (!user && session.email) {
    const ts = now();
    const userId = stableUserIdForEmail(session.email);
    const profile = DUMMY_USERS[session.email.trim().toLowerCase()];
    user = {
      id: userId,
      email: session.email,
      authUid: session.authUid || null,
      displayName: session.name || session.email.split("@")[0] || "User",
      role: session.role || profile?.role || "se",
      teamId: session.teamId || profile?.teamId || TEAM_AJAY_ID,
      orgId: profile?.orgId || DEMO_ORG_ID,
      managerId: profile ? managerIdForProfile(profile) : null,
      jobTitle: profile?.jobTitle ?? null,
      status: "active",
      createdAt: ts,
      updatedAt: ts,
    };
    await store.upsertUser(user);
  }

  if (!user) return session;

  const org = user.orgId ? await getOrg(user.orgId) : null;

  let managerName = null;
  if (user.managerId) {
    const mgr = await store.getUser(user.managerId);
    if (mgr) {
      managerName = mgr.displayName || mgr.email?.split("@")[0] || null;
    }
  }

  return {
    ...session,
    userId: user.id,
    uid: user.id,
    authUid: user.authUid ?? session.authUid ?? null,
    role: user.role,
    teamId: user.teamId,
    orgId: user.orgId || null,
    managerId: user.managerId || null,
    managerName,
    jobTitle: user.jobTitle || null,
    avatarDataUrl: user.avatarDataUrl || null,
    isOrgDirector: isOrgLeader(user.id, org),
    name: user.displayName || session.name,
  };
}

/** Upsert Firebase user on login — internal User.id + authIndex. */
export async function upsertFirebaseUser(fbUser, roleHint) {
  const store = getStore();
  const ts = now();
  const email = String(fbUser.email || "").trim().toLowerCase();
  const authUid = fbUser.uid;

  let user = await store.getUserByEmail(email);

  if (!user) {
    const legacyByAuth = await store.getUser(authUid);
    if (legacyByAuth?.email === email) user = legacyByAuth;
  }

  const profileHint = DUMMY_USERS[email];
  const role =
    user?.role ||
    profileHint?.role ||
    (email.includes("vipin.") || email.startsWith("director@") ? "manager" : roleHint || "se");

  const profile = {
    id: user?.id || stableUserIdForEmail(email),
    email,
    authUid,
    displayName: fbUser.displayName || user?.displayName || profileHint?.name || email.split("@")[0],
    role,
    teamId: user?.teamId ?? profileHint?.teamId ?? TEAM_AJAY_ID,
    orgId: user?.orgId ?? profileHint?.orgId ?? DEMO_ORG_ID,
    managerId: user?.managerId ?? (profileHint ? managerIdForProfile(profileHint) : null),
    jobTitle: user?.jobTitle ?? profileHint?.jobTitle ?? null,
    avatarDataUrl: user?.avatarDataUrl ?? null,
    status: user?.status ?? "active",
    createdAt: user?.createdAt ?? ts,
    updatedAt: ts,
  };

  await store.upsertUser(profile);
  if (store.upsertAuthIndex) {
    await store.upsertAuthIndex(authUid, profile.id, email);
  }

  return profile;
}
