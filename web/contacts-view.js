/**
 * "My contacts" — every contact across the accounts the SE is on, as tiles.
 */

import {
  listContactsForSession,
  historyPreviewContactsForSession,
} from "./domain/account-service.js?v=2.1";
import { getCachedAccountListRows } from "./domain/session-list-cache.js";
import { renderContactTileList, wireContactTiles } from "./contact-tile.js";

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

  const preview = historyPreviewContactsForSession(session);
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
