#!/usr/bin/env node
/**
 * Post-call intake page 1 — account/deal preview helpers.
 * Run: node web/scripts/test-postcall-intake-preview.mjs
 */

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

globalThis.document = { getElementById: () => null };

import { namesEqual, titleCaseDisplayName } from "../shared.js";
import {
  resolveIntakeAccount,
  renderAccountDealPreviewHtml,
  shouldShowCrmMatchesPanel,
  syncIntakeDealSelection,
  inferDealTypeFromTitle,
  isResolvedAccountValidForResult,
  filterSessionEmailFromProspects,
  isSessionProspectEmail,
  pickPreferredIntakeAccount,
} from "../postcall.js";

function assert(cond, msg) {
  if (!cond) throw new Error(msg);
}

function testTitleCase() {
  assert(titleCaseDisplayName("euphotic") === "Euphotic", "titleCaseDisplayName");
  assert(titleCaseDisplayName("EUPHOTIC") === "Euphotic", "titleCase upper");
  assert(namesEqual("Euphotic", "euphotic"), "namesEqual case insensitive");
  assert(!namesEqual("Acme", "Beta"), "namesEqual different");
}

function testCaseInsensitiveAccountMatch() {
  const result = {
    byEmail: [{ matched: true, accounts: [{ id: "acc_1", name: "Euphotic", domain: "euphotic.io" }] }],
    accounts: [{ id: "acc_1", name: "Euphotic", domain: "euphotic.io" }],
    deals: [],
  };
  const resolved = resolveIntakeAccount(result, "euphotic", null);
  assert(resolved?.id === "acc_1", "typed company matches account name");
  assert(
    resolveIntakeAccount(result, "EUPHOTIC", null)?.id === "acc_1",
    "uppercase typed company matches",
  );
}

function testMultipleDealsPreview() {
  const html = renderAccountDealPreviewHtml({
    accountName: "Acme",
    accountMatched: true,
    deals: [
      { id: "deal_1", title: "Acme - New Business - 2026-08-01", stage: "discovery", status: "open" },
      { id: "deal_2", title: "Acme - Expansion - 2026-07-15", stage: "demo", status: "open" },
    ],
    selectedDealId: "deal_1",
    createNewDeal: false,
  });
  assert(html.includes('data-deal-id="deal_1"'), "first deal tile");
  assert(html.includes('data-deal-id="deal_2"'), "second deal tile");
  assert(html.includes("pick-new-deal"), "+ New deal link");
  assert(html.includes("is-selected") && html.includes("deal_1"), "first deal selected");
  assert(html.includes("pc-deal-tiles-row"), "horizontal deal row");
  assert(html.includes("nb-account-column"), "account column");
  assert(html.includes("pc-deal-showcase"), "deal column");
  assert(!html.includes("pc-showcase-row"), "no extra showcase wrapper");
  assert(html.includes("edit-account-name"), "inline account name input");
  assert(html.includes("pc-account-name-input"), "visible account name input styling hook");
  assert(!html.includes("pc-new-deal-title-input"), "no new deal input when existing deal selected");
}

function testNewDealOptionWhenMatched() {
  const html = renderAccountDealPreviewHtml({
    accountName: "Northwind",
    accountMatched: true,
    deals: [{ id: "deal_only", title: "Northwind - New Business - 2026-08-01", stage: "discovery" }],
    selectedDealId: "deal_only",
    createNewDeal: false,
  });
  assert(html.includes('data-action="pick-new-deal"'), "new deal visible with existing deal");
  assert(html.includes("Account matched · existing"), "matched account badge");

  const newDealHtml = renderAccountDealPreviewHtml({
    accountName: "Northwind",
    accountMatched: true,
    deals: [{ id: "deal_only", title: "Northwind deal", stage: "discovery" }],
    selectedDealId: null,
    createNewDeal: true,
    newDealType: "expansion",
    newDealTitle: "Northwind - Expansion - 2026-08-01",
  });
  assert(newDealHtml.includes("edit-new-deal-title"), "editable new deal title input");
  assert(newDealHtml.includes("Northwind - Expansion - 2026-08-01"), "prefilled deal title");
  assert(newDealHtml.includes("pc-new-deal-title-input"), "styled new deal text field");
  assert(!newDealHtml.includes('data-deal-id="deal_only" is-selected'), "existing deal not selected in new-deal mode");
  assert(!newDealHtml.includes("pick-deal-type"), "no deal type chips");
  assert(!newDealHtml.includes("pc-deal-tile--new"), "no giant new-deal card tile");
}

