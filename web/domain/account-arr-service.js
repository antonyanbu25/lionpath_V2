/**
 * Account-level ARR roll-up and add-on attach matrix (ADDON_ARR §6, task 2.8).
 */

import { selectLatestArrLines, resolveAllowanceConsumerDealId } from "./arr-service.js";

const SESSIONS_ADDON = "freddy_ai_agent_sessions";

export const ATTACH_MATRIX_ADDON_KEYS = [
  "freddy_ai_copilot",
  "freddy_ai_agent_sessions",
  "connector_app_tasks",
  "day_pass",
  "asset_units",
];

export const ADDON_LABELS = {
  freddy_ai_copilot: "Freddy AI Copilot",
  freddy_ai_agent_sessions: "Freddy AI Agent",
  connector_app_tasks: "Connector tasks",
  day_pass: "Day pass",
  asset_units: "Asset units",
};

const PRODUCT_LABELS = {
  freshdesk: "Freshdesk",
  freshdesk_omni: "FD Omni",
  freshservice: "Freshservice",
  freshsales: "Freshsales",
};

/** @param {object[]} lines */
export function summarizeIncludedArr(lines) {
  const included = (lines || []).filter((l) => !l.excluded);
  const baseArr = included.filter((l) => l.kind === "base").reduce((s, l) => s + (l.annualValue || 0), 0);
  const addonArr = included.filter((l) => l.kind === "addon").reduce((s, l) => s + (l.annualValue || 0), 0);
  const totalArr = baseArr + addonArr;
  return {
    baseArr,
    addonArr,
    totalArr,
    totalMrr: Math.round(totalArr / 12),
    baseMrr: Math.round(baseArr / 12),
    addonMrr: Math.round(addonArr / 12),
    addonShare: totalArr > 0 ? (addonArr / totalArr) * 100 : null,
  };
}

/**
 * @param {object|null|undefined} line
 * @returns {"attached"|"discussed"|"excluded"|"absent"}
 */
export function classifyAddonAttachCell(line) {
  if (!line) return "absent";
  if (!line.excluded && (line.annualValue > 0 || line.quantity > 0)) return "attached";
  if (
    line.exclusionReason === "not_quantified" ||
    (line.inScope && line.quantity == null && line.excluded)
  ) {
    return "discussed";
  }
  if (line.excluded || line.inScope) return "discussed";
  return "absent";
}

/**
 * @param {object} line
 * @param {string} addonKey
 */
function lineMatchesAddon(line, addonKey) {
  return line?.kind === "addon" && line.addonKey === addonKey;
}

/**
 * @param {import("./types.js").Deal[]} deals
 * @param {Map<string, object[]>} linesByDealId latest lines per deal
 */
export function buildAttachMatrix(deals, linesByDealId) {
  const sortedDeals = [...(deals || [])].sort((a, b) => {
    const aActive = a.status === "active" ? 0 : 1;
    const bActive = b.status === "active" ? 0 : 1;
    if (aActive !== bActive) return aActive - bActive;
    return (a.createdAt || 0) - (b.createdAt || 0);
  });

  /** @type {Record<string, Record<string, { state: string, line: object|null }>>} */
  const cells = {};
  for (const addonKey of ATTACH_MATRIX_ADDON_KEYS) {
    cells[addonKey] = {};
    for (const deal of sortedDeals) {
      const lines = linesByDealId.get(deal.id) || [];
      const line = lines.find((l) => lineMatchesAddon(l, addonKey)) || null;
      cells[addonKey][deal.id] = { state: classifyAddonAttachCell(line), line };
    }
  }
  return { deals: sortedDeals, cells };
}

/**
 * @param {import("./types.js").Deal[]} deals
 * @param {Map<string, object[]>} linesByDealId
 */
