/**
 * Real-time account / deal lookup for the pre-call search form (mirrors post-call CRM surfacing).
 */

import { resolveContactsForEmails } from "./postcall-contact-resolve.js";
import { setAccountEngagementContext } from "./domain/account-context.js";
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
let lookupTimer = 0;
let lookupToken = 0;

function parseEmails(raw) {
  return String(raw || "")
    .split(/[,;\s]+/)
    .map((e) => e.trim().toLowerCase())
    .filter((e) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(e));
}

function syncEngagementContext() {
  const ctx = {};
  if (prepResolvedAccount?.id) ctx.accountId = prepResolvedAccount.id;
  if (prepSelectedDealId && !prepCreateNewDeal) ctx.dealId = prepSelectedDealId;
  if (Object.keys(ctx).length) setAccountEngagementContext(ctx);
}

export function getPrepCrmSelection() {
  return {
    accountId: prepResolvedAccount?.id || null,
    account: prepResolvedAccount,
    dealId: prepCreateNewDeal ? null : prepSelectedDealId,
    createNewDeal: prepCreateNewDeal,
  };
}

export function resetPrepCrmSelection() {
  prepResolvedAccount = null;
  prepSelectedDealId = null;
  prepCreateNewDeal = false;
  lastDeals = [];
}

async function applyAccount(account, deals = []) {
  prepResolvedAccount = account
    ? { id: account.id, name: account.name, domain: account.domain || null }
    : null;
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
}

function renderDealRow() {
  const row = $("prep-deal-row");
  const select = $("prep-deal-select");
  const accountCard = $("prep-account-card");
  if (!row || !select) return;

  if (!prepResolvedAccount) {
    row.hidden = true;
    if (accountCard) accountCard.hidden = true;
    return;
  }

  if (accountCard) {
    accountCard.hidden = false;
    accountCard.innerHTML = `<div class="prep-account-chip">
      <span class="prep-account-chip-mono">${esc(String(prepResolvedAccount.name || prepResolvedAccount.domain || "AC").slice(0, 2).toUpperCase())}</span>
      <div class="prep-account-chip-body">
        <span class="prep-account-chip-name">${esc(prepResolvedAccount.name || prepResolvedAccount.domain || "Account")}</span>
        ${prepResolvedAccount.domain ? `<span class="prep-account-chip-domain muted">${esc(prepResolvedAccount.domain)}</span>` : ""}
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

  row.hidden = false;
}

async function renderCrmPanel() {
  const panel = $("prep-crm-matches");
  if (!panel) return;
  const emails = parseEmails(await readFieldValueAsync($("prospectEmail")));
  if (!emails.length) {
    panel.hidden = true;
    panel.innerHTML = "";
    if (!prepResolvedAccount) {
      $("prep-deal-row") && ($("prep-deal-row").hidden = true);
      $("prep-account-card") && ($("prep-account-card").hidden = true);
    }
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
  if (accounts.length === 1) {
    await applyAccount(accounts[0], result.deals || []);
  } else if (accounts.length > 1 && !prepResolvedAccount) {
    prepSelectedDealId = null;
    prepCreateNewDeal = false;
  }

  const rows = result.byEmail
    .map((entry) => {
      const accountChips = entry.accounts
        .map((a) => {
          const selected = prepResolvedAccount?.id === a.id ? " prep-crm-account--selected" : "";
          return `<button type="button" class="pc-crm-account${selected}" data-action="prep-pick-account" data-account-id="${esc(a.id)}">
            <span class="pc-crm-account-name">${esc(a.name || a.domain || "Account")}</span>
          </button>`;
        })
        .join("");
      const status = entry.matched
        ? accountChips
        : `<span class="pc-crm-new">New account will be created</span>`;
      return `<div class="pc-crm-row">
        <span class="pc-crm-email">${esc(entry.email)}</span>
        <span class="pc-crm-matchset">${status}</span>
      </div>`;
    })
    .join("");

  const header = accounts.length
    ? `Linked account${accounts.length === 1 ? "" : "s"} found — select or confirm below`
    : "No account yet — one will be created when you generate the brief";

  panel.innerHTML = `<div class="pc-crm-head">${esc(header)}</div>${rows}`;
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

  renderDealRow();
}

function scheduleLookup() {
  window.clearTimeout(lookupTimer);
  lookupTimer = window.setTimeout(() => {
    void renderCrmPanel();
  }, 320);
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
