/**
 * Real-time account / deal lookup for the pre-call search form (mirrors post-call CRM surfacing).
 * Contacts are grouped by corporate email domain — one account per domain, not per contact.
 */

import {
  resolveContactsForEmails,
  resolveAccountsForCompany,
  enrichDealOwnerNames,
} from "./postcall-contact-resolve.js";
import {
  setAccountEngagementContext,
  clearAccountEngagementContext,
} from "./domain/account-context.js";
import { isFreeMailDomain } from "./domain/constants.js";
import { companyNameFromDomain, formatCompanyWebsiteDisplay, prepDomainUiState } from "./prep-domain.js";
import { formatDealTitlePreview, inferDealTypeFromTitle } from "./domain/deal-service.js";
import { renderAccountDealPreviewHtml } from "./account-deal-preview.js";
import { readFieldValueAsync, setFieldValue } from "./crayons-ui.js";
import { $ } from "./shared.js";

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
/** @type {string} */
let prepDraftNewDealTitle = "";
/** @type {'new_business'|'expansion'} */
let prepNewDealType = "new_business";
let prepFocusNewDealInput = false;
/** @type {object[]} */
let lastDeals = [];
/** @type {string|null} */
let prepDraftAccountName = null;
let prepAccountNameUserEdited = false;
let lookupTimer = 0;
let lookupToken = 0;
let previewToken = 0;
let prepDealsLoading = false;
/** @type {object[]} */
let prepAccountOptions = [];
/** @type {string|null} */
let prepAccountPickerDomain = null;
/** @type {{ accounts: object[], deals: object[] }} */
let lastCrmLookupResult = { accounts: [], deals: [] };
/** Skip redundant CRM re-lookups when full lookup context unchanged. */
let lastCrmLookupEmailKey = "";
let lastLookupContextKey = "";
let lastSuccessfulLookupContextKey = "";
/** @type {'idle'|'pending'|'resolved'} */
let prepCrmLookupState = "idle";

const LOOKUP_DEBOUNCE_MS = 180;

/** @param {string} emailKey */
export function buildLookupContextKey(emailKey, companyDomain, companyName) {
  return `${emailKey}|${normalizeDomain(companyDomain)}|${String(companyName || "").trim().toLowerCase()}`;
}

async function readLookupContextKey() {
  const ctx = await readCompanyLookupContext();
  const emails = parseEmails(await readFieldValueAsync($("prospectEmail")));
  return buildLookupContextKey(emails.join(","), ctx.companyDomain, ctx.companyName);
}

function clearMatchedCrmState() {
  prepSelectedDealId = null;
  prepCreateNewDeal = false;
  prepDraftNewDealTitle = "";
  lastDeals = [];
  prepDealsLoading = false;
  prepAccountOptions = [];
  prepAccountPickerDomain = null;
  prepCrmLookupState = "pending";
  previewToken = ++lookupToken;
  if (prepResolvedAccount?.id) {
    prepResolvedAccount = null;
  }
}

/** Immediate invalidation when email/domain context changes (exported for app.js domain autofill). */
export async function notifyPrepLookupInvalidate() {
  if (!prepIntakeVisible()) return;
  const key = await readLookupContextKey();
  if (key === lastLookupContextKey) return;
  lastLookupContextKey = key;
  clearMatchedCrmState();
  void showInstantAccountPreview();
}

export function onPrepLookupContextChanged() {
  void notifyPrepLookupInvalidate();
  scheduleLookupDebounced();
}

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

function dedupeAccounts(accounts) {
  const byId = new Map();
  for (const account of accounts || []) {
    if (account?.id && !byId.has(account.id)) byId.set(account.id, account);
  }
  return [...byId.values()];
}

/** When CRM returns Firestore + hist_* stub for the same company, keep one canonical row. */
function collapseSameCompanyAccounts(accounts) {
  const list = (accounts || []).filter((a) => a?.id);
  if (list.length <= 1) return list;
  const names = new Set(list.map((a) => String(a.name || "").trim().toLowerCase()).filter(Boolean));
  const domains = new Set(list.map((a) => String(a.domain || "").trim().toLowerCase()).filter(Boolean));
  const sameCompany = names.size <= 1 || domains.size <= 1;
  if (!sameCompany) return list;
  const firestore = list.filter((a) => !String(a.id).startsWith("hist_"));
  return [firestore[0] || list[0]];
}

