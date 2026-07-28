/**
 * Deal record ARR derivation panel (task 2.6) — reads arr_lines, inline SE edits.
 * ADDON_ARR §5, ADDON_ARR_VOLUME §5–§6, ADDON_ARR_MRR §4–§5, spec §7.1.
 */

import { esc } from "./shared.js";
import {
  buildArrFieldState,
  confirmArrAssumptions,
  fetchArrCompute,
  getArrDisplayUnit,
  logArrOverride,
  mergeDraftForCompute,
  patchFieldEdit,
  persistDealArrRecompute,
  setArrDisplayUnit,
} from "./domain/arr-edit-service.js";
import { accountAllowanceConsumedForDeal, selectLatestArrLines } from "./domain/arr-service.js";
import { getStore } from "./domain/store.js";
import { sessionUserId } from "./domain/session.js";

const PRODUCT_LABELS = {
  freshdesk: "Freshdesk",
  freshdesk_omni: "Freshdesk Omni",
  freshservice: "Freshservice",
  freshsales: "Freshsales",
};

const TIER_LABELS = {
  starter: "Starter",
  growth: "Growth",
  pro: "Pro",
  enterprise: "Enterprise",
};

const ADDON_LABELS = {
  freddy_ai_copilot: "Freddy AI Copilot",
  freddy_ai_agent_sessions: "Freddy AI Agent sessions",
  connector_app_tasks: "Connector app tasks",
  day_pass: "Day pass",
  asset_units: "Asset units",
};

const SESSIONS_ADDON = "freddy_ai_agent_sessions";

/** @param {number|null|undefined} amount */
export function formatUsd(amount) {
  if (amount == null || !Number.isFinite(amount)) return "—";
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    maximumFractionDigits: 0,
  }).format(amount);
}

/** @param {number} arr */
export function displayMrrFromArr(arr) {
  return Math.round(arr / 12);
}

/** @param {number|null|undefined} n */
function formatNumber(n) {
  if (n == null || !Number.isFinite(n)) return "—";
  return new Intl.NumberFormat("en-US", { maximumFractionDigits: 0 }).format(n);
}

/** @param {number|null|undefined} arr @param {"ARR"|"MRR"} [displayUnit] */
function formatMoneyDual(arr, displayUnit = "ARR") {
  if (arr == null || !Number.isFinite(arr)) return "—";
  const primary = displayUnit === "MRR" ? displayMrrFromArr(arr) : arr;
  const secondary = displayUnit === "MRR" ? arr : displayMrrFromArr(arr);
  const primaryLabel = displayUnit;
  const secondaryLabel = displayUnit === "MRR" ? "ARR" : "MRR";
  return `${formatUsd(primary)} ${primaryLabel} · ${formatUsd(secondary)} ${secondaryLabel}`;
}

/** @param {object} field @param {string} fieldKey */
function renderProvenanceMeta(field, fieldKey) {
  if (!field) return "";
  const kind = field.provenance || "derived";
  const kindLabel =
    kind === "stated" ? "From call" : kind === "se_override" ? "SE edit" : "Assumption";
  const prev =
    field.previousValue != null
      ? `<span class="deal-arr-field-previous muted">Was: ${esc(formatNumber(field.previousValue))}${field.previousUnit ? ` ${esc(volumeUnitLabel(field.previousUnit))}` : fieldKey === "aiSessionRate" ? ` (${Math.round(field.previousValue * 100)}%)` : ""}</span>`
      : "";
  return `
    <div class="deal-arr-field-meta">
      <span class="deal-arr-field-provenance deal-arr-field-provenance--${esc(kind)}">${esc(kindLabel)}</span>
      <span class="deal-arr-field-source muted">${esc(field.sourceLabel || "")}</span>
      ${prev}
    </div>`;
}

/**
 * @param {string} fieldKey
 * @param {object} field
 * @param {object} opts
 */
