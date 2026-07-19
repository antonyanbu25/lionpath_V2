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
assert(detailContainer.innerHTML.includes("Acme Corp"), "detail renders account name");
assert(detailContainer.innerHTML.includes("Alex Lee"), "detail renders contact");
assert(detailContainer.innerHTML.includes("All accounts"), "detail uses account copy");

console.log("test-account-view: ok");
