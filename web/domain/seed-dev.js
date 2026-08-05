/**
 * Dev seed data — Freshworks CX SE org (Vipin → senior managers → squad managers → ICs).
 */

import { DUMMY_USERS } from "../dummy-users.js";
import { firebaseConfig } from "../firebase-config.js";
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
  TEAM_DISPLAY_NAMES,
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
  // Production Firestore is seeded via worker scripts — dev upserts fail under SE rules.
  if (firebaseConfig.projectId) return;

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
      name: name,
      orgId: DEMO_ORG_ID,
      managerId: team?.managerId || managerId,
      memberIds: mergedMembers,
      createdAt: team?.createdAt ?? ts,
      updatedAt: ts,
    });
  }

  await upsertTeam(
    TEAM_AJAY_ID,
    TEAM_DISPLAY_NAMES[TEAM_AJAY_ID],
    squadManagers[TEAM_AJAY_ID],
    teamMembers[TEAM_AJAY_ID]
  );
  await upsertTeam(
    TEAM_NIKIL_ID,
    TEAM_DISPLAY_NAMES[TEAM_NIKIL_ID],
    squadManagers[TEAM_NIKIL_ID],
    teamMembers[TEAM_NIKIL_ID]
  );
  await upsertTeam(
    TEAM_PREETHI_SRI_ID,
    TEAM_DISPLAY_NAMES[TEAM_PREETHI_SRI_ID],
    squadManagers[TEAM_PREETHI_SRI_ID],
    teamMembers[TEAM_PREETHI_SRI_ID]
  );
  await upsertTeam(
    TEAM_PREETHI_SRIRAM_ID,
    TEAM_DISPLAY_NAMES[TEAM_PREETHI_SRIRAM_ID],
    squadManagers[TEAM_PREETHI_SRIRAM_ID],
    teamMembers[TEAM_PREETHI_SRIRAM_ID]
  );

  await seedProductSignalDemoIfNeeded(store, ts);
}

const PRODUCT_SIGNAL_SEED_KEY = "lionpath_product_signal_seeded_v1";