function renderEditableField(fieldKey, field, opts = {}) {
  const {
    type = "number",
    step = "1",
    min,
    max,
    unitSelect = false,
    placeholder = "",
    editable = false,
  } = opts;

  if (!editable) {
    return `<span class="deal-arr-field-readonly">${esc(formatNumber(field?.value))}${field?.unit ? ` ${esc(volumeUnitLabel(field.unit))}` : ""}</span>`;
  }

  const unitHtml = unitSelect
    ? `<select class="deal-arr-field-unit" data-arr-field="${esc(fieldKey)}-unit" aria-label="Volume unit">
        ${VOLUME_UNITS.map(
          (u) =>
            `<option value="${esc(u.value)}"${field?.unit === u.value ? " selected" : ""}>/${esc(u.label)}</option>`,
        ).join("")}
      </select>`
    : "";

  return `
    <div class="deal-arr-field-editor" data-arr-field-wrap="${esc(fieldKey)}">
      <input
        class="deal-arr-field-input"
        type="${esc(type)}"
        data-arr-field="${esc(fieldKey)}"
        value="${field?.value != null ? esc(String(field.value)) : ""}"
        step="${esc(step)}"
        ${min != null ? `min="${min}"` : ""}
        ${max != null ? `max="${max}"` : ""}
        placeholder="${esc(placeholder)}"
        inputmode="${type === "number" ? "decimal" : "text"}"
      />${unitHtml}
      ${renderProvenanceMeta(field, fieldKey)}
    </div>`;
}

/** @param {"ARR"|"MRR"} displayUnit @param {boolean} editable */
function renderUnitToggle(displayUnit, editable) {
  if (!editable) return "";
  return `
    <div class="deal-arr-unit-toggle" role="group" aria-label="Display unit">
      <button type="button" class="deal-arr-unit-btn${displayUnit === "ARR" ? " deal-arr-unit-btn--active" : ""}" data-arr-unit="ARR">ARR</button>
      <button type="button" class="deal-arr-unit-btn${displayUnit === "MRR" ? " deal-arr-unit-btn--active" : ""}" data-arr-unit="MRR">MRR</button>
    </div>`;
}

/** @param {string|null|undefined} unit */
function volumeUnitLabel(unit) {
  switch (unit) {
    case "per_day":
      return "conversations/day";
    case "per_week":
      return "conversations/week";
    case "per_month":
      return "conversations/month";
    case "per_year":
      return "conversations/year";
    default:
      return unit || "";
  }
}

/** @param {string|null|undefined} unit */
function quantityUnitLabel(unit, addonKey) {
  if (unit === "agent_month" || unit === "user_month") {
    return addonKey === "freddy_ai_copilot" ? "seats" : "agents";
  }
  if (unit === "per_100_sessions") return "packs";
  if (unit === "per_5000_tasks") return "packs";
  if (unit === "per_pass") return "passes";
  if (unit === "per_500_units") return "packs";
  return unit || "";
}

export { selectLatestArrLines } from "./domain/arr-service.js";

const VOLUME_UNITS = [
  { value: "per_day", label: "day" },
  { value: "per_week", label: "week" },
  { value: "per_month", label: "month" },
  { value: "per_year", label: "year" },
];

/** @param {object} a @param {object} b */
function lineSortOrder(a, b) {
  if (a.kind === "base" && b.kind !== "base") return -1;
  if (b.kind === "base" && a.kind !== "base") return 1;
  if (a.excluded !== b.excluded) return a.excluded ? 1 : -1;
  return String(a.addonKey || "").localeCompare(String(b.addonKey || ""));
}

/** @param {object} line */
function lineIsAssumed(line) {
  if (line.assumed === true) return true;
  if (line.assumed === false) return false;
  return (line.derivationJson || []).some((s) => s.assumptionKey && !s.bypass);
}

/** @param {object} line */
function exclusionPhrase(line) {
  if (line.tierConflict) return "tier conflict";
  switch (line.exclusionReason) {
    case "not_quantified":
      return "discussed, volume not stated";
    case "not_committed_spend":
      return "not committed spend";
    case "no_list_price":
      return "no list price";
    case "tier_conflict":
      return "tier conflict";
    case "peak_basis_unresolved":
      return "peak basis — unresolved";
    case "product_not_applicable":
      return "not applicable to product";
    default:
      return line.exclusionReason ? String(line.exclusionReason).replace(/_/g, " ") : "excluded";
  }
}

/** @param {object} line @param {object|null} inputs */
function lineTitle(line, inputs) {
  if (line.kind === "base") {
    const product = inputs?.product || line.product;
    const tier = inputs?.tier || line.tier;
    const productLabel = PRODUCT_LABELS[product] || product || "Base";
    const tierLabel = tier ? TIER_LABELS[tier] || tier : "";
    return tierLabel ? `${productLabel} ${tierLabel}` : productLabel;
  }
  return ADDON_LABELS[line.addonKey] || line.addonKey || "Add-on";
}