function dedupeDeals(deals) {
  const byId = new Map();
  for (const deal of deals || []) {
    if (deal?.id && !byId.has(deal.id)) byId.set(deal.id, deal);
  }
  return [...byId.values()];
}

/**
 * Email-first CRM resolve with company/domain fallback (exported for tests).
 * @param {string[]} emails
 * @param {{ companyName?: string, companyDomain?: string }} [opts]
 */
export async function lookupPrepCrmMatches(emails, opts = {}) {
  const list = parseEmails(emails.join(", "));
  const empty = { accounts: [], deals: [], byEmail: [] };
  if (!list.length) return empty;

  const t0 = typeof performance !== "undefined" ? performance.now() : Date.now();
  let result = await resolveContactsForEmails(list);
  let accounts = dedupeAccounts(result.accounts);
  let deals = dedupeDeals(result.deals);

  const emailDomain = list[0]?.split("@")[1]?.toLowerCase() || null;
  const companyDomain = normalizeDomain(opts.companyDomain) || (emailDomain && !isFreeMailDomain(emailDomain) ? emailDomain : null);
  const companyName = String(opts.companyName || "").trim() || (companyDomain ? companyNameFromDomain(companyDomain) : "");

  if (!accounts.length && (companyName || companyDomain)) {
    try {
      const byCompany = await resolveAccountsForCompany(companyName, companyDomain || undefined);
      accounts = dedupeAccounts([...accounts, ...(byCompany.accounts || [])]);
      deals = dedupeDeals([...deals, ...(byCompany.deals || [])]);
    } catch {
      /* best-effort */
    }
  }

  const out = { accounts, deals, byEmail: result.byEmail || [] };
  if (typeof localStorage !== "undefined" && localStorage.getItem("DEBUG_PREP_CRM") === "1") {
    const ms = Math.round((typeof performance !== "undefined" ? performance.now() : Date.now()) - t0);
    console.log("[prep-crm] lookupPrepCrmMatches", { ms, accounts: out.accounts.length, deals: out.deals.length });
  }
  return out;
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
  return (prepDraftAccountName || prepResolvedAccount?.name || "").trim();
}

function syncNewDealTitlePrefill(accountName) {
  if (!prepCreateNewDeal && prepSelectedDealId) return;
  if (prepDraftNewDealTitle) return;
  prepDraftNewDealTitle = formatDealTitlePreview(accountName, prepNewDealType);
}

function hideAccountDealPreview() {
  const preview = $("prep-account-deal-preview");
  if (preview) {
    preview.hidden = true;
    preview.innerHTML = "";
  }
}

function hidePrepCrmMatchesPanel() {
  const panel = $("prep-crm-matches");
  if (panel) {
    panel.hidden = true;
    panel.innerHTML = "";
  }
}

/** @returns {{ id: null, name: string, domain: string|null }} */
export function buildDraftAccount(domain, name) {
  const displayName = name || companyNameFromDomain(domain) || domain || "Account";
  return {
    id: null,
    name: displayName,
    domain: normalizeDomain(domain) || domain || null,
  };
}

/** Stable draft account for new-domain previews (fixes post-lookup flicker). */
export function ensureDraftAccount(domain, name) {
  const want = normalizeDomain(domain);
  if (prepResolvedAccount?.id) {
    const have = normalizeDomain(prepResolvedAccount.domain);
    if (have && want && have === want) return;
    prepResolvedAccount = null;
  }
  prepResolvedAccount = buildDraftAccount(domain, name);
  if (!prepAccountNameUserEdited) prepDraftAccountName = prepResolvedAccount.name;
  // Wait for CRM lookup to confirm whether deals already exist before flagging new deal.
}

function prefetchedDealsForAccount(deals, accountId) {
  if (!accountId) return [];
  return dedupeDeals((deals || []).filter((d) => d.accountId === accountId));
}

/** @internal exported for unit tests */
export function pickPrefetchedDealsForAccount(deals, accountId) {
  return prefetchedDealsForAccount(deals, accountId);
}

