/**
 * Smoke tests for account view rendering (no browser).
 */
import { getAccountEngagementDetail } from "../domain/account-service.js";
import { initDomainStore, getStore } from "../domain/store.js";
import { renderAccountView, summarizeContactEvents, ACTIVITY_INITIAL_VISIBLE } from "../account-view.js";
import { savePostCallAnalysis } from "../history.js";
import { renderAccountArrModule } from "../account-arr-module.js";

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

await store.createDeal({
  id: "deal_acme_nb",
  accountId,
  type: "new_business",
  stage: "discovery",
  status: "active",
  ownerId: session.uid,
  teamId: session.teamId,
  orgId: null,
  title: "New business",
  prepCount: 1,
  postCallCount: 0,
  openTaskCount: 0,
  latestQualityScore: null,
  metadata: {
    meddpicc: {
      identifyPain: { value: "Scaling support ops", status: "partial" },
      completionScore: 12,
      lastUpdatedAt: Date.now(),
    },
  },
  createdAt: Date.now(),
  updatedAt: Date.now(),
  lastActivityAt: Date.now(),
});
await store.updateLifecycle(lifecycleId, { dealId: "deal_acme_nb" });

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
  const state = { html: "", dealRows: [] };

  function refreshDealRows() {
    state.dealRows = [];
    const re = /data-action="open-opportunity"[^>]*data-deal-id="([^"]+)"/g;
    let match;
    while ((match = re.exec(state.html))) {
      state.dealRows.push(makeDealRow(match[1]));
    }
  }

  function makeButton() {
    return { addEventListener() {} };
  }

  function makeDealRow(dealId) {
    const row = {
      getAttribute(name) {
        return name === "data-deal-id" ? dealId : null;
      },
      addEventListener(type, fn) {
        row._handlers = row._handlers || {};
        row._handlers[type] = fn;
      },
      dispatchEvent(type = "click") {
        if (type === "click") row._handlers?.click?.();
        else row._handlers?.[type]?.({ key: "Enter", preventDefault() {} });
        return true;
      },
    };
    return row;
  }

  return {
    set innerHTML(value) {
      state.html = value;
      refreshDealRows();
    },
    get innerHTML() {
      return state.html;
    },
    querySelector(sel) {
      if (sel === '[data-action="back"]') return makeButton(sel);
      if (sel === '[data-action="prep"]') return makeButton(sel);
      if (sel === '[data-action="postcall"]') return makeButton(sel);
      if (sel === '[data-action="open-opportunity"]') return state.dealRows[0] || null;
      return null;
    },
    querySelectorAll(sel) {
      if (sel === '[data-action="select-contact"]') return [];
      if (sel === '[data-action="open-opportunity"]') return state.dealRows;
      return [];
    },
  };
}

const listContainer = mockContainer();
await renderAccountView(listContainer, session);
assert(listContainer.innerHTML.includes("Acme Corp"), "list renders account name");
assert(listContainer.innerHTML.includes("account-list-item"), "list renders account row");
assert(listContainer.innerHTML.includes("account-list-view--compact"), "list uses compact command layout");
assert(listContainer.innerHTML.includes("account-list-col--region"), "list shows region column");
assert(listContainer.innerHTML.includes("Total ARR"), "list shows ARR column");
assert(listContainer.innerHTML.includes("Last touch"), "list shows last touch column");
assert(listContainer.innerHTML.includes("account-list-row-grid"), "list row uses grid");
assert(
  listContainer.innerHTML.includes('<button type="button" class="lifecycle-list-item account-list-item'),
  "list row uses native button (full-width grid)",
);
assert(
  !listContainer.innerHTML.includes("fw-button class=\"lifecycle-list-item account-list-item"),
  "list row must not use fw-button wrapper",
);
assert(listContainer.innerHTML.includes("account-list-toolbar--compact"), "list uses compact toolbar");
assert(!listContainer.innerHTML.includes("scan stage, motion"), "list drops verbose subtitle");

const detailContainer = mockContainer();
await renderAccountView(detailContainer, session, { accountId, dealId: "deal_acme_nb" });
const html = detailContainer.innerHTML;