/** @param {object[]} lines */
function summarizeArrLines(lines) {
  const included = lines.filter((l) => !l.excluded);
  const recurringArr = included.filter((l) => l.recurring).reduce((s, l) => s + (l.annualValue || 0), 0);
  const consumptionArr = included.filter((l) => !l.recurring).reduce((s, l) => s + (l.annualValue || 0), 0);
  const totalArr = recurringArr + consumptionArr;
  const addonArr = included
    .filter((l) => l.kind === "addon")
    .reduce((s, l) => s + (l.annualValue || 0), 0);
  const addonShare = totalArr > 0 ? (addonArr / totalArr) * 100 : null;

  let confidenceWeight = 0;
  let confidenceSum = 0;
  for (const line of included) {
    if (line.confidence == null || !(line.annualValue > 0)) continue;
    confidenceWeight += line.annualValue;
    confidenceSum += line.confidence * line.annualValue;
  }
  const dealConfidence = confidenceWeight > 0 ? confidenceSum / confidenceWeight : null;

  return {
    recurringArr,
    consumptionArr,
    totalArr,
    recurringMrr: displayMrrFromArr(recurringArr),
    consumptionMrr: displayMrrFromArr(consumptionArr),
    totalMrr: displayMrrFromArr(totalArr),
    addonShare,
    dealConfidence,
  };
}

/** @param {number|null} confidence */
function confidenceBadge(confidence) {
  if (confidence == null) {
    return `<span class="deal-arr-confidence deal-arr-confidence--unknown">Confidence —</span>`;
  }
  const pct = Math.round(confidence * 100);
  let band = "medium";
  if (pct >= 80) band = "high";
  else if (pct < 50) band = "low";
  return `<span class="deal-arr-confidence deal-arr-confidence--${band}">${esc(String(pct))}% confidence</span>`;
}

/** @param {number|null} confidence */
function lineConfidenceBadge(confidence) {
  if (confidence == null) return "";
  const pct = Math.round(confidence * 100);
  return `<span class="deal-arr-line-confidence muted">${esc(String(pct))}%</span>`;
}

/** @param {object} step */
function formatDerivationStep(step) {
  switch (step.step) {
    case "stated": {
      const unit = volumeUnitLabel(step.unit);
      const quote = step.evidence ? ` "${step.evidence}"` : "";
      return `<span class="deal-arr-chain-label">stated</span> ${esc(formatNumber(step.value))} ${esc(unit)}${quote ? `<span class="deal-arr-chain-quote muted">${esc(quote.trim())}</span>` : ""}`;
    }
    case "normalised":
      return `<span class="deal-arr-chain-label">normalised</span> ${esc(formatNumber(step.value))} / year`;
    case "sessions": {
      const pct =
        step.assumptionValue != null
          ? ` (${Math.round(step.assumptionValue * 100)}% of volume)`
          : "";
      return `<span class="deal-arr-chain-label">sessions</span> ${esc(formatNumber(step.value))}${esc(pct)}`;
    }
    case "billable":
      return `<span class="deal-arr-chain-label">billable</span> ${esc(formatNumber(step.value))}${step.note ? ` <span class="muted">(${esc(step.note)})</span>` : ""}`;
    case "priced":
      return `<span class="deal-arr-chain-label">priced</span> ${esc(formatNumber(step.packs))} packs × ${esc(formatUsd(step.unitPrice))} = ${esc(formatUsd(step.annualValue))}`;
    case "tier_conflict":
      return `<span class="deal-arr-chain-label">conflict</span> ${esc(step.note || "Tier conflict")}`;
    default:
      return esc(step.note || step.step || "");
  }
}

/** @param {object} line @param {object|null} inputs */
function renderQuantityCell(line, inputs) {
  if (line.quantity == null) return `<span class="muted">—</span>`;
  const unitLabel = quantityUnitLabel(line.unit, line.addonKey);
  const price = line.unitPrice != null ? ` × ${formatUsd(line.unitPrice)}` : "";
  if (line.kind === "base") {
    return `${esc(formatNumber(line.quantity))} ${esc(unitLabel)}${esc(price)}`;
  }
  return `${esc(formatNumber(line.quantity))} ${esc(unitLabel)}${esc(price)}`;
}