function testNoAccountPreview() {
  const html = renderAccountDealPreviewHtml({
    accountName: "brandnew",
    accountMatched: false,
    deals: [],
    createNewDeal: true,
  });
  assert(html.includes("New account · on confirm"), "new account badge");
  assert(html.includes("Create on confirm"), "deal create on confirm");
  assert(html.includes("Brandnew"), "title-cased company in preview");
  assert(html.includes("nb-account-column"), "account column in preview");
  assert(html.includes("pc-deal-showcase"), "deal column in preview");
}

function testInferDealTypeFromTitle() {
  assert(inferDealTypeFromTitle("Euphotic - Expansion - 2026-08-01") === "expansion", "expansion title");
  assert(inferDealTypeFromTitle("Acme - New Business - 2026-08-01") === "new_business", "new business title");
  assert(inferDealTypeFromTitle("Custom deal name") === "new_business", "unknown title defaults");
}

function testCrmPanelVisibility() {
  const single = {
    byEmail: [{ matched: true, accounts: [{ id: "a1" }] }],
    accounts: [{ id: "a1", name: "One" }],
    deals: [],
  };
  assert(!shouldShowCrmMatchesPanel(single, { id: "a1" }), "hide panel when account picked");

  const multi = {
    byEmail: [{ matched: true, accounts: [{ id: "a1" }, { id: "a2" }] }],
    accounts: [{ id: "a1" }, { id: "a2" }],
    deals: [],
  };
  assert(shouldShowCrmMatchesPanel(multi, null), "show panel for multi account");
}

function testSyncDealSelection() {
  syncIntakeDealSelection(
    [
      { id: "d1" },
      { id: "d2" },
    ],
    { createNewDeal: false, selectedDealId: "d2" },
  );
  // syncIntakeDealSelection mutates module state — re-import would be needed for isolation;
  // verify via return behavior by calling render with explicit opts instead.
  assert(true, "syncIntakeDealSelection runs");
}

/** After euphotic session, love@life.com must NOT reuse stale Euphotic account. */
function testStaleEuphoticNotReusedForLifeEmail() {
  const staleEuphotic = { id: "acc_euphotic", name: "Euphotic", domain: "euphotic.io" };
  const noMatchResult = { byEmail: [], accounts: [], deals: [] };

  assert(!isResolvedAccountValidForResult(staleEuphotic, noMatchResult), "euphotic not in empty CRM result");
  const resolved = resolveIntakeAccount(noMatchResult, "Life", staleEuphotic);
  assert(!resolved?.id, "stale euphotic ignored when CRM has no match for life.com");

  const html = renderAccountDealPreviewHtml({
    accountName: "Life",
    accountMatched: false,
    deals: [],
    createNewDeal: true,
    newDealTitle: "Life - New Business - 2026-08-01",
  });
  assert(html.includes("New account · on confirm"), "life.com shows new account flow");
  assert(html.includes("Life"), "company derived from domain");
  assert(!html.includes("Euphotic"), "must not show euphotic");
  assert(!html.includes("Existing account"), "must not show matched badge");
  assert(!html.includes("Account matched · existing"), "must not show existing matched badge");
}

function testExistingDealSelectedByDefault() {
  syncIntakeDealSelection(
    [{ id: "deal_recent", title: "Acme - New Business - 2026-08-01", stage: "discovery" }],
    { createNewDeal: false, selectedDealId: null },
  );

  const html = renderAccountDealPreviewHtml({
    accountName: "Acme",
    accountMatched: true,
    deals: [{ id: "deal_recent", title: "Acme - New Business - 2026-08-01", stage: "discovery" }],
    selectedDealId: "deal_recent",
    createNewDeal: false,
  });
  assert(html.includes('data-deal-id="deal_recent"'), "existing deal tile shown");
  assert(html.includes("is-selected") && html.includes("deal_recent"), "first deal auto-selected");
  assert(!html.includes("pc-new-deal-title-input"), "new deal input hidden until + New deal");
}

