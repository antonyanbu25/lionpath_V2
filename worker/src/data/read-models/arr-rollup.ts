/**
 * Account ARR roll-up helpers — mirrors web/domain/account-arr-service.js + arr-service.js.
 */

import type { FirestoreDoc } from "../firestore-admin";

export const ATTACH_MATRIX_ADDON_KEYS = [
  "freddy_ai_copilot",
  "freddy_ai_agent_sessions",
  "connector_app_tasks",
  "day_pass",
  "asset_units",
] as const;

export const ADDON_LABELS: Record<string, string> = {
  freddy_ai_copilot: "Freddy AI Copilot",
  freddy_ai_agent_sessions: "Freddy AI Agent",
  connector_app_tasks: "Connector tasks",
  day_pass: "Day pass",
  asset_units: "Asset units",
};

const PRODUCT_LABELS: Record<string, string> = {
  freshdesk: "Freshdesk",
  freshdesk_omni: "FD Omni",
  freshservice: "Freshservice",
  freshsales: "Freshsales",
};

/** Latest compute snapshot per deal (one callId bucket). */
export function selectLatestArrLines(allLines: FirestoreDoc[]): FirestoreDoc[] {
  if (!allLines?.length) return [];
  const byCall = new Map<string, FirestoreDoc[]>();
  for (const line of allLines) {
    const key = String(line.callId || "");
    const bucket = byCall.get(key) || [];
    bucket.push(line);
    byCall.set(key, bucket);
  }
  let best: FirestoreDoc[] = [];
  let bestAt = -1;
  for (const bucket of byCall.values()) {
    const at = Math.max(...bucket.map((l) => Number(l.computedAt || 0)));
    if (at > bestAt) {
      bestAt = at;
      best = bucket;
    }
  }
  return best.slice().sort((a, b) => {
    if (a.kind === "base" && b.kind !== "base") return -1;
    if (b.kind === "base" && a.kind !== "base") return 1;
    if (a.excluded !== b.excluded) return a.excluded ? 1 : -1;
    return String(a.addonKey || "").localeCompare(String(b.addonKey || ""));
  });
}