/** @param {object} line @param {"ARR"|"MRR"} [displayUnit] */
function renderMoneyCell(line, displayUnit = "ARR") {
  if (line.excluded) {
    return `<span class="deal-arr-money deal-arr-money--excluded muted">excluded</span>`;
  }
  return `<span class="deal-arr-money">${esc(formatMoneyDual(line.annualValue || 0, displayUnit))}</span>`;
}

/**
 * @param {object} line
 * @param {object|null} inputs
 * @param {object} ctx
 */
function renderBaseRow(line, inputs, ctx = {}) {
  const { editable = false, fieldState = null, displayUnit = "ARR" } = ctx;
  const title = lineTitle(line, inputs);
  const rowClass = line.excluded ? "deal-arr-row deal-arr-row--excluded" : "deal-arr-row";

  if (line.excluded) {
    return `
      <div class="${rowClass}">
        <div class="deal-arr-row-main">
          <span class="deal-arr-row-label">${esc(title)} — ${esc(exclusionPhrase(line))} — excluded</span>
          ${renderMoneyCell(line, displayUnit)}
        </div>
      </div>`;
  }

  const qty = editable
    ? renderEditableField("agents", fieldState?.agents, { editable: true, min: 1, step: "1" })
    : renderQuantityCell(line, inputs);

  const evidence = line.evidence || inputs?.agentsEvidence;
  const meta =
    !editable && evidence
      ? `<p class="deal-arr-evidence muted">"${esc(evidence)}"</p>`
      : !editable && !line.stated
        ? `<p class="deal-arr-evidence muted">Agent count inferred — not directly quoted</p>`
        : "";

  return `
    <div class="${rowClass}">
      <div class="deal-arr-row-main">
        <span class="deal-arr-row-label">${esc(title)}</span>
        <span class="deal-arr-row-qty">${qty}</span>
        ${renderMoneyCell(line, displayUnit)}
      </div>
      ${meta}
    </div>`;
}

/** @param {object} step @param {object} ctx */
function renderChainStep(step, ctx = {}) {
  const { editable = false, fieldState = null } = ctx;
  if (step.step === "stated" && editable && fieldState) {
    return `<span class="deal-arr-chain-label">stated</span> ${renderEditableField("conversationVolume", fieldState.conversationVolume, { editable: true, unitSelect: true, min: 0 })}`;
  }
  if (step.step === "sessions" && editable && fieldState) {
    return `<span class="deal-arr-chain-label">sessions</span> ${renderEditableField("aiSessionRate", fieldState.aiSessionRate, { editable: true, step: "0.01", min: 0, max: 1, placeholder: "0.5" })} <span class="muted">× volume → annual sessions</span>`;
  }
  if (step.step === "direct_override" && editable && fieldState) {
    return `<span class="deal-arr-chain-label">direct</span> ${renderEditableField("sessionDirectOverride", fieldState.sessionDirectOverride, { editable: true, min: 0, placeholder: "annual sessions" })} <span class="muted">bypasses chain</span>`;
  }
  return formatDerivationStep(step);
}

/**
 * @param {object} line
 * @param {object|null} inputs
 * @param {object} ctx
 */