export function findCrossSellGaps(deals, linesByDealId) {
  const active = (deals || []).filter((d) => d.status === "active");
  if (active.length < 2) return [];

  const gaps = [];
  for (const addonKey of ATTACH_MATRIX_ADDON_KEYS) {
    const attached = active.filter((d) => classifyAddonAttachCell(findAddonLine(linesByDealId, d.id, addonKey)) === "attached");
    const absent = active.filter((d) => {
      const state = classifyAddonAttachCell(findAddonLine(linesByDealId, d.id, addonKey));
      return state === "absent" || state === "discussed";
    });
    if (attached.length && absent.length) {
      gaps.push({
        addonKey,
        label: ADDON_LABELS[addonKey] || addonKey,
        attachedDealIds: attached.map((d) => d.id),
        absentDealIds: absent.map((d) => d.id),
      });
    }
  }
  return gaps;
}

/** @param {Map<string, object[]>} linesByDealId @param {string} dealId @param {string} addonKey */
function findAddonLine(linesByDealId, dealId, addonKey) {
  return (linesByDealId.get(dealId) || []).find((l) => lineMatchesAddon(l, addonKey)) || null;
}

/**
 * @param {import("./types.js").Deal[]} deals
 * @param {Map<string, object[]>} linesByDealId
 */
export function findDiscussedUnquantifiedAddons(deals, linesByDealId) {
  const items = [];
  for (const deal of deals || []) {
    for (const line of linesByDealId.get(deal.id) || []) {
      if (line.kind !== "addon") continue;
      const discussed =
        line.exclusionReason === "not_quantified" ||
        (line.inScope && line.quantity == null && line.excluded);
      if (!discussed) continue;
      items.push({
        addonKey: line.addonKey,
        label: ADDON_LABELS[line.addonKey] || line.addonKey,
        dealId: deal.id,
        evidence: line.evidence || null,
      });
    }
  }
  return items;
}

/** @param {string|null|undefined} product */
export function formatProductLabel(product) {
  if (!product) return "—";
  return PRODUCT_LABELS[product] || String(product).replace(/_/g, " ");
}

/**
 * @param {ReturnType<import("./store.js").getStore>} store
 * @param {string} accountId
 * @param {import("./types.js").Deal[]} deals
 */
export async function buildAccountArrRollup(store, accountId, deals) {
  /** @type {Map<string, object[]>} */
  const linesByDealId = new Map();
  const allLatestLines = [];

  for (const deal of deals || []) {
    const raw = store.listArrLinesByDeal ? await store.listArrLinesByDeal(deal.id) : [];
    const latest = selectLatestArrLines(raw);
    linesByDealId.set(deal.id, latest);
    allLatestLines.push(...latest);
  }

  const includedSummary = summarizeIncludedArr(allLatestLines);
  const attachMatrix = buildAttachMatrix(deals, linesByDealId);
  const crossSellGaps = findCrossSellGaps(deals, linesByDealId);
  const discussedUnquantified = findDiscussedUnquantifiedAddons(deals, linesByDealId);

  let allowanceConsumerDealId = null;
  if (store.getAccount && accountId) {
    const account = await store.getAccount(accountId);
    allowanceConsumerDealId = account?.metadata?.arrSessionAllowanceDealId || null;
  }
  if (!allowanceConsumerDealId && store.listDealsByAccount) {
    allowanceConsumerDealId = await resolveAllowanceConsumerDealId(store, accountId, "", null);
  }

  const products = new Set();
  for (const lines of linesByDealId.values()) {
    const base = lines.find((l) => l.kind === "base" && !l.excluded);
    if (base?.product) products.add(base.product);
  }

  let totalArrLow = 0;
  let totalArrHigh = 0;
  let hasDealEstimates = false;
  for (const deal of deals || []) {
    if (deal.arrEstimatePoint == null) continue;
    hasDealEstimates = true;
    totalArrLow += deal.arrEstimateLow ?? deal.arrEstimatePoint ?? 0;
    totalArrHigh += deal.arrEstimateHigh ?? deal.arrEstimatePoint ?? 0;
  }

  return {
    linesByDealId,
    ...includedSummary,
    attachMatrix,
    crossSellGaps,
    discussedUnquantified,
    allowanceConsumerDealId,
    productsInPlay: [...products].map(formatProductLabel),
    estimateBand:
      hasDealEstimates
        ? { low: totalArrLow, high: totalArrHigh, point: (totalArrLow + totalArrHigh) / 2 }
        : null,
  };
}