/** Demo clusters, gaps, wins, and TC rows for #signal (spec §11.10). Idempotent. */
async function seedProductSignalDemoIfNeeded(store, ts) {
  if (typeof localStorage !== "undefined" && localStorage.getItem(PRODUCT_SIGNAL_SEED_KEY)) return;
  if (!store.upsertProductGap || !store.upsertGapCluster) return;

  const orgId = DEMO_ORG_ID;
  const ownerId = stableUserIdForEmail("saketh.poruri@freshworks.com");
  const teamId = TEAM_AJAY_ID;

  const clusterResidency = {
    id: "gclus_demo_residency",
    orgId,
    label: "Data residency for ASEAN tenants",
    dealCount: 5,
    arrTotal: 88000,
    status: "published",
    productArea: "platform",
    crossCuttingTags: ["data_residency"],
    taxonomyVersion: "1.0",
    createdAt: ts,
    updatedAt: ts,
  };
  const clusterWhatsapp = {
    id: "gclus_demo_whatsapp",
    orgId,
    label: "WhatsApp template approval in-product",
    dealCount: 4,
    arrTotal: 54000,
    status: "published",
    productArea: "channels",
    crossCuttingTags: [],
    taxonomyVersion: "1.0",
    createdAt: ts,
    updatedAt: ts,
  };
  const clusterEnablement = {
    id: "gclus_demo_ai_knowledge",
    orgId,
    label: "AI Agent on non-Freshworks knowledge",
    dealCount: 6,
    arrTotal: 47000,
    status: "published",
    productArea: "ai_customer",
    crossCuttingTags: [],
    taxonomyVersion: "1.0",
    createdAt: ts,
    updatedAt: ts,
  };
  const clusterBulk = {
    id: "gclus_demo_bulk",
    orgId,
    label: "Bulk admin config via API",
    dealCount: 3,
    arrTotal: 31000,
    status: "draft",
    productArea: "admin_config",
    crossCuttingTags: ["migration"],
    taxonomyVersion: "1.0",
    createdAt: ts,
    updatedAt: ts,
  };

  await store.upsertGapCluster(clusterResidency);
  await store.upsertGapCluster(clusterWhatsapp);
  await store.upsertGapCluster(clusterEnablement);
  await store.upsertGapCluster(clusterBulk);

  const gaps = [
    {
      id: "pgap_demo_residency",
      postCallId: "postcall_demo_signal_1",
      dealId: "deal_demo_signal_1",
      accountId: "account_demo_signal_1",
      orgId,
      ownerId,
      teamId,
      clusterId: clusterResidency.id,
      productArea: "platform",
      subArea: "other",
      crossCuttingTags: ["data_residency"],
      verbatim: "Our regulator won't allow data outside Singapore",
      disposition: "hard_blocker",
      dealImpact: "blocker",
      gapType: "real_gap",
      competitorNamed: null,
      arrTouched: 88000,
      taxonomyVersion: "1.0",
      status: "in_review",
      embedding: [0.1, 0.2, 0.3],
      createdAt: ts,
      updatedAt: ts,
    },
    {
      id: "pgap_demo_whatsapp",
      postCallId: "postcall_demo_signal_2",
      dealId: "deal_demo_signal_2",
      accountId: "account_demo_signal_2",
      orgId,
      ownerId,
      teamId,
      clusterId: clusterWhatsapp.id,
      productArea: "channels",
      subArea: "whatsapp",
      crossCuttingTags: [],
      verbatim: "We shouldn't have to leave to get a template signed off",
      disposition: "hard_blocker",
      dealImpact: "blocker",
      gapType: "real_gap",
      competitorNamed: { name: "Zendesk", saidBetter: true },
      arrTouched: 54000,
      taxonomyVersion: "1.0",
      status: "published",
      createdAt: ts,
      updatedAt: ts,
    },
    {
      id: "pgap_demo_enablement",
      postCallId: "postcall_demo_signal_3",
      dealId: "deal_demo_signal_3",
      accountId: "account_demo_signal_3",
      orgId,
      ownerId,
      teamId,
      clusterId: clusterEnablement.id,
      productArea: "ai_customer",
      subArea: "knowledge_answers",
      crossCuttingTags: [],
      verbatim: "Our docs live in Confluence and they're staying there",
      disposition: "se_didnt_know",
      dealImpact: "friction",
      gapType: "enablement_gap",
      arrTouched: 47000,
      taxonomyVersion: "1.0",
      status: "published_enablement",
      createdAt: ts,
      updatedAt: ts,
    },
    {
      id: "pgap_demo_bulk",
      postCallId: "postcall_demo_signal_4",
      dealId: "deal_demo_signal_4",
      accountId: "account_demo_signal_4",
      orgId,
      ownerId,
      teamId,
      clusterId: clusterBulk.id,
      productArea: "admin_config",
      subArea: "bulk_config",
      crossCuttingTags: ["migration"],
      verbatim: "Clicking through 200 groups isn't a migration plan",
      disposition: "roadmap_deflection",
      dealImpact: "friction",
      gapType: "real_gap",
      arrTouched: 31000,
      taxonomyVersion: "1.0",
      status: "draft",
      createdAt: ts,
      updatedAt: ts,
    },
  ];

  for (const gap of gaps) {
    await store.upsertProductGap(gap);
  }

  const wins = [
    {
      id: "ww_demo_copilot",
      postCallId: "postcall_demo_signal_5",
      accountId: "account_demo_signal_5",
      orgId,
      ownerId,
      teamId,
      productArea: "ai_agent",
      verbatim: "That would save my team the whole morning. Pioneer Metering",
      referenceCandidate: true,
      taxonomyVersion: "1.0",
      createdAt: ts,
      updatedAt: ts,
    },
    {
      id: "ww_demo_inbox",
      postCallId: "postcall_demo_signal_6",
      accountId: "account_demo_signal_6",
      orgId,
      ownerId,
      teamId,
      productArea: "channels",
      verbatim: "Unified inbox across email and WhatsApp. consistently the moment the room leans in",
      referenceCandidate: true,
      taxonomyVersion: "1.0",
      createdAt: ts,
      updatedAt: ts,
    },
    {
      id: "ww_demo_setup",
      postCallId: "postcall_demo_signal_7",
      accountId: "account_demo_signal_7",
      orgId,
      ownerId,
      teamId,
      productArea: "admin_config",
      verbatim: "Setup speed vs incumbent. named unprompted in competitive deals",
      referenceCandidate: true,
      taxonomyVersion: "1.0",
      createdAt: ts,
      updatedAt: ts,
    },
  ];

  for (const row of wins) {
    await store.upsertWhatWorks(row);
  }

  const tcRows = [
    {
      id: "tc_demo_ai_optin_1",
      dealId: "deal_demo_ai_1",
      accountId: "account_demo_ai_1",
      orgId,
      ownerId,
      teamId,
      status: "yes",
      reasonForEvaluation: { value: "Deflection. ticket volume they can't staff for" },
      whyAi: { value: "Copilot drafting shown in demo" },
      aiAttach: { product: "Copilot", agentCount: 40, agentTotal: 40, summary: "Copilot 40/40" },
      createdAt: ts,
      updatedAt: ts,
    },
    {
      id: "tc_demo_ai_optin_2",
      dealId: "deal_demo_ai_2",
      accountId: "account_demo_ai_2",
      orgId,
      ownerId,
      teamId,
      status: "yes",
      reasonForEvaluation: { value: "Consolidation. channels fragmented across tools" },
      aiAttach: { product: "Copilot", agentCount: 20, agentTotal: 20, summary: "Copilot 20/20" },
      createdAt: ts,
      updatedAt: ts,
    },
    {
      id: "tc_demo_ai_decline_1",
      dealId: "deal_demo_ai_3",
      accountId: "account_demo_ai_3",
      orgId,
      ownerId,
      teamId,
      status: "pending",
      whyAi: { value: "Data residency. regulator won't allow data outside Singapore" },
      aiAttach: { product: "Copilot", agentCount: 0, agentTotal: 14, summary: "Copilot shown. declined 0/14" },
      createdAt: ts,
      updatedAt: ts,
    },
    {
      id: "tc_demo_ai_decline_2",
      dealId: "deal_demo_ai_4",
      accountId: "account_demo_ai_4",
      orgId,
      ownerId,
      teamId,
      status: "no",
      whyAi: { value: "Knowledge base isn't ready for AI Agent" },
      aiAttach: { product: "AI Agent", summary: "AI shown. KB not ready" },
      createdAt: ts,
      updatedAt: ts,
    },
  ];

  if (store.upsertTechnicalCommit) {
    for (const tc of tcRows) {
      await store.upsertTechnicalCommit(tc);
    }
  }

  if (store.upsertClusteringState) {
    await store.upsertClusteringState({
      id: orgId,
      orgId,
      pendingGapCount: 0,
      lastFullRunAt: ts,
      lastIncrementalAt: null,
      running: false,
      updatedAt: ts,
    });
  }

  if (typeof localStorage !== "undefined") {
    localStorage.setItem(PRODUCT_SIGNAL_SEED_KEY, "1");
  }
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

/** Firestore rules deny reads when session.userId != authIndex userId; swallow and continue. */
async function safeStoreGet(label, fn) {
  try {
    return await fn();
  } catch (err) {
    console.warn(`[seed-dev] ${label} failed:`, err?.message || err);
    return null;
  }
}

/**
 * Resolve domain user for a session. authIndex is checked first on Firebase login so a
 * placeholder usr_dummy_* id from completeFirebaseLogin does not throw before lookup.
 * @internal Exported for session-resolve tests.
 */
export async function lookupUserForSession(session, store) {
  const lookupId = session?.userId || session?.uid;
  let user = null;

  if (session?.authUid && store.getUserIdByAuthUid) {
    const mappedId = await safeStoreGet("authIndex lookup", () =>
      store.getUserIdByAuthUid(session.authUid)
    );
    if (mappedId) {
      user = await safeStoreGet("getUser by authIndex", () => store.getUser(mappedId));
    }
  }

  if (!user && lookupId) {
    user = await safeStoreGet("getUser by session id", () => store.getUser(lookupId));
  }
  if (!user && session?.email) {
    user = await safeStoreGet("getUserByEmail", () => store.getUserByEmail(session.email));
  }
  if (!user && session?.email) {
    user = await safeStoreGet("getUser by stable id", () =>
      store.getUser(stableUserIdForEmail(session.email))
    );
  }

  return user;
}

/**
 * Domain owner id for Firestore reads/writes — authIndex wins over usr_dummy_* placeholders.
 * @param {object | null | undefined} session
 * @param {object} [store] optional store override (tests)
 * @returns {Promise<string | null>}
 */
export async function resolveEffectiveOwnerId(session, storeOverride) {
  if (!session) return null;
  const raw = session.userId || session.uid;
  const isDummy = raw?.startsWith("usr_dummy_");
  const isAuthUidAsProfile = session.authUid && raw === session.authUid;
  if (raw && !isDummy && !isAuthUidAsProfile) return raw;

  if (session.authUid || session.email) {
    let store = storeOverride;
    if (!store) {
      if (!firebaseConfig.projectId) {
        await seedDevDomainIfNeeded();
      }
      store = getStore();
    }
    const user = await lookupUserForSession(session, store);
    if (user?.id) return user.id;
  }

  return raw || (session.email ? stableUserIdForEmail(session.email) : null);
}

/** Load user profile from store and merge into session. */
export async function enrichSessionFromStore(session) {
  const lookupId = session?.userId || session?.uid;
  if (!lookupId && !session?.email && !session?.authUid) return session;

  if (!firebaseConfig.projectId) {
    await seedDevDomainIfNeeded();
  }
  const store = getStore();

  let user = await lookupUserForSession(session, store);

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
    try {
      await store.upsertUser(user);
    } catch (err) {
      console.warn("[seed-dev] upsertUser failed. using stable id fallback:", err?.message || err);
      return {
        ...session,
        userId: session.userId || session.uid || userId,
        uid: session.userId || session.uid || userId,
        authUid: session.authUid ?? null,
        role: user.role,
        teamId: user.teamId,
        orgId: user.orgId || null,
        name: user.displayName,
      };
    }
  }

  if (!user) {
    if (session?.email) {
      const fallbackId = stableUserIdForEmail(session.email);
      return {
        ...session,
        userId: session.userId || session.uid || fallbackId,
        uid: session.userId || session.uid || fallbackId,
      };
    }
    return session;
  }

  const org = user.orgId ? await safeStoreGet("getOrg", () => getOrg(user.orgId)) : null;

  let managerName = null;
  if (user.managerId) {
    const mgr = await safeStoreGet("getUser manager", () => store.getUser(user.managerId));
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

/** Upsert Firebase user on login. internal User.id + authIndex. */
export async function upsertFirebaseUser(fbUser, roleHint) {
  const store = getStore();
  const ts = now();
  const email = String(fbUser.email || "").trim().toLowerCase();
  const authUid = fbUser.uid;

  let user = null;

  if (store.getUserIdByAuthUid) {
    const mappedId = await safeStoreGet("authIndex lookup", () => store.getUserIdByAuthUid(authUid));
    if (mappedId) {
      user = await safeStoreGet("getUser by authIndex", () => store.getUser(mappedId));
    }
  }

  if (!user) {
    user = await safeStoreGet("getUserByEmail", () => store.getUserByEmail(email));
  }

  if (!user) {
    const legacyByAuth = await safeStoreGet("legacy getUser by authUid", () => store.getUser(authUid));
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