assert(html.includes("account-record--overview"), "account detail always uses overview shell");
assert(!html.includes("account-record--opportunity"), "legacy opportunity shell removed");
assert(html.includes("Acme Corp"), "detail renders account name");
assert(html.includes("Alex Lee"), "detail renders contact");
assert(html.includes("account-contact-row"), "detail uses compact contact rows");
assert(html.includes('data-action="select-contact"'), "contact rows use inline selection");
assert(html.includes("account-contacts-split"), "contacts use list plus detail layout");
assert(html.includes('data-action="open-opportunity"'), "deal rows open deal via My deals nav");
assert(html.includes("account-deals-on-account"), "overview lists deals on account");
assert(!html.includes("account-command-deck"), "overview omits legacy command deck");
assert(!html.includes('data-action="deal-type-select"'), "overview omits pursuit type control");
assert(!html.includes("Deal qualification (MEDDPICC)"), "overview omits MEDDPICC sidebar");
assert(html.includes("All accounts"), "overview back goes to account list");
assert(html.includes("account-command-header-domain"), "domain under account title");

let openedDealId = null;
let openedAccountId = null;
const openDealContainer = mockContainer();
await renderAccountView(openDealContainer, session, {
  accountId,
  onOpenDeal: (dealId, meta = {}) => {
    openedDealId = dealId;
    openedAccountId = meta.accountId;
  },
});
const dealRow = openDealContainer.querySelector('[data-action="open-opportunity"]');
assert(dealRow, "overview renders clickable deal row");
dealRow.dispatchEvent("click");
assert(openedDealId === "deal_acme_nb", "deal row triggers onOpenDeal with deal id");
assert(openedAccountId === accountId, "deal row triggers onOpenDeal with account id");

const overviewContainer = mockContainer();
await renderAccountView(overviewContainer, session, { accountId, dealId: null });
const overviewHtml = overviewContainer.innerHTML;
assert(overviewHtml.includes("account-record--overview"), "account route uses overview shell");
assert(overviewHtml.includes("account-deals-on-account"), "overview lists deals with ARR");
assert(overviewHtml.includes("account-calls-on-account"), "overview lists all account calls");
assert(overviewHtml.includes("account-arr-module"), "overview renders ARR module");
assert(overviewHtml.includes("Add-on attach matrix"), "overview renders attach matrix");
assert(overviewHtml.includes("account-gaps-section"), "overview renders gaps placeholder");
assert(overviewHtml.includes("Reason for evaluation"), "overview renders reason for evaluation");
assert(overviewHtml.includes("Why AI"), "overview renders why AI");
assert(!overviewHtml.includes("account-command-deck"), "overview omits command deck");
assert(!overviewHtml.includes('data-action="deal-type-select"'), "overview omits pursuit type control");
assert(!overviewHtml.includes("Deal qualification (MEDDPICC)"), "overview omits MEDDPICC");
assert(overviewHtml.includes("Acme Corp"), "overview renders account name");
assert(overviewHtml.includes("All accounts"), "overview back goes to list");

const contactDetailContainer = mockContainer();
await renderAccountView(contactDetailContainer, session, { accountId, contactId: "contact_1", dealId: null });
assert(contactDetailContainer.innerHTML.includes("account-contact-selected-panel"), "selected contact panel renders");
assert(contactDetailContainer.innerHTML.includes("account-contacts-split"), "contact selection keeps contact list visible");
assert(!contactDetailContainer.innerHTML.includes('data-action="back-from-contact"'), "no back-from-contact control");

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

const grouped = summarizeContactEvents([
  { type: "linked_from_prep", timestamp: Date.now(), payload: { source: "prep" } },
  { type: "linked_from_prep", timestamp: Date.now(), payload: { source: "prep" } },
  { type: "linked_from_prep", timestamp: Date.now() - 86400000, payload: { source: "prep" } },
]);
assert(grouped.length === 2, "summarizeContactEvents groups same-day duplicates");
assert(grouped[0].count === 2, "summarizeContactEvents counts grouped events");

