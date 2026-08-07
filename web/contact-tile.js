/**
 * Shared, self-contained contact tile rendering — used by the deal view and the
 * "My contacts" surface. Reuses the existing `.account-contact-*` / `.contact-meta-abbrev`
 * styles from lifecycle.css so tiles look identical to the account view's contact panel.
 */

import { esc } from "./shared.js";

function formatContactDate(ts) {
  const n = typeof ts === "number" ? ts : Date.parse(String(ts || ""));
  if (!Number.isFinite(n) || n <= 0) return null;
  return new Date(n).toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" });
}

/** Two-letter initials for a contact avatar. */
export function contactInitials(contact) {
  const n = String(contact?.name || contact?.email || "").trim();
  if (!n) return "?";
  const parts = n.split(/\s+/).filter(Boolean);
  if (parts.length >= 2) return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
  return n.slice(0, 2).toUpperCase();
}

/** DISC primary abbreviation badge. */
export function discAbbrev(contact) {
  const primary = contact?.metadata?.disc?.primary;
  if (primary && primary !== "unknown") {
    return `<span class="contact-meta-abbrev contact-meta-abbrev--disc" title="DISC ${esc(primary)}">${esc(primary)}</span>`;
  }
  return "";
}

/** Influence level abbreviation badge. */
export function influenceAbbrev(contact) {
  const level = contact?.metadata?.influence?.level;
  if (level && level !== "unknown") {
    const letter = level.charAt(0).toUpperCase();
    const full = level.charAt(0).toUpperCase() + level.slice(1);
    return `<span class="contact-meta-abbrev contact-meta-abbrev--influence contact-meta-abbrev--${esc(level)}" title="${esc(full)} influence">${esc(letter)}</span>`;
  }
  return "";
}

/** Primary-contact star. */
export function primaryContactMark(isPrimary) {
  if (!isPrimary) return "";
  return `<span class="contact-meta-abbrev contact-meta-abbrev--primary" title="Primary contact" aria-label="Primary contact">★</span>`;
}

/**
 * Render a single contact tile.
 * @param {object} contact
 * @param {{ isPrimary?: boolean, accountId?: string, accountName?: string, showAccount?: boolean }} [opts]
 */
export function renderContactTile(contact, opts = {}) {
  const name = contact?.name || contact?.email || "Contact";
  const sub = contact?.title || contact?.role || (contact?.name ? contact?.email : "");
  const accountId = opts.accountId || contact?.accountId || "";
  const badges = `${discAbbrev(contact)}${influenceAbbrev(contact)}${primaryContactMark(opts.isPrimary)}`;
  const accountLine =
    opts.showAccount && opts.accountName
      ? `<span class="contact-tile-account">${esc(opts.accountName)}</span>`
      : "";
  const createdLine = contact?.createdAt
    ? `<span class="contact-tile-created muted">Created ${esc(formatContactDate(contact.createdAt) || "-")}</span>`
    : "";
  return `<button type="button" class="account-contact-row account-contact-row--selectable contact-tile"
      data-action="open-contact-account" data-account-id="${esc(accountId)}" data-contact-id="${esc(contact?.id || "")}">
      <span class="account-contact-avatar account-contact-row-avatar">${esc(contactInitials(contact))}</span>
      <span class="account-contact-row-main">
        <span class="account-detail-contact-name">${esc(name)}</span>
        ${sub ? `<span class="account-contact-row-title">${esc(sub)}</span>` : ""}
        ${accountLine}
        ${createdLine}
      </span>
      <span class="account-contact-row-badges">${badges}</span>
    </button>`;
}

/**
 * Render a list of contact tiles (empty-state aware).
 * @param {object[]} contacts
 * @param {{ primaryContactId?: string|null, emptyText?: string, showAccount?: boolean,
 *           accountNameById?: Record<string,string> }} [opts]
 */
export function renderContactTileList(contacts, opts = {}) {
  const list = contacts || [];
  if (!list.length) {
    return `<p class="account-contact-empty muted">${esc(opts.emptyText || "No contacts yet.")}</p>`;
  }
  return `<div class="contact-tile-list">${list
    .map((c) =>
      renderContactTile(c, {
        isPrimary: !!opts.primaryContactId && c.id === opts.primaryContactId,
        accountId: c.accountId,
        accountName: opts.accountNameById ? opts.accountNameById[c.accountId] : undefined,
        showAccount: !!opts.showAccount,
      }),
    )
    .join("")}</div>`;
}

/**
 * Wire tile clicks to open the parent account.
 * @param {HTMLElement} container
 * @param {(accountId: string, contactId: string) => void} onOpen
 */
export function wireContactTiles(container, onOpen) {
  if (!container) return;
  container.querySelectorAll('[data-action="open-contact-account"]').forEach((btn) => {
    btn.addEventListener("click", () => {
      const accountId = btn.dataset.accountId;
      if (accountId) onOpen(accountId, btn.dataset.contactId || "");
    });
  });
}
