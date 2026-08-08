/**
 * Firestore-backed domain store for Firebase auth mode.
 */

import { newId, now, dealContactId, normalizeDealContactRole } from "./types.js";
import { collectionCRUD } from "./collection-crud.js";
import { invalidateSessionListCache } from "./session-list-cache.js";
import {
  CALL_SUMMARY_LIST_FIELDS,
  CALL_SUMMARY_SEARCH_FIELDS,
  ACCOUNT_LIST_FIELDS,
  ACCOUNT_SEARCH_FIELDS,
  DEAL_LIST_FIELDS,
  DEAL_SEARCH_FIELDS,
} from "./field-masks.js";
import {
  detailArray,
  detailFromPostCall,
  dealSignalsFromPostCalls,
  tcDeltasFromPostCalls,
  productGapsFromPostCalls,
  whatWorksFromPostCalls,
} from "./post-call-detail.js";
import { isFirestoreIndexError, isHistoryStubId, stripUndefinedFields } from "./safe-store.js";

/**
 * Drop the listAccountsForSession row cache after writing anything it aggregates —
 * accounts, deals, lifecycles. Mirrors the guard in local-store.js; without it a list
 * read inside the 60s TTL returns pre-write rows. Deals and lifecycles do not go through
 * collectionCRUD, so this is called per writer rather than at one chokepoint.
 */
function touchSessionLists() {
  invalidateSessionListCache();
}

/** Drop ~6KB embedding vectors from list reads (client SDK has no query select). */
function omitEmbeddingFields(row) {
  if (!row || typeof row !== "object") return row;
  const { embedding, embeddingModel, ...rest } = row;
  return rest;
}