/** @internal exported for unit tests */
export async function resolveDealsForAccount(account, prefetchedDeals, opts = {}) {
  const enrichOwners = opts.enrichOwners !== false;
  const filterDeals = (rows) =>
    enrichOwners ? enrichDealOwnerNames(rows) : Promise.resolve(rows);
  if (!account?.id) {
    return filterDeals(prefetchedDeals.filter((d) => !account || d.accountId === account?.id));
  }
  const cached = prefetchedDealsForAccount(prefetchedDeals, account.id);
  if (cached.length) {
    return filterDeals(cached);
  }
  const { listDealsForAccount } = await import("./domain/deal-service.js");
  return filterDeals(await listDealsForAccount(account.id));
}

/** Exported for test-prep-crm-domain-writeback.mjs — no other change in behavior. */
export async function applyAccount(account, deals = []) {
  const token = ++lookupToken;
  previewToken = token;
  const prevAccountId = prepResolvedAccount?.id || null;
  prepResolvedAccount = account
    ? { id: account.id, name: account.name, domain: account.domain || null }
    : null;
  if (!prepAccountNameUserEdited) {
    prepDraftAccountName = account?.name || prepDraftAccountName;
  }
  if (account?.id) {
    prepDealsLoading = true;
    prepCrmLookupState = "pending";
    renderPrepAccountDealPreview(token);
    if (token !== lookupToken) return;
    lastDeals = await resolveDealsForAccount(account, deals, { enrichOwners: false });
    prepDealsLoading = false;
    prepCrmLookupState = "resolved";
  } else {
    prepDealsLoading = false;
    prepCrmLookupState = "resolved";
    lastDeals = await enrichDealOwnerNames(
      deals.filter((d) => !account || d.accountId === account.id),
    );
  }
  if (token !== lookupToken) return;
  if (prevAccountId !== (account?.id || null)) {
    prepDraftNewDealTitle = "";
    prepNewDealType = "new_business";
  }
  if (account?.id && lastDeals.length) {
    if (prevAccountId !== account.id) {
      prepCreateNewDeal = false;
      if (lastDeals.length === 1) {
        prepSelectedDealId = lastDeals[0].id;
      } else if (!lastDeals.some((d) => d.id === prepSelectedDealId)) {
        prepSelectedDealId = lastDeals[0]?.id || null;
      }
    } else if (!prepCreateNewDeal) {
      if (lastDeals.length === 1) {
        prepSelectedDealId = lastDeals[0].id;
      } else if (!lastDeals.some((d) => d.id === prepSelectedDealId)) {
        prepSelectedDealId = lastDeals[0]?.id || null;
      }
    }
  } else if (lastDeals.length === 1 && !prepCreateNewDeal) {
    prepSelectedDealId = lastDeals[0].id;
  } else if (!lastDeals.some((d) => d.id === prepSelectedDealId)) {
    prepSelectedDealId = lastDeals[0]?.id || null;
  }
  if (account?.domain && !prepDomainUiState.userEdited) {
    const field = $("companyDomain");
    if (field) {
      const normalized = normalizeDomain(account.domain);
      const display = formatCompanyWebsiteDisplay(normalized);
      const current = String(field.value || "").trim();
      if (current !== display) {
        // field.value = x alone is a no-op on this fw-input build (see
        // prep-domain.js setDomainValue) — write the shadow-DOM control so
        // the CRM-resolved domain actually appears, and record it as an
        // auto value so the email-domain inferer doesn't treat it as a
        // manual edit and refuse to update the field on later keystrokes.
        void setFieldValue(field, display);
        field.dispatchEvent?.(new CustomEvent("fwInput", { bubbles: true, detail: { value: display } }));
        prepDomainUiState.lastAutoValue = normalized;
      }
    }
  }
  syncEngagementContext();
  renderPrepAccountDealPreview(token);
}

function renderAccountDealPreview(domain, accountName) {
  if (!$("prep-account-deal-preview")) return;
  ensureDraftAccount(domain, accountName);
  renderPrepAccountDealPreview();
}

function syncEngagementContext() {
  const ctx = {};
  if (prepResolvedAccount?.id) ctx.accountId = prepResolvedAccount.id;
  if (prepSelectedDealId && !prepCreateNewDeal) ctx.dealId = prepSelectedDealId;
  if (Object.keys(ctx).length) setAccountEngagementContext(ctx);
  else clearAccountEngagementContext();
}

