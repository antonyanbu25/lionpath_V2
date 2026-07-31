/**
 * "My contacts" — every contact across the accounts the SE is on, as tiles.
 */

import { listContactsForSession } from "./domain/account-service.js";
import { getCachedAccountListRows } from "./domain/session-list-cache.js";
import { listPostCallAnalyses } from "./history.js";
import { loadLocalBriefs } from "./precall.js";
import { renderContactTileList, wireContactTiles } from "./contact-tile.js";
import { esc, normalizeUserEmail } from "./shared.js";

/** @param {object} session */
function contactsPreviewFromHistory(session) {
  const email = normalizeUserEmail(session?.email);
  if (!email) return { contacts: [], accountNameById: {} };
  const seen = new Set();
  const contacts = [];
  const accountNameById = {};

  const addContact = (addr, company) => {
    const e = String(addr || "").trim().toLowerCase();
    if (!e || seen.has(e)) return;
    seen.add(e);
    const name = e.split("@")[0].replace(/[._-]+/g, " ");
    const accountKey = String(company || e.split("@")[1] || "Contact").trim();
    const accountId = `hist_${accountKey.toLowerCase().replace(/[^a-z0-9]+/g, "-").slice(0, 40)}`;
    accountNameById[accountId] = accountKey;
    contacts.push({
      id: `hist_${e}`,
      email: e,
      name: name.charAt(0).toUpperCase() + name.slice(1),
      accountId,
      _preview: true,
    });
  };

  for (const brief of loadLocalBriefs()) {
    const company = brief.company || brief.meta?.company || "";
    for (const addr of brief.meta?.prospectEmails || []) addContact(addr, company);
  }
  for (const rec of listPostCallAnalyses(email)) {
    const company = rec.company || rec.result?.company || "";
    for (const addr of rec.prospectEmails || rec.result?.prospectEmails || []) addContact(addr, company);
  }

  contacts.sort((a, b) => String(a.name).localeCompare(String(b.name)));
  return { contacts, accountNameById };
}

function paintContacts(container, contacts, accountNameById, opts, preview = false) {
  const count = contacts.length;
  container.innerHTML = `
    <section class="contacts-view">
      <header class="contacts-view-head">
        <h2 class="contacts-view-title">My contacts</h2>
        <p class="muted">${count} contact${count === 1 ? "" : "s"} across your accounts.${preview ? " Updating…" : ""}</p>
      </header>
      <div id="contacts-view-list">
        ${renderContactTileList(contacts, {
          showAccount: true,
          accountNameById,
          emptyText: "No contacts yet. They appear here after you enter prospect emails on a call or brief.",
        })}
      </div>
    </section>`;
  wireContactTiles(container, (accountId, contactId) => {
    if (opts.onOpenAccount) opts.onOpenAccount(accountId, contactId);
  });
}

/**
 * @param {HTMLElement} container
 * @param {object} session
 * @param {{ onOpenAccount?: (accountId: string, contactId?: string) => void, shouldApply?: () => boolean }} [opts]
 */
export async function renderContactsView(container, session, opts = {}) {
  if (!container) return;

  if (getCachedAccountListRows(session)) {
    /* warm path — accounts already cached from deals/accounts nav */
  }

  const preview = contactsPreviewFromHistory(session);
  if (preview.contacts.length) {
    paintContacts(container, preview.contacts, preview.accountNameById, opts, true);
  } else {
    container.innerHTML = `<div class="contacts-view-loading muted">Loading contacts…</div>`;
  }

  let contacts = [];
  let accountNameById = {};
  try {
    const res = await listContactsForSession(session);
    contacts = res.contacts;
    accountNameById = res.accountNameById;
  } catch (err) {
    console.warn("[contacts-view] load failed:", err?.message || err);
  }

  if (opts.shouldApply && !opts.shouldApply()) return;
  paintContacts(container, contacts, accountNameById, opts, false);
}
