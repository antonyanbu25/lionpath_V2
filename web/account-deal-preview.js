/**
 * Shared account + deal tile picker (pre-call and post-call intake).
 */

import { esc } from "./shared.js";
import { titleCaseDisplayName } from "./shared.js";
import { STAGE_LABELS } from "./domain/types.js";
import { formatDealTitlePreview } from "./domain/deal-service.js";
import { companyMono } from "./precall-render.js?v=2.1.14";

/**
 * @param {object} d
 * @param {boolean} selected
 * @param {number} [index] 0-based deal index for "Deal N · existing"
 */
export function renderDealTile(d, selected, index = 0) {
  const stage = STAGE_LABELS[d.stage] || d.stage || d.status || "Active";
  const owner = d.ownerName || d.ownerDisplayName || null;
  const existingLine = owner
    ? `Deal ${index + 1} · existing (owner: ${owner})`
    : `Deal ${index + 1} · existing`;
  const meta = d.id ? existingLine : stage;
  return `<button type="button" class="nb-deal-card pc-deal-tile${selected ? " is-selected" : ""}" data-action="pick-deal" data-deal-id="${esc(d.id)}">
      <span class="nb-deal-card-icon" aria-hidden="true">◆</span>
      <div class="nb-deal-card-body">
        <span class="nb-deal-card-title">${esc(titleCaseDisplayName(d.title || "Deal"))}</span>
        <span class="nb-deal-card-stage">${esc(meta)}</span>
      </div>
    </button>`;
}

export function renderStaticDealCard(title, stage) {
  return `<div class="nb-deal-card pc-deal-tile pc-deal-tile--static">
      <span class="nb-deal-card-icon" aria-hidden="true">◆</span>
      <div class="nb-deal-card-body">
        <span class="nb-deal-card-title">${esc(title)}</span>
        <span class="nb-deal-card-stage">${esc(stage)}</span>
      </div>
    </div>`;
}

export function renderNewDealEditor(displayName, newDealType, newDealTitle, selected = true) {
  const title = newDealTitle || formatDealTitlePreview(displayName, newDealType);
  return `<div class="pc-new-deal-field${selected ? " is-selected" : ""}">
      <input type="text" class="pc-new-deal-title-input" data-action="edit-new-deal-title"
        value="${esc(title)}" placeholder="${esc(formatDealTitlePreview(displayName, newDealType))}"
        autocomplete="off" aria-label="New deal name" />
      <span class="pc-new-deal-hint muted">Create on confirm</span>
    </div>`;
}

/**
 * @param {{
 *   accountName: string,
 *   accountMatched: boolean,
 *   deals?: object[],
 *   selectedDealId?: string|null,
 *   createNewDeal?: boolean,
 *   newDealType?: 'new_business'|'expansion',
 *   newDealTitle?: string,
 *   editableAccount?: boolean,
 * }} opts
 */
export function renderAccountDealPreviewHtml(opts) {
  const {
    accountName,
    accountMatched,
    deals = [],
    selectedDealId = null,
    createNewDeal = false,
    newDealType = "new_business",
    newDealTitle = "",
    editableAccount = true,
  } = opts;

  const displayName = titleCaseDisplayName(accountName) || "Account";
  const hasExistingDeals = deals.length > 0;
  const accountBadge =
    accountMatched || hasExistingDeals ? "Account matched · existing" : "New account · on confirm";
  const showNewDealLink = accountMatched || hasExistingDeals;
  const dealHead = `<div class="nb-deal-head">
      <span class="nb-label">Deal</span>
      ${showNewDealLink ? `<button type="button" class="nb-deal-new-link${createNewDeal ? " is-active" : ""}" data-action="pick-new-deal">＋ New deal</button>` : ""}
    </div>`;

  let dealTilesHtml = "";
  if (!accountMatched && !hasExistingDeals) {
    const title = newDealTitle || formatDealTitlePreview(displayName, newDealType);
    dealTilesHtml = renderStaticDealCard(title, "Create on confirm");
  } else if (!deals.length) {
    const defaultTitle = newDealTitle || formatDealTitlePreview(displayName, newDealType);
    dealTilesHtml = createNewDeal
      ? renderNewDealEditor(displayName, newDealType, defaultTitle)
      : renderStaticDealCard(defaultTitle, "Create on confirm");
  } else if (createNewDeal) {
    dealTilesHtml = deals.map((d, i) => renderDealTile(d, false, i)).join("");
    dealTilesHtml += renderNewDealEditor(
      displayName,
      newDealType,
      newDealTitle || formatDealTitlePreview(displayName, newDealType),
    );
  } else {
    dealTilesHtml = deals.map((d, i) => renderDealTile(d, selectedDealId === d.id, i)).join("");
  }

  const accountBody = editableAccount
    ? `<div class="pc-account-name-wrap pc-lookup-field">
          <input type="text" class="pc-account-name-input" data-action="edit-account-name"
            value="${esc(displayName)}" placeholder="Account name" autocomplete="off" aria-label="Account name" />
          <div class="pc-account-suggest pc-lookup-menu" role="listbox" hidden></div>
        </div>`
    : `<span class="nb-account-card-name">${esc(displayName)}</span>`;

  return `<div class="nb-account-column">
    <span class="nb-label">Account</span>
    <div class="nb-account-slot">
      <div class="nb-account-card prep-account-card${editableAccount ? " pc-account-card-editable" : ""}" aria-live="polite">
        <span class="nb-account-card-mono">${esc(companyMono(displayName))}</span>
        <div class="nb-account-card-body">
          ${accountBody}
          <span class="nb-account-card-badge">${esc(accountBadge)}</span>
        </div>
      </div>
    </div>
  </div>
  <div class="nb-deal-slot pc-deal-showcase">
    ${dealHead}
    <div class="pc-deal-tiles-row">${dealTilesHtml}</div>
  </div>`;
}
