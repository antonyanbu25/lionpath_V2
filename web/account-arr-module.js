/**
 * Account record ARR module + add-on attach matrix (ADDON_ARR §6, task 2.8).
 */

import { esc } from "./shared.js";
import { displayMrrFromArr, formatUsd } from "./deal-arr-module.js";
import {
  ADDON_LABELS,
  ATTACH_MATRIX_ADDON_KEYS,
  formatProductLabel,
} from "./domain/account-arr-service.js";
import { DEAL_TYPE_LABELS } from "./domain/deal-service.js";

const SESSIONS_ADDON = "freddy_ai_agent_sessions";

/** @param {number|null|undefined} amount @param {"ARR"|"MRR"} unit */
function formatMoney(amount, unit = "ARR") {
  if (amount == null || !Number.isFinite(amount)) return "-";
  const value = unit === "MRR" ? displayMrrFromArr(amount) : amount;
  return `${formatUsd(value)} ${unit}`;
}

/** @param {number|null|undefined} low @param {number|null|undefined} high */
function formatCompactBand(low, high) {
  if (low == null && high == null) return "-";
  const fmt = (n) => {
    if (n == null) return "-";
    if (n >= 1_000_000) return `$${Math.round(n / 1_000_000)}M`;
    if (n >= 1000) return `$${Math.round(n / 1000)}K`;
    return formatUsd(n);
  };
  if (low != null && high != null && low !== high) return `${fmt(low)}–${fmt(high)}`;
  return fmt(high ?? low);
}

/** @param {{ state: string, line?: object|null }} cell @param {string|null} allowanceDealId @param {string} dealId @param {string} addonKey */
function renderMatrixCell(cell, allowanceDealId, dealId, addonKey) {
  const { state, line } = cell || { state: "absent" };
  if (state === "attached") {
    const qty =
      line?.quantity != null
        ? addonKey === SESSIONS_ADDON
          ? `${line.quantity}/mo`
          : `${line.quantity}`
        : "";
    const money = line?.annualValue > 0 ? formatMoney(line.annualValue, "ARR") : "✓";
    return `<span class="account-attach-cell account-attach-cell--attached" title="${esc(qty ? `${qty} · ${money}` : money)}">${esc(money)}</span>`;
  }
  if (state === "discussed") {
    return `<span class="account-attach-cell account-attach-cell--discussed" title="Discussed. not quantified">…</span>`;
  }
  if (addonKey === SESSIONS_ADDON && allowanceDealId && allowanceDealId !== dealId) {
    return `<span class="account-attach-cell account-attach-cell--no-allowance muted" title="500-session allowance applied to another deal on this account">no free tier</span>`;
  }
  return `<span class="account-attach-cell account-attach-cell--absent muted">-</span>`;
}

/**
 * @param {object} rollup from buildAccountArrRollup
 * @param {object} [opts]
 */
