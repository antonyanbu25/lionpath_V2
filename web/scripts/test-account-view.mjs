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

assert(html.includes("account-record--opportunity"), "deal route uses opportunity record");
assert(html.includes("← Account"), "opportunity back goes to account overview");
assert(html.includes("Acme Corp"), "detail renders account name");
assert(html.includes("Alex Lee"), "detail renders contact");
assert(html.includes("account-contact-row"), "detail uses compact contact rows");
assert(html.includes('data-action="select-contact"'), "contact rows use inline selection");
assert(html.includes("account-contact-selected-panel"), "detail shows selected contact panel");
assert(html.includes("account-contacts-split"), "contacts use list plus detail layout");
assert(html.includes('data-action="deal-type-select"'), "detail has deal type dropdown");
assert(html.includes("account-meta-rail__cell--type"), "type control lives in meta rail");
assert(!html.includes('data-action="engagement-menu"'), "engagement settings menu removed");
assert(!html.includes("handoff-expansion"), "hand off to expansion removed");
assert(!html.includes("Type drives stage and activity"), "deal sub-header row removed");
assert(!html.includes('data-action="deal-select"'), "no switch deal select on detail");
assert(!html.includes("Switch deal"), "switch deal control removed");
assert(html.includes('label="Type"'), "type dropdown uses Type label");
assert(!html.includes('label="Pursuit type"'), "legacy pursuit select removed");
assert(html.includes("account-command-deck"), "detail uses 1b command deck");
assert(html.includes("account-command-panel--contacts"), "contacts in left command panel");
assert(html.includes("account-meddpicc-details--expanded"), "MEDDPICC expanded by default");
assert(html.includes('title="DISC D"'), "DISC abbrev exposes full label in title");
assert(!html.includes('text="High influence"'), "contacts avoid long influence fw-tag");
assert(!html.includes("DISC not assessed"), "no grey DISC-not-assessed chip when DISC is set");
assert(html.includes("fw-tag"), "detail uses Crayons tags");
assert(html.includes("lifecycle-pipeline-stage"), "detail renders lifecycle pipeline stepper");
assert(html.includes("lifecycle-terminal-stage"), "detail renders terminal outcome stages");
assert(html.includes("lifecycle-pipeline-step-num"), "pipeline shows numbered open stages");
assert(!html.includes("account-detail-grid"), "legacy two-column grid replaced");
assert(html.includes("Deal qualification (MEDDPICC)"), "detail renders MEDDPICC card");
assert(html.includes("Not captured"), "MEDDPICC uses designed empty-state copy");
assert(html.includes("meddpicc-field-status"), "MEDDPICC status below field body");
assert(html.includes("meddpicc-field--compact"), "MEDDPICC uses compact sidebar rows");
assert(html.includes("lifecycle-category-pill"), "timeline uses category pills");
assert(html.includes("lifecycle-timeline-day-label"), "activity feed uses day section headers");
assert(!html.includes("account-contacts-table"), "detail no longer uses wide contacts table");
assert(!html.includes("account-stage-select"), "detail no longer uses stage dropdown");
assert(html.includes("← Account"), "opportunity uses back to account overview");
assert(!html.includes("All accounts"), "opportunity does not use list back label");
assert(html.includes("Deal team"), "detail renders deal team card");
assert(html.includes("SE added to deal team") || html.includes("Stage updated"), "detail renders rich activity");
assert(html.includes("account-record-top"), "detail groups header meta and pursuit");
assert(html.includes("account-meta-rail"), "detail renders meta rail");
assert(html.includes("account-command-header-domain"), "domain under account title");
assert(!html.includes("account-meta-rail__label\">Domain"), "domain not duplicated in meta rail");
assert(!html.includes("account-meta-rail__label\">Motion"), "meta rail omits duplicate motion label");
assert(!html.includes("account-meta-rail__label\">Stage"), "meta rail omits stage (on pipeline)");
assert(!html.includes("account-meta-rail__label\">ICP"), "meta rail omits ICP chip");
assert(!html.includes('data-action="open-contact"'), "legacy open-contact drill-down removed");
assert(html.includes("account-summary-primary-contact"), "meta rail shows primary contact");
assert(!html.includes("account-deals-details"), "single-deal account hides deals section");

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

const mgrSession = {
  uid: "usr_mgr_view",
  teamId: session.teamId,
  orgId,
  email: "mgr-view@freshworks.com",
  role: "manager",
};
const mgrContainer = mockContainer();
await renderAccountView(mgrContainer, mgrSession, { accountId, dealId: "deal_acme_nb" });
assert(mgrContainer.innerHTML.includes('data-action="add-se"'), "manager opportunity view shows Add SE button");
assert(mgrContainer.innerHTML.includes('data-action="add-se-select"'), "manager opportunity view shows SE select");
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
await renderAccountView(capContainer, session, { accountId, dealId: "deal_acme_nb" });
assert(
  capContainer.innerHTML.includes("account-activity-show-all"),
  "activity feed shows show-all when more than initial visible count",
);
assert(capContainer.innerHTML.includes("Show all activities (6 more)"), "show-all label reflects hidden count");

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
assert(twoDealContainer.innerHTML.includes('data-action="deal-type-select"'), "multi-deal account uses type dropdown");
assert(!twoDealContainer.innerHTML.includes('data-action="deal-select"'), "no redundant switch deal select");
assert(!twoDealContainer.innerHTML.includes("account-deals-details"), "two active deals hide sidebar deals table");

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
