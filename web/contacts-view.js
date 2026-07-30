/**
 * "My contacts" — every contact across the accounts the SE is on, as tiles.
 * Contact is the primary identifier; each tile opens its parent account.
 */

import { listContactsForSession } from "./domain/account-service.js";
import { renderContactTileList, wireContactTiles } from "./contact-tile.js";
import { esc } from "./shared.js";

/**
 * @param {HTMLElement} container
 * @param {object} session
 * @param {{ onOpenAccount?: (accountId: string, contactId?: string) => void }} [opts]
 */
export async function renderContactsView(container, session, opts = {}) {
  if (!container) return;
  container.innerHTML = `<div class="contacts-view-loading muted">Loading contacts…</div>`;

  let contacts = [];
  let accountNameById = {};
  try {
    const res = await listContactsForSession(session);
    contacts = res.contacts;
    accountNameById = res.accountNameById;
  } catch (err) {
    console.warn("[contacts-view] load failed:", err?.message || err);
  }

  const count = contacts.length;
  container.innerHTML = `
    <section class="contacts-view">
      <header class="contacts-view-head">
        <h2 class="contacts-view-title">My contacts</h2>
        <p class="muted">${count} contact${count === 1 ? "" : "s"} across your accounts. The people you've entered on calls and briefs.</p>
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
