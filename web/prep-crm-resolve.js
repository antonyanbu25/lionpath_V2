/**
 * Real-time account / deal lookup for the pre-call search form (mirrors post-call CRM surfacing).
 * Contacts are grouped by corporate email domain — one account per domain, not per contact.
 */

import { resolveContactsForEmails } from "./postcall-contact-resolve.js";
import { setAccountEngagementContext } from "./domain/account-context.js";
import { isFreeMailDomain } from "./domain/constants.js";
import { companyNameFromDomain } from "./prep-domain.js";
import { readFieldValueAsync } from "./crayons-ui.js";
import { esc, $ } from "./shared.js";

function normalizeDomain(raw) {
  return String(raw || "")
    .trim()
    .toLowerCase()
    .replace(/^https?:\/\//, "")
    .replace(/^www\./, "")
    .split("/")[0];
}

/** @type {{ id: string, name?: string, domain?: string|null }|null} */
let prepResolvedAccount = null;
/** @type {string|null} */
let prepSelectedDealId = null;
let prepCreateNewDeal = false;
/** @type {object[]} */
let lastDeals = [];
/** @type {string|null} */
let prepDraftAccountName = null;
let prepAccountNameUserEdited = false;
let lookupTimer = 0;
let lookupToken = 0;

function parseEmails(raw) {
  return String(raw || "")
    .split(/[,;\s]+/)
    .map((e) => e.trim().toLowerCase())
    .filter((e) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(e));
}

/** Merge per-email CRM hits into one row per corporate domain. */
function groupByDomain(byEmail) {
  /** @type {Map<string, { domain: string|null, emails: string[], accounts: Map<string, object>, matched: boolean }>} */
  const groups = new Map();
  for (const entry of byEmail) {
    const domain = entry.domain;
    const corporate = domain && !isFreeMailDomain(domain);
    const key = corporate ? domain : `__personal:${entry.email}`;
    if (!groups.has(key)) {
      groups.set(key, { domain: corporate ? domain : null, emails: [], accounts: new Map(), matched: false });
    }
    const group = groups.get(key);
    group.emails.push(entry.email);
    group.matched = group.matched || entry.matched;
    for (const account of entry.accounts || []) {
      if (account?.id) group.accounts.set(account.id, account);
    }
  }
  return [...groups.values()].map((g) => ({
    domain: g.domain,
    emails: g.emails,
    accounts: [...g.accounts.values()],
    matched: g.matched,
  }));
}

function resolveDefaultAccountName(domain, domainAccounts) {
  if (prepAccountNameUserEdited && prepDraftAccountName) return prepDraftAccountName;
  if (prepResolvedAccount?.name) return prepResolvedAccount.name;
  if (domainAccounts.length === 1) {
    return domainAccounts[0].name || companyNameFromDomain(domain) || domain || "";
  }
  return companyNameFromDomain(domain) || domain || "";
}

function readAccountNameInput() {
  const input = $("prep-account-name");
  return (input?.value || prepDraftAccountName || "").trim();
}

function syncEngagementContext() {
  const ctx = {};
  if (prepResolvedAccount?.id) ctx.accountId = prepResolvedAccount.id;
  if (prepSelectedDealId && !prepCreateNewDeal) ctx.dealId = prepSelectedDealId;
  if (Object.keys(ctx).length) setAccountEngagementContext(ctx);
}

export function getPrepCrmSelection() {
  const accountName = readAccountNameInput() || prepResolvedAccount?.name || null;
  return {
    accountId: prepResolvedAccount?.id || null,
    account: prepResolvedAccount,
    accountName,
    dealId: prepCreateNewDeal ? null : prepSelectedDealId,
    createNewDeal: prepCreateNewDeal,
  };
}

export function resetPrepCrmSelection() {
  prepResolvedAccount = null;
  prepSelectedDealId = null;
  prepCreateNewDeal = false;
  lastDeals = [];
  prepDraftAccountName = null;
  prepAccountNameUserEdited = false;
}

/** Clear CRM UI after starting a fresh brief. */
export function resetPrepCrmUi() {
  resetPrepCrmSelection();
  const panel = $("prep-crm-matches");
  if (panel) {
    panel.hidden = true;
    panel.innerHTML = "";
  }
  const accountCard = $("prep-account-card");
  if (accountCard) {
    accountCard.hidden = true;
    accountCard.innerHTML = "";
  }
  const dealRow = $("prep-deal-row");
  if (dealRow) dealRow.hidden = true;
  const grid = $("prep-account-deal-grid");
  if (grid) grid.hidden = true;
  const nameInput = $("prep-account-name");
  if (nameInput) nameInput.value = "";
}

async function applyAccount(account, deals = []) {
  prepResolvedAccount = account
    ? { id: account.id, name: account.name, domain: account.domain || null }
    : null;
  if (!prepAccountNameUserEdited) {
    prepDraftAccountName = account?.name || prepDraftAccountName;
  }
  lastDeals = deals.filter((d) => !account || d.accountId === account.id);
  if (lastDeals.length === 1 && !prepCreateNewDeal) {
    prepSelectedDealId = lastDeals[0].id;
  } else if (!lastDeals.some((d) => d.id === prepSelectedDealId)) {
    prepSelectedDealId = lastDeals[0]?.id || null;
  }
  if (account?.domain) {
    const field = $("companyDomain");
    if (field) {
      const normalized = normalizeDomain(account.domain);
      field.value = normalized;
      field.dispatchEvent?.(new CustomEvent("fwInput", { bubbles: true, detail: { value: normalized } }));
    }
  }
  syncEngagementContext();
  renderDealRow();
  const nameInput = $("prep-account-name");
  if (nameInput && !prepAccountNameUserEdited) {
    nameInput.value = prepDraftAccountName || account?.name || "";
  }
}

function renderAccountDealPreview(domain, accountName, isExisting = false) {
  const grid = $("prep-account-deal-grid");
  const accountCard = $("prep-account-card");
  const row = $("prep-deal-row");
  const dealDisplay = $("prep-deal-display");
  if (!grid || !accountCard) return;

  const displayName = accountName || companyNameFromDomain(domain) || domain || "Account";
  const mono = displayName.slice(0, 2).toUpperCase();
  grid.hidden = false;
  accountCard.hidden = false;
  accountCard.innerHTML = `<div class="nb-account-card">
    <span class="nb-account-card-mono">${esc(mono)}</span>
    <div class="nb-account-card-body">
      <span class="nb-account-card-name">${esc(displayName)}</span>
      <span class="nb-account-card-badge">${isExisting ? "Existing account" : "New account"}</span>
    </div>
  </div>`;

  if (row && dealDisplay) {
    row.hidden = false;
    dealDisplay.innerHTML = `<div class="nb-deal-card">
      <span class="nb-deal-card-icon" aria-hidden="true"><svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M12 2v20M17 5H9.5a3.5 3.5 0 0 0 0 7h5a3.5 3.5 0 0 1 0 7H6"/></svg></span>
      <div class="nb-deal-card-body">
        <span class="nb-deal-card-title">New deal</span>
        <span class="nb-deal-card-stage">Will be created on generate</span>
      </div>
    </div>`;
  }
}

function renderDealRow() {
  const row = $("prep-deal-row");
  const select = $("prep-deal-select");
  const accountCard = $("prep-account-card");
  const dealDisplay = $("prep-deal-display");
  const grid = $("prep-account-deal-grid");
  if (!row || !select) return;

  if (!prepResolvedAccount) {
    row.hidden = true;
    if (accountCard) accountCard.hidden = true;
    if (grid) grid.hidden = true;
    return;
  }

  if (grid) grid.hidden = false;

  const displayName = readAccountNameInput() || prepResolvedAccount.name || prepResolvedAccount.domain || "Account";
  const mono = displayName.slice(0, 2).toUpperCase();
  if (accountCard) {
    accountCard.hidden = false;
    accountCard.innerHTML = `<div class="nb-account-card">
      <span class="nb-account-card-mono">${esc(mono)}</span>
      <div class="nb-account-card-body">
        <span class="nb-account-card-name">${esc(displayName)}</span>
        <span class="nb-account-card-badge">${prepResolvedAccount.id ? "Existing account" : "New account"}</span>
      </div>
    </div>`;
  }

  const options = lastDeals.map(
    (d) => `<fw-select-option value="${esc(d.id)}">${esc(d.title || "Deal")}</fw-select-option>`,
  );
  select.innerHTML = [
    ...options,
    `<fw-select-option value="__new__">+ Create new deal</fw-select-option>`,
  ].join("");

  if (prepCreateNewDeal || !prepSelectedDealId) {
    select.value = prepCreateNewDeal ? "__new__" : prepSelectedDealId || "__new__";
  } else {
    select.value = prepSelectedDealId;
  }

  const selectedDeal = lastDeals.find((d) => d.id === prepSelectedDealId);
  if (dealDisplay) {
    const title = prepCreateNewDeal || !selectedDeal ? "New deal" : selectedDeal.title || "Deal";
    const stage = prepCreateNewDeal || !selectedDeal ? "Will be created on generate" : selectedDeal.stage || selectedDeal.status || "Active";
    dealDisplay.innerHTML = `<div class="nb-deal-card">
      <span class="nb-deal-card-icon" aria-hidden="true"><svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M12 2v20M17 5H9.5a3.5 3.5 0 0 0 0 7h5a3.5 3.5 0 0 1 0 7H6"/></svg></span>
      <div class="nb-deal-card-body">
        <span class="nb-deal-card-title">${esc(title)}</span>
        <span class="nb-deal-card-stage">${esc(stage)}</span>
      </div>
    </div>`;
  }

  row.hidden = false;
}

async function renderCrmPanel() {
  const panel = $("prep-crm-matches");
  if (!panel) return;
  const emails = parseEmails(await readFieldValueAsync($("prospectEmail")));
  if (!emails.length) {
    panel.hidden = true;
    panel.innerHTML = "";
    $("prep-deal-row") && ($("prep-deal-row").hidden = true);
    $("prep-account-card") && ($("prep-account-card").hidden = true);
    $("prep-account-deal-grid") && ($("prep-account-deal-grid").hidden = true);
    return;
  }

  const seq = ++lookupToken;
  let result;
  try {
    result = await resolveContactsForEmails(emails);
  } catch (err) {
    console.warn("[prep] CRM lookup failed:", err?.message || err);
    panel.hidden = true;
    return;
  }
  if (seq !== lookupToken) return;

  const accounts = result.accounts || [];
  const domainGroups = groupByDomain(result.byEmail || []);
  const primaryGroup = domainGroups.find((g) => g.domain) || domainGroups[0];
  const defaultName = resolveDefaultAccountName(primaryGroup?.domain, primaryGroup?.accounts || accounts);
  if (!prepAccountNameUserEdited) prepDraftAccountName = defaultName;

  if (accounts.length === 1) {
    await applyAccount(accounts[0], result.deals || []);
  } else if (accounts.length > 1 && !prepResolvedAccount) {
    prepSelectedDealId = null;
    prepCreateNewDeal = false;
  } else if (primaryGroup?.domain && !prepResolvedAccount) {
    renderAccountDealPreview(primaryGroup.domain, defaultName, false);
  }

  const domainRows = domainGroups
    .map((group) => {
      const domainLabel = group.domain || "Personal email";
      const contactList = group.emails.map((e) => esc(e)).join(", ");
      const accountChips = group.accounts
        .map((a) => {
          const selected = prepResolvedAccount?.id === a.id ? " pc-crm-account--selected" : "";
          return `<button type="button" class="pc-crm-account${selected}" data-action="prep-pick-account" data-account-id="${esc(a.id)}">
            <span class="pc-crm-account-name">${esc(a.name || a.domain || "Account")}</span>
          </button>`;
        })
        .join("");
      const status = group.matched
        ? accountChips
        : `<span class="pc-crm-new">New account will be created</span>`;
      return `<div class="pc-crm-domain-group">
        <div class="pc-crm-row pc-crm-row--domain">
          <span class="pc-crm-domain-label">${esc(domainLabel)}</span>
          <span class="pc-crm-contacts muted">${contactList}</span>
        </div>
        <div class="pc-crm-row pc-crm-row--status">
          <span class="pc-crm-matchset">${status}</span>
        </div>
      </div>`;
    })
    .join("");

  if (accounts.length <= 1) {
    panel.hidden = true;
    panel.innerHTML = `<input id="prep-account-name" type="hidden" value="${esc(prepDraftAccountName || defaultName)}" />`;
  } else {
    const header = "Multiple accounts found — pick one";
    panel.innerHTML = `<div class="pc-crm-head">${esc(header)}</div>${domainRows}`;
    panel.hidden = false;

    panel.querySelectorAll('[data-action="prep-pick-account"]').forEach((btn) => {
      btn.addEventListener("click", () => {
        const account = accounts.find((a) => a.id === btn.dataset.accountId);
        if (!account) return;
        prepCreateNewDeal = false;
        void applyAccount(account, (result.deals || []).filter((d) => d.accountId === account.id));
        panel.querySelectorAll(".pc-crm-account").forEach((el) => el.classList.remove("pc-crm-account--selected"));
        btn.classList.add("pc-crm-account--selected");
      });
    });
  }

  renderDealRow();
}

function scheduleLookup() {
  void showInstantAccountPreview();
  window.clearTimeout(lookupTimer);
  lookupTimer = window.setTimeout(() => {
    void renderCrmPanel();
  }, 320);
}

async function showInstantAccountPreview() {
  if (prepResolvedAccount) return;
  const emails = parseEmails(await readFieldValueAsync($("prospectEmail")));
  if (!emails.length) {
    $("prep-account-deal-grid") && ($("prep-account-deal-grid").hidden = true);
    return;
  }
  const domain = emails[0].split("@")[1]?.toLowerCase();
  if (!domain || isFreeMailDomain(domain)) return;
  const name = companyNameFromDomain(domain) || domain;
  renderAccountDealPreview(domain, name, false);
}

export function initPrepCrmResolve() {
  const emailField = $("prospectEmail");
  emailField?.addEventListener("fwInput", scheduleLookup);
  emailField?.addEventListener("input", scheduleLookup);

  $("prep-deal-select")?.addEventListener("fwChange", (ev) => {
    const val = ev.detail?.value || $("prep-deal-select")?.value;
    if (val === "__new__") {
      prepCreateNewDeal = true;
      prepSelectedDealId = null;
    } else {
      prepCreateNewDeal = false;
      prepSelectedDealId = val || null;
    }
    syncEngagementContext();
  });

  $("prep-deal-new-btn")?.addEventListener("click", () => {
    prepCreateNewDeal = true;
    prepSelectedDealId = null;
    const select = $("prep-deal-select");
    if (select) select.value = "__new__";
    syncEngagementContext();
  });
}