await store.upsertUser({
  id: "user_empty",
  email: "empty@freshworks.com",
  authUid: null,
  displayName: "Empty SE",
  role: "se",
  teamId: session.teamId,
  orgId: null,
  managerId: null,
  jobTitle: "Solution Engineer",
  status: "active",
  createdAt: Date.now(),
  updatedAt: Date.now(),
});

await store.createDeal({
  id: "deal_exp_acme",
  accountId,
  type: "expansion",
  stage: "research",
  status: "active",
  ownerId: session.uid,
  teamId: session.teamId,
  orgId: null,
  title: "Expansion",
  prepCount: 0,
  postCallCount: 0,
  openTaskCount: 0,
  latestQualityScore: null,
  createdAt: Date.now(),
  updatedAt: Date.now(),
  lastActivityAt: Date.now(),
});
await store.updateLifecycle(lifecycleId, { dealId: "deal_acme_nb" });
const twoDealContainer = mockContainer();
await renderAccountView(twoDealContainer, session, { accountId, dealId: "deal_acme_nb" });
assert(twoDealContainer.innerHTML.includes("account-deals-on-account"), "multi-deal overview lists deals table");
assert(!twoDealContainer.innerHTML.includes('data-action="deal-type-select"'), "overview omits type dropdown");

await store.updateAccount(accountId, {
  metadata: {
    engagementOverride: {
      dealId: "deal_exp_acme",
      dealType: "expansion",
      updatedAt: Date.now(),
      updatedBy: session.uid,
    },
  },
});
const overrideDetail = await getAccountEngagementDetail(session, accountId, {});
assert(overrideDetail.selectedDealId === "deal_exp_acme", "engagement override selects deal on load");
assert(overrideDetail.engagementSelectionSource === "override", "override source recorded");

await store.createAccount({
  id: "account_no_eb",
  name: "No Buyer Co",
  domain: "nobuyer.com",
  slug: "no-buyer-co-nobuyer-com",
  seTeam: [{ seUserId: session.uid, role: "primary", addedAt: Date.now() }],
  primarySeUserId: session.uid,
  createdAt: Date.now(),
  updatedAt: Date.now(),
});

await store.createLifecycle({
  id: "lc_no_eb",
  accountId: "account_no_eb",
  ownerId: session.uid,
  teamId: session.teamId,
  title: "No Buyer Co",
  stage: "discovery",
  status: "active",
  prepCount: 0,
  postCallCount: 0,
  openTaskCount: 0,
  lastActivityAt: Date.now(),
  createdAt: Date.now(),
  updatedAt: Date.now(),
});

await store.createContact({
  id: "contact_no_eb",
  accountId: "account_no_eb",
  email: "ops@nobuyer.com",
  name: "Ops Lead",
  title: "Operations",
  metadata: {
    influence: { level: "medium", decisionRole: "technical_evaluator", source: "prep", updatedAt: Date.now() },
  },
  createdAt: Date.now(),
  updatedAt: Date.now(),
});

const noEbContainer = mockContainer();
await renderAccountView(noEbContainer, session, { accountId: "account_no_eb", dealId: null });
assert(noEbContainer.innerHTML.includes("account-economic-buyer-empty"), "explicit empty state when no economic buyer");
assert(noEbContainer.innerHTML.includes("No economic buyer identified"), "empty state copy");

const emptyContainer = mockContainer();
await renderAccountView(emptyContainer, {
  uid: "user_empty",
  teamId: session.teamId,
  email: "empty@freshworks.com",
});
assert(emptyContainer.innerHTML.includes("No accounts yet"), "empty list shows empty state copy");
assert(emptyContainer.innerHTML.includes("account-list-view"), "empty list uses list view wrapper");

const noUserContainer = mockContainer();
await renderAccountView(noUserContainer, { email: "logged@freshworks.com" });
assert(
  noUserContainer.innerHTML.includes("No accounts yet") ||
    noUserContainer.innerHTML.includes("account-list-view"),
  "email-only session uses effective userId and renders accounts list",
);