function renderAddonRow(line, inputs, ctx = {}) {
  const { editable = false, fieldState = null, displayUnit = "ARR" } = ctx;
  const title = lineTitle(line, inputs);
  const assumed = lineIsAssumed(line);
  const conflict = line.tierConflict || line.exclusionReason === "tier_conflict";
  const rowMods = [
    "deal-arr-row",
    line.excluded ? "deal-arr-row--excluded" : "",
    conflict ? "deal-arr-row--conflict" : "",
    assumed && !line.excluded ? "deal-arr-row--assumed" : "",
  ]
    .filter(Boolean)
    .join(" ");

  if (line.excluded) {
    const conflictBadge = conflict
      ? `<span class="deal-arr-conflict-badge">Tier conflict</span>`
      : "";
    return `
      <div class="${rowMods}">
        <div class="deal-arr-row-main">
          <span class="deal-arr-row-label">${esc(title)} — ${esc(exclusionPhrase(line))} — excluded</span>
          ${conflictBadge}
          ${line.evidence ? `<span class="deal-arr-chain-quote muted">"${esc(line.evidence)}"</span>` : ""}
          ${renderMoneyCell(line, displayUnit)}
        </div>
      </div>`;
  }

  const badges = [
    assumed ? `<span class="deal-arr-assumed-badge" title="Includes unreviewed assumptions">⚠ assumed</span>` : "",
    conflict ? `<span class="deal-arr-conflict-badge">Tier conflict</span>` : "",
    lineConfidenceBadge(line.confidence),
  ]
    .filter(Boolean)
    .join(" ");

  let qty = renderQuantityCell(line, inputs);
  if (editable && line.addonKey === "freddy_ai_copilot") {
    qty = renderEditableField("copilotSeats", fieldState?.copilotSeats, { editable: true, min: 0, step: "1" });
  }
  if (editable && line.addonKey === "connector_app_tasks") {
    qty = renderEditableField("connectorTasks", fieldState?.connectorTasks, {
      editable: true,
      unitSelect: true,
      min: 0,
    });
  }

  const chain = line.derivationJson || [];
  const hasChain = line.addonKey === SESSIONS_ADDON && (chain.length > 1 || editable);

  const rowInner = `
    <div class="deal-arr-row-main">
      <span class="deal-arr-row-label">${esc(title)}</span>
      <span class="deal-arr-row-qty">${qty}</span>
      <span class="deal-arr-row-badges">${badges}</span>
      ${renderMoneyCell(line, displayUnit)}
    </div>`;

  if (!hasChain) {
    const evidence = line.evidence
      ? `<p class="deal-arr-evidence muted">"${esc(line.evidence)}"</p>`
      : "";
    return `<div class="${rowMods}">${rowInner}${evidence}</div>`;
  }

  const chainSteps = chain.filter((s) => s.step !== "priced");
  const chainRows = chainSteps
    .map(
      (step) =>
        `<div class="deal-arr-chain-step"><span class="deal-arr-chain-tree">└</span> ${renderChainStep(step, ctx)}</div>`,
    )
    .join("");

  const directRow = editable
    ? `<div class="deal-arr-chain-step"><span class="deal-arr-chain-tree">└</span> ${renderChainStep({ step: "direct_override" }, ctx)}</div>`
    : "";

  const confirmBtn =
    editable && assumed
      ? `<div class="deal-arr-chain-actions"><button type="button" class="deal-arr-confirm-assumptions" data-action="confirm-arr-assumptions">Confirm assumptions</button></div>`
      : editable && fieldState?.assumptionsConfirmed
        ? `<div class="deal-arr-chain-actions muted">Assumptions confirmed</div>`
        : "";

  return `
    <details class="deal-arr-derivation ${rowMods}" open>
      <summary class="deal-arr-derivation-summary">${rowInner}</summary>
      <div class="deal-arr-chain">${chainRows}${directRow}${confirmBtn}</div>
    </details>`;
}

/** @param {object[]} lines @param {"ARR"|"MRR"} displayUnit */
function linesToSummaryDisplay(lines, displayUnit) {
  const summary = summarizeArrLines(lines);
  const primary = (arr) => (displayUnit === "MRR" ? displayMrrFromArr(arr) : arr);
  return {
    ...summary,
    headerArr: summary.totalArr,
    headerPrimary: primary(summary.totalArr),
    recurringPrimary: primary(summary.recurringArr),
    consumptionPrimary: primary(summary.consumptionArr),
  };
}

/**
 * @param {object|null|undefined} deal
 * @param {object[]} allLines
 * @param {object} [opts]
 */