export function getPrepCrmSelection() {
  const accountName = readAccountNameInput() || prepResolvedAccount?.name || null;
  return {
    accountId: prepResolvedAccount?.id || null,
    account: prepResolvedAccount,
    accountName,
    dealId: prepCreateNewDeal ? null : prepSelectedDealId,
    createNewDeal: prepCreateNewDeal,
    newDealTitle: prepCreateNewDeal ? prepDraftNewDealTitle.trim() || null : null,
    newDealType: prepCreateNewDeal ? prepNewDealType : null,
  };
}

export function resetPrepCrmSelection() {
  prepResolvedAccount = null;
  prepSelectedDealId = null;
  prepCreateNewDeal = false;
  prepDraftNewDealTitle = "";
  prepNewDealType = "new_business";
  prepFocusNewDealInput = false;
  lastDeals = [];
  prepDealsLoading = false;
  prepCrmLookupState = "idle";
  prepAccountOptions = [];
  prepAccountPickerDomain = null;
  lastCrmLookupEmailKey = "";
  lastLookupContextKey = "";
  lastSuccessfulLookupContextKey = "";
  lastCrmLookupResult = { accounts: [], deals: [] };
  prepDraftAccountName = null;
  prepAccountNameUserEdited = false;
}

/** Clear CRM UI after starting a fresh brief. */
export function resetPrepCrmUi() {
  resetPrepCrmSelection();
  clearAccountEngagementContext();
  previewToken = ++lookupToken;
  hidePrepCrmMatchesPanel();
  hideAccountDealPreview();
}

function focusAndSelectNewDealInput(previewEl) {
  const input = previewEl?.querySelector?.('[data-action="edit-new-deal-title"]');
  if (!input) return;
  requestAnimationFrame(() => {
    input.focus();
    input.select();
  });
}

function activateNewDealMode(previewEl, { focusInput = false } = {}) {
  const changed = !prepCreateNewDeal || prepSelectedDealId !== null;
  prepCreateNewDeal = true;
  prepSelectedDealId = null;
  if (focusInput) prepFocusNewDealInput = true;
  syncEngagementContext();
  if (changed) {
    renderPrepAccountDealPreview();
  } else if (focusInput && previewEl) {
    focusAndSelectNewDealInput(previewEl);
  }
}

function wirePrepAccountDealPreview(previewEl) {
  if (!previewEl) return;

  previewEl.querySelectorAll('[data-action="pick-deal"]').forEach((btn) => {
    btn.addEventListener("click", () => {
      prepSelectedDealId = btn.dataset.dealId || null;
      prepCreateNewDeal = false;
      prepFocusNewDealInput = false;
      syncEngagementContext();
      renderPrepAccountDealPreview();
    });
  });
  previewEl.querySelectorAll('[data-action="pick-new-deal"]').forEach((btn) => {
    btn.addEventListener("click", () => {
      syncNewDealTitlePrefill(readAccountNameInput());
      activateNewDealMode(previewEl, { focusInput: true });
    });
  });
  previewEl.querySelectorAll('[data-action="edit-new-deal-title"]').forEach((input) => {
    input.addEventListener("focus", () => {
      if (!prepCreateNewDeal || prepSelectedDealId !== null) {
        activateNewDealMode(previewEl, { focusInput: true });
      }
    });
    input.addEventListener("click", () => {
      if (prepCreateNewDeal) input.select();
    });
    input.addEventListener("input", () => {
      if (!prepCreateNewDeal || prepSelectedDealId !== null) {
        prepCreateNewDeal = true;
        prepSelectedDealId = null;
      }
      prepDraftNewDealTitle = input.value;
      prepNewDealType = inferDealTypeFromTitle(input.value);
      syncEngagementContext();
    });
    input.addEventListener("blur", () => {
      const trimmed = input.value.trim();
      if (trimmed) {
        prepDraftNewDealTitle = trimmed;
        prepNewDealType = inferDealTypeFromTitle(trimmed);
      }
    });
  });
  previewEl.querySelectorAll('[data-action="prep-pick-account"]').forEach((btn) => {
    btn.addEventListener("click", () => {
      const account = prepAccountOptions.find((a) => a.id === btn.dataset.accountId);
      if (!account) return;
      prepCreateNewDeal = false;
      const deals = (lastCrmLookupResult.deals || []).filter((d) => d.accountId === account.id);
      void applyAccount(account, deals);
    });
  });
}