export function renderAccountArrModule(rollup, opts = {}) {
  const wireSidebar = opts.wireframeSidebar === true;
  const cardClass = wireSidebar ? " account-record-section--card account-record-section--tight account-arr-module--wireframe-sidebar" : "";

  if (!rollup) {
    return `
      <section class="account-record-section account-arr-module account-arr-module--empty${cardClass}">
        ${
          wireSidebar
            ? `<p class="prep-form-eyebrow account-section-eyebrow">ARR derivation</p>`
            : `<h3 class="account-record-section-title">Account ARR</h3>`
        }
        <p class="muted">Run post-call on a deal to derive account totals and the add-on attach matrix.</p>
      </section>`;
  }

  const { attachMatrix, allowanceConsumerDealId } = rollup;
  const deals = attachMatrix?.deals || [];
  const displayUnit = opts.displayUnit === "MRR" ? "MRR" : "ARR";
  const totalPrimary = displayUnit === "MRR" ? rollup.totalMrr : rollup.totalArr;
  const basePrimary = displayUnit === "MRR" ? rollup.baseMrr : rollup.baseArr;
  const addonPrimary = displayUnit === "MRR" ? rollup.addonMrr : rollup.addonArr;
  const band = rollup.estimateBand;

  const totalsBlock = wireSidebar
    ? `
    <div class="account-arr-derivation">
      <div class="account-arr-derivation-row">
        <span class="muted">Account total</span>
        <span>${esc(formatMoney(totalPrimary, displayUnit))}</span>
      </div>
      <div class="account-arr-derivation-row">
        <span class="muted">Base</span>
        <span>${esc(formatMoney(basePrimary, displayUnit))}</span>
      </div>
      <div class="account-arr-derivation-row">
        <span class="muted">Add-ons</span>
        <span>${esc(formatMoney(addonPrimary, displayUnit))}</span>
      </div>
      ${
        band
          ? `<div class="account-arr-derivation-row account-arr-derivation-row--total">
        <span>Point estimate</span>
        <span>${esc(formatMoney(band.point, displayUnit))}</span>
      </div>
      <div class="account-arr-derivation-row">
        <span class="muted">Band ±30%</span>
        <span>${esc(formatCompactBand(band.low, band.high))}</span>
      </div>`
          : ""
      }
    </div>`
    : `
    <div class="account-arr-totals">
      <div class="account-arr-total-primary">
        <span class="account-arr-total-value">${esc(formatMoney(totalPrimary, displayUnit))}</span>
        <span class="account-arr-total-label muted">account total · ${esc(displayUnit)}</span>
      </div>
      ${band ? `<div class="account-arr-band muted">Band ${esc(formatCompactBand(band.low, band.high))} · estimate</div>` : ""}
      <div class="account-arr-split">
        <div><span class="muted">Base</span> <strong>${esc(formatMoney(basePrimary, displayUnit))}</strong></div>
        <div><span class="muted">Add-ons</span> <strong>${esc(formatMoney(addonPrimary, displayUnit))}</strong></div>
      </div>
      ${
        rollup.addonShare != null
          ? `<p class="account-arr-share muted">${esc(rollup.addonShare.toFixed(1).replace(/\.0$/, ""))}% of account ARR is add-ons</p>`
          : ""
      }
    </div>`;

  const matrixRows = ATTACH_MATRIX_ADDON_KEYS.map((addonKey) => {
    const hasAny = deals.some((d) => {
      const cell = attachMatrix.cells[addonKey]?.[d.id];
      return cell && cell.state !== "absent";
    });
    if (!hasAny && addonKey !== "freddy_ai_copilot" && addonKey !== SESSIONS_ADDON) return "";

    const cells = deals
      .map((deal) => {
        const cell = attachMatrix.cells[addonKey]?.[deal.id] || { state: "absent" };
        return `<td class="account-attach-matrix-col">${renderMatrixCell(cell, allowanceConsumerDealId, deal.id, addonKey)}</td>`;
      })
      .join("");

    return `
      <tr>
        <th scope="row" class="account-attach-matrix-addon">${esc(ADDON_LABELS[addonKey] || addonKey)}</th>
        ${cells}
      </tr>`;
  }).filter(Boolean);

  const dealHeaders = deals
    .map((deal) => {
      const title = deal.title || DEAL_TYPE_LABELS[deal.type] || "Deal";
      const short = title.length > 18 ? `${title.slice(0, 16)}…` : title;
      return `<th scope="col" class="account-attach-matrix-deal" title="${esc(title)}">${esc(short)}</th>`;
    })
    .join("");

  const matrixBlock =
    deals.length && matrixRows.length
      ? `
    <div class="account-attach-matrix-wrap">
      <h4 class="account-attach-matrix-title">Add-on attach matrix</h4>
      <p class="muted account-attach-matrix-hint">Add-ons down, deals across. cross-sell only visible at account level.</p>
      <table class="account-attach-matrix">
        <thead>
          <tr>
            <th scope="col" class="account-attach-matrix-corner">Add-on</th>
            ${dealHeaders}
          </tr>
        </thead>
        <tbody>${matrixRows.join("")}</tbody>
      </table>
    </div>`
      : `<p class="muted account-attach-matrix-empty">No add-on lines yet. attach states appear after post-call ARR compute.</p>`;

  const allowanceNote =
    allowanceConsumerDealId && deals.length > 1
      ? `<p class="account-arr-allowance-note muted">500-session account allowance consumed by <strong>${esc(dealLabel(deals, allowanceConsumerDealId))}</strong>. other deals bill from session one.</p>`
      : "";

  const crossSellRows = (rollup.crossSellGaps || [])
    .map((gap) => {
      const attached = gap.attachedDealIds.map((id) => dealLabel(deals, id)).join(", ");
      const missing = gap.absentDealIds.map((id) => dealLabel(deals, id)).join(", ");
      return `<li><strong>${esc(gap.label)}</strong> on ${esc(attached)}. absent from ${esc(missing)}</li>`;
    })
    .join("");

  const crossSellBlock =
    crossSellRows
      ? `<div class="account-arr-cross-sell"><h4 class="account-arr-subtitle">Cross-sell gaps</h4><ul class="account-arr-cross-sell-list">${crossSellRows}</ul></div>`
      : "";

  const unquantRows = (rollup.discussedUnquantified || [])
    .map(
      (item) =>
        `<li><strong>${esc(item.label)}</strong> on ${esc(dealLabel(deals, item.dealId))}${item.evidence ? `. <span class="muted">"${esc(item.evidence)}"</span>` : ""}</li>`,
    )
    .join("");

  const unquantBlock =
    unquantRows
      ? `<div class="account-arr-unquantified"><h4 class="account-arr-subtitle">Discussed, never quantified</h4><ul class="account-arr-unquantified-list">${unquantRows}</ul></div>`
      : "";

  return `
    <section class="account-record-section account-arr-module${cardClass}">
      ${
        wireSidebar
          ? `<p class="prep-form-eyebrow account-section-eyebrow">ARR derivation</p>`
          : `<h3 class="account-record-section-title">Account ARR</h3>`
      }
      ${totalsBlock}
      ${matrixBlock}
      ${allowanceNote}
      ${crossSellBlock}
      ${unquantBlock}
    </section>`;
}

/** @param {object[]} deals @param {string} dealId */
function dealLabel(deals, dealId) {
  const deal = deals.find((d) => d.id === dealId);
  if (!deal) return dealId;
  return deal.title || DEAL_TYPE_LABELS[deal.type] || "Deal";
}

export { formatProductLabel };
