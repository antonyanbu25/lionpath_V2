/**
 * Smoke tests for account view rendering (no browser).
 */
import { initDomainStore, getStore } from "../domain/store.js";
import { renderAccountView, summarizeContactEvents, ACTIVITY_INITIAL_VISIBLE } from "../account-view.js";

function assert(cond, msg) {
  if (!cond) throw new Error(msg);
}

const storeData = new Map();
globalThis.localStorage = {
  getItem: (k) => storeData.get(k) ?? null,
  setItem: (k, v) => storeData.set(k, v),
  removeItem: (k) => storeData.delete(k),
};

initDomainStore(null);
const store = getStore();

const session = { uid: "user_test", teamId: "team_test", email: "se@freshworks.com" };
const accountId = "account_acme";
const lifecycleId = "lc_acme";

await store.createAccount({
  id: accountId,
  name: "Acme Corp",
  domain: "acme.com",
  slug: "acme-corp-acme-com",
  seTeam: [{ seUserId: session.uid, role: "primary", addedAt: Date.now() }],
  primarySeUserId: session.uid,
  createdAt: Date.now(),
  updatedAt: Date.now(),
});

await store.upsertUser({
  id: session.uid,
  email: session.email,
  authUid: null,
  displayName: "Test SE",
  role: "se",
  teamId: session.teamId,
  orgId: null,
  managerId: null,
  jobTitle: "Solution Engineer",
  status: "active",
  createdAt: Date.now(),
  updatedAt: Date.now(),
});

await store.createLifecycle({
  id: lifecycleId,
  accountId,
  ownerId: session.uid,
  teamId: session.teamId,
  primaryContactId: "contact_1",
  title: "Acme Corp",
  stage: "discovery",
  status: "active",
  prepCount: 1,
  postCallCount: 0,
  openTaskCount: 0,
  lastActivityAt: Date.now(),
  createdAt: Date.now(),
  updatedAt: Date.now(),
});

await store.createContact({
  id: "contact_1",
  accountId,
  email: "alex@acme.com",
  name: "Alex Lee",
  title: "VP Support",
  metadata: {
    disc: { primary: "D", confidence: "medium", assessedAt: Date.now(), source: "prep" },
    influence: { level: "high", decisionRole: "economic_buyer", source: "prep", updatedAt: Date.now() },
  },
  createdAt: Date.now(),
  updatedAt: Date.now(),
});

await store.addLifecycleEvent({
  id: "ev_se_added",
  lifecycleId,
  type: "se_added",
  actorId: session.uid,
  timestamp: Date.now(),
  payload: { seUserId: "usr_secondary", accountId, role: "secondary" },
});

function mockContainer() {
  return {
    innerHTML: "",
    querySelector() { return null; },
    querySelectorAll() { return []; },
  };
}

const listContainer = mockContainer();
await renderAccountView(listContainer, session);
assert(listContainer.innerHTML.includes("Acme Corp"), "list renders account name");
assert(listContainer.innerHTML.includes("account-list-item"), "list renders account row");

const detailContainer = mockContainer();
await renderAccountView(detailContainer, session, { accountId });
const html = detailContainer.innerHTML;

assert(html.includes("Acme Corp"), "detail renders account name");
assert(html.includes("Alex Lee"), "detail renders contact");
assert(html.includes("fw-accordion"), "detail uses Crayons accordion for contacts");
assert(html.includes("fw-tag"), "detail uses Crayons tags");
assert(html.includes("lifecycle-pipeline-stage"), "detail renders lifecycle pipeline stepper");
assert(html.includes("lifecycle-terminal-stage"), "detail renders terminal outcome stages");
assert(html.includes("account-detail-grid"), "detail uses two-column grid");
assert(html.includes("Deal qualification (MEDDPICC)"), "detail renders MEDDPICC card");
assert(html.includes("Not captured"), "MEDDPICC uses designed empty-state copy");
assert(html.includes("DISC D"), "detail renders DISC tag with value");
assert(!html.includes("DISC not assessed"), "no grey DISC-not-assessed chip when DISC is set");
assert(html.includes("account-accordion-tags"), "contact accordion uses tags row");
assert(html.includes("meddpicc-field-value"), "MEDDPICC field value wrapper present");
assert(html.includes("meddpicc-field-status"), "MEDDPICC status below field body");
assert(html.includes("lifecycle-category-pill"), "timeline uses category pills");
assert(html.includes("lifecycle-timeline-day-label"), "activity feed uses day section headers");
assert(!html.includes("account-contact-row"), "detail no longer uses custom contact rows");
assert(!html.includes("account-stage-select"), "detail no longer uses stage dropdown");
assert(html.includes("All accounts"), "detail uses account copy");
assert(html.includes("Deal team"), "detail renders deal team card");
assert(html.includes("SE added to deal team") || html.includes("Stage updated"), "detail renders rich activity");
assert(html.includes('expanded'), "primary contact accordion expanded by default");

const orgId = "org_acme_test";
const primaryUser = await store.getUser(session.uid);
await store.upsertUser({ ...primaryUser, orgId });

await store.upsertUser({
  id: "usr_mgr_view",
  email: "mgr-view@freshworks.com",
  authUid: null,
  displayName: "Manager View",
  role: "manager",
  teamId: session.teamId,
  orgId,
  managerId: null,
  jobTitle: "Manager",
  status: "active",
  createdAt: Date.now(),
  updatedAt: Date.now(),
});

await store.upsertUser({
  id: "usr_add_se",
  email: "add-se@freshworks.com",
  authUid: null,
  displayName: "Add Candidate SE",
  role: "se",
  teamId: session.teamId,
  orgId,
  managerId: "usr_mgr_view",
  jobTitle: "Solution Engineer",
  status: "active",
  createdAt: Date.now(),
  updatedAt: Date.now(),
});

const mgrSession = {
  uid: "usr_mgr_view",
  teamId: session.teamId,
  orgId,
  email: "mgr-view@freshworks.com",
  role: "manager",
};
const mgrContainer = mockContainer();
await renderAccountView(mgrContainer, mgrSession, { accountId });
assert(mgrContainer.innerHTML.includes('data-action="add-se"'), "manager detail shows Add SE button");
assert(mgrContainer.innerHTML.includes('data-action="add-se-select"'), "manager detail shows SE select");
assert(mgrContainer.innerHTML.includes("Add Candidate SE"), "select lists assignable SE");

const grouped = summarizeContactEvents([
  { type: "linked_from_prep", timestamp: Date.now(), payload: { source: "prep" } },
  { type: "linked_from_prep", timestamp: Date.now(), payload: { source: "prep" } },
  { type: "linked_from_prep", timestamp: Date.now() - 86400000, payload: { source: "prep" } },
]);
assert(grouped.length === 2, "summarizeContactEvents groups same-day duplicates");
assert(grouped[0].count === 2, "summarizeContactEvents counts grouped events");

const capTs = Date.now();
for (let i = 0; i < ACTIVITY_INITIAL_VISIBLE + 5; i++) {
  await store.addLifecycleEvent({
    id: `ev_cap_${i}`,
    lifecycleId,
    type: "postcall_analyzed",
    actorId: session.uid,
    timestamp: capTs - i * 1000,
    payload: { qualityScore: 7 },
  });
}

const capContainer = mockContainer();
await renderAccountView(capContainer, session, { accountId });
assert(
  capContainer.innerHTML.includes("account-activity-show-all"),
  "activity feed shows show-all when more than initial visible count",
);
assert(capContainer.innerHTML.includes("Show all activities (6 more)"), "show-all label reflects hidden count");

console.log("test-account-view: ok");
