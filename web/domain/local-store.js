/**
 * localStorage-backed domain store for dummy auth mode.
 * Mirrors Firestore document shapes under se-singha-domain:{collection} keys.
 */

import { newId, now, dealContactId, normalizeDealContactRole } from "./types.js";
import {
  detailArray,
  dealSignalsFromPostCalls,
  tcDeltasFromPostCalls,
  productGapsFromPostCalls,
  whatWorksFromPostCalls,
} from "./post-call-detail.js";
import { invalidateSessionListCache } from "./session-list-cache.js";
import { stripEmbeddingFields } from "./field-masks.js";

const PREFIX = "se-singha-domain:";
const _cache = new Map();

/**
 * Collections that feed listAccountsForSession's row cache. Writing any of them must
 * drop that cache, or a list read straight after a write returns pre-write rows for up
 * to its 60s TTL. app.js invalidates on the two UI write paths, but that leaves every
 * other caller silently stale — so the invariant is enforced here instead.
 */
const SESSION_LIST_COLLECTIONS = new Set(["accounts", "deals", "lifecycles"]);

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
  if (SESSION_LIST_COLLECTIONS.has(name)) invalidateSessionListCache();
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

/** Hard delete. Only join rows use this — domain records are archived by status, never removed. */
function removeById(collection, id) {
  const items = loadCollection(collection);
  const next = items.filter((d) => d.id !== id);
  if (next.length === items.length) return false;
  saveCollection(collection, next);
  return true;
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

    /**
     * Slug lookup, alias-aware. When an account is re-slugged after its domain is discovered
     * (name-derived `acme-corp` → canonical `acme.com`) the old slug is kept in
     * `metadata.slugAliases`. Without checking those, a later name-only lookup misses the
     * account it just adopted and forks a duplicate — the very thing re-slugging prevents.
     */
    async findAccountBySlug(slug) {
      const key = String(slug || "").trim();
      if (!key) return null;
      return (
        findOne("accounts", (a) => a.slug === key) ||
        findOne("accounts", (a) => (a.metadata?.slugAliases || []).includes(key))
      );
    },

    async findAccountsByDomain(domain) {
      const key = String(domain || "").trim().toLowerCase();
      if (!key) return [];
      return findMany(
        "accounts",
        (a) => String(a.domain || "").trim().toLowerCase() === key,
        (a, b) => (b.updatedAt || 0) - (a.updatedAt || 0),
      );
    },

    /**
     * Global name match (no teamId filter) — mirrors findAccountsByDomain for intake attach.
     * Normalized equality on account.name so SE-2 resolves SE-1's company without ownership.
     */
    async findAccountsByName(nameQuery) {
      const key = String(nameQuery || "")
        .trim()
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, " ")
        .trim();
      if (!key) return [];
      return findMany(
        "accounts",
        (a) =>
          String(a.name || "")
            .trim()
            .toLowerCase()
            .replace(/[^a-z0-9]+/g, " ")
            .trim() === key,
        (a, b) => (b.updatedAt || 0) - (a.updatedAt || 0),
      );
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

    async listAccounts(opts = {}) {
      const rows = findMany("accounts", () => true, (a, b) => (b.updatedAt || 0) - (a.updatedAt || 0));
      return opts.forSearch ? rows : rows.map(stripEmbeddingFields);
    },

    async listActiveLifecyclesForAccount(accountId, opts = {}) {
      const ownerId = opts.ownerId || null;
      return findMany(
        "lifecycles",
        (l) =>
          l.accountId === accountId &&
          l.status === "active" &&
          (!ownerId || l.ownerId === ownerId),
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

    async findContactsByEmail(email) {
      const key = String(email || "").trim().toLowerCase();
      if (!key) return [];
      return findMany("contacts", (c) => c.email === key);
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

    // ---- dealContacts: the Deal↔Contact join (Salesforce OpportunityContactRole) ----
    // An account's contacts are NOT implicitly on all of its deals. Reading
    // listContactsByAccount to populate a deal's contact panel is what made two deals on one
    // account show identical people — query this join instead.

    async createDealContact(link = {}) {
      const id = dealContactId(link.dealId, link.contactId);
      const existing = findById("dealContacts", id);
      const ts = now();
      return upsertById("dealContacts", {
        createdAt: existing?.createdAt ?? ts,
        ...existing,
        ...link,
        id,
        role: normalizeDealContactRole(link.role),
        isPrimary: !!link.isPrimary,
        updatedAt: ts,
      });
    },

    async findDealContact(dealId, contactId) {
      return findById("dealContacts", dealContactId(dealId, contactId)) || null;
    },

    async listDealContactLinks(dealId) {
      const key = String(dealId || "").trim();
      if (!key) return [];
      return findMany(
        "dealContacts",
        (d) => d.dealId === key,
        (a, b) => Number(b.isPrimary) - Number(a.isPrimary) || a.contactId.localeCompare(b.contactId),
      );
    },

    async listContactsByDeal(dealId) {
      const links = await this.listDealContactLinks(dealId);
      return links
        .map((link) => {
          const contact = findById("contacts", link.contactId);
          if (!contact) return null;
          return {
            ...contact,
            contactId: contact.id,
            dealRole: link.role,
            isPrimary: link.isPrimary,
            dealContactId: link.id,
          };
        })
        .filter(Boolean);
    },

    async listDealsByContact(contactId) {
      const key = String(contactId || "").trim();
      if (!key) return [];
      return findMany("dealContacts", (d) => d.contactId === key);
    },

    async setPrimaryDealContact(dealId, contactId) {
      const key = String(dealId || "").trim();
      const target = String(contactId || "").trim();
      if (!key || !target) return null;
      let promoted = null;
      // Exactly one primary per deal: demote the deal's others in the same pass, so a caller
      // cannot leave two rows both claiming to be primary.
      for (const link of findMany("dealContacts", (d) => d.dealId === key)) {
        const isPrimary = link.contactId === target;
        if (!!link.isPrimary === isPrimary) {
          if (isPrimary) promoted = link;
          continue;
        }
        const saved = upsertById("dealContacts", { ...link, isPrimary, updatedAt: now() });
        if (isPrimary) promoted = saved;
      }
      return promoted;
    },

    async removeDealContact(dealId, contactId) {
      const id = dealContactId(dealId, contactId);
      if (!findById("dealContacts", id)) return false;
      removeById("dealContacts", id);
      return true;
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

    async findActiveDeal(accountId, type, opts = {}) {
      const ownerId = opts.ownerId || null;
      const teamId = opts.teamId || null;
      const includeGrace = opts.includeGrace === true;
      const statuses = includeGrace ? ["active", "closed_won_grace"] : ["active"];
      for (const status of statuses) {
        const match = findOne(
          "deals",
          (d) =>
            d.accountId === accountId &&
            d.type === type &&
            d.status === status &&
            (!ownerId || d.ownerId === ownerId) &&
            (!teamId || d.teamId === teamId),
        );
        if (match) return match;
      }
      return null;
    },

    async findWonNbDealInGrace(accountId, asOfMs = Date.now()) {
      const { NB_GRACE_PERIOD_MS } = await import("./deal-motion.js");
      const matches = findMany(
        "deals",
        (d) =>
          d.accountId === accountId &&
          d.type === "new_business" &&
          d.status === "archived" &&
          d.stage === "closed_won",
        (a, b) => (b.lastActivityAt || 0) - (a.lastActivityAt || 0),
      );
      for (const deal of matches) {
        const wonAt = deal.metadata?.closedWonAt || deal.closedWonAt;
        if (typeof wonAt === "number" && asOfMs <= wonAt + NB_GRACE_PERIOD_MS) {
          return deal;
        }
      }
      return null;
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

    /**
     * Deals for an account. Default (no ownerId) is account-scoped — every deal on the
     * account, not caller ownership — so intake attach surfaces other SEs' opportunities.
     */
    async listDealsByAccount(accountId, ownerId, opts = {}) {
      const teamId = opts.teamId || null;
      // Coerce mistaken opts-as-ownerId objects from older call sites.
      const ownerFilter =
        typeof ownerId === "string" && ownerId ? ownerId : null;
      const rows = findMany(
        "deals",
        (d) =>
          d.accountId === accountId
          && (!ownerFilter || d.ownerId === ownerFilter)
          && (!teamId || d.teamId === teamId),
        (a, b) => (b.lastActivityAt || 0) - (a.lastActivityAt || 0),
      );
      return opts.forSearch ? rows : rows.map(stripEmbeddingFields);
    },

    async listDealsByOwner(ownerId, limitCount = 300, opts = {}) {
      const rows = findMany(
        "deals",
        (d) => d.ownerId === ownerId,
        (a, b) => (b.lastActivityAt || 0) - (a.lastActivityAt || 0),
      ).slice(0, limitCount);
      return opts.forSearch ? rows : rows.map(stripEmbeddingFields);
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

    async upsertCallSummary(doc) {
      return upsertById("callSummaries", doc);
    },

    async upsertPostCallWithSummary(postCall, callSummary) {
      const saved = await upsertById("postCalls", postCall);
      if (callSummary) await upsertById("callSummaries", callSummary);
      return saved;
    },

    async getPostCall(id) {
      return findById("postCalls", id);
    },

    async getCall(id) {
      return this.getPostCall(id);
    },

    _postCallForDetailLookup(callId) {
      return findById("postCalls", callId);
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

    async listCallSummariesByOwner(ownerId, limitCount = 200, opts = {}) {
      const rows = findMany("callSummaries", (p) => p.ownerId === ownerId, (a, b) => b.createdAt - a.createdAt).slice(
        0,
        limitCount,
      );
      return opts.forSearch ? rows : rows.map(stripEmbeddingFields);
    },

    async listCallSummariesByTeam(teamId, limitCount = 200, opts = {}) {
      const rows = findMany("callSummaries", (p) => p.teamId === teamId, (a, b) => b.createdAt - a.createdAt).slice(
        0,
        limitCount,
      );
      return opts.forSearch ? rows : rows.map(stripEmbeddingFields);
    },

    async listCallSummariesByOrg(orgId, limitCount = 200, opts = {}) {
      const rows = findMany("callSummaries", (p) => p.orgId === orgId, (a, b) => b.createdAt - a.createdAt).slice(
        0,
        limitCount,
      );
      return opts.forSearch ? rows : rows.map(stripEmbeddingFields);
    },

    async listCallSummariesByDeal(dealId, limitCount = 50, opts = {}) {
      const rows = findMany("callSummaries", (p) => p.dealId === dealId, (a, b) => b.createdAt - a.createdAt).slice(
        0,
        limitCount,
      );
      return opts.forSearch ? rows : rows.map(stripEmbeddingFields);
    },

    async listCallSummariesByAccount(accountId, limitCount = 80, opts = {}) {
      const rows = findMany("callSummaries", (p) => p.accountId === accountId, (a, b) => b.createdAt - a.createdAt).slice(
        0,
        limitCount,
      );
      return opts.forSearch ? rows : rows.map(stripEmbeddingFields);
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

    async listTasksForLifecycles(lifecycleIds) {
      const ids = new Set((lifecycleIds || []).filter(Boolean));
      /** @type {Map<string, object[]>} */
      const byLifecycle = new Map();
      if (!ids.size) return byLifecycle;
      const tasks = findMany("tasks", (t) => ids.has(t.lifecycleId), (a, b) => b.createdAt - a.createdAt);
      for (const task of tasks) {
        const key = task.lifecycleId;
        if (!byLifecycle.has(key)) byLifecycle.set(key, []);
        byLifecycle.get(key).push(task);
      }
      return byLifecycle;
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

    async listScorecardsForCalls(callIds) {
      const ids = new Set((callIds || []).filter(Boolean));
      /** @type {Map<string, object[]>} */
      const byCall = new Map();
      if (!ids.size) return byCall;
      const cards = findMany("scorecards", (s) => ids.has(s.callId), (a, b) => b.createdAt - a.createdAt);
      for (const card of cards) {
        const key = card.callId;
        if (!byCall.has(key)) byCall.set(key, []);
        byCall.get(key).push(card);
      }
      return byCall;
    },

    async listScorecardLinesByCall(callId) {
      return findMany("scorecardLines", (l) => l.callId === callId);
    },

    async listScorecardLinesForCalls(callIds) {
      const ids = new Set((callIds || []).filter(Boolean));
      /** @type {Map<string, object[]>} */
      const byCall = new Map();
      if (!ids.size) return byCall;
      const lines = findMany("scorecardLines", (l) => ids.has(l.callId));
      for (const line of lines) {
        const key = line.callId;
        if (!byCall.has(key)) byCall.set(key, []);
        byCall.get(key).push(line);
      }
      return byCall;
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
      const cardIds = new Set(lines.map((l) => l.scorecardId).filter(Boolean));
      const provisionalCards = new Set(
        loadCollection("scorecards")
          .filter((s) => cardIds.has(s.id) && s.provisional)
          .map((s) => s.id),
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
      const embedded = detailArray(this._postCallForDetailLookup(callId), "videoFacts");
      if (embedded.length) return embedded;
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
      const embedded = detailArray(this._postCallForDetailLookup(callId), "timelineSegments");
      if (embedded.length) {
        return embedded.sort((a, b) => (a.startS || 0) - (b.startS || 0));
      }
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
      const embedded = detailArray(this._postCallForDetailLookup(callId), "timelineMarkers");
      if (embedded.length) {
        return embedded.sort((a, b) => (a.atS || 0) - (b.atS || 0));
      }
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
      const embedded = detailArray(this._postCallForDetailLookup(callId), "followUps");
      if (embedded.length) return embedded;
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
      const embedded = detailArray(this._postCallForDetailLookup(callId), "objections");
      if (embedded.length) return embedded;
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
      const embedded = detailArray(this._postCallForDetailLookup(callId), "momDrafts");
      if (embedded.length) return embedded;
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
      const embedded = detailArray(this._postCallForDetailLookup(callId), "meddpiccDeltas");
      if (embedded.length) return embedded;
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
      const embedded = detailArray(this._postCallForDetailLookup(callId), "dealSignals");
      if (embedded.length) return embedded;
      return findMany("dealSignals", (s) => s.callId === callId, (a, b) => b.createdAt - a.createdAt);
    },

    async listDealSignalsByDeal(dealId, limitCount = 50) {
      const postCalls = await this.listPostCallsByDeal(dealId, limitCount);
      const fromDetail = dealSignalsFromPostCalls(postCalls, limitCount);
      if (fromDetail.length) return fromDetail;
      return findMany("dealSignals", (s) => s.dealId === dealId, (a, b) => b.createdAt - a.createdAt).slice(0, limitCount);
    },

    async listDealSignalsForDeals(dealIds, perDealLimit = 1) {
      const idSet = new Set((dealIds || []).filter(Boolean));
      /** @type {Map<string, object[]>} */
      const byDeal = new Map();
      if (!idSet.size) return byDeal;
      const postCalls = findMany("postCalls", (p) => idSet.has(p.dealId));
      for (const pc of postCalls) {
        for (const sig of detailArray(pc, "dealSignals")) {
          if (!byDeal.has(pc.dealId)) byDeal.set(pc.dealId, []);
          const arr = byDeal.get(pc.dealId);
          if (arr.length < perDealLimit) arr.push(sig);
        }
      }
      if ([...byDeal.values()].some((rows) => rows.length)) return byDeal;
      const all = findMany(
        "dealSignals",
        (s) => idSet.has(s.dealId),
        (a, b) => b.createdAt - a.createdAt,
      );
      for (const row of all) {
        if (!byDeal.has(row.dealId)) byDeal.set(row.dealId, []);
        const arr = byDeal.get(row.dealId);
        if (arr.length < perDealLimit) arr.push(row);
      }
      return byDeal;
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

    async listArrLinesForDeals(dealIds) {
      const idSet = new Set((dealIds || []).filter(Boolean));
      /** @type {Map<string, object[]>} */
      const byDeal = new Map();
      if (!idSet.size) return byDeal;
      const all = findMany(
        "arrLines",
        (s) => idSet.has(s.dealId),
        (a, b) => b.computedAt - a.computedAt,
      );
      for (const row of all) {
        if (!byDeal.has(row.dealId)) byDeal.set(row.dealId, []);
        byDeal.get(row.dealId).push(row);
      }
      return byDeal;
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

    async getTechnicalCommitByAccount(accountId) {
      return findMany("technicalCommits", (s) => s.accountId === accountId)[0] || null;
    },

    async upsertTcDelta(docData) {
      return upsertById("tcDeltas", docData);
    },

    async deleteTcDelta(id) {
      saveCollection("tcDeltas", loadCollection("tcDeltas").filter((d) => d.id !== id));
    },

    async listTcDeltasByCall(callId) {
      const embedded = detailArray(this._postCallForDetailLookup(callId), "tcDeltas");
      if (embedded.length) return embedded;
      return findMany("tcDeltas", (s) => s.callId === callId, (a, b) => b.createdAt - a.createdAt);
    },

    async listTcDeltasByDeal(dealId, limitCount = 200) {
      const postCalls = await this.listPostCallsByDeal(dealId, limitCount);
      const fromDetail = tcDeltasFromPostCalls(postCalls, limitCount);
      if (fromDetail.length) return fromDetail;
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
      const embedded = detailArray(this._postCallForDetailLookup(postCallId), "productGaps");
      if (embedded.length) return embedded;
      return findMany("productGaps", (g) => g.postCallId === postCallId, (a, b) => b.createdAt - a.createdAt);
    },

    async listProductGapsByOrg(orgId, limitCount = 500) {
      return findMany("productGaps", (g) => g.orgId === orgId, (a, b) => b.createdAt - a.createdAt).slice(
        0,
        limitCount,
      );
    },

    async listProductGapsByDeal(dealId, limitCount = 500) {
      const postCalls = await this.listPostCallsByDeal(dealId, limitCount);
      const fromDetail = productGapsFromPostCalls(postCalls, limitCount);
      if (fromDetail.length) return fromDetail;
      return findMany("productGaps", (g) => g.dealId === dealId, (a, b) => b.createdAt - a.createdAt).slice(
        0,
        limitCount,
      );
    },

    async upsertWhatWorks(docData) {
      return upsertById("whatWorks", docData);
    },

    async listWhatWorksByPostCall(postCallId) {
      const embedded = detailArray(this._postCallForDetailLookup(postCallId), "whatWorks");
      if (embedded.length) return embedded;
      return findMany("whatWorks", (w) => w.postCallId === postCallId, (a, b) => b.createdAt - a.createdAt);
    },

    async listWhatWorksByOrg(orgId, limitCount = 500) {
      return findMany("whatWorks", (w) => w.orgId === orgId, (a, b) => b.createdAt - a.createdAt).slice(
        0,
        limitCount,
      );
    },

    async listWhatWorksByDeal(dealId, limitCount = 500) {
      const postCalls = await this.listPostCallsByDeal(dealId, limitCount);
      const fromDetail = whatWorksFromPostCalls(postCalls, limitCount);
      if (fromDetail.length) return fromDetail;
      return findMany("whatWorks", (w) => w.dealId === dealId, (a, b) => b.createdAt - a.createdAt).slice(
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

    async getReadModel(collection, id) {
      return findById(collection, id);
    },

    async getReadModels(collection, ids) {
      const unique = [...new Set((ids || []).filter(Boolean))];
      return unique.map((id) => findById(collection, id)).filter(Boolean);
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
        "dealContacts",
        "lifecycles",
        "prepBriefs",
        "postCalls",
        "callSummaries",
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
    "dealContacts",
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
