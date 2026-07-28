/**
 * localStorage-backed domain store for dummy auth mode.
 * Mirrors Firestore document shapes under se-singha-domain:{collection} keys.
 */

import { newId, now } from "./types.js";

const PREFIX = "se-singha-domain:";
const _cache = new Map();

function loadCollection(name) {
  if (_cache.has(name)) return _cache.get(name);
  try {
    const items = JSON.parse(localStorage.getItem(`${PREFIX}${name}`) || "[]");
    _cache.set(name, items);
    return items;
  } catch {
    return [];
  }
}

function saveCollection(name, items) {
  _cache.set(name, items);
  localStorage.setItem(`${PREFIX}${name}`, JSON.stringify(items));
}

export function clearLocalStoreCache() {
  _cache.clear();
}

function upsertById(collection, doc) {
  const items = loadCollection(collection);
  const idx = items.findIndex((d) => d.id === doc.id);
  if (idx >= 0) items[idx] = { ...items[idx], ...doc };
  else items.push(doc);
  saveCollection(collection, items);
  return doc;
}

function upsertByNaturalKey(collection, doc, matchFn) {
  const items = loadCollection(collection);
  const existing = items.find(matchFn);
  if (existing) {
    const idx = items.findIndex((d) => d.id === existing.id);
    items[idx] = { ...existing, ...doc, id: existing.id };
    saveCollection(collection, items);
    return items[idx];
  }
  return upsertById(collection, doc);
}

function findById(collection, id) {
  return loadCollection(collection).find((d) => d.id === id) || null;
}

function findOne(collection, predicate) {
  return loadCollection(collection).find(predicate) || null;
}

function findMany(collection, predicate, sortFn) {
  const items = loadCollection(collection).filter(predicate);
  if (sortFn) items.sort(sortFn);
  return items;
}