const signedOutContainer = mockContainer();
await renderAccountView(signedOutContainer, {});
assert(signedOutContainer.innerHTML.includes("Sign in to view accounts"), "unsigned session shows sign-in copy");

const raceContainer = mockContainer();
const racePromise = renderAccountView(raceContainer, session, { shouldApply: () => false });
await new Promise((r) => setTimeout(r, 5));
raceContainer.innerHTML = "stale-marker";
await racePromise;
assert(raceContainer.innerHTML === "stale-marker", "stale account list render does not overwrite DOM");

const loadingContainer = mockContainer();
const loadingPromise = renderAccountView(loadingContainer, session);
assert(
  loadingContainer.innerHTML.includes("account-list-view--loading"),
  "accounts list shows loading shell before rows arrive",
);
await loadingPromise;
assert(loadingContainer.innerHTML.includes("Acme Corp"), "accounts list replaces shell with rows");

await store.createAccount({
  id: "account_other",
  name: "Other Co",
  domain: "other.com",
  slug: "other-co-other-com",
  seTeam: [{ seUserId: session.uid, role: "primary", addedAt: Date.now() }],
  primarySeUserId: session.uid,
  createdAt: Date.now(),
  updatedAt: Date.now(),
});

await store.createLifecycle({
  id: "lc_other",
  accountId: "account_other",
  ownerId: session.uid,
  teamId: session.teamId,
  title: "Other Co",
  stage: "discovery",
  status: "active",
  prepCount: 0,
  postCallCount: 0,
  openTaskCount: 0,
  lastActivityAt: Date.now(),
  createdAt: Date.now(),
  updatedAt: Date.now(),
});

await store.createDeal({
  id: "deal_other_nb",
  accountId: "account_other",
  type: "new_business",
  stage: "discovery",
  status: "active",
  ownerId: session.uid,
  teamId: session.teamId,
  orgId: null,
  title: "Other deal",
  prepCount: 0,
  postCallCount: 0,
  openTaskCount: 0,
  latestQualityScore: null,
  createdAt: Date.now(),
  updatedAt: Date.now(),
  lastActivityAt: Date.now(),
});

const staleDealContainer = mockContainer();
await renderAccountView(staleDealContainer, session, { accountId, dealId: "deal_other_nb" });
assert(
  !staleDealContainer.innerHTML.includes("Could not load this account right now"),
  "foreign dealId on account detail does not show generic load error",
);

const listNavContainer = mockContainer();
await renderAccountView(listNavContainer, session, { accountId, dealId: null });
assert(listNavContainer.innerHTML.includes("account-record--overview"), "list-style navigation opens overview");
assert(
  !listNavContainer.innerHTML.includes("Could not load this account right now"),
  "list-style navigation avoids generic load error",
);

await savePostCallAnalysis(
  session.email,
  { companyName: "Globex Inc", accountId: "hist_globex-inc" },
  {
    analysis: { company: "Globex Inc", callHeader: { company: "Globex Inc" } },
    confirmed: { accountId: "hist_globex-inc", company: "Globex Inc" },
  },
);

const historyContainer = mockContainer();
await renderAccountView(historyContainer, session, { accountId: "hist_globex-inc", dealId: null });
assert(
  !historyContainer.innerHTML.includes("Could not load this account right now"),
  "history-only account detail avoids generic load error",
);
assert(
  historyContainer.innerHTML.includes("Globex") ||
    historyContainer.innerHTML.includes("Account not found"),
  "history-only account renders company or not-found",
);

const arrWithoutMatrix = renderAccountArrModule({
  estimateBand: null,
  linesByDealId: new Map(),
  discussedUnquantified: [],
  crossSellGaps: [],
  totalArr: 0,
  totalMrr: 0,
  baseArr: 0,
  baseMrr: 0,
  addonArr: 0,
  addonMrr: 0,
});
assert(arrWithoutMatrix.includes("account-arr-module"), "arr module renders without attachMatrix");
assert(!arrWithoutMatrix.includes("undefined"), "arr module omits undefined markers when attachMatrix missing");

console.log("test-account-view: ok");
