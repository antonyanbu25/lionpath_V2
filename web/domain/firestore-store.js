/**
 * Firestore-backed domain store for Firebase auth mode.
 */

import { newId, now } from "./types.js";

/** @param {object} fb Firebase helpers from app.js initFirebase */
export function createFirestoreStore(fb) {
  if (!fb?.db) throw new Error("Firestore not initialized");

  const {
    db, collection, doc, getDoc, getDocs, setDoc, updateDoc, addDoc,
    query, where, orderBy, limit,
  } = fb;

  async function getById(col, id) {
    const snap = await getDoc(doc(db, col, id));
    return snap.exists() ? { id: snap.id, ...snap.data() } : null;
  }

  return {
    mode: "firestore",

    async getUser(id) {
      return getById("users", id);
    },

    async upsertUser(user) {
      await setDoc(doc(db, "users", user.id), user, { merge: true });
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
      return getById("teams", id);
    },

    async upsertTeam(team) {
      await setDoc(doc(db, "teams", team.id), team, { merge: true });
      return team;
    },

    async getOrg(id) {
      return getById("orgs", id);
    },

    async upsertOrg(org) {
      await setDoc(doc(db, "orgs", org.id), org, { merge: true });
      return org;
    },

    async listTeamsByOrg(orgId) {
      const q = query(collection(db, "teams"), where("orgId", "==", orgId));
      const snap = await getDocs(q);
      return snap.docs
        .map((d) => ({ id: d.id, ...d.data() }))
        .sort((a, b) => String(a.name).localeCompare(String(b.name)));
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
      const ref = account.id ? doc(db, "accounts", account.id) : doc(collection(db, "accounts"));
      const data = { ...account, id: ref.id };
      await setDoc(ref, data);
      return data;
    },

    async updateAccount(id, patch) {
      await updateDoc(doc(db, "accounts", id), { ...patch, updatedAt: now() });
      return getById("accounts", id);
    },

    async getAccount(id) {
      return getById("accounts", id);
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

    async listLifecyclesByOwner(ownerId) {
      const q = query(
        collection(db, "lifecycles"),
        where("ownerId", "==", ownerId),
        orderBy("lastActivityAt", "desc")
      );
      const snap = await getDocs(q);
      return snap.docs.map((d) => ({ id: d.id, ...d.data() }));
    },

    async listLifecyclesByTeam(teamId) {
      const q = query(
        collection(db, "lifecycles"),
        where("teamId", "==", teamId),
        orderBy("lastActivityAt", "desc")
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

    async listPrepBriefsByLifecycle(lifecycleId) {
      const q = query(
        collection(db, "prepBriefs"),
        where("lifecycleId", "==", lifecycleId),
        orderBy("createdAt", "desc")
      );
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

    async listPostCallsByLifecycle(lifecycleId) {
      const q = query(
        collection(db, "postCalls"),
        where("lifecycleId", "==", lifecycleId),
        orderBy("createdAt", "desc")
      );
      const snap = await getDocs(q);
      return snap.docs.map((d) => ({ id: d.id, ...d.data() }));
    },

    async listPostCallsByTeam(teamId) {
      const q = query(
        collection(db, "postCalls"),
        where("teamId", "==", teamId),
        orderBy("createdAt", "desc")
      );
      const snap = await getDocs(q);
      return snap.docs.map((d) => ({ id: d.id, ...d.data() }));
    },

    async listPostCallsByOrg(orgId) {
      const q = query(
        collection(db, "postCalls"),
        where("orgId", "==", orgId),
        orderBy("createdAt", "desc")
      );
      const snap = await getDocs(q);
      return snap.docs.map((d) => ({ id: d.id, ...d.data() }));
    },

    async listPostCallsByOwner(ownerId) {
      const q = query(
        collection(db, "postCalls"),
        where("ownerId", "==", ownerId),
        orderBy("createdAt", "desc")
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
  };
}