export function createLocalStore() {
  const readCacheConfig = { enabled: true };

  return {
    mode: "local",

    get readCacheEnabled() {
      return readCacheConfig.enabled;
    },
    set readCacheEnabled(enabled) {
      readCacheConfig.enabled = !!enabled;
    },

    async getUser(id) {
      return findById("users", id);
    },

    async upsertUser(user) {
      return upsertById("users", user);
    },

    async getUserByEmail(email) {
      const key = String(email || "").trim().toLowerCase();
      return findOne("users", (u) => u.email === key);
    },

    async upsertAuthIndex(authUid, userId, email) {
      return upsertById("authIndex", {
        id: authUid,
        userId,
        email: String(email || "").trim().toLowerCase(),
        updatedAt: now(),
      });
    },

    async getUserIdByAuthUid(authUid) {
      const row = findById("authIndex", authUid);
      return row?.userId ?? null;
    },

    async getTeam(id) {
      return findById("teams", id);
    },

    async upsertTeam(team) {
      return upsertById("teams", team);
    },

    async getOrg(id) {
      return findById("orgs", id);
    },

    async upsertOrg(org) {
      return upsertById("orgs", org);
    },

    async listTeamsByOrg(orgId) {
      return findMany("teams", (t) => t.orgId === orgId, (a, b) => a.name.localeCompare(b.name));
    },

    async listUsersByManagerId(managerId) {
      return findMany("users", (u) => u.managerId === managerId);
    },

    async listUsersByOrg(orgId) {
      return findMany("users", (u) => u.orgId === orgId);
    },

    async listPostCallsByOrg(orgId, limitCount = 200) {
      return findMany("postCalls", (p) => p.orgId === orgId, (a, b) => b.createdAt - a.createdAt).slice(0, limitCount);
    },

    async findAccountBySlug(slug) {
      return findOne("accounts", (a) => a.slug === slug);
    },

    async createAccount(account) {
      return upsertById("accounts", account);
    },

    async updateAccount(id, patch) {
      const existing = findById("accounts", id);
      if (!existing) return null;
      const updated = { ...existing, ...patch, updatedAt: now() };
      return upsertById("accounts", updated);
    },

    async getAccount(id) {
      return findById("accounts", id);
    },

    async listAccounts() {
      return findMany("accounts", () => true, (a, b) => (b.updatedAt || 0) - (a.updatedAt || 0));
    },

    async listActiveLifecyclesForAccount(accountId) {
      return findMany(
        "lifecycles",
        (l) => l.accountId === accountId && l.status === "active",
        (a, b) => b.lastActivityAt - a.lastActivityAt
      );
    },

    async listLifecyclesByOrg(orgId) {
      return findMany(
        "lifecycles",
        (l) => l.orgId === orgId,
        (a, b) => b.lastActivityAt - a.lastActivityAt
      );
    },

    async findContactByAccountEmail(accountId, email) {
      const key = String(email || "").trim().toLowerCase();
      return findOne("contacts", (c) => c.accountId === accountId && c.email === key);
    },

    async createContact(contact) {
      return upsertById("contacts", contact);
    },

    async updateContact(id, patch) {
      const existing = findById("contacts", id);
      if (!existing) return null;
      return upsertById("contacts", { ...existing, ...patch, updatedAt: now() });
    },

    async listContactsByAccount(accountId) {
      return findMany("contacts", (c) => c.accountId === accountId, (a, b) => a.email.localeCompare(b.email));
    },

    async addContactEvent(event) {
      return upsertById("contactEvents", event);
    },

    async listContactEvents(contactId, limitCount = 10) {
      return findMany(
        "contactEvents",
        (e) => e.contactId === contactId,
        (a, b) => b.timestamp - a.timestamp
      ).slice(0, limitCount);
    },

    async findActiveLifecycle(ownerId, accountId) {
      return findOne(
        "lifecycles",
        (l) => l.ownerId === ownerId && l.accountId === accountId && l.status === "active"
      );
    },

    async findActiveLifecycleByDeal(ownerId, accountId, dealId) {
      return findOne(
        "lifecycles",
        (l) =>
          l.ownerId === ownerId &&
          l.accountId === accountId &&
          l.dealId === dealId &&
          l.status === "active"
      );
    },

    async findLifecycleByDealAndOwner(dealId, ownerId) {
      const matches = findMany(
        "lifecycles",
        (l) => l.dealId === dealId && l.ownerId === ownerId,
        (a, b) => (b.lastActivityAt || 0) - (a.lastActivityAt || 0)
      );
      return matches.find((l) => l.status === "active") || matches[0] || null;
    },

    async findActiveDeal(accountId, type) {
      return findOne(
        "deals",
        (d) => d.accountId === accountId && d.type === type && d.status === "active"
      );
    },

    async createDeal(deal) {
      return upsertById("deals", deal);
    },

    async updateDeal(id, patch) {
      const existing = findById("deals", id);
      if (!existing) return null;
      return upsertById("deals", { ...existing, ...patch, updatedAt: now() });
    },

    async getDeal(id) {
      return findById("deals", id);
    },

    async listDealsByAccount(accountId, ownerId) {
      return findMany(
        "deals",
        (d) => d.accountId === accountId && (!ownerId || d.ownerId === ownerId),
        (a, b) => (b.lastActivityAt || 0) - (a.lastActivityAt || 0)
      );
    },

    async listDealsByOwner(ownerId, limitCount = 300) {
      return findMany(
        "deals",
        (d) => d.ownerId === ownerId,
        (a, b) => (b.lastActivityAt || 0) - (a.lastActivityAt || 0)
      ).slice(0, limitCount);
    },

    async createLifecycle(lifecycle) {
      return upsertById("lifecycles", lifecycle);
    },

    async updateLifecycle(id, patch) {
      const existing = findById("lifecycles", id);
      if (!existing) return null;
      return upsertById("lifecycles", { ...existing, ...patch, updatedAt: now() });
    },

    async getLifecycle(id) {
      return findById("lifecycles", id);
    },

    async listLifecyclesByOwner(ownerId, limitCount = 200) {
      return findMany("lifecycles", (l) => l.ownerId === ownerId, (a, b) => b.lastActivityAt - a.lastActivityAt).slice(0, limitCount);
    },

    async listLifecyclesByTeam(teamId, limitCount = 200) {
      return findMany("lifecycles", (l) => l.teamId === teamId, (a, b) => b.lastActivityAt - a.lastActivityAt).slice(0, limitCount);
    },

    async createPrepBrief(doc) {
      return upsertById("prepBriefs", doc);
    },

    async listPrepBriefsByLifecycle(lifecycleId, ownerId) {
      return findMany(
        "prepBriefs",
        (p) => p.lifecycleId === lifecycleId && (!ownerId || p.ownerId === ownerId),
        (a, b) => b.createdAt - a.createdAt
      );
    },

    async findPostCallByIdentity(ownerId, callIdentityKey) {
      return findOne(
        "postCalls",
        (p) => p.ownerId === ownerId && p.callIdentityKey === callIdentityKey
      );
    },

    async upsertPostCall(doc) {
      return upsertById("postCalls", doc);
    },

    async getPostCall(id) {
      return findById("postCalls", id);
    },

    async listPostCallsByLifecycle(lifecycleId, limitCount = 200) {
      return findMany("postCalls", (p) => p.lifecycleId === lifecycleId, (a, b) => b.createdAt - a.createdAt).slice(0, limitCount);
    },

    async listPostCallsByTeam(teamId, limitCount = 200) {
      return findMany("postCalls", (p) => p.teamId === teamId, (a, b) => b.createdAt - a.createdAt).slice(0, limitCount);
    },

    async listPostCallsByOwner(ownerId, limitCount = 200) {
      return findMany("postCalls", (p) => p.ownerId === ownerId, (a, b) => b.createdAt - a.createdAt).slice(0, limitCount);
    },

    async listPostCallsByDeal(dealId, limitCount = 50) {
      return findMany("postCalls", (p) => p.dealId === dealId, (a, b) => b.createdAt - a.createdAt).slice(0, limitCount);
    },

    async listPostCallsByAccount(accountId, limitCount = 80) {
      return findMany("postCalls", (p) => p.accountId === accountId, (a, b) => b.createdAt - a.createdAt).slice(
        0,
        limitCount,
      );
    },

    async createTask(doc) {
      return upsertById("tasks", doc);
    },

    async updateTask(id, patch) {
      const existing = findById("tasks", id);
      if (!existing) return null;
      return upsertById("tasks", { ...existing, ...patch });
    },

    async listTasksByLifecycle(lifecycleId) {
      return findMany("tasks", (t) => t.lifecycleId === lifecycleId, (a, b) => b.createdAt - a.createdAt);
    },

    async addLifecycleEvent(event) {
      return upsertById("events", event);
    },

    async listLifecycleEvents(lifecycleId) {
      return findMany("events", (e) => e.lifecycleId === lifecycleId, (a, b) => b.timestamp - a.timestamp);
    },

    async upsertScorecard(docData) {
      return upsertById("scorecards", docData);
    },

    async deleteScorecard(id) {
      const items = loadCollection("scorecards").filter((d) => d.id !== id);
      saveCollection("scorecards", items);
    },

    async listScorecardsByCall(callId) {
      return findMany("scorecards", (s) => s.callId === callId, (a, b) => b.createdAt - a.createdAt);
    },

    async upsertScorecardLine(docData) {
      return upsertById("scorecardLines", docData);
    },

    async deleteScorecardLinesByScorecardId(scorecardId) {
      const items = loadCollection("scorecardLines").filter((d) => d.scorecardId !== scorecardId);
      saveCollection("scorecardLines", items);
    },

    async listScorecardLinesByTeamTheme(teamId, themeKey) {
      const lines = findMany(
        "scorecardLines",
        (l) => l.teamId === teamId && l.themeKey === themeKey && l.applicable === true,
      );
      const provisionalCards = new Set(
        loadCollection("scorecards").filter((s) => s.provisional).map((s) => s.id),
      );
      return lines.filter((l) => !provisionalCards.has(l.scorecardId));
    },

    async upsertVideoFacts(docData) {
      return upsertById("videoFacts", docData);
    },

    async deleteVideoFacts(id) {
      const items = loadCollection("videoFacts").filter((d) => d.id !== id);
      saveCollection("videoFacts", items);
    },

    async listVideoFactsByCall(callId) {
      return findMany("videoFacts", (s) => s.callId === callId, (a, b) => b.createdAt - a.createdAt);
    },

    async upsertTimelineSegment(docData) {
      return upsertById("timelineSegments", docData);
    },

    async deleteTimelineSegmentsByVideoFactsId(videoFactsId) {
      const items = loadCollection("timelineSegments").filter((d) => d.videoFactsId !== videoFactsId);
      saveCollection("timelineSegments", items);
    },

    async listTimelineSegmentsByCall(callId) {
      return findMany(
        "timelineSegments",
        (s) => s.callId === callId,
        (a, b) => (a.startS || 0) - (b.startS || 0),
      );
    },

    async upsertTimelineMarker(docData) {
      return upsertById("timelineMarkers", docData);
    },

    async listTimelineMarkersByCall(callId) {
      return findMany(
        "timelineMarkers",
        (m) => m.callId === callId,
        (a, b) => (a.atS || 0) - (b.atS || 0),
      );
    },

    /** Clear a previous transcript derivation before re-deriving. Leaves Pass 2 rows alone. */
    async deleteTranscriptTimelineByCall(callId) {
      saveCollection(
        "timelineSegments",
        loadCollection("timelineSegments").filter(
          (s) => !(s.callId === callId && s.source === "transcript"),
        ),
      );
      saveCollection(
        "timelineMarkers",
        loadCollection("timelineMarkers").filter((m) => m.callId !== callId),
      );
    },

    async upsertFollowUp(docData) {
      return upsertById("followUps", docData);
    },

    async deleteFollowUp(id) {
      const items = loadCollection("followUps").filter((d) => d.id !== id);
      saveCollection("followUps", items);
    },

    async listFollowUpsByCall(callId) {
      return findMany("followUps", (s) => s.callId === callId, (a, b) => b.createdAt - a.createdAt);
    },

    async upsertObjection(docData) {
      return upsertById("objections", docData);
    },

    async deleteObjection(id) {
      const items = loadCollection("objections").filter((d) => d.id !== id);
      saveCollection("objections", items);
    },

    async listObjectionsByCall(callId) {
      return findMany("objections", (s) => s.callId === callId, (a, b) => b.createdAt - a.createdAt);
    },

    async upsertMomDraft(docData) {
      return upsertById("momDrafts", docData);
    },

    async deleteMomDraft(id) {
      const items = loadCollection("momDrafts").filter((d) => d.id !== id);
      saveCollection("momDrafts", items);
    },

    async listMomDraftsByCall(callId) {
      return findMany("momDrafts", (s) => s.callId === callId, (a, b) => b.createdAt - a.createdAt);
    },

    async upsertMeddpiccDelta(docData) {
      return upsertById("meddpiccDeltas", docData);
    },

    async deleteMeddpiccDelta(id) {
      const items = loadCollection("meddpiccDeltas").filter((d) => d.id !== id);
      saveCollection("meddpiccDeltas", items);
    },

    async listMeddpiccDeltasByCall(callId) {
      return findMany("meddpiccDeltas", (s) => s.callId === callId, (a, b) => b.createdAt - a.createdAt);
    },

    async upsertDealSignal(docData) {
      return upsertById("dealSignals", docData);
    },

    async deleteDealSignal(id) {
      const items = loadCollection("dealSignals").filter((d) => d.id !== id);
      saveCollection("dealSignals", items);
    },

    async listDealSignalsByCall(callId) {
      return findMany("dealSignals", (s) => s.callId === callId, (a, b) => b.createdAt - a.createdAt);
    },

    async listDealSignalsByDeal(dealId, limitCount = 50) {
      return findMany("dealSignals", (s) => s.dealId === dealId, (a, b) => b.createdAt - a.createdAt).slice(0, limitCount);
    },

    async upsertArrLine(docData) {
      return upsertById("arrLines", docData);
    },

    async deleteArrLine(id) {
      const items = loadCollection("arrLines").filter((d) => d.id !== id);
      saveCollection("arrLines", items);
    },

    async listArrLinesByCall(callId) {
      return findMany("arrLines", (s) => s.callId === callId, (a, b) => b.computedAt - a.computedAt);
    },

    async listArrLinesByDeal(dealId, limitCount = 200) {
      return findMany("arrLines", (s) => s.dealId === dealId, (a, b) => b.computedAt - a.computedAt).slice(0, limitCount);
    },

    async upsertArrOverride(docData) {
      return upsertById("arrOverrides", docData);
    },

    async listArrOverridesByDeal(dealId, limitCount = 100) {
      return findMany("arrOverrides", (s) => s.dealId === dealId, (a, b) => b.createdAt - a.createdAt).slice(
        0,
        limitCount,
      );
    },

    async upsertTechnicalCommit(docData) {
      return upsertByNaturalKey("technicalCommits", docData, (row) => row.dealId === docData.dealId);
    },

    async getTechnicalCommitByDeal(dealId) {
      return findMany("technicalCommits", (s) => s.dealId === dealId)[0] || null;
    },

    async upsertTcDelta(docData) {
      return upsertById("tcDeltas", docData);
    },

    async deleteTcDelta(id) {
      saveCollection("tcDeltas", loadCollection("tcDeltas").filter((d) => d.id !== id));
    },

    async listTcDeltasByCall(callId) {
      return findMany("tcDeltas", (s) => s.callId === callId, (a, b) => b.createdAt - a.createdAt);
    },

    async listTcDeltasByDeal(dealId, limitCount = 200) {
      return findMany("tcDeltas", (s) => s.dealId === dealId, (a, b) => b.createdAt - a.createdAt).slice(
        0,
        limitCount,
      );
    },

    async upsertDealSummary(docData) {
      return upsertByNaturalKey("dealSummaries", docData, (row) => row.dealId === docData.dealId);
    },

    async getDealSummaryByDeal(dealId) {
      return findMany("dealSummaries", (s) => s.dealId === dealId)[0] || null;
    },

    async upsertAccountSummary(docData) {
      return upsertByNaturalKey("accountSummaries", docData, (row) => row.accountId === docData.accountId);
    },

    async getAccountSummaryByAccount(accountId) {
      return findMany("accountSummaries", (s) => s.accountId === accountId)[0] || null;
    },

    async upsertProductGap(docData) {
      return upsertById("productGaps", docData);
    },

    async listProductGapsByPostCall(postCallId) {
      return findMany("productGaps", (g) => g.postCallId === postCallId, (a, b) => b.createdAt - a.createdAt);
    },

    async listProductGapsByOrg(orgId, limitCount = 500) {
      return findMany("productGaps", (g) => g.orgId === orgId, (a, b) => b.createdAt - a.createdAt).slice(
        0,
        limitCount,
      );
    },

    async upsertWhatWorks(docData) {
      return upsertById("whatWorks", docData);
    },

    async listWhatWorksByPostCall(postCallId) {
      return findMany("whatWorks", (w) => w.postCallId === postCallId, (a, b) => b.createdAt - a.createdAt);
    },

    async listWhatWorksByOrg(orgId, limitCount = 500) {
      return findMany("whatWorks", (w) => w.orgId === orgId, (a, b) => b.createdAt - a.createdAt).slice(
        0,
        limitCount,
      );
    },

    async listTechnicalCommitsByOrg(orgId, limitCount = 500) {
      return findMany("technicalCommits", (t) => t.orgId === orgId, (a, b) => b.updatedAt - a.updatedAt).slice(
        0,
        limitCount,
      );
    },

    async upsertGapCluster(docData) {
      return upsertById("gapClusters", docData);
    },

    async listGapClustersByOrg(orgId, limitCount = 200) {
      return findMany(
        "gapClusters",
        (c) => c.orgId === orgId && c.status !== "archived",
        (a, b) => (b.arrTotal || 0) - (a.arrTotal || 0),
      ).slice(0, limitCount);
    },

    async getGapCluster(id) {
      return findById("gapClusters", id);
    },

    async getClusteringState(orgId) {
      return findOne("clusteringState", (s) => s.orgId === orgId || s.id === orgId);
    },

    async upsertClusteringState(docData) {
      return upsertByNaturalKey("clusteringState", docData, (row) => row.orgId === docData.orgId);
    },

    /** Clear all domain data (dev/testing). */
    clearAll() {
      _cache.clear();
      for (const name of [
        "users",
        "teams",
        "orgs",
        "accounts",
        "contacts",
        "deals",
        "lifecycles",
        "prepBriefs",
        "postCalls",
        "tasks",
        "events",
        "contactEvents",
        "scorecards",
        "scorecardLines",
        "scoreOverrides",
        "videoFacts",
        "timelineSegments",
        "timelineMarkers",
        "followUps",
        "objections",
        "momDrafts",
        "meddpiccDeltas",
        "technicalCommits",
        "tcDeltas",
        "dealSignals",
        "dealSummaries",
        "accountSummaries",
        "arrLines",
        "arrOverrides",
        "productGaps",
        "whatWorks",
        "gapClusters",
        "clusteringState",
      ]) {
        localStorage.removeItem(`${PREFIX}${name}`);
      }
    },
  };
}

/** Export for tests and migration scripts reading browser export. */
export function exportLocalDomainData() {
  const data = {};
  for (const name of [
    "users",
    "teams",
    "accounts",
    "contacts",
    "deals",
    "lifecycles",
    "prepBriefs",
    "postCalls",
    "tasks",
    "events",
    "contactEvents",
    "scorecards",
    "scorecardLines",
    "scoreOverrides",
    "videoFacts",
    "timelineSegments",
    "timelineMarkers",
    "followUps",
    "objections",
    "momDrafts",
    "meddpiccDeltas",
    "technicalCommits",
    "tcDeltas",
    "dealSignals",
    "dealSummaries",
    "accountSummaries",
    "arrLines",
    "arrOverrides",
    "productGaps",
    "whatWorks",
    "gapClusters",
    "clusteringState",
  ]) {
    data[name] = loadCollection(name);
  }
  return data;
}

export { newId, now };