export function renderDealArrModule(deal, allLines, opts = {}) {
  const editable = !!opts.editable;
  const displayUnit = opts.displayUnit || "ARR";
  const liveLines = opts.liveLines || null;
  const lines = selectLatestArrLines(liveLines || allLines || []);
  const inputs = deal?.arrInputsJson || null;
  const fieldState = opts.fieldState || (editable ? buildArrFieldState(deal, allLines || []) : null);
  const hasEstimate = deal?.arrEstimatePoint != null;
  const priceBookVersion =
    deal?.arrPriceBookVersion || lines[0]?.priceBookVersion || null;
  const assumptionsBookVersion =
    deal?.assumptionsBookVersion || lines[0]?.assumptionsBookVersion || priceBookVersion;
  const computedAt = deal?.arrComputedAt || lines[0]?.computedAt || null;
  const ctx = { editable, fieldState, displayUnit };

  if (!lines.length && !hasEstimate) {
    if ((deal?.postCallCount || 0) > 0) {
      return `
        <section class="account-record-section deal-record-section deal-arr-module deal-arr-module--empty">
          <h3 class="account-record-section-title">ARR derivation</h3>
          <p class="muted">Pricing inputs have not been computed for this deal yet — run post-call analysis with ARR extraction.</p>
        </section>`;
    }
    return "";
  }

  const summary = linesToSummaryDisplay(lines, displayUnit);
  const headerArr = opts.liveTotalArr ?? (hasEstimate ? deal.arrEstimatePoint : summary.totalArr);
  const headerConfidence =
    summary.dealConfidence ??
    (lines.length
      ? (() => {
          const vals = lines.filter((l) => !l.excluded && l.confidence != null).map((l) => l.confidence);
          return vals.length ? vals.reduce((a, b) => a + b, 0) / vals.length : null;
        })()
      : null);

  const baseLine = lines.find((l) => l.kind === "base");
  const addonLines = lines.filter((l) => l.kind === "addon");

  const bodyParts = [];
  if (baseLine) bodyParts.push(renderBaseRow(baseLine, inputs, ctx));
  for (const line of addonLines) bodyParts.push(renderAddonRow(line, inputs, ctx));

  const addonShareNote =
    summary.addonShare != null && summary.totalArr > 0
      ? `<p class="deal-arr-addon-share muted">Add-on share of total: ${esc(summary.addonShare.toFixed(1).replace(/\.0$/, ""))}%</p>`
      : "";

  const subtotals =
    summary.totalArr > 0
      ? `
      <div class="deal-arr-subtotals">
        <div class="deal-arr-subtotal">
          <span class="deal-arr-subtotal-label">Recurring</span>
          <span class="deal-arr-subtotal-value">${esc(formatMoneyDual(summary.recurringArr, displayUnit))}</span>
        </div>
        ${summary.consumptionArr > 0
          ? `<div class="deal-arr-subtotal">
              <span class="deal-arr-subtotal-label">Consumption</span>
              <span class="deal-arr-subtotal-value">${esc(formatMoneyDual(summary.consumptionArr, displayUnit))} <span class="muted deal-arr-normalised-note">(normalised, not a monthly bill)</span></span>
            </div>`
          : ""}
      </div>`
      : "";

  const computedLabel = computedAt
    ? new Date(computedAt).toLocaleString(undefined, {
        month: "short",
        day: "numeric",
        year: "numeric",
        hour: "numeric",
        minute: "2-digit",
      })
    : "—";

  const statusNote = editable
    ? `<p class="deal-arr-live-note muted" data-arr-live-status>Edits recompute via price book — ARR is stored; MRR is display-only.</p>`
    : "";

  return `
    <section class="account-record-section deal-record-section deal-arr-module${editable ? " deal-arr-module--editable" : ""}" aria-label="ARR derivation module">
      <div class="deal-arr-header">
        <div class="deal-arr-header-main">
          <h3 class="account-record-section-title deal-arr-title">ARR derivation</h3>
          <p class="deal-arr-header-totals" data-arr-header-totals>
            ${esc(formatMoneyDual(headerArr || 0, displayUnit))}
          </p>
        </div>
        <div class="deal-arr-header-meta">
          ${renderUnitToggle(displayUnit, editable)}
          ${confidenceBadge(headerConfidence)}
          ${priceBookVersion ? `<span class="deal-arr-version muted mono">PB ${esc(priceBookVersion)}</span>` : ""}
          ${assumptionsBookVersion ? `<span class="deal-arr-version muted mono">AB ${esc(assumptionsBookVersion)}</span>` : ""}
        </div>
      </div>

      ${statusNote}

      <div class="deal-arr-body" data-arr-body>
        ${bodyParts.join("") || `<p class="muted">No line breakdown stored — point estimate only.</p>`}
      </div>

      ${subtotals}

      <div class="deal-arr-total-row" data-arr-total-row>
        <span class="deal-arr-total-label">Total</span>
        <span class="deal-arr-total-value">${esc(formatMoneyDual(headerArr || 0, displayUnit))}</span>
      </div>

      ${addonShareNote}

      <footer class="deal-arr-footer">
        <div class="deal-arr-footer-meta muted">
          ${priceBookVersion ? `<span>Price book ${esc(priceBookVersion)}</span>` : ""}
          ${assumptionsBookVersion ? `<span>Assumptions ${esc(assumptionsBookVersion)}</span>` : ""}
          <span>Computed ${esc(computedLabel)}</span>
        </div>
      </footer>
    </section>`;
}