function renderPrepAccountDealPreview(expectedToken) {
  const preview = $("prep-account-deal-preview");
  if (!preview) return;
  const token = expectedToken ?? previewToken;
  if (token !== previewToken) return;

  const showAccountPicker =
    prepAccountOptions.length > 1 && !prepResolvedAccount?.id;

  if (showAccountPicker) {
    preview.hidden = false;
    preview.innerHTML = renderAccountDealPreviewHtml({
      accountName: "",
      accountMatched: false,
      accountOptions: prepAccountOptions,
      selectedAccountId: prepResolvedAccount?.id || null,
      accountPickerDomain: prepAccountPickerDomain,
      deals: [],
      editableAccount: false,
    });
    wirePrepAccountDealPreview(preview);
    if (typeof window !== "undefined") window.__logPrecallDeploy?.();
    return;
  }

  if (!prepResolvedAccount) {
    hideAccountDealPreview();
    return;
  }

  const accountName = readAccountNameInput() || prepResolvedAccount.name || prepResolvedAccount.domain || "Account";
  const accountMatched = !!prepResolvedAccount.id;
  syncNewDealTitlePrefill(accountName);

  preview.hidden = false;
  preview.innerHTML = renderAccountDealPreviewHtml({
    accountName,
    accountMatched,
    lookupPending: !accountMatched && prepCrmLookupState !== "resolved",
    deals: lastDeals,
    selectedDealId: prepSelectedDealId,
    createNewDeal: prepCreateNewDeal,
    newDealType: prepNewDealType,
    newDealTitle: prepDraftNewDealTitle,
    editableAccount: false,
    dealsLoading: prepDealsLoading,
  });
  wirePrepAccountDealPreview(preview);
  if (prepFocusNewDealInput && prepCreateNewDeal) {
    prepFocusNewDealInput = false;
    focusAndSelectNewDealInput(preview);
  }
  if (typeof window !== "undefined") window.__logPrecallDeploy?.();
}

async function readCompanyLookupContext() {
  const companyDomain = normalizeDomain(await readFieldValueAsync($("companyDomain")));
  const accountName = readAccountNameInput();
  const emails = parseEmails(await readFieldValueAsync($("prospectEmail")));
  const emailDomain = emails[0]?.split("@")[1]?.toLowerCase() || null;
  const domain =
    companyDomain || (emailDomain && !isFreeMailDomain(emailDomain) ? emailDomain : null);
  const companyName =
    accountName ||
    (domain ? companyNameFromDomain(domain) : "") ||
    (emailDomain && !isFreeMailDomain(emailDomain) ? companyNameFromDomain(emailDomain) : "");
  return { companyName, companyDomain: domain };
}

