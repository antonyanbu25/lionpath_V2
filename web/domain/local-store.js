/**
 * localStorage-backed domain store for dummy auth mode.
 * Mirrors Firestore document shapes under se-singha-domain:{collection} keys.
 */

import { newId, now } from "./types.js";

const PREFIX = "se-singha-domain:";

function loadCollection(name) {
  try {
    return JSON.parse(localStorage.getItem(`${PREFIX}${name}`) || "[]");
  } catch {
    return [];
  }
}

function saveCollection(name, items) {
  localStorage.setItem(`${PREFIX}${name}`, JSON.stringify(items));
}

function upsertById(collection, doc) {
  const items = loadCollection(collection);
  const idx = items.findIndex((d) => d.id === doc.id);
  if (idx >= 0) items[idx] = { ...items[idx], ...doc };
  else items.push(doc);
  saveCollection(collection, items);
  return doc;
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
  return {
    mode: "local",

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

    async listPostCallsByOrg(orgId) {
      return findMany("postCalls", (p) => p.orgId === orgId, (a, b) => b.createdAt - a.createdAt);
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

    async listLifecyclesByOwner(ownerId) {
      return findMany("lifecycles", (l) => l.ownerId === ownerId, (a, b) => b.lastActivityAt - a.lastActivityAt);
    },

    async listLifecyclesByTeam(teamId) {
      return findMany("lifecycles", (l) => l.teamId === teamId, (a, b) => b.lastActivityAt - a.lastActivityAt);
    },

    async createPrepBrief(doc) {
      return upsertById("prepBriefs", doc);
    },

    async listPrepBriefsByLifecycle(lifecycleId) {
      return findMany("prepBriefs", (p) => p.lifecycleId === lifecycleId, (a, b) => b.createdAt - a.createdAt);
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

    async listPostCallsByLifecycle(lifecycleId) {
      return findMany("postCalls", (p) => p.lifecycleId === lifecycleId, (a, b) => b.createdAt - a.createdAt);
    },

    async listPostCallsByTeam(teamId) {
      return findMany("postCalls", (p) => p.teamId === teamId, (a, b) => b.createdAt - a.createdAt);
    },

    async listPostCallsByOwner(ownerId) {
      return findMany("postCalls", (p) => p.ownerId === ownerId, (a, b) => b.createdAt - a.createdAt);
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

    /** Clear all domain data (dev/testing). */
    clearAll() {
      for (const name of ["users", "teams", "orgs", "accounts", "contacts", "lifecycles", "prepBriefs", "postCalls", "tasks", "events", "contactEvents"]) {
        localStorage.removeItem(`${PREFIX}${name}`);
      }
    },
  };
}

/** Export for tests and migration scripts reading browser export. */
export function exportLocalDomainData() {
  const data = {};
  for (const name of ["users", "teams", "accounts", "contacts", "lifecycles", "prepBriefs", "postCalls", "tasks", "events", "contactEvents"]) {
    data[name] = loadCollection(name);
  }
  return data;
}

export { newId, now };