/** @param {object} fb Firebase helpers from app.js initFirebase */
export function createFirestoreStore(fb) {
  if (!fb?.db) throw new Error("Firestore not initialized");

  const {
    db, collection, doc, getDoc, getDocs, setDoc, updateDoc, deleteDoc, addDoc,
    query, where, orderBy, limit, documentId, writeBatch, select, onSnapshot,
  } = fb;

  const WHERE_IN_CHUNK = 30;

  function mapSnapDocs(snap) {
    return snap.docs.map((d) => normalizeTimestamps({ id: d.id, ...d.data() }));
  }

  function mapDocSnap(snap) {
    return snap?.exists?.() ? normalizeTimestamps({ id: snap.id, ...snap.data() }) : null;
  }

  function normalizeTimestamps(row) {
    if (!row || typeof row !== "object") return row;
    const out = { ...row };
    for (const key of ["createdAt", "updatedAt", "lastActivityAt"]) {
      const v = out[key];
      if (v && typeof v === "object") {
        if (typeof v.toMillis === "function") out[key] = v.toMillis();
        else if (typeof v.seconds === "number") out[key] = v.seconds * 1000;
      }
    }
    return out;
  }

  /** @param {readonly string[]} fields @param {boolean} [forSearch] */
  function callSummaryFields(forSearch = false) {
    return forSearch ? CALL_SUMMARY_SEARCH_FIELDS : CALL_SUMMARY_LIST_FIELDS;
  }

  /** @param {readonly string[]} fields @param {boolean} [forSearch] */
  function dealFields(forSearch = false) {
    return forSearch ? DEAL_SEARCH_FIELDS : DEAL_LIST_FIELDS;
  }

  /** @param {boolean} [forSearch] */
  function accountFields(forSearch = false) {
    return forSearch ? ACCOUNT_SEARCH_FIELDS : ACCOUNT_LIST_FIELDS;
  }

  /** @param {string} col @param {string} field @param {string[]} values */
  async function queryWhereInChunks(col, field, values) {
    const ids = [...new Set((values || []).filter(Boolean).filter((id) => !isHistoryStubId(id)))];
    if (!ids.length) return [];
    const chunks = [];
    for (let i = 0; i < ids.length; i += WHERE_IN_CHUNK) {
      chunks.push(ids.slice(i, i + WHERE_IN_CHUNK));
    }
    const snaps = await Promise.all(
      chunks.map((chunk) => {
        const q = query(collection(db, col), where(field, "in", chunk));
        return getDocs(q);
      }),
    );
    return snaps.flatMap((snap) => snap.docs.map((d) => ({ id: d.id, ...d.data() })));
  }

  /** @param {string} col @param {string[]} ids */
  async function getDocsByIdInChunks(col, ids) {
    const unique = [...new Set((ids || []).filter(Boolean).filter((id) => !isHistoryStubId(id)))];
    if (!unique.length || !documentId) return [];
    const chunks = [];
    for (let i = 0; i < unique.length; i += WHERE_IN_CHUNK) {
      chunks.push(unique.slice(i, i + WHERE_IN_CHUNK));
    }
    const snaps = await Promise.all(
      chunks.map((chunk) => {
        const q = query(collection(db, col), where(documentId(), "in", chunk));
        return getDocs(q);
      }),
    );
    return snaps.flatMap((snap) => snap.docs.map((d) => ({ id: d.id, ...d.data() })));
  }

  /** @param {object[]} rows @param {string} field */
  function groupRowsByField(rows, field) {
    /** @type {Map<string, object[]>} */
    const out = new Map();
    for (const row of rows || []) {
      const key = String(row[field] || "");
      if (!key) continue;
      if (!out.has(key)) out.set(key, []);
      out.get(key).push(row);
    }
    return out;
  }

  const READ_CACHE_TTL_MS = 30_000;
  const READ_CACHE_COLS = new Set(["users", "teams", "orgs", "accounts"]);
  const readCache = new Map();
  const readCacheConfig = { enabled: true };

  function readCacheKey(col, id) {
    return `${col}:${id}`;
  }

  function peekReadCache(col, id) {
    if (!readCacheConfig.enabled || !READ_CACHE_COLS.has(col)) return { hit: false };
    const entry = readCache.get(readCacheKey(col, id));
    if (!entry) return { hit: false };
    if (Date.now() > entry.expiresAt) {
      readCache.delete(readCacheKey(col, id));
      return { hit: false };
    }
    return { hit: true, value: entry.value };
  }

  function storeReadCache(col, id, value) {
    if (!readCacheConfig.enabled || !READ_CACHE_COLS.has(col)) return;
    readCache.set(readCacheKey(col, id), {
      value,
      expiresAt: Date.now() + READ_CACHE_TTL_MS,
    });
  }

  function invalidateReadCache(col, id) {
    readCache.delete(readCacheKey(col, id));
  }

  async function fetchById(col, id) {
    const snap = await getDoc(doc(db, col, id));
    return snap.exists() ? { id: snap.id, ...snap.data() } : null;
  }

  async function getCachedById(col, id) {
    const cached = peekReadCache(col, id);
    if (cached.hit) return cached.value;
    const result = await fetchById(col, id);
    storeReadCache(col, id, result);
    return result;
  }

  async function getById(col, id) {
    return fetchById(col, id);
  }

  function sortRows(rows, sortKey = "createdAt", dir = "desc") {
    const sign = dir === "asc" ? 1 : -1;
    return [...(rows || [])].sort((a, b) => {
      const av = a?.[sortKey] || 0;
      const bv = b?.[sortKey] || 0;
      if (av === bv) return String(a?.id || "").localeCompare(String(b?.id || ""));
      return av > bv ? sign : -sign;
    });
  }

  function subscribeQueryRows(col, field, value, onRows, opts = {}) {
    if (!onSnapshot) return () => {};
    const key = String(value || "").trim();
    if (!key || typeof onRows !== "function") return () => {};
    if (isHistoryStubId(key)) {
      onRows([]);
      return () => {};
    }
    const q = query(collection(db, col), where(field, "==", key));
    return onSnapshot(
      q,
      (snap) => {
        const rows = mapSnapDocs(snap);
        onRows(opts.sortKey ? sortRows(rows, opts.sortKey, opts.dir) : rows);
      },
      (err) => console.warn(`[firestore] ${col} snapshot failed:`, err?.message || err),
    );
  }

  function subscribeDocRow(col, id, onRow) {
    if (!onSnapshot) return () => {};
    const key = String(id || "").trim();
    if (!key || typeof onRow !== "function") return () => {};
    if (isHistoryStubId(key)) {
      onRow(null);
      return () => {};
    }
    return onSnapshot(
      doc(db, col, key),
      (snap) => onRow(mapDocSnap(snap)),
      (err) => console.warn(`[firestore] ${col}/${key} snapshot failed:`, err?.message || err),
    );
  }

  function subscribeMany(specs, emit) {
    let cancelled = false;
    const unsubs = [];
    const safeEmit = () => {
      if (!cancelled) emit();
    };
    for (const spec of specs) {
      const unsub =
        spec.kind === "doc"
          ? subscribeDocRow(spec.col, spec.id, (row) => {
              spec.assign(row);
              safeEmit();
            })
          : subscribeQueryRows(
              spec.col,
              spec.field,
              spec.value,
              (rows) => {
                spec.assign(rows);
                safeEmit();
              },
              { sortKey: spec.sortKey, dir: spec.dir },
            );
      unsubs.push(unsub);
    }
    return () => {
      cancelled = true;
      for (const unsub of unsubs) unsub?.();
    };
  }

  const crudDeps = {
    db,
    collection,
    doc,
    getDocs,
    setDoc,
    updateDoc,
    query,
    where,
    getCachedById,
    invalidateReadCache,
    now,
  };
  const accountsCrud = collectionCRUD("accounts", crudDeps);
  const teamsCrud = collectionCRUD("teams", crudDeps);
  const orgsCrud = collectionCRUD("orgs", crudDeps);

  const storeApi = {
    mode: "firestore",

    subscribeDealsByOwner(ownerId, cb) {
      return subscribeQueryRows("deals", "ownerId", ownerId, (rows) => {
        const sorted = sortRows(rows, "lastActivityAt", "desc").map(omitEmbeddingFields);
        cb?.(sorted);
      });
    },

    subscribeDealDetail(dealId, cb) {
      if (isHistoryStubId(dealId)) {
        cb?.({
          deal: null,
          summary: null,
          technicalCommit: null,
          dealSignals: [],
          arrLines: [],
          productGaps: [],
          whatWorks: [],
        });
        return () => {};
      }
      const state = {
        deal: null,
        dealSummaries: [],
        technicalCommits: [],
        dealSignals: [],
        arrLines: [],
        productGaps: [],
        whatWorks: [],
      };
      const emit = () => {
        cb?.({
          deal: state.deal,
          summary: sortRows(state.dealSummaries, "generatedAt", "desc")[0] || null,
          technicalCommit: sortRows(state.technicalCommits, "updatedAt", "desc")[0] || null,
          dealSignals: sortRows(state.dealSignals, "createdAt", "desc").slice(0, 50),
          arrLines: sortRows(state.arrLines, "computedAt", "desc").slice(0, 200),
          productGaps: sortRows(state.productGaps, "createdAt", "desc").slice(0, 500),
          whatWorks: sortRows(state.whatWorks, "createdAt", "desc").slice(0, 500),
        });
      };
      return subscribeMany(
        [
          { kind: "doc", col: "deals", id: dealId, assign: (row) => { state.deal = row; } },
          { col: "dealSummaries", field: "dealId", value: dealId, assign: (rows) => { state.dealSummaries = rows; } },
          { col: "technicalCommits", field: "dealId", value: dealId, assign: (rows) => { state.technicalCommits = rows; } },
          { col: "dealSignals", field: "dealId", value: dealId, assign: (rows) => { state.dealSignals = rows; } },
          { col: "arrLines", field: "dealId", value: dealId, assign: (rows) => { state.arrLines = rows; } },
          { col: "productGaps", field: "dealId", value: dealId, assign: (rows) => { state.productGaps = rows; } },
          { col: "whatWorks", field: "dealId", value: dealId, assign: (rows) => { state.whatWorks = rows; } },
        ],
        emit,
      );
    },

    subscribeCallDetail(callId, cb) {
      if (isHistoryStubId(callId)) {
        cb?.({
          postCall: null,
          scorecards: [],
          videoFacts: [],
          timelineSegments: [],
          timelineMarkers: [],
          followUps: [],
          objections: [],
          momDrafts: [],
          meddpiccDeltas: [],
          tcDeltas: [],
          arrLines: [],
          dealSignals: [],
        });
        return () => {};
      }
      const state = {
        postCall: null,
        scorecards: [],
        arrLines: [],
        videoFacts: [],
        timelineSegments: [],
        timelineMarkers: [],
        followUps: [],
        objections: [],
        momDrafts: [],
        meddpiccDeltas: [],
        tcDeltas: [],
        dealSignals: [],
      };
      const emit = () => {
        const embedded = detailFromPostCall(state.postCall);
        cb?.({
          postCall: state.postCall,
          scorecards: state.scorecards,
          videoFacts: embedded.videoFacts.length ? embedded.videoFacts : state.videoFacts,
          timelineSegments: embedded.timelineSegments.length
            ? sortRows(embedded.timelineSegments, "startS", "asc")
            : sortRows(state.timelineSegments, "startS", "asc"),
          timelineMarkers: embedded.timelineMarkers.length
            ? sortRows(embedded.timelineMarkers, "atS", "asc")
            : sortRows(state.timelineMarkers, "atS", "asc"),
          followUps: embedded.followUps.length ? embedded.followUps : state.followUps,
          objections: embedded.objections.length ? embedded.objections : state.objections,
          momDrafts: embedded.momDrafts.length ? embedded.momDrafts : state.momDrafts,
          meddpiccDeltas: embedded.meddpiccDeltas.length ? embedded.meddpiccDeltas : state.meddpiccDeltas,
          tcDeltas: embedded.tcDeltas.length ? embedded.tcDeltas : state.tcDeltas,
          arrLines: sortRows(state.arrLines, "computedAt", "desc"),
          dealSignals: embedded.dealSignals.length ? embedded.dealSignals : state.dealSignals,
        });
      };
      return subscribeMany(
        [
          { kind: "doc", col: "postCalls", id: callId, assign: (row) => { state.postCall = row; } },
          { col: "scorecards", field: "callId", value: callId, assign: (rows) => { state.scorecards = rows; } },
          { col: "arrLines", field: "callId", value: callId, assign: (rows) => { state.arrLines = rows; } },
          { col: "videoFacts", field: "callId", value: callId, assign: (rows) => { state.videoFacts = rows; } },
          { col: "timelineSegments", field: "callId", value: callId, assign: (rows) => { state.timelineSegments = rows; } },
          { col: "timelineMarkers", field: "callId", value: callId, assign: (rows) => { state.timelineMarkers = rows; } },
          { col: "followUps", field: "callId", value: callId, assign: (rows) => { state.followUps = rows; } },
          { col: "objections", field: "callId", value: callId, assign: (rows) => { state.objections = rows; } },
          { col: "momDrafts", field: "callId", value: callId, assign: (rows) => { state.momDrafts = rows; } },
          { col: "meddpiccDeltas", field: "callId", value: callId, assign: (rows) => { state.meddpiccDeltas = rows; } },
          { col: "tcDeltas", field: "callId", value: callId, assign: (rows) => { state.tcDeltas = rows; } },
          { col: "dealSignals", field: "callId", value: callId, assign: (rows) => { state.dealSignals = rows; } },
        ],
        emit,
      );
    },

    subscribeArrLinesByDeal(dealId, cb) {
      return subscribeQueryRows("arrLines", "dealId", dealId, (rows) => {
        cb?.(sortRows(rows, "computedAt", "desc").slice(0, 200));
      });
    },

    get readCacheEnabled() {
      return readCacheConfig.enabled;
    },
    set readCacheEnabled(enabled) {
      readCacheConfig.enabled = !!enabled;
      if (!readCacheConfig.enabled) readCache.clear();
    },

    async getUser(id) {
      return getCachedById("users", id);
    },

    async upsertUser(user) {
      await setDoc(doc(db, "users", user.id), user, { merge: true });
      invalidateReadCache("users", user.id);
      return user;
    },

    async getUserByEmail(email) {
      const key = String(email || "").trim().toLowerCase();
      const q = query(collection(db, "users"), where("email", "==", key), limit(1));
      const snap = await getDocs(q);
      if (snap.empty) return null;
      const d = snap.docs[0];
      return { id: d.id, ...d.data() };
    },

    async upsertAuthIndex(authUid, userId, email) {
      await setDoc(
        doc(db, "authIndex", authUid),
        { userId, email: String(email || "").trim().toLowerCase(), updatedAt: now() },
        { merge: true }
      );
    },

    async getUserIdByAuthUid(authUid) {
      const snap = await getDoc(doc(db, "authIndex", authUid));
      return snap.exists() ? snap.data().userId : null;
    },

    async getTeam(id) {
      return teamsCrud.get(id);
    },

    async upsertTeam(team) {
      return teamsCrud.upsert(team);
    },

    async getOrg(id) {
      return orgsCrud.get(id);
    },

    async upsertOrg(org) {
      return orgsCrud.upsert(org);
    },

    async listTeamsByOrg(orgId) {
      return teamsCrud.listBy("orgId", orgId, (a, b) => String(a.name).localeCompare(String(b.name)));
    },

    async listUsersByManagerId(managerId) {
      const q = query(collection(db, "users"), where("managerId", "==", managerId));
      const snap = await getDocs(q);
      return snap.docs.map((d) => ({ id: d.id, ...d.data() }));
    },

    async listUsersByOrg(orgId) {
      const q = query(collection(db, "users"), where("orgId", "==", orgId));
      const snap = await getDocs(q);
      return snap.docs.map((d) => ({ id: d.id, ...d.data() }));
    },

    /**
     * Slug lookup, alias-aware. When an account is re-slugged after its domain is discovered
     * (name-derived `acme-corp` → canonical `acme.com`) the old slug is kept in
     * `metadata.slugAliases`. Without checking those, a later name-only lookup misses the
     * account it just adopted and forks a duplicate — the very thing re-slugging prevents.
     *
     * `array-contains` on a nested field is auto-indexed, so no composite index is needed.
     */
    async findAccountBySlug(slug) {
      const key = String(slug || "").trim();
      if (!key) return null;
      const direct = await getDocs(
        query(collection(db, "accounts"), where("slug", "==", key), limit(1)),
      );
      if (!direct.empty) {
        const d = direct.docs[0];
        return { id: d.id, ...d.data() };
      }
      const aliased = await getDocs(
        query(
          collection(db, "accounts"),
          where("metadata.slugAliases", "array-contains", key),
          limit(1),
        ),
      );
      if (aliased.empty) return null;
      const d = aliased.docs[0];
      return { id: d.id, ...d.data() };
    },

    async findAccountsByDomain(domain) {
      const key = String(domain || "").trim().toLowerCase();
      if (!key) return [];
      const q = query(collection(db, "accounts"), where("domain", "==", key));
      const snap = await getDocs(q);
      return snap.docs
        .map((d) => ({ id: d.id, ...d.data() }))
        .sort((a, b) => (b.updatedAt || 0) - (a.updatedAt || 0));
    },

    /**
     * Global name match (no teamId filter) — mirrors findAccountsByDomain for intake attach.
     * Accounts have no nameNormalized index; scan listAccounts and filter client-side.
     * FOLLOW-UP (DEAL-011): firestore.rules may later need explicit "read account/deal for
     * attach" so SE-2 can resolve SE-1's account/deal without a full list dump.
     */
    async findAccountsByName(nameQuery) {
      const key = String(nameQuery || "")
        .trim()
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, " ")
        .trim();
      if (!key) return [];
      try {
        const all = await this.listAccounts();
        return all
          .filter(
            (a) =>
              String(a.name || "")
                .trim()
                .toLowerCase()
                .replace(/[^a-z0-9]+/g, " ")
                .trim() === key,
          )
          .sort((a, b) => (b.updatedAt || 0) - (a.updatedAt || 0));
      } catch (err) {
        console.warn("[firestore] findAccountsByName failed:", err?.message || err);
        return [];
      }
    },

    async createAccount(account) {
      const created = await accountsCrud.create(account);
      touchSessionLists();
      return created;
    },

    async updateAccount(id, patch) {
      const updated = await accountsCrud.update(id, patch);
      touchSessionLists();
      return updated;
    },

    async getAccount(id) {
      return accountsCrud.get(id);
    },

    async listAccounts(opts = {}) {
      const fields = accountFields(!!opts.forSearch);
      const q = select
        ? query(collection(db, "accounts"), select(...fields))
        : query(collection(db, "accounts"));
      const snap = await getDocs(q);
      const rows = mapSnapDocs(snap).sort((a, b) => (b.updatedAt || 0) - (a.updatedAt || 0));
      return opts.forSearch ? rows : rows.map(omitEmbeddingFields);
    },

    async listActiveLifecyclesForAccount(accountId, opts = {}) {
      const ownerId = opts.ownerId || null;
      const filters = [
        where("accountId", "==", accountId),
        where("status", "==", "active"),
        ...(ownerId ? [where("ownerId", "==", ownerId)] : []),
      ];
      // Scoped owner queries skip orderBy — avoids composite-index gaps; sort client-side.
      const q = ownerId
        ? query(collection(db, "lifecycles"), ...filters)
        : query(collection(db, "lifecycles"), ...filters, orderBy("lastActivityAt", "desc"));
      const snap = await getDocs(q);
      const rows = snap.docs.map((d) => ({ id: d.id, ...d.data() }));
      if (ownerId) {
        rows.sort((a, b) => (b.lastActivityAt || 0) - (a.lastActivityAt || 0));
      }
      return rows;
    },

    async listLifecyclesByOrg(orgId) {
      const q = query(
        collection(db, "lifecycles"),
        where("orgId", "==", orgId),
        orderBy("lastActivityAt", "desc")
      );
      const snap = await getDocs(q);
      return snap.docs.map((d) => ({ id: d.id, ...d.data() }));
    },

    async findContactByAccountEmail(accountId, email) {
      const key = String(email || "").trim().toLowerCase();
      const q = query(
        collection(db, "contacts"),
        where("accountId", "==", accountId),
        where("email", "==", key),
        limit(1)
      );
      const snap = await getDocs(q);
      if (snap.empty) return null;
      const d = snap.docs[0];
      return { id: d.id, ...d.data() };
    },

    async findContactsByEmail(email) {
      const key = String(email || "").trim().toLowerCase();
      if (!key) return [];
      const q = query(collection(db, "contacts"), where("email", "==", key));
      const snap = await getDocs(q);
      return snap.docs.map((d) => ({ id: d.id, ...d.data() }));
    },

    async createContact(contact) {
      const ref = contact.id ? doc(db, "contacts", contact.id) : doc(collection(db, "contacts"));
      const data = stripUndefinedFields({ ...contact, id: ref.id });
      await setDoc(ref, data);
      return data;
    },

    async updateContact(id, patch) {
      await updateDoc(
        doc(db, "contacts", id),
        stripUndefinedFields({ ...patch, updatedAt: now() }),
      );
      return getById("contacts", id);
    },

    async listContactsByAccount(accountId) {
      const q = query(collection(db, "contacts"), where("accountId", "==", accountId));
      const snap = await getDocs(q);
      return snap.docs
        .map((d) => ({ id: d.id, ...d.data() }))
        .sort((a, b) => String(a.email).localeCompare(String(b.email)));
    },

    // ---- dealContacts: the Deal↔Contact join (Salesforce OpportunityContactRole) ----
    // A top-level collection rather than a deal subcollection, because it is read from both
    // directions: a deal's people, and a person's deals. Single-field equality is auto-indexed,
    // so firestore.indexes.json needs no change.

    async createDealContact(link) {
      const id = dealContactId(link.dealId, link.contactId);
      const ref = doc(db, "dealContacts", id);
      const ts = now();
      const data = {
        ...link,
        id,
        role: normalizeDealContactRole(link.role),
        isPrimary: !!link.isPrimary,
        createdAt: link.createdAt || ts,
        updatedAt: ts,
      };
      await setDoc(ref, data, { merge: true });
      return data;
    },

    async findDealContact(dealId, contactId) {
      const snap = await getDoc(doc(db, "dealContacts", dealContactId(dealId, contactId)));
      return snap.exists() ? { id: snap.id, ...snap.data() } : null;
    },

    async listDealContactLinks(dealId) {
      const key = String(dealId || "").trim();
      if (!key) return [];
      const q = query(collection(db, "dealContacts"), where("dealId", "==", key));
      const snap = await getDocs(q);
      return snap.docs
        .map((d) => ({ id: d.id, ...d.data() }))
        .sort(
          (a, b) =>
            Number(!!b.isPrimary) - Number(!!a.isPrimary) ||
            String(a.contactId).localeCompare(String(b.contactId)),
        );
    },

    async listContactsByDeal(dealId) {
      const links = await this.listDealContactLinks(dealId);
      if (!links.length) return [];
      const contactIds = links.map((l) => l.contactId);
      const contacts = await this.getContactsByIds(contactIds);
      const byId = new Map(contacts.map((c) => [c.id, c]));
      return links
        .map((link) => {
          const contact = byId.get(link.contactId);
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

    async getContactsByIds(ids) {
      const unique = [...new Set(ids.filter(Boolean))];
      if (!unique.length) return [];
      const out = [];
      for (let i = 0; i < unique.length; i += 30) {
        const chunk = unique.slice(i, i + 30);
        const refs = chunk.map((id) => doc(db, "contacts", id));
        const snaps = await Promise.all(refs.map((r) => getDoc(r)));
        for (const snap of snaps) {
          if (snap.exists()) out.push({ id: snap.id, ...snap.data() });
        }
      }
      return out;
    },

    /** @deprecated use listDealContactLinks */
    async _listContactsByDealJoinRows(dealId) {
      return this.listDealContactLinks(dealId);
    },

    async listDealsByContact(contactId) {
      const key = String(contactId || "").trim();
      if (!key) return [];
      const q = query(collection(db, "dealContacts"), where("contactId", "==", key));
      const snap = await getDocs(q);
      return snap.docs.map((d) => ({ id: d.id, ...d.data() }));
    },

    async setPrimaryDealContact(dealId, contactId) {
      const key = String(dealId || "").trim();
      const target = String(contactId || "").trim();
      if (!key || !target) return null;
      const q = query(collection(db, "dealContacts"), where("dealId", "==", key));
      const snap = await getDocs(q);
      let promoted = null;
      // Exactly one primary per deal: demote the deal's others in the same pass, so a caller
      // cannot leave two rows both claiming to be primary.
      await Promise.all(
        snap.docs.map(async (d) => {
          const row = { id: d.id, ...d.data() };
          const isPrimary = row.contactId === target;
          if (isPrimary) promoted = { ...row, isPrimary: true };
          if (!!row.isPrimary === isPrimary) return;
          await updateDoc(d.ref, { isPrimary, updatedAt: now() });
        }),
      );
      return promoted;
    },

    async removeDealContact(dealId, contactId) {
      if (!deleteDoc) return false;
      const id = dealContactId(dealId, contactId);
      const ref = doc(db, "dealContacts", id);
      const snap = await getDoc(ref);
      if (!snap.exists()) return false;
      await deleteDoc(ref);
      return true;
    },

    async addContactEvent(event) {
      const eventRef = doc(
        collection(db, "contacts", event.contactId, "events"),
        event.id || newId("contactEvent")
      );
      const data = { ...event, id: eventRef.id };
      await setDoc(eventRef, data);
      return data;
    },

    async listContactEvents(contactId, limitCount = 10) {
      const q = query(
        collection(db, "contacts", contactId, "events"),
        orderBy("timestamp", "desc"),
        limit(limitCount)
      );
      const snap = await getDocs(q);
      return snap.docs.map((d) => ({ id: d.id, ...d.data() }));
    },

    async findActiveLifecycle(ownerId, accountId) {
      const q = query(
        collection(db, "lifecycles"),
        where("ownerId", "==", ownerId),
        where("accountId", "==", accountId),
        where("status", "==", "active"),
        limit(1)
      );
      const snap = await getDocs(q);
      if (snap.empty) return null;
      const d = snap.docs[0];
      return { id: d.id, ...d.data() };
    },

    async findActiveLifecycleByDeal(ownerId, accountId, dealId) {
      const q = query(
        collection(db, "lifecycles"),
        where("ownerId", "==", ownerId),
        where("accountId", "==", accountId),
        where("dealId", "==", dealId),
        where("status", "==", "active"),
        limit(1)
      );
      const snap = await getDocs(q);
      if (snap.empty) return null;
      const d = snap.docs[0];
      return { id: d.id, ...d.data() };
    },

    async findLifecycleByDealAndOwner(dealId, ownerId) {
      const q = query(
        collection(db, "lifecycles"),
        where("dealId", "==", dealId),
        where("ownerId", "==", ownerId),
        orderBy("lastActivityAt", "desc"),
        limit(5)
      );
      const snap = await getDocs(q);
      const rows = snap.docs.map((d) => ({ id: d.id, ...d.data() }));
      return rows.find((l) => l.status === "active") || rows[0] || null;
    },

    async findActiveDeal(accountId, type, opts = {}) {
      const ownerId = opts.ownerId || null;
      const teamId = opts.teamId || null;
      const includeGrace = opts.includeGrace === true;
      const statuses = includeGrace ? ["active", "closed_won_grace"] : ["active"];
      for (const status of statuses) {
        const filters = [
          where("accountId", "==", accountId),
          where("type", "==", type),
          where("status", "==", status),
          ...(ownerId ? [where("ownerId", "==", ownerId)] : []),
          ...(teamId ? [where("teamId", "==", teamId)] : []),
        ];
        const q = query(collection(db, "deals"), ...filters, limit(1));
        const snap = await getDocs(q);
        if (!snap.empty) {
          const d = snap.docs[0];
          return { id: d.id, ...d.data() };
        }
      }
      return null;
    },

    async findWonNbDealInGrace(accountId, asOfMs = Date.now()) {
      const { NB_GRACE_PERIOD_MS } = await import("./deal-motion.js");
      const q = query(
        collection(db, "deals"),
        where("accountId", "==", accountId),
        where("type", "==", "new_business"),
        where("status", "==", "archived"),
        where("stage", "==", "closed_won"),
        orderBy("lastActivityAt", "desc"),
        limit(5),
      );
      const snap = await getDocs(q);
      for (const docSnap of snap.docs) {
        const deal = { id: docSnap.id, ...docSnap.data() };
        const wonAt = deal.metadata?.closedWonAt || deal.closedWonAt;
        if (typeof wonAt === "number" && asOfMs <= wonAt + NB_GRACE_PERIOD_MS) {
          return deal;
        }
      }
      return null;
    },

    async createDeal(deal) {
      const ref = deal.id ? doc(db, "deals", deal.id) : doc(collection(db, "deals"));
      const data = { ...deal, id: ref.id };
      await setDoc(ref, data);
      touchSessionLists();
      return data;
    },

    async updateDeal(id, patch) {
      await updateDoc(doc(db, "deals", id), { ...patch, updatedAt: now() });
      touchSessionLists();
      return getById("deals", id);
    },

    async getDeal(id) {
      if (isHistoryStubId(id)) return null;
      return getById("deals", id);
    },

    /**
     * Deals for an account. Default (no ownerId) is account-scoped — every deal on the
     * account, not caller ownership — so intake attach surfaces other SEs' opportunities.
     * Optional ownerId/teamId remain for callers that need a narrow slice.
     * FOLLOW-UP (DEAL-011): firestore.rules may later need explicit "read account/deal for
     * attach"; without it SE-2 queries may permission-deny other owners' deals.
     */
    async listDealsByAccount(accountId, ownerId, opts = {}) {
      if (isHistoryStubId(accountId)) return [];
      const fields = dealFields(!!opts.forSearch);
      const teamId = opts.teamId || null;
      // Coerce mistaken opts-as-ownerId objects from older call sites.
      const ownerFilter =
        typeof ownerId === "string" && ownerId ? ownerId : null;

      const filterAndSort = (rows) => {
        const filtered = rows.filter((d) => {
          if (ownerFilter && d.ownerId !== ownerFilter) return false;
          if (teamId && d.teamId !== teamId) return false;
          return true;
        });
        filtered.sort(
          (a, b) =>
            (b.lastActivityAt || b.updatedAt || 0) - (a.lastActivityAt || a.updatedAt || 0),
        );
        return opts.forSearch ? filtered : filtered.map(omitEmbeddingFields);
      };

      async function runQueryPlain(filters) {
        const q = select
          ? query(collection(db, "deals"), ...filters, select(...fields))
          : query(collection(db, "deals"), ...filters);
        const snap = await getDocs(q);
        return mapSnapDocs(snap);
      }

      async function runQueryOrdered(filters) {
        const q = select
          ? query(
              collection(db, "deals"),
              ...filters,
              orderBy("lastActivityAt", "desc"),
              select(...fields),
            )
          : query(collection(db, "deals"), ...filters, orderBy("lastActivityAt", "desc"));
        const snap = await getDocs(q);
        return mapSnapDocs(snap);
      }

      const fullFilters = [
        where("accountId", "==", accountId),
        ...(ownerFilter ? [where("ownerId", "==", ownerFilter)] : []),
        ...(teamId ? [where("teamId", "==", teamId)] : []),
      ];

      try {
        const rows = await runQueryOrdered(fullFilters);
        if (rows.length) return filterAndSort(rows);
      } catch (err) {
        if (!isFirestoreIndexError(err)) {
          console.warn(
            "[firestore] listDealsByAccount ordered query failed:",
            accountId,
            err?.message || err,
          );
        } else {
          console.warn("[firestore] listDealsByAccount index fallback:", accountId);
        }
      }

      if (ownerFilter) {
        try {
          const rows = await runQueryOrdered([
            where("accountId", "==", accountId),
            where("ownerId", "==", ownerFilter),
          ]);
          if (rows.length) return filterAndSort(rows);
        } catch (err) {
          if (!isFirestoreIndexError(err)) {
            console.warn(
              "[firestore] listDealsByAccount owner ordered query failed:",
              accountId,
              err?.message || err,
            );
          }
        }
      }

      // Plain query — ordered queries omit deals missing lastActivityAt.
      const plain = await runQueryPlain([where("accountId", "==", accountId)]);
      return filterAndSort(plain);
    },

    async listDealsByOwner(ownerId, limitCount = 300, opts = {}) {
      const fields = dealFields(!!opts.forSearch);
      const q = select
        ? query(
            collection(db, "deals"),
            where("ownerId", "==", ownerId),
            orderBy("lastActivityAt", "desc"),
            limit(limitCount),
            select(...fields),
          )
        : query(
            collection(db, "deals"),
            where("ownerId", "==", ownerId),
            orderBy("lastActivityAt", "desc"),
            limit(limitCount),
          );
      const snap = await getDocs(q);
      const rows = mapSnapDocs(snap);
      return opts.forSearch ? rows : rows.map(omitEmbeddingFields);
    },

    async createLifecycle(lifecycle) {
      const ref = lifecycle.id ? doc(db, "lifecycles", lifecycle.id) : doc(collection(db, "lifecycles"));
      const data = { ...lifecycle, id: ref.id };
      await setDoc(ref, data);
      touchSessionLists();
      return data;
    },

    async updateLifecycle(id, patch) {
      await updateDoc(doc(db, "lifecycles", id), { ...patch, updatedAt: now() });
      touchSessionLists();
      return getById("lifecycles", id);
    },

    async getLifecycle(id) {
      return getById("lifecycles", id);
    },

    async listLifecyclesByOwner(ownerId, limitCount = 200) {
      const q = query(
        collection(db, "lifecycles"),
        where("ownerId", "==", ownerId),
        orderBy("lastActivityAt", "desc"),
        limit(limitCount)
      );
      const snap = await getDocs(q);
      return snap.docs.map((d) => ({ id: d.id, ...d.data() }));
    },

    async listLifecyclesByTeam(teamId, limitCount = 200) {
      const q = query(
        collection(db, "lifecycles"),
        where("teamId", "==", teamId),
        orderBy("lastActivityAt", "desc"),
        limit(limitCount)
      );
      const snap = await getDocs(q);
      return snap.docs.map((d) => ({ id: d.id, ...d.data() }));
    },

    async createPrepBrief(docData) {
      const ref = docData.id ? doc(db, "prepBriefs", docData.id) : doc(collection(db, "prepBriefs"));
      const data = { ...docData, id: ref.id };
      await setDoc(ref, data);
      return data;
    },

    async listPrepBriefsByLifecycle(lifecycleId, ownerId) {
      const constraints = [where("lifecycleId", "==", lifecycleId)];
      if (ownerId) constraints.push(where("ownerId", "==", ownerId));
      constraints.push(orderBy("createdAt", "desc"));
      const q = query(collection(db, "prepBriefs"), ...constraints);
      const snap = await getDocs(q);
      return snap.docs.map((d) => ({ id: d.id, ...d.data() }));
    },

    async findPostCallByIdentity(ownerId, callIdentityKey) {
      const q = query(
        collection(db, "postCalls"),
        where("ownerId", "==", ownerId),
        where("callIdentityKey", "==", callIdentityKey),
        limit(1)
      );
      const snap = await getDocs(q);
      if (snap.empty) return null;
      const d = snap.docs[0];
      return { id: d.id, ...d.data() };
    },

    async upsertPostCall(docData) {
      const ref = docData.id ? doc(db, "postCalls", docData.id) : doc(collection(db, "postCalls"));
      const data = { ...docData, id: ref.id };
      await setDoc(ref, data, { merge: true });
      touchSessionLists();
      return data;
    },

    async upsertCallSummary(docData) {
      const ref = docData.id ? doc(db, "callSummaries", docData.id) : doc(collection(db, "callSummaries"));
      const data = { ...docData, id: ref.id };
      await setDoc(ref, data, { merge: true });
      touchSessionLists();
      return data;
    },

    async upsertPostCallWithSummary(postCall, callSummary) {
      if (!writeBatch) {
        const saved = await this.upsertPostCall(postCall);
        if (callSummary) await this.upsertCallSummary(callSummary);
        return saved;
      }
      const postRef = postCall.id ? doc(db, "postCalls", postCall.id) : doc(collection(db, "postCalls"));
      const postData = { ...postCall, id: postRef.id };
      const batch = writeBatch(db);
      batch.set(postRef, postData, { merge: true });
      if (callSummary) {
        const sumRef = doc(db, "callSummaries", callSummary.id || postData.id);
        batch.set(sumRef, { ...callSummary, id: sumRef.id }, { merge: true });
      }
      await batch.commit();
      touchSessionLists();
      return postData;
    },

    async getPostCall(id) {
      if (isHistoryStubId(id)) return null;
      const snap = await getDoc(doc(db, "postCalls", id));
      if (!snap.exists()) return null;
      const row = { id: snap.id, ...snap.data() };
      const { hydratePostCallPayloadFromGcs } = await import("./call-payload-storage.js");
      return hydratePostCallPayloadFromGcs(row);
    },

    /** Post-call with embedded detail hydrated (alias for detail views). */
    async getCall(id) {
      return this.getPostCall(id);
    },

    async _postCallForDetailLookup(callId) {
      if (isHistoryStubId(callId)) return null;
      const snap = await getDoc(doc(db, "postCalls", callId));
      if (!snap.exists()) return null;
      const row = { id: snap.id, ...snap.data() };
      if (row.detailGcsUri) {
        const { hydratePostCallPayloadFromGcs } = await import("./call-payload-storage.js");
        return hydratePostCallPayloadFromGcs(row);
      }
      return row;
    },

    async listPostCallsByLifecycle(lifecycleId, limitCount = 200) {
      const q = query(
        collection(db, "postCalls"),
        where("lifecycleId", "==", lifecycleId),
        orderBy("createdAt", "desc"),
        limit(limitCount)
      );
      const snap = await getDocs(q);
      return snap.docs.map((d) => ({ id: d.id, ...d.data() }));
    },

    async listPostCallsByTeam(teamId, limitCount = 200) {
      const q = query(
        collection(db, "postCalls"),
        where("teamId", "==", teamId),
        orderBy("createdAt", "desc"),
        limit(limitCount)
      );
      const snap = await getDocs(q);
      return snap.docs.map((d) => ({ id: d.id, ...d.data() }));
    },

    async listPostCallsByOrg(orgId, limitCount = 200) {
      const q = query(
        collection(db, "postCalls"),
        where("orgId", "==", orgId),
        orderBy("createdAt", "desc"),
        limit(limitCount)
      );
      const snap = await getDocs(q);
      return snap.docs.map((d) => ({ id: d.id, ...d.data() }));
    },

    async listPostCallsByOwner(ownerId, limitCount = 200) {
      const q = query(
        collection(db, "postCalls"),
        where("ownerId", "==", ownerId),
        orderBy("createdAt", "desc"),
        limit(limitCount)
      );
      const snap = await getDocs(q);
      return snap.docs.map((d) => ({ id: d.id, ...d.data() }));
    },

    async listPostCallsByDeal(dealId, limitCount = 50) {
      const q = query(
        collection(db, "postCalls"),
        where("dealId", "==", dealId),
        orderBy("createdAt", "desc"),
        limit(limitCount)
      );
      const snap = await getDocs(q);
      return snap.docs.map((d) => ({ id: d.id, ...d.data() }));
    },

    async listPostCallsByAccount(accountId, limitCount = 80) {
      const q = query(
        collection(db, "postCalls"),
        where("accountId", "==", accountId),
        orderBy("createdAt", "desc"),
        limit(limitCount)
      );
      const snap = await getDocs(q);
      return snap.docs.map((d) => ({ id: d.id, ...d.data() }));
    },

    async listCallSummariesByOwner(ownerId, limitCount = 200, opts = {}) {
      const fields = callSummaryFields(!!opts.forSearch);
      const q = select
        ? query(
            collection(db, "callSummaries"),
            where("ownerId", "==", ownerId),
            orderBy("createdAt", "desc"),
            limit(limitCount),
            select(...fields),
          )
        : query(
            collection(db, "callSummaries"),
            where("ownerId", "==", ownerId),
            orderBy("createdAt", "desc"),
            limit(limitCount),
          );
      const snap = await getDocs(q);
      const rows = mapSnapDocs(snap);
      return opts.forSearch ? rows : rows.map(omitEmbeddingFields);
    },

    async listCallSummariesByTeam(teamId, limitCount = 200, opts = {}) {
      const fields = callSummaryFields(!!opts.forSearch);
      const q = select
        ? query(
            collection(db, "callSummaries"),
            where("teamId", "==", teamId),
            orderBy("createdAt", "desc"),
            limit(limitCount),
            select(...fields),
          )
        : query(
            collection(db, "callSummaries"),
            where("teamId", "==", teamId),
            orderBy("createdAt", "desc"),
            limit(limitCount),
          );
      const snap = await getDocs(q);
      const rows = mapSnapDocs(snap);
      return opts.forSearch ? rows : rows.map(omitEmbeddingFields);
    },

    async listCallSummariesByOrg(orgId, limitCount = 200, opts = {}) {
      const fields = callSummaryFields(!!opts.forSearch);
      const q = select
        ? query(
            collection(db, "callSummaries"),
            where("orgId", "==", orgId),
            orderBy("createdAt", "desc"),
            limit(limitCount),
            select(...fields),
          )
        : query(
            collection(db, "callSummaries"),
            where("orgId", "==", orgId),
            orderBy("createdAt", "desc"),
            limit(limitCount),
          );
      const snap = await getDocs(q);
      const rows = mapSnapDocs(snap);
      return opts.forSearch ? rows : rows.map(omitEmbeddingFields);
    },

    async listCallSummariesByDeal(dealId, limitCount = 50, opts = {}) {
      const fields = callSummaryFields(!!opts.forSearch);
      const q = select
        ? query(
            collection(db, "callSummaries"),
            where("dealId", "==", dealId),
            orderBy("createdAt", "desc"),
            limit(limitCount),
            select(...fields),
          )
        : query(
            collection(db, "callSummaries"),
            where("dealId", "==", dealId),
            orderBy("createdAt", "desc"),
            limit(limitCount),
          );
      const snap = await getDocs(q);
      const rows = mapSnapDocs(snap);
      return opts.forSearch ? rows : rows.map(omitEmbeddingFields);
    },

    async listCallSummariesByAccount(accountId, limitCount = 80, opts = {}) {
      const fields = callSummaryFields(!!opts.forSearch);
      const q = select
        ? query(
            collection(db, "callSummaries"),
            where("accountId", "==", accountId),
            orderBy("createdAt", "desc"),
            limit(limitCount),
            select(...fields),
          )
        : query(
            collection(db, "callSummaries"),
            where("accountId", "==", accountId),
            orderBy("createdAt", "desc"),
            limit(limitCount),
          );
      const snap = await getDocs(q);
      const rows = mapSnapDocs(snap);
      return opts.forSearch ? rows : rows.map(omitEmbeddingFields);
    },

    async createTask(docData) {
      const ref = docData.id ? doc(db, "tasks", docData.id) : doc(collection(db, "tasks"));
      const data = { ...docData, id: ref.id };
      await setDoc(ref, data);
      return data;
    },

    async updateTask(id, patch) {
      await updateDoc(doc(db, "tasks", id), patch);
      return getById("tasks", id);
    },

    async listTasksByLifecycle(lifecycleId) {
      const q = query(
        collection(db, "tasks"),
        where("lifecycleId", "==", lifecycleId),
        orderBy("createdAt", "desc")
      );
      const snap = await getDocs(q);
      return snap.docs.map((d) => ({ id: d.id, ...d.data() }));
    },

    async listTasksForLifecycles(lifecycleIds) {
      const rows = await queryWhereInChunks("tasks", "lifecycleId", lifecycleIds);
      return groupRowsByField(rows, "lifecycleId");
    },

    async addLifecycleEvent(event) {
      const eventRef = doc(
        collection(db, "lifecycles", event.lifecycleId, "events"),
        event.id || newId("event")
      );
      const data = { ...event, id: eventRef.id };
      await setDoc(eventRef, data);
      return data;
    },

    async listLifecycleEvents(lifecycleId) {
      const q = query(
        collection(db, "lifecycles", lifecycleId, "events"),
        orderBy("timestamp", "desc")
      );
      const snap = await getDocs(q);
      return snap.docs.map((d) => ({ id: d.id, ...d.data() }));
    },

    async upsertScorecard(docData) {
      const ref = docData.id ? doc(db, "scorecards", docData.id) : doc(collection(db, "scorecards"));
      const data = { ...docData, id: ref.id };
      await setDoc(ref, data, { merge: true });
      return data;
    },

    async deleteScorecard(id) {
      if (!deleteDoc) return;
      await deleteDoc(doc(db, "scorecards", id));
    },

    async listScorecardsByCall(callId) {
      const q = query(collection(db, "scorecards"), where("callId", "==", callId));
      const snap = await getDocs(q);
      return snap.docs.map((d) => ({ id: d.id, ...d.data() }));
    },

    async listScorecardsForCalls(callIds) {
      const rows = await queryWhereInChunks("scorecards", "callId", callIds);
      return groupRowsByField(rows, "callId");
    },

    async listScorecardLinesByCall(callId) {
      const q = query(collection(db, "scorecardLines"), where("callId", "==", callId));
      const snap = await getDocs(q);
      return snap.docs.map((d) => ({ id: d.id, ...d.data() }));
    },

    async listScorecardLinesForCalls(callIds) {
      const rows = await queryWhereInChunks("scorecardLines", "callId", callIds);
      return groupRowsByField(rows, "callId");
    },

    async upsertScorecardLine(docData) {
      const ref = docData.id
        ? doc(db, "scorecardLines", docData.id)
        : doc(collection(db, "scorecardLines"));
      const data = { ...docData, id: ref.id };
      await setDoc(ref, data, { merge: true });
      return data;
    },

    async deleteScorecardLinesByScorecardId(scorecardId) {
      const q = query(collection(db, "scorecardLines"), where("scorecardId", "==", scorecardId));
      const snap = await getDocs(q);
      if (!deleteDoc) return;
      await Promise.all(snap.docs.map((d) => deleteDoc(d.ref)));
    },

    /**
     * Heatmap query — caller must exclude provisional scorecards (§6.6).
     * Lines are denormalized with teamId; join provisional via scorecards.
     */
    async listScorecardLinesByTeamTheme(teamId, themeKey) {
      const q = query(
        collection(db, "scorecardLines"),
        where("teamId", "==", teamId),
        where("themeKey", "==", themeKey),
        where("applicable", "==", true),
      );
      const snap = await getDocs(q);
      const lines = snap.docs.map((d) => ({ id: d.id, ...d.data() }));
      // Exclude shadow-mode calls — provisional lives on the parent scorecard
      const cardIds = [...new Set(lines.map((l) => l.scorecardId).filter(Boolean))];
      const cards = await getDocsByIdInChunks("scorecards", cardIds);
      const provisional = new Set(cards.filter((c) => c.provisional).map((c) => c.id));
      return lines.filter((l) => !provisional.has(l.scorecardId));
    },

    async upsertVideoFacts(docData) {
      const ref = docData.id ? doc(db, "videoFacts", docData.id) : doc(collection(db, "videoFacts"));
      const data = { ...docData, id: ref.id };
      await setDoc(ref, data, { merge: true });
      return data;
    },

    async deleteVideoFacts(id) {
      if (!deleteDoc) return;
      await deleteDoc(doc(db, "videoFacts", id));
    },

    async listVideoFactsByCall(callId) {
      const postCall = await this._postCallForDetailLookup(callId);
      const embedded = detailArray(postCall, "videoFacts");
      if (embedded.length) return embedded;
      const q = query(collection(db, "videoFacts"), where("callId", "==", callId));
      const snap = await getDocs(q);
      return snap.docs.map((d) => ({ id: d.id, ...d.data() }));
    },

    async upsertTimelineSegment(docData) {
      const ref = docData.id
        ? doc(db, "timelineSegments", docData.id)
        : doc(collection(db, "timelineSegments"));
      const data = { ...docData, id: ref.id };
      await setDoc(ref, data, { merge: true });
      return data;
    },

    async deleteTimelineSegmentsByVideoFactsId(videoFactsId) {
      const q = query(collection(db, "timelineSegments"), where("videoFactsId", "==", videoFactsId));
      const snap = await getDocs(q);
      if (!deleteDoc) return;
      await Promise.all(snap.docs.map((d) => deleteDoc(d.ref)));
    },

    async listTimelineSegmentsByCall(callId) {
      const postCall = await this._postCallForDetailLookup(callId);
      const embedded = detailArray(postCall, "timelineSegments");
      if (embedded.length) {
        return embedded.sort((a, b) => (a.startS || 0) - (b.startS || 0));
      }
      const q = query(collection(db, "timelineSegments"), where("callId", "==", callId));
      const snap = await getDocs(q);
      return snap.docs
        .map((d) => ({ id: d.id, ...d.data() }))
        .sort((a, b) => (a.startS || 0) - (b.startS || 0));
    },

    async upsertTimelineMarker(docData) {
      const ref = docData.id
        ? doc(db, "timelineMarkers", docData.id)
        : doc(collection(db, "timelineMarkers"));
      const data = { ...docData, id: ref.id };
      await setDoc(ref, data, { merge: true });
      return data;
    },

    async listTimelineMarkersByCall(callId) {
      const postCall = await this._postCallForDetailLookup(callId);
      const embedded = detailArray(postCall, "timelineMarkers");
      if (embedded.length) {
        return embedded.sort((a, b) => (a.atS || 0) - (b.atS || 0));
      }
      const q = query(collection(db, "timelineMarkers"), where("callId", "==", callId));
      const snap = await getDocs(q);
      return snap.docs
        .map((d) => ({ id: d.id, ...d.data() }))
        .sort((a, b) => (a.atS || 0) - (b.atS || 0));
    },

    /** Clear a previous transcript derivation before re-deriving. Leaves Pass 2 rows alone. */
    async deleteTranscriptTimelineByCall(callId) {
      if (!deleteDoc) return;
      const segQ = query(
        collection(db, "timelineSegments"),
        where("callId", "==", callId),
        where("source", "==", "transcript"),
      );
      const markerQ = query(collection(db, "timelineMarkers"), where("callId", "==", callId));
      const [segSnap, markerSnap] = await Promise.all([getDocs(segQ), getDocs(markerQ)]);
      await Promise.all([
        ...segSnap.docs.map((d) => deleteDoc(d.ref)),
        ...markerSnap.docs.map((d) => deleteDoc(d.ref)),
      ]);
    },

    async upsertFollowUp(docData) {
      const ref = docData.id ? doc(db, "followUps", docData.id) : doc(collection(db, "followUps"));
      const data = { ...docData, id: ref.id };
      await setDoc(ref, data, { merge: true });
      return data;
    },

    async deleteFollowUp(id) {
      if (!deleteDoc) return;
      await deleteDoc(doc(db, "followUps", id));
    },

    async listFollowUpsByCall(callId) {
      const postCall = await this._postCallForDetailLookup(callId);
      const embedded = detailArray(postCall, "followUps");
      if (embedded.length) return embedded;
      const q = query(collection(db, "followUps"), where("callId", "==", callId));
      const snap = await getDocs(q);
      return snap.docs.map((d) => ({ id: d.id, ...d.data() }));
    },

    async upsertObjection(docData) {
      const ref = docData.id ? doc(db, "objections", docData.id) : doc(collection(db, "objections"));
      const data = { ...docData, id: ref.id };
      await setDoc(ref, data, { merge: true });
      return data;
    },

    async deleteObjection(id) {
      if (!deleteDoc) return;
      await deleteDoc(doc(db, "objections", id));
    },

    async listObjectionsByCall(callId) {
      const postCall = await this._postCallForDetailLookup(callId);
      const embedded = detailArray(postCall, "objections");
      if (embedded.length) return embedded;
      const q = query(collection(db, "objections"), where("callId", "==", callId));
      const snap = await getDocs(q);
      return snap.docs.map((d) => ({ id: d.id, ...d.data() }));
    },

    async upsertMomDraft(docData) {
      const ref = docData.id ? doc(db, "momDrafts", docData.id) : doc(collection(db, "momDrafts"));
      const data = { ...docData, id: ref.id };
      await setDoc(ref, data, { merge: true });
      return data;
    },

    async deleteMomDraft(id) {
      if (!deleteDoc) return;
      await deleteDoc(doc(db, "momDrafts", id));
    },

    async listMomDraftsByCall(callId) {
      const postCall = await this._postCallForDetailLookup(callId);
      const embedded = detailArray(postCall, "momDrafts");
      if (embedded.length) return embedded;
      const q = query(collection(db, "momDrafts"), where("callId", "==", callId));
      const snap = await getDocs(q);
      return snap.docs.map((d) => ({ id: d.id, ...d.data() }));
    },

    async upsertMeddpiccDelta(docData) {
      const ref = docData.id
        ? doc(db, "meddpiccDeltas", docData.id)
        : doc(collection(db, "meddpiccDeltas"));
      const data = { ...docData, id: ref.id };
      await setDoc(ref, data, { merge: true });
      return data;
    },

    async deleteMeddpiccDelta(id) {
      if (!deleteDoc) return;
      await deleteDoc(doc(db, "meddpiccDeltas", id));
    },

    async listMeddpiccDeltasByCall(callId) {
      const postCall = await this._postCallForDetailLookup(callId);
      const embedded = detailArray(postCall, "meddpiccDeltas");
      if (embedded.length) return embedded;
      const q = query(collection(db, "meddpiccDeltas"), where("callId", "==", callId));
      const snap = await getDocs(q);
      return snap.docs.map((d) => ({ id: d.id, ...d.data() }));
    },

    async upsertDealSignal(docData) {
      const ref = docData.id ? doc(db, "dealSignals", docData.id) : doc(collection(db, "dealSignals"));
      const data = { ...docData, id: ref.id };
      await setDoc(ref, data, { merge: true });
      return data;
    },

    async deleteDealSignal(id) {
      if (!deleteDoc) return;
      await deleteDoc(doc(db, "dealSignals", id));
    },

    async listDealSignalsByCall(callId) {
      const postCall = await this._postCallForDetailLookup(callId);
      const embedded = detailArray(postCall, "dealSignals");
      if (embedded.length) return embedded;
      const q = query(collection(db, "dealSignals"), where("callId", "==", callId));
      const snap = await getDocs(q);
      return snap.docs.map((d) => ({ id: d.id, ...d.data() }));
    },

    async listDealSignalsByDeal(dealId, limitCount = 50) {
      const postCalls = await this.listPostCallsByDeal(dealId, limitCount);
      const fromDetail = dealSignalsFromPostCalls(postCalls, limitCount);
      if (fromDetail.length) return fromDetail;
      try {
        const q = query(
          collection(db, "dealSignals"),
          where("dealId", "==", dealId),
          orderBy("createdAt", "desc"),
          limit(limitCount)
        );
        const snap = await getDocs(q);
        return snap.docs.map((d) => ({ id: d.id, ...d.data() }));
      } catch (err) {
        if (!isFirestoreIndexError(err)) throw err;
        const q = query(collection(db, "dealSignals"), where("dealId", "==", dealId), limit(limitCount));
        const snap = await getDocs(q);
        return snap.docs
          .map((d) => ({ id: d.id, ...d.data() }))
          .sort((a, b) => (b.createdAt || 0) - (a.createdAt || 0))
          .slice(0, limitCount);
      }
    },

    async listDealSignalsForDeals(dealIds, perDealLimit = 1) {
      const ids = [...new Set((dealIds || []).filter(Boolean))];
      /** @type {Map<string, object[]>} */
      const byDeal = new Map();
      if (!ids.length) return byDeal;

      const postCalls = await queryWhereInChunks("postCalls", "dealId", ids);
      for (const pc of postCalls) {
        const dealId = pc.dealId;
        if (!dealId) continue;
        for (const sig of detailArray(pc, "dealSignals")) {
          if (!byDeal.has(dealId)) byDeal.set(dealId, []);
          const arr = byDeal.get(dealId);
          if (arr.length < perDealLimit) arr.push(sig);
        }
      }
      if ([...byDeal.values()].some((rows) => rows.length)) return byDeal;

      const chunkSize = 30;
      for (let i = 0; i < ids.length; i += chunkSize) {
        const chunk = ids.slice(i, i + chunkSize);
        try {
          const q = query(
            collection(db, "dealSignals"),
            where("dealId", "in", chunk),
            orderBy("createdAt", "desc"),
          );
          const snap = await getDocs(q);
          for (const d of snap.docs) {
            const row = { id: d.id, ...d.data() };
            const dealId = row.dealId;
            if (!dealId) continue;
            if (!byDeal.has(dealId)) byDeal.set(dealId, []);
            const arr = byDeal.get(dealId);
            if (arr.length < perDealLimit) arr.push(row);
          }
        } catch (err) {
          if (!isFirestoreIndexError(err)) throw err;
          const q = query(collection(db, "dealSignals"), where("dealId", "in", chunk));
          const snap = await getDocs(q);
          const rows = snap.docs
            .map((d) => ({ id: d.id, ...d.data() }))
            .sort((a, b) => (b.createdAt || 0) - (a.createdAt || 0));
          for (const row of rows) {
            const dealId = row.dealId;
            if (!dealId) continue;
            if (!byDeal.has(dealId)) byDeal.set(dealId, []);
            const arr = byDeal.get(dealId);
            if (arr.length < perDealLimit) arr.push(row);
          }
        }
      }
      return byDeal;
    },

    async upsertArrLine(docData) {
      const ref = docData.id ? doc(db, "arrLines", docData.id) : doc(collection(db, "arrLines"));
      const data = { ...docData, id: ref.id };
      await setDoc(ref, data, { merge: true });
      return data;
    },

    async deleteArrLine(id) {
      if (!deleteDoc) return;
      await deleteDoc(doc(db, "arrLines", id));
    },

    async listArrLinesByCall(callId) {
      const q = query(collection(db, "arrLines"), where("callId", "==", callId));
      const snap = await getDocs(q);
      return snap.docs.map((d) => ({ id: d.id, ...d.data() }));
    },

    async listArrLinesByDeal(dealId, limitCount = 200) {
      const q = query(
        collection(db, "arrLines"),
        where("dealId", "==", dealId),
        orderBy("computedAt", "desc"),
        limit(limitCount)
      );
      const snap = await getDocs(q);
      return snap.docs.map((d) => ({ id: d.id, ...d.data() }));
    },

    async listArrLinesForDeals(dealIds) {
      const ids = [...new Set((dealIds || []).filter(Boolean))];
      /** @type {Map<string, object[]>} */
      const byDeal = new Map();
      if (!ids.length) return byDeal;
      const chunkSize = 30;
      for (let i = 0; i < ids.length; i += chunkSize) {
        const chunk = ids.slice(i, i + chunkSize);
        const q = query(
          collection(db, "arrLines"),
          where("dealId", "in", chunk),
          orderBy("computedAt", "desc"),
        );
        const snap = await getDocs(q);
        for (const d of snap.docs) {
          const row = { id: d.id, ...d.data() };
          const dealId = row.dealId;
          if (!dealId) continue;
          if (!byDeal.has(dealId)) byDeal.set(dealId, []);
          byDeal.get(dealId).push(row);
        }
      }
      return byDeal;
    },

    async upsertArrOverride(docData) {
      const ref = docData.id ? doc(db, "arrOverrides", docData.id) : doc(collection(db, "arrOverrides"));
      const data = { ...docData, id: ref.id };
      await setDoc(ref, data, { merge: true });
      return data;
    },

    async listArrOverridesByDeal(dealId, limitCount = 100) {
      const q = query(
        collection(db, "arrOverrides"),
        where("dealId", "==", dealId),
        orderBy("createdAt", "desc"),
        limit(limitCount)
      );
      const snap = await getDocs(q);
      return snap.docs.map((d) => ({ id: d.id, ...d.data() }));
    },

    async upsertTechnicalCommit(docData) {
      const existingQ = query(collection(db, "technicalCommits"), where("dealId", "==", docData.dealId), limit(1));
      const existingSnap = await getDocs(existingQ);
      const ref = docData.id
        ? doc(db, "technicalCommits", docData.id)
        : existingSnap.docs[0]
          ? doc(db, "technicalCommits", existingSnap.docs[0].id)
          : doc(collection(db, "technicalCommits"));
      const data = { ...docData, id: ref.id };
      await setDoc(ref, data, { merge: true });
      return data;
    },

    async getTechnicalCommitByDeal(dealId) {
      if (isHistoryStubId(dealId)) return null;
      const q = query(collection(db, "technicalCommits"), where("dealId", "==", dealId), limit(1));
      const snap = await getDocs(q);
      const row = snap.docs[0];
      return row ? { id: row.id, ...row.data() } : null;
    },

    async getTechnicalCommitByAccount(accountId) {
      const q = query(collection(db, "technicalCommits"), where("accountId", "==", accountId), limit(1));
      const snap = await getDocs(q);
      const row = snap.docs[0];
      return row ? { id: row.id, ...row.data() } : null;
    },

    async upsertTcDelta(docData) {
      const ref = docData.id ? doc(db, "tcDeltas", docData.id) : doc(collection(db, "tcDeltas"));
      const data = { ...docData, id: ref.id };
      await setDoc(ref, data, { merge: true });
      return data;
    },

    async deleteTcDelta(id) {
      if (!deleteDoc) return;
      await deleteDoc(doc(db, "tcDeltas", id));
    },

    async listTcDeltasByCall(callId) {
      const postCall = await this._postCallForDetailLookup(callId);
      const embedded = detailArray(postCall, "tcDeltas");
      if (embedded.length) return embedded;
      const q = query(collection(db, "tcDeltas"), where("callId", "==", callId));
      const snap = await getDocs(q);
      return snap.docs.map((d) => ({ id: d.id, ...d.data() }));
    },

    async listTcDeltasByDeal(dealId, limitCount = 200) {
      const postCalls = await this.listPostCallsByDeal(dealId, limitCount);
      const fromDetail = tcDeltasFromPostCalls(postCalls, limitCount);
      if (fromDetail.length) return fromDetail;
      const q = query(
        collection(db, "tcDeltas"),
        where("dealId", "==", dealId),
        orderBy("createdAt", "desc"),
        limit(limitCount),
      );
      const snap = await getDocs(q);
      return snap.docs.map((d) => ({ id: d.id, ...d.data() }));
    },

    async upsertDealSummary(docData) {
      const ref = docData.id
        ? doc(db, "dealSummaries", docData.id)
        : doc(collection(db, "dealSummaries"));
      const data = { ...docData, id: ref.id };
      await setDoc(ref, data, { merge: true });
      return data;
    },

    async getDealSummaryByDeal(dealId) {
      const q = query(collection(db, "dealSummaries"), where("dealId", "==", dealId), limit(1));
      const snap = await getDocs(q);
      const row = snap.docs[0];
      return row ? { id: row.id, ...row.data() } : null;
    },

    async upsertAccountSummary(docData) {
      const ref = docData.id
        ? doc(db, "accountSummaries", docData.id)
        : doc(collection(db, "accountSummaries"));
      const data = { ...docData, id: ref.id };
      await setDoc(ref, data, { merge: true });
      return data;
    },

    async getAccountSummaryByAccount(accountId) {
      const q = query(
        collection(db, "accountSummaries"),
        where("accountId", "==", accountId),
        limit(1),
      );
      const snap = await getDocs(q);
      const row = snap.docs[0];
      return row ? { id: row.id, ...row.data() } : null;
    },

    async upsertProductGap(docData) {
      const ref = docData.id ? doc(db, "productGaps", docData.id) : doc(collection(db, "productGaps"));
      const data = { ...docData, id: ref.id };
      await setDoc(ref, data, { merge: true });
      return data;
    },

    async listProductGapsByPostCall(postCallId) {
      const postCall = await this._postCallForDetailLookup(postCallId);
      const embedded = detailArray(postCall, "productGaps");
      if (embedded.length) return embedded;
      const q = query(collection(db, "productGaps"), where("postCallId", "==", postCallId));
      const snap = await getDocs(q);
      return snap.docs.map((d) => ({ id: d.id, ...d.data() }));
    },

    async listProductGapsByOrg(orgId, limitCount = 500) {
      const q = query(
        collection(db, "productGaps"),
        where("orgId", "==", orgId),
        orderBy("createdAt", "desc"),
        limit(limitCount),
      );
      const snap = await getDocs(q);
      return snap.docs.map((d) => ({ id: d.id, ...d.data() }));
    },

    async listProductGapsByDeal(dealId, limitCount = 500) {
      const postCalls = await this.listPostCallsByDeal(dealId, limitCount);
      const fromDetail = productGapsFromPostCalls(postCalls, limitCount);
      if (fromDetail.length) return fromDetail;
      const q = query(
        collection(db, "productGaps"),
        where("dealId", "==", dealId),
        orderBy("createdAt", "desc"),
        limit(limitCount),
      );
      const snap = await getDocs(q);
      return snap.docs.map((d) => ({ id: d.id, ...d.data() }));
    },

    async upsertWhatWorks(docData) {
      const ref = docData.id ? doc(db, "whatWorks", docData.id) : doc(collection(db, "whatWorks"));
      const data = { ...docData, id: ref.id };
      await setDoc(ref, data, { merge: true });
      return data;
    },

    async listWhatWorksByPostCall(postCallId) {
      const postCall = await this._postCallForDetailLookup(postCallId);
      const embedded = detailArray(postCall, "whatWorks");
      if (embedded.length) return embedded;
      const q = query(collection(db, "whatWorks"), where("postCallId", "==", postCallId));
      const snap = await getDocs(q);
      return snap.docs.map((d) => ({ id: d.id, ...d.data() }));
    },

    async listWhatWorksByOrg(orgId, limitCount = 500) {
      const q = query(
        collection(db, "whatWorks"),
        where("orgId", "==", orgId),
        orderBy("createdAt", "desc"),
        limit(limitCount),
      );
      const snap = await getDocs(q);
      return snap.docs.map((d) => ({ id: d.id, ...d.data() }));
    },

    async listWhatWorksByDeal(dealId, limitCount = 500) {
      const postCalls = await this.listPostCallsByDeal(dealId, limitCount);
      const fromDetail = whatWorksFromPostCalls(postCalls, limitCount);
      if (fromDetail.length) return fromDetail;
      const q = query(
        collection(db, "whatWorks"),
        where("dealId", "==", dealId),
        orderBy("createdAt", "desc"),
        limit(limitCount),
      );
      const snap = await getDocs(q);
      return snap.docs.map((d) => ({ id: d.id, ...d.data() }));
    },

    async listTechnicalCommitsByOrg(orgId, limitCount = 500) {
      const q = query(
        collection(db, "technicalCommits"),
        where("orgId", "==", orgId),
        orderBy("updatedAt", "desc"),
        limit(limitCount),
      );
      const snap = await getDocs(q);
      return snap.docs.map((d) => ({ id: d.id, ...d.data() }));
    },

    async upsertGapCluster(docData) {
      const ref = docData.id ? doc(db, "gapClusters", docData.id) : doc(collection(db, "gapClusters"));
      const data = { ...docData, id: ref.id };
      await setDoc(ref, data, { merge: true });
      return data;
    },

    async listGapClustersByOrg(orgId, limitCount = 200) {
      const q = query(
        collection(db, "gapClusters"),
        where("orgId", "==", orgId),
        where("status", "in", ["draft", "published"]),
        orderBy("arrTotal", "desc"),
        limit(limitCount),
      );
      const snap = await getDocs(q);
      return snap.docs.map((d) => ({ id: d.id, ...d.data() }));
    },

    async getGapCluster(id) {
      const ref = doc(db, "gapClusters", id);
      const snap = await getDoc(ref);
      return snap.exists() ? { id: snap.id, ...snap.data() } : null;
    },

    async getClusteringState(orgId) {
      const ref = doc(db, "clusteringState", orgId);
      const snap = await getDoc(ref);
      return snap.exists() ? { id: snap.id, ...snap.data() } : null;
    },

    async upsertClusteringState(docData) {
      const id = docData.id || docData.orgId;
      const ref = doc(db, "clusteringState", id);
      const data = { ...docData, id, orgId: docData.orgId };
      await setDoc(ref, data, { merge: true });
      return data;
    },

    /** Pre-aggregated read model (write-time rollup). */
    async getReadModel(collection, id) {
      if (!id) return null;
      const snap = await getDoc(doc(db, collection, id));
      return snap.exists() ? { id: snap.id, ...snap.data() } : null;
    },

    async getReadModels(collection, ids) {
      return getDocsByIdInChunks(collection, ids);
    },
  };

  return storeApi;
}
