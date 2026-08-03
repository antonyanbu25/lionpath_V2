/** Smoke tests for post-call confirm gate (no DOM). */
globalThis.document = { getElementById: () => null };

import {
  buildConfirmAttendees,
  renderConfirmationGate,
  syncIntakeDealSelection,
  __setIntakeDealStateForTests,
  __resetIntakeDealStateForTests,
} from "../postcall.js";

function assert(cond, msg) {
  if (!cond) throw new Error(msg);
}

const resolve = {
  transcriptMeta: { speakers: ["Farhan Sidek", "Daniel Foo", "Mei Ling Tan (AE)"] },
  participantEmails: ["farhan@getgo.com", "daniel@getgo.com", "me@freshworks.com"],
  customerIdentities: ["Farhan Sidek", "Daniel Foo"],
  seIdentity: "Antony S.",
  aeIdentity: "Mei Ling Tan",
};

const attendees = buildConfirmAttendees(resolve);
assert(attendees.length >= 3, "builds attendee rows from resolve");
const primary = attendees.filter((a) => a.role === "Primary SE");
assert(primary.length === 1, "exactly one Primary SE");

const html = renderConfirmationGate(
  {
    ...resolve,
    account: {
      accountId: "acc_1",
      accountName: "GetGo",
      reasons: [{ rank: 1, detail: "Domain match" }],
    },
    deals: [
      {
        dealId: "deal_1",
        title: "GetGo - New Business - 2026-08-01",
        stage: "discovery",
        type: "new_business",
        preselected: true,
      },
    ],
  },
  { primary: "demo", confidence: 0.91 },
);

assert(html.includes("Confirm call details"), "minimal title");
assert(!html.includes("Confirm before analysis"), "removed old header");
assert(!html.includes("Derived from recording"), "removed derived facts");
assert(!html.includes("No account matched</h3>"), "no duplicate no-match heading");
assert(!html.includes("postcall-customer-checks"), "removed customer checkboxes");
assert(!html.includes("<select id=\"pc-confirm-call-type\""), "no call type select");
assert(html.includes("postcall-call-type-chip"), "call type chips");
assert(html.includes("AI detected"), "AI detected badge");
assert(!html.includes("profile and its credits follow from call type"), "no call type hint");
assert(html.includes("postcall-role-select"), "per-attendee role dropdowns");
assert(!html.includes("postcall-role-chip"), "removed tap-to-cycle role chips");
assert(!html.includes("Some themes need video"), "no video-missing block on confirm");
assert(!html.includes("Change account or deal"), "no change account/deal on confirm");
assert(!html.includes("profile and its credits follow from call type"), "no call type hint");
assert(html.includes("Add attendee"), "add attendee control");
assert(/Getgo - New Business/i.test(html), "deal naming in top card");
assert(html.includes("Who was on the call"), "attendees section");

const emmaResolve = {
  transcriptMeta: { speakers: ["Emma Wark", "emma w", "Antony S."] },
  participantEmails: ["emma.w@gamersheek.co.uk", "me@freshworks.com"],
  customerIdentities: ["Emma Wark", "emma.w@gamersheek.co.uk"],
  seIdentity: "Antony S.",
  identityOptions: ["emma w"],
  account: {
    accountId: "acc_gs",
    accountName: "Gamersheek",
    reasons: [{ rank: 1, detail: "Domain match" }],
  },
  deals: [
    {
      dealId: "deal_gs",
      title: "Gamersheek - New Business - 2026-08-01",
      stage: "discovery",
      type: "new_business",
      preselected: true,
    },
  ],
};
const emmaAttendees = buildConfirmAttendees(emmaResolve);
const emmaCount = emmaAttendees.filter(
  (a) => (a.email || "").includes("emma.w@") || /emma/i.test(a.name),
).length;
assert(emmaCount === 1, "Emma Wark + emma w + email merge to one attendee");
const emmaHtml = renderConfirmationGate(emmaResolve, { primary: "discovery", confidence: 0.9 });
assert(
  (emmaHtml.match(/class="postcall-attendee-name">Emma Wark</g) || []).length === 1,
  "confirm HTML lists Emma Wark once in attendee rows",
);
assert(!emmaHtml.includes(">emma w<"), "confirm HTML does not show duplicate emma w row");