/**
 * @param {HTMLElement} container
 * @param {object|null} deal
 * @param {object[]} lines
 * @param {object} [opts]
 */
export function mountDealArrModule(container, deal, lines, opts = {}) {
  if (!container || !deal) return;

  const session = opts.session || null;
  const getAuthHeaders = opts.getAuthHeaders || (async () => ({}));
  const onDealUpdated = opts.onDealUpdated || null;

  let currentDeal = deal;
  let currentLines = lines || [];
  let displayUnit = getArrDisplayUnit();
  let fieldState = buildArrFieldState(currentDeal, currentLines);
  let recomputeTimer = null;
  let persistTimer = null;

  const render = (liveOpts = {}) => {
    container.innerHTML = renderDealArrModule(currentDeal, currentLines, {
      editable: true,
      displayUnit,
      fieldState,
      ...liveOpts,
    });
    wire(container);
  };

  const readFieldValuesFromDom = () => {
    const readNum = (key) => {
      const el = container.querySelector(`[data-arr-field="${key}"]`);
      if (!el) return fieldState[key]?.value ?? null;
      const v = el.value.trim();
      if (v === "") return null;
      const n = Number(v);
      return Number.isFinite(n) ? n : null;
    };
    const readUnit = (key) => {
      const el = container.querySelector(`[data-arr-field="${key}-unit"]`);
      return el?.value || fieldState[key]?.unit || null;
    };

    return {
      ...fieldState,
      agents: { ...fieldState.agents, value: readNum("agents") },
      conversationVolume: {
        ...fieldState.conversationVolume,
        value: readNum("conversationVolume"),
        unit: readUnit("conversationVolume") || fieldState.conversationVolume.unit,
      },
      aiSessionRate: { ...fieldState.aiSessionRate, value: readNum("aiSessionRate") },
      copilotSeats: { ...fieldState.copilotSeats, value: readNum("copilotSeats") },
      connectorTasks: {
        ...fieldState.connectorTasks,
        value: readNum("connectorTasks"),
        unit: readUnit("connectorTasks") || fieldState.connectorTasks.unit,
      },
      sessionDirectOverride: {
        ...fieldState.sessionDirectOverride,
        value: readNum("sessionDirectOverride"),
      },
    };
  };

  const runLiveRecompute = async () => {
    const nextState = readFieldValuesFromDom();
    fieldState = nextState;
    const statusEl = container.querySelector("[data-arr-live-status]");
    if (statusEl) statusEl.textContent = "Recomputing…";

    try {
      const store = getStore();
      const allowanceConsumed = await accountAllowanceConsumedForDeal(
        store,
        currentDeal.accountId,
        currentDeal.id,
      );
      const { draft, computeOpts } = mergeDraftForCompute(currentDeal, fieldState, {
        accountAllowanceConsumed: allowanceConsumed,
        userLabel: session?.email || sessionUserId(session) || "se",
      });
      const result = await fetchArrCompute(draft, computeOpts, getAuthHeaders);

      const computedLines = (result.lines || []).map((line, idx) => ({
        id: `live_${idx}`,
        dealId: currentDeal.id,
        callId: selectLatestArrLines(currentLines)[0]?.callId || "live",
        computedAt: Date.now(),
        priceBookVersion: result.priceBookVersion,
        assumptionsBookVersion: result.assumptionsBookVersion,
        evidence: null,
        ...line,
      }));

      render({
        liveLines: computedLines,
        liveTotalArr: result.arrPoint,
        fieldState,
      });

      if (statusEl) statusEl.textContent = "Live total updated — saving…";
      schedulePersist(result, nextState);
    } catch (err) {
      if (statusEl) {
        statusEl.textContent = err?.message || "Recompute failed";
      }
    }
  };

  const schedulePersist = (computeResult, nextState) => {
    clearTimeout(persistTimer);
    persistTimer = setTimeout(async () => {
      try {
        const userId = sessionUserId(session);
        if (!userId) return;

        const store = getStore();
        const prevState = buildArrFieldState(currentDeal, currentLines);
        const changedFields = ["agents", "conversationVolume", "aiSessionRate", "copilotSeats", "connectorTasks", "sessionDirectOverride"].filter(
          (key) => {
            const a = prevState[key]?.value;
            const b = nextState[key]?.value;
            if (key === "conversationVolume" || key === "connectorTasks") {
              return a !== b || prevState[key]?.unit !== nextState[key]?.unit;
            }
            return a !== b;
          },
        );

        let metadataPatch = currentDeal.metadata || {};
        for (const key of changedFields) {
          const patch = patchFieldEdit(
            currentDeal,
            key,
            key === "conversationVolume" || key === "connectorTasks"
              ? { value: nextState[key].value, unit: nextState[key].unit }
              : nextState[key].value,
            prevState[key],
            userId,
            displayUnit,
          );
          metadataPatch = patch.metadata;
          currentDeal = { ...currentDeal, metadata: metadataPatch };
          await logArrOverride({
            dealId: currentDeal.id,
            accountId: currentDeal.accountId,
            field: key,
            action: "edit",
            original: prevState[key]?.value ?? null,
            override: nextState[key]?.value ?? null,
            arrEstimatePoint: computeResult.arrPoint ?? 0,
            displayUnit,
            userId,
            ownerId: currentDeal.ownerId,
            teamId: currentDeal.teamId,
            orgId: currentDeal.orgId,
          });
        }

        if (changedFields.length) {
          await store.updateDeal?.(currentDeal.id, { metadata: metadataPatch });
        }

        const persisted = await persistDealArrRecompute(
          currentDeal.id,
          currentDeal,
          computeResult,
          { userId },
        );
        if (persisted?.lines) currentLines = persisted.lines;
        if (persisted?.deal) currentDeal = { ...currentDeal, ...persisted.deal };
        fieldState = buildArrFieldState(currentDeal, currentLines);
        onDealUpdated?.(currentDeal, currentLines);

        const statusEl = container.querySelector("[data-arr-live-status]");
        if (statusEl) statusEl.textContent = "Saved — deal override applied (this deal only).";
      } catch (err) {
        const statusEl = container.querySelector("[data-arr-live-status]");
        if (statusEl) statusEl.textContent = err?.message || "Save failed";
      }
    }, 600);
  };

  const scheduleRecompute = () => {
    clearTimeout(recomputeTimer);
    recomputeTimer = setTimeout(() => {
      void runLiveRecompute();
    }, 250);
  };

  const wire = (root) => {
    root.querySelectorAll(".deal-arr-unit-btn").forEach((btn) => {
      btn.addEventListener("click", () => {
        const unit = btn.getAttribute("data-arr-unit");
        if (unit === "ARR" || unit === "MRR") {
          displayUnit = unit;
          setArrDisplayUnit(unit);
          render();
        }
      });
    });

    root.querySelectorAll(".deal-arr-field-input, .deal-arr-field-unit").forEach((el) => {
      el.addEventListener("input", scheduleRecompute);
      el.addEventListener("change", scheduleRecompute);
    });

    root.querySelector('[data-action="confirm-arr-assumptions"]')?.addEventListener("click", () => {
      void (async () => {
        const statusEl = root.querySelector("[data-arr-live-status]");
        if (statusEl) statusEl.textContent = "Confirming assumptions…";
        try {
          const result = await confirmArrAssumptions(
            currentDeal.id,
            currentDeal,
            session,
            getAuthHeaders,
          );
          currentDeal = {
            ...currentDeal,
            arrEstimatePoint: result.arrPoint,
            metadata: {
              ...(currentDeal.metadata || {}),
              arrEdits: {
                ...(currentDeal.metadata?.arrEdits || {}),
                assumptionsConfirmed: true,
              },
            },
          };
          fieldState = buildArrFieldState(currentDeal, currentLines);
          const store = getStore();
          currentLines = (await store.listArrLinesByDeal?.(currentDeal.id)) || currentLines;
          render({ liveTotalArr: result.arrPoint });
          onDealUpdated?.(currentDeal, currentLines);
        } catch (err) {
          if (statusEl) statusEl.textContent = err?.message || "Confirm failed";
        }
      })();
    });
  };

  render();
}