export function summarizeIncludedArr(lines: FirestoreDoc[]) {
  const included = (lines || []).filter((l) => !l.excluded);
  const baseArr = included
    .filter((l) => l.kind === "base")
    .reduce((s, l) => s + Number(l.annualValue || 0), 0);
  const addonArr = included
    .filter((l) => l.kind === "addon")
    .reduce((s, l) => s + Number(l.annualValue || 0), 0);
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

export function classifyAddonAttachCell(
  line: FirestoreDoc | null | undefined,
): "attached" | "discussed" | "excluded" | "absent" {
  if (!line) return "absent";
  if (!line.excluded && (Number(line.annualValue) > 0 || Number(line.quantity) > 0)) return "attached";
  if (
    line.exclusionReason === "not_quantified" ||
    (line.inScope && line.quantity == null && line.excluded)
  ) {
    return "discussed";
  }
  if (line.excluded || line.inScope) return "discussed";
  return "absent";
}

function lineMatchesAddon(line: FirestoreDoc, addonKey: string): boolean {
  return line?.kind === "addon" && line.addonKey === addonKey;
}

function findAddonLine(
  linesByDealId: Map<string, FirestoreDoc[]>,
  dealId: string,
  addonKey: string,
): FirestoreDoc | null {
  return (linesByDealId.get(dealId) || []).find((l) => lineMatchesAddon(l, addonKey)) || null;
}

export function buildAttachMatrix(deals: FirestoreDoc[], linesByDealId: Map<string, FirestoreDoc[]>) {
  const sortedDeals = [...(deals || [])].sort((a, b) => {
    const aActive = a.status === "active" ? 0 : 1;
    const bActive = b.status === "active" ? 0 : 1;
    if (aActive !== bActive) return aActive - bActive;
    return Number(a.createdAt || 0) - Number(b.createdAt || 0);
  });

  const cells: Record<string, Record<string, { state: string; line: FirestoreDoc | null }>> = {};
  for (const addonKey of ATTACH_MATRIX_ADDON_KEYS) {
    cells[addonKey] = {};
    for (const deal of sortedDeals) {
      const lines = linesByDealId.get(String(deal.id)) || [];
      const line = lines.find((l) => lineMatchesAddon(l, addonKey)) || null;
      cells[addonKey][String(deal.id)] = { state: classifyAddonAttachCell(line), line };
    }
  }
  return { deals: sortedDeals, cells };
}

export function findCrossSellGaps(deals: FirestoreDoc[], linesByDealId: Map<string, FirestoreDoc[]>) {
  const active = (deals || []).filter((d) => d.status === "active");
  if (active.length < 2) return [];

  const gaps = [];
  for (const addonKey of ATTACH_MATRIX_ADDON_KEYS) {
    const attached = active.filter(
      (d) =>
        classifyAddonAttachCell(findAddonLine(linesByDealId, String(d.id), addonKey)) === "attached",
    );
    const absent = active.filter((d) => {
      const state = classifyAddonAttachCell(findAddonLine(linesByDealId, String(d.id), addonKey));
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

export function findDiscussedUnquantifiedAddons(
  deals: FirestoreDoc[],
  linesByDealId: Map<string, FirestoreDoc[]>,
) {
  const items = [];
  for (const deal of deals || []) {
    for (const line of linesByDealId.get(String(deal.id)) || []) {
      if (line.kind !== "addon") continue;
      const discussed =
        line.exclusionReason === "not_quantified" ||
        (line.inScope && line.quantity == null && line.excluded);
      if (!discussed) continue;
      items.push({
        addonKey: line.addonKey,
        label: ADDON_LABELS[String(line.addonKey)] || line.addonKey,
        dealId: deal.id,
        evidence: line.evidence || null,
      });
    }
  }
  return items;
}

export function formatProductLabel(product: string | null | undefined): string {
  if (!product) return "-";
  return PRODUCT_LABELS[product] || String(product).replace(/_/g, " ");
}

export interface AccountArrRollupPayload {
  linesByDealId: Record<string, FirestoreDoc[]>;
  baseArr: number;
  addonArr: number;
  totalArr: number;
  totalMrr: number;
  baseMrr: number;
  addonMrr: number;
  addonShare: number | null;
  attachMatrix: ReturnType<typeof buildAttachMatrix>;
  crossSellGaps: ReturnType<typeof findCrossSellGaps>;
  discussedUnquantified: ReturnType<typeof findDiscussedUnquantifiedAddons>;
  allowanceConsumerDealId: string | null;
  productsInPlay: string[];
  estimateBand: { low: number; high: number; point: number } | null;
}

export function buildAccountArrRollupPayload(
  account: FirestoreDoc,
  deals: FirestoreDoc[],
  arrByDeal: Map<string, FirestoreDoc[]>,
): AccountArrRollupPayload {
  const linesByDealId = new Map<string, FirestoreDoc[]>();
  const allLatestLines: FirestoreDoc[] = [];

  for (const deal of deals || []) {
    const raw = arrByDeal.get(String(deal.id)) || [];
    const latest = selectLatestArrLines(raw);
    linesByDealId.set(String(deal.id), latest);
    allLatestLines.push(...latest);
  }

  const includedSummary = summarizeIncludedArr(allLatestLines);
  const attachMatrix = buildAttachMatrix(deals, linesByDealId);
  const crossSellGaps = findCrossSellGaps(deals, linesByDealId);
  const discussedUnquantified = findDiscussedUnquantifiedAddons(deals, linesByDealId);

  const meta = (account.metadata as Record<string, unknown>) || {};
  let allowanceConsumerDealId = (meta.arrSessionAllowanceDealId as string) || null;
  if (!allowanceConsumerDealId) {
    const sessionsDeal = deals.find((d) =>
      (linesByDealId.get(String(d.id)) || []).some(
        (l) =>
          l.addonKey === "freddy_ai_agent_sessions" &&
          (l.inScope || Number(l.annualValue) > 0 || l.exclusionReason === "not_quantified"),
      ),
    );
    allowanceConsumerDealId = sessionsDeal ? String(sessionsDeal.id) : null;
  }

  const products = new Set<string>();
  for (const lines of linesByDealId.values()) {
    const base = lines.find((l) => l.kind === "base" && !l.excluded);
    if (base?.product) products.add(String(base.product));
  }

  let totalArrLow = 0;
  let totalArrHigh = 0;
  let hasDealEstimates = false;
  for (const deal of deals || []) {
    if (deal.arrEstimatePoint == null) continue;
    hasDealEstimates = true;
    totalArrLow += Number(deal.arrEstimateLow ?? deal.arrEstimatePoint ?? 0);
    totalArrHigh += Number(deal.arrEstimateHigh ?? deal.arrEstimatePoint ?? 0);
  }

  const serializedLines: Record<string, FirestoreDoc[]> = {};
  for (const [dealId, lines] of linesByDealId.entries()) serializedLines[dealId] = lines;

  return {
    linesByDealId: serializedLines,
    ...includedSummary,
    attachMatrix,
    crossSellGaps,
    discussedUnquantified,
    allowanceConsumerDealId,
    productsInPlay: [...products].map(formatProductLabel),
    estimateBand: hasDealEstimates
      ? { low: totalArrLow, high: totalArrHigh, point: (totalArrLow + totalArrHigh) / 2 }
      : null,
  };
}