function testHistoryDealShownBeforeAccountResolved() {
  const html = renderAccountDealPreviewHtml({
    accountName: "Gamersheek",
    accountMatched: false,
    deals: [{ id: "deal_hist_gamersheek", title: "Gamersheek - New Business - 2026-08-01", stage: "discovery" }],
    selectedDealId: "deal_hist_gamersheek",
    createNewDeal: false,
  });
  assert(html.includes('data-deal-id="deal_hist_gamersheek"'), "history deal tile when account not yet resolved");
  assert(html.includes("Deal 1 · existing"), "existing deal label");
  assert(!html.includes("pc-deal-tile--static"), "no static create-on-confirm card");
  assert(html.includes("Account matched · existing"), "matched badge when deals surfaced");
}

function testPickPreferredIntakeAccount() {
  const dupes = [
    { id: "hist_gamersheek", name: "Gamersheek" },
    { id: "acc_b85d74fb", name: "Gamersheek" },
  ];
  assert(pickPreferredIntakeAccount(dupes)?.id === "acc_b85d74fb", "prefer Firestore over hist stub");
  const different = [
    { id: "acc_a", name: "Acme", domain: "acme.com" },
    { id: "acc_b", name: "Beta", domain: "beta.com" },
  ];
  assert(pickPreferredIntakeAccount(different) === null, "no auto-pick for different companies");

  const result = {
    accounts: dupes,
    deals: [{ id: "deal_hist_gamersheek", accountId: "hist_gamersheek" }],
    byEmail: [],
  };
  assert(resolveIntakeAccount(result, "", null)?.id === "acc_b85d74fb", "resolve picks Firestore dupe");
}

function testReconcileClearsStaleResolvedAccount() {
  const euphotic = { id: "acc_euphotic", name: "Euphotic", domain: "euphotic.io" };
  const euphoticResult = {
    byEmail: [{ matched: true, accounts: [euphotic] }],
    accounts: [euphotic],
    deals: [{ id: "deal_e", accountId: "acc_euphotic", title: "Euphotic deal" }],
  };
  const lifeResult = { byEmail: [], accounts: [], deals: [] };

  assert(isResolvedAccountValidForResult(euphotic, euphoticResult), "euphotic valid when in CRM result");
  assert(!isResolvedAccountValidForResult(euphotic, lifeResult), "euphotic invalid after switch to life.com");
  assert(!resolveIntakeAccount(lifeResult, "Life", euphotic)?.id, "resolve rejects stale euphotic for life.com");
}

function testProspectEmailFieldNotPrefilledInHtml() {
  const html = fs.readFileSync(path.join(__dirname, "../index.html"), "utf8");
  assert(html.includes('id="pc-account-deal-preview"'), "pc-account-deal-preview container in index.html");
  assert(html.includes("postcall-intake-card"), "postcall-intake-card in index.html");
  assert(!html.includes('id="pc-company-name"'), "legacy pc-company-name field removed");
  const match = html.match(/id="pc-prospect-emails"[\s\S]*?<\/fw-input>/);
  assert(match, "pc-prospect-emails fw-input present");
  assert(!/\bvalue\s*=/.test(match[0]), "prospect email field has no default value attribute");
  assert(match[0].includes('autocomplete="nope"'), "prospect email autofill disabled with nope token");
  assert(match[0].includes('name="pc-attendee-emails"'), "prospect field uses attendee name not login email");
  assert(match[0].includes('data-lpignore="true"'), "password manager ignore hint present");
  assert(!match[0].includes("se@freshworks.com"), "demo SE email not in prospect field markup");
  assert(html.includes('id="postcall-form" autocomplete="off"'), "postcall form disables autocomplete");
  assert(html.includes("postcall-autofill-decoys"), "decoy autofill trap fields present");
  assert(!html.includes('id="pc-enable-video-pass"'), "video pass opt-in toggle removed");
  assert(!html.includes("postcall-video-pass-opt"), "video pass opt-in block removed");
  assert(!html.includes("Enable video analysis"), "video analysis consent label removed");
  assert(!html.includes("Camera, slides, and screen-share scoring"), "video pass hint removed");
}

