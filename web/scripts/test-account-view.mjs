/**
 * Smoke tests for account view rendering (no browser).
 */
import { initDomainStore, getStore } from "../domain/store.js";
import { renderAccountView } from "../account-view.js";

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
  teamId: session.teamId,
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
assert(!html.includes("account-contact-row"), "detail no longer uses custom contact rows");
assert(!html.includes("account-stage-select"), "detail no longer uses stage dropdown");
assert(html.includes("All accounts"), "detail uses account copy");
assert(html.includes('expanded'), "primary contact accordion expanded by default");

console.log("test-account-view: ok");
