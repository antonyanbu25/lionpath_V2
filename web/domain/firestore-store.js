/**
 * Firestore-backed domain store for Firebase auth mode.
 */

import { newId, now } from "./types.js";
import { collectionCRUD } from "./collection-crud.js";

/** @param {object} fb Firebase helpers from app.js initFirebase */
export function createFirestoreStore(fb) {
  if (!fb?.db) throw new Error("Firestore not initialized");

  const {
    db, collection, doc, getDoc, getDocs, setDoc, updateDoc, deleteDoc, addDoc,
    query, where, orderBy, limit,
  } = fb;

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

    async findAccountBySlug(slug) {
      const q = query(collection(db, "accounts"), where("slug", "==", slug), limit(1));
      const snap = await getDocs(q);
      if (snap.empty) return null;
      const d = snap.docs[0];
      return { id: d.id, ...d.data() };
    },

    async createAccount(account) {
      return accountsCrud.create(account);
    },

    async updateAccount(id, patch) {
      return accountsCrud.update(id, patch);
    },

    async getAccount(id) {
      return accountsCrud.get(id);
    },

    async listAccounts() {
      const snap = await getDocs(collection(db, "accounts"));
      return snap.docs
        .map((d) => ({ id: d.id, ...d.data() }))
        .sort((a, b) => (b.updatedAt || 0) - (a.updatedAt || 0));
    },

    async listActiveLifecyclesForAccount(accountId) {
      const q = query(
        collection(db, "lifecycles"),
        where("accountId", "==", accountId),
        where("status", "==", "active"),
        orderBy("lastActivityAt", "desc")
      );
      const snap = await getDocs(q);
      return snap.docs.map((d) => ({ id: d.id, ...d.data() }));
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

    async createContact(contact) {
      const ref = contact.id ? doc(db, "contacts", contact.id) : doc(collection(db, "contacts"));
      const data = { ...contact, id: ref.id };
      await setDoc(ref, data);
      return data;
    },

    async updateContact(id, patch) {
      await updateDoc(doc(db, "contacts", id), { ...patch, updatedAt: now() });
      return getById("contacts", id);
    },

    async listContactsByAccount(accountId) {
      const q = query(collection(db, "contacts"), where("accountId", "==", accountId));
      const snap = await getDocs(q);
      return snap.docs
        .map((d) => ({ id: d.id, ...d.data() }))
        .sort((a, b) => String(a.email).localeCompare(String(b.email)));
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

    async findActiveDeal(accountId, type) {
      const q = query(
        collection(db, "deals"),
        where("accountId", "==", accountId),
        where("type", "==", type),
        where("status", "==", "active"),
        limit(1)
      );
      const snap = await getDocs(q);
      if (snap.empty) return null;
      const d = snap.docs[0];
      return { id: d.id, ...d.data() };
    },

    async createDeal(deal) {
      const ref = deal.id ? doc(db, "deals", deal.id) : doc(collection(db, "deals"));
      const data = { ...deal, id: ref.id };
      await setDoc(ref, data);
      return data;
    },

    async updateDeal(id, patch) {
      await updateDoc(doc(db, "deals", id), { ...patch, updatedAt: now() });
      return getById("deals", id);
    },

    async getDeal(id) {
      return getById("deals", id);
    },

    async listDealsByAccount(accountId, ownerId) {
      const constraints = [where("accountId", "==", accountId)];
      if (ownerId) constraints.push(where("ownerId", "==", ownerId));
      constraints.push(orderBy("lastActivityAt", "desc"));
      const q = query(collection(db, "deals"), ...constraints);
      const snap = await getDocs(q);
      return snap.docs.map((d) => ({ id: d.id, ...d.data() }));
    },

    async listDealsByOwner(ownerId, limitCount = 300) {
      const q = query(
        collection(db, "deals"),
        where("ownerId", "==", ownerId),
        orderBy("lastActivityAt", "desc"),
        limit(limitCount)
      );
      const snap = await getDocs(q);
      return snap.docs.map((d) => ({ id: d.id, ...d.data() }));
    },

    async createLifecycle(lifecycle) {
      const ref = lifecycle.id ? doc(db, "lifecycles", lifecycle.id) : doc(collection(db, "lifecycles"));
      const data = { ...lifecycle, id: ref.id };
      await setDoc(ref, data);
      return data;
    },

    async updateLifecycle(id, patch) {
      await updateDoc(doc(db, "lifecycles", id), { ...patch, updatedAt: now() });
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
      return data;
    },

    async getPostCall(id) {
      const snap = await getDoc(doc(db, "postCalls", id));
      return snap.exists() ? { id: snap.id, ...snap.data() } : null;
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
      const provisional = new Set();
      for (const id of cardIds) {
        const card = await getById("scorecards", id);
        if (card?.provisional) provisional.add(id);
      }
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
      const q = query(collection(db, "dealSignals"), where("callId", "==", callId));
      const snap = await getDocs(q);
      return snap.docs.map((d) => ({ id: d.id, ...d.data() }));
    },

    async listDealSignalsByDeal(dealId, limitCount = 50) {
      const q = query(
        collection(db, "dealSignals"),
        where("dealId", "==", dealId),
        orderBy("createdAt", "desc"),
        limit(limitCount)
      );
      const snap = await getDocs(q);
      return snap.docs.map((d) => ({ id: d.id, ...d.data() }));
    },

    async listDealSignalsForDeals(dealIds, perDealLimit = 1) {
      const ids = [...new Set((dealIds || []).filter(Boolean))];
      /** @type {Map<string, object[]>} */
      const byDeal = new Map();
      if (!ids.length) return byDeal;
      const chunkSize = 30;
      for (let i = 0; i < ids.length; i += chunkSize) {
        const chunk = ids.slice(i, i + chunkSize);
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
      const q = query(collection(db, "technicalCommits"), where("dealId", "==", dealId), limit(1));
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
      const q = query(collection(db, "tcDeltas"), where("callId", "==", callId));
      const snap = await getDocs(q);
      return snap.docs.map((d) => ({ id: d.id, ...d.data() }));
    },

    async listTcDeltasByDeal(dealId, limitCount = 200) {
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

    async upsertWhatWorks(docData) {
      const ref = docData.id ? doc(db, "whatWorks", docData.id) : doc(collection(db, "whatWorks"));
      const data = { ...docData, id: ref.id };
      await setDoc(ref, data, { merge: true });
      return data;
    },

    async listWhatWorksByPostCall(postCallId) {
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
  };

  return storeApi;
}