async function renderCrmPanel() {
  const emails = parseEmails(await readFieldValueAsync($("prospectEmail")));
  if (!emails.length) {
    resetPrepCrmSelection();
    hidePrepCrmMatchesPanel();
    hideAccountDealPreview();
    return;
  }

  const ctxEarly = await readCompanyLookupContext();
  const emailKey = emails.join(",");
  const contextKey = buildLookupContextKey(emailKey, ctxEarly.companyDomain, ctxEarly.companyName);
  if (
    contextKey === lastSuccessfulLookupContextKey &&
    prepResolvedAccount?.id &&
    lastDeals.length > 0 &&
    !prepDealsLoading &&
    prepCrmLookupState === "resolved"
  ) {
    return;
  }
  lastCrmLookupEmailKey = emailKey;
  lastLookupContextKey = contextKey;

  const seq = ++lookupToken;
  previewToken = seq;
  prepCrmLookupState = "pending";
  renderPrepAccountDealPreview(seq);
  let result;
  try {
    const ctx = await readCompanyLookupContext();
    result = await lookupPrepCrmMatches(emails, ctx);
  } catch (err) {
    console.warn("[prep] CRM lookup failed:", err?.message || err);
    prepCrmLookupState = "idle";
    hidePrepCrmMatchesPanel();
    if (prepResolvedAccount && !prepResolvedAccount.id) {
      renderPrepAccountDealPreview(seq);
    } else {
      hideAccountDealPreview();
    }
    return;
  }
  if (seq !== lookupToken) return;

  lastCrmLookupResult = result;
  const accounts = result.accounts || [];
  const domainGroups = groupByDomain(result.byEmail || []);
  const primaryGroup = domainGroups.find((g) => g.domain) || domainGroups[0];
  const groupAccountsRaw = dedupeAccounts([...accounts, ...(primaryGroup?.accounts || [])]);
  const groupAccounts =
    groupAccountsRaw.length > 1 ? collapseSameCompanyAccounts(groupAccountsRaw) : groupAccountsRaw;
  const defaultName = resolveDefaultAccountName(primaryGroup?.domain, groupAccounts);
  if (!prepAccountNameUserEdited) prepDraftAccountName = defaultName;

  prepAccountOptions = groupAccounts.length > 1 ? groupAccounts : [];
  prepAccountPickerDomain = primaryGroup?.domain || null;

  if (groupAccounts.length === 1) {
    prepAccountOptions = [];
    const sole = groupAccounts[0];
    if (prepResolvedAccount?.id === sole.id && lastDeals.length > 0) {
      renderPrepAccountDealPreview(seq);
    } else {
      await applyAccount(sole, result.deals || []);
    }
  } else if (groupAccounts.length > 1) {
    prepSelectedDealId = null;
    prepCreateNewDeal = false;
    lastDeals = [];
    if (prepResolvedAccount?.id && groupAccounts.some((a) => a.id === prepResolvedAccount.id)) {
      await applyAccount(
        prepResolvedAccount,
        (result.deals || []).filter((d) => d.accountId === prepResolvedAccount.id),
      );
    } else {
      prepResolvedAccount = null;
      renderPrepAccountDealPreview(seq);
    }
  } else if (primaryGroup?.domain && !prepResolvedAccount?.id) {
    prepAccountOptions = [];
    ensureDraftAccount(primaryGroup.domain, defaultName);
    prepCrmLookupState = "resolved";
    renderPrepAccountDealPreview(seq);
  } else if (!primaryGroup?.domain && !prepResolvedAccount?.id) {
    prepAccountOptions = [];
    prepResolvedAccount = null;
    hideAccountDealPreview();
  } else {
    renderPrepAccountDealPreview(seq);
  }

  hidePrepCrmMatchesPanel();
  lastSuccessfulLookupContextKey = contextKey;
}

function prepIntakeVisible() {
  const view = $("view-precall");
  return !!(view && !view.hidden);
}

function scheduleLookupDebounced() {
  if (!prepIntakeVisible()) return;
  window.clearTimeout(lookupTimer);
  lookupTimer = window.setTimeout(() => {
    void renderCrmPanel();
  }, LOOKUP_DEBOUNCE_MS);
}

function scheduleLookup() {
  if (!prepIntakeVisible()) return;
  void notifyPrepLookupInvalidate();
  scheduleLookupDebounced();
}

async function showInstantAccountPreview() {
  if (prepAccountOptions.length > 1) return;
  const seq = ++previewToken;
  prepCrmLookupState = "pending";
  const emails = parseEmails(await readFieldValueAsync($("prospectEmail")));
  if (seq !== previewToken) return;
  if (prepResolvedAccount?.id) return;
  if (!emails.length) {
    hideAccountDealPreview();
    return;
  }
  const ctx = await readCompanyLookupContext();
  const domain =
    ctx.companyDomain ||
    emails[0]?.split("@")[1]?.toLowerCase() ||
    null;
  if (!domain || isFreeMailDomain(domain)) {
    if (!prepResolvedAccount?.id) prepResolvedAccount = null;
    hideAccountDealPreview();
    return;
  }
  if (seq !== previewToken) return;
  if (prepResolvedAccount?.id) {
    const accDom = normalizeDomain(prepResolvedAccount.domain);
    const wantDom = normalizeDomain(domain);
    if (accDom && wantDom && accDom === wantDom) return;
    prepResolvedAccount = null;
  }
  const name = ctx.companyName || companyNameFromDomain(domain) || domain;
  renderAccountDealPreview(domain, name);
}

export function initPrepCrmResolve() {
  const emailField = $("prospectEmail");
  emailField?.addEventListener("fwInput", scheduleLookup);
  emailField?.addEventListener("input", scheduleLookup);

  $("companyDomain")?.addEventListener("fwInput", scheduleLookup);
  $("companyDomain")?.addEventListener("input", scheduleLookup);
}