const resolveWithDeal = {
  ...resolve,
  account: {
    accountId: "acc_1",
    accountName: "GetGo",
    reasons: [{ rank: 1, detail: "Domain match" }],
  },
  deals: [
    {
      dealId: "deal_1",
      title: "GetGo - New Business - 2026-08-01",
      stage: "discovery",
      type: "new_business",
      preselected: true,
    },
  ],
};

__setIntakeDealStateForTests({
  createNewDeal: true,
  selectedDealId: null,
  newDealTitle: "Getgo - Expansion - 2026-08-01",
  payload: {
    createNewDeal: true,
    newDealTitle: "Getgo - Expansion - 2026-08-01",
    newDealType: "expansion",
  },
});
const htmlNewDeal = renderConfirmationGate(resolveWithDeal, { primary: "demo", confidence: 0.91 });
assert(htmlNewDeal.includes("Getgo - Expansion - 2026-08-01"), "confirm shows intake new deal title");
assert(htmlNewDeal.includes("Create on confirm"), "new deal stage on confirm");
assert(!htmlNewDeal.includes("postcall-deal-picker-inline"), "hide deal picker when creating new deal");
__resetIntakeDealStateForTests();

/** love@peninsula.com intake must not be overridden by stale Euphotic resolve match. */
__setIntakeDealStateForTests({
  createNewAccount: true,
  createNewDeal: true,
  resolvedAccount: null,
  accountName: "Peninsula",
  newDealTitle: "Peninsula - New Business - 2026-08-01",
  payload: {
    companyName: "Peninsula",
    createNewAccount: true,
    createNewDeal: true,
    newDealTitle: "Peninsula - New Business - 2026-08-01",
    newDealType: "new_business",
  },
});
const htmlPeninsula = renderConfirmationGate(
  {
    ...resolve,
    account: {
      accountId: "acc_euphotic",
      accountName: "Euphotic",
      reasons: [{ rank: 1, detail: "Stale brief match" }],
    },
    deals: [
      { dealId: "deal_old", title: "Euphotic - Expansion - 2025-01-01", stage: "discovery", preselected: true },
      { dealId: "deal_old2", title: "Euphotic - New Business - 2024-06-01", stage: "closed" },
    ],
  },
  { primary: "discovery", confidence: 0.88 },
);
assert(htmlPeninsula.includes("Peninsula"), "confirm keeps intake Peninsula account");
assert(htmlPeninsula.includes("New account · will be created on confirm"), "confirm shows new account badge");
assert(htmlPeninsula.includes("Peninsula - New Business - 2026-08-01"), "confirm keeps intake new deal");
assert(!htmlPeninsula.includes("Euphotic"), "confirm must not show stale Euphotic account");
assert(!htmlPeninsula.includes("postcall-deal-picker-inline"), "hide deal picker when intake chose new deal");
__resetIntakeDealStateForTests();

/** vivid-pix.com new account with zero CRM deals must not inherit Euphotic resolve deals. */
__setIntakeDealStateForTests({
  createNewAccount: true,
  createNewDeal: false,
  accountName: "Vivid Pix",
  payload: { companyName: "Vivid Pix", createNewAccount: true },
});
syncIntakeDealSelection([], {});
const htmlVivid = renderConfirmationGate(
  {
    ...resolve,
    account: { accountId: "acc_euphotic", accountName: "Euphotic" },
    deals: [
      { dealId: "d1", title: "Euphotic - Expansion - Date", stage: "discovery", preselected: true },
      { dealId: "d2", title: "Euphotic - New Business - 2026-07-27", stage: "closed" },
    ],
  },
  { primary: "demo", confidence: 0.9 },
);
assert(htmlVivid.includes("Vivid Pix"), "confirm keeps Vivid Pix account");
assert(htmlVivid.includes("Create on confirm"), "new account gets create-on-confirm deal");
assert(!htmlVivid.includes("Euphotic"), "confirm must not show stale Euphotic deals");
assert(!htmlVivid.includes("postcall-deal-picker-inline"), "no deal picker for new account");
__resetIntakeDealStateForTests();

console.log("test-postcall-confirm: ok");