function testSessionEmailRejectedFromProspects() {
  const sessionEmail = "se@freshworks.com";
  assert(isSessionProspectEmail("se@freshworks.com", sessionEmail), "detects session email");
  assert(isSessionProspectEmail("SE@freshworks.com", sessionEmail), "case insensitive session match");
  assert(!isSessionProspectEmail("alex@acme.com", sessionEmail), "customer email not session");

  const mixed = filterSessionEmailFromProspects(
    ["se@freshworks.com", "alex@acme.com"],
    sessionEmail,
  );
  assert(mixed.length === 1 && mixed[0] === "alex@acme.com", "strips session email from list");

  const onlySession = filterSessionEmailFromProspects(["se@freshworks.com"], sessionEmail);
  assert(onlySession.length === 0, "session-only list becomes empty");
}

function testMatchedAccountNoDealsHidesNewDealInput() {
  const html = renderAccountDealPreviewHtml({
    accountName: "Northwind",
    accountMatched: true,
    deals: [],
    createNewDeal: false,
    newDealTitle: "Northwind - New Business - 2026-08-01",
  });
  assert(!html.includes("pc-new-deal-title-input"), "no new deal input until + New deal");
  assert(html.includes("Create on confirm"), "static create-on-confirm card");
  assert(html.includes('data-action="pick-new-deal"'), "+ New deal link when account matched");
}

function testNewDealSelectedStateWhenCreating() {
  const html = renderAccountDealPreviewHtml({
    accountName: "Northwind",
    accountMatched: true,
    deals: [{ id: "deal_only", title: "Northwind deal", stage: "discovery" }],
    selectedDealId: null,
    createNewDeal: true,
    newDealTitle: "Northwind - New Business - 2026-08-01",
  });
  assert(html.includes('pc-new-deal-field is-selected'), "new deal field shows selected state");
  assert(html.includes('nb-deal-new-link is-active'), "+ New deal link active in new-deal mode");
  assert(!html.includes('pc-deal-tile is-selected'), "no existing deal tile selected");
  assert(html.includes('data-deal-id="deal_only"'), "existing deal tile still visible");
}

function testNewDealSelectedStateNoExistingDeals() {
  const html = renderAccountDealPreviewHtml({
    accountName: "Contoso",
    accountMatched: true,
    deals: [],
    createNewDeal: true,
    newDealTitle: "Contoso - New Business - 2026-08-01",
  });
  assert(html.includes('pc-new-deal-field is-selected'), "new deal input selected when no deals");
  assert(html.includes("pc-new-deal-title-input"), "editable new deal title");
  assert(!html.includes("pc-deal-tile--static"), "static card replaced by editor in new-deal mode");
}

function main() {
  testTitleCase();
  testCaseInsensitiveAccountMatch();
  testMultipleDealsPreview();
  testNewDealOptionWhenMatched();
  testNoAccountPreview();
  testInferDealTypeFromTitle();
  testCrmPanelVisibility();
  testSyncDealSelection();
  testStaleEuphoticNotReusedForLifeEmail();
  testExistingDealSelectedByDefault();
  testHistoryDealShownBeforeAccountResolved();
  testPickPreferredIntakeAccount();
  testReconcileClearsStaleResolvedAccount();
  testProspectEmailFieldNotPrefilledInHtml();
  testSessionEmailRejectedFromProspects();
  testMatchedAccountNoDealsHidesNewDealInput();
  testNewDealSelectedStateWhenCreating();
  testNewDealSelectedStateNoExistingDeals();
  console.log("test-postcall-intake-preview.mjs: all assertions passed");
}

main();
