/**
 * Pure ARR compute — spec §7, ADDON_ARR*, PRICE_BOOK_SEED.
 * No network, no storage. Same inputs + same books → same output.
 */

import type {
  AddonPriceBookRow,
  AssumptionsBookRow,
  PriceBookRow,
} from "../domain-model/price-book";
import {
  lookupAddonPriceBookRow,
  lookupAssumption,
  lookupPriceBookRow,
} from "../price-book/lookup";

export type VolumeUnit = "per_day" | "per_week" | "per_month" | "per_year";
export type VolumeBasis = "average" | "peak" | "projected";

export interface ArrAddonInput {
  addonKey: string;
  quantity: number | null;
  unit: string | null;
  stated: boolean;
  inScope: boolean;
}

export interface ConversationVolumeInput {
  value: number | null;
  unit: VolumeUnit | null;
  basis: VolumeBasis | null;
  confidence?: number;
  evidence?: string;
  inScope?: boolean;
}

export interface ArrBandFactors {
  agentsInferred?: boolean;
  tierInferred?: boolean;
  productAmbiguous?: boolean;
  usageUnquantified?: boolean;
}

export interface ArrComputeInput {
  agents: number;
  product: string;
  tier: string;
  term: string;
  currency: string;
  region: string | null;
  addons: ArrAddonInput[];
  conversationVolume: ConversationVolumeInput | null;
  accountAllowanceConsumed: boolean;
  bandFactors?: ArrBandFactors;
  /** SE override — bypasses assumptions book rate (ADDON_ARR_VOLUME §7 test 15). */
  aiSessionRateOverride?: number;
  /** Direct annual session count — bypasses volume chain (test 16). */
  sessionDirectOverride?: {
    annualSessions: number;
    by: string;
    at: string;
  };
  /** SE confirmed assumptions book defaults for this deal — clears assumed badge (ADDON_ARR_VOLUME §5). */
  assumptionsConfirmed?: boolean;
}

export interface ArrPriceBooks {
  version: string;
  priceBook: PriceBookRow[];
  addonPriceBook: AddonPriceBookRow[];
  assumptionsBook: AssumptionsBookRow[];
}

export interface ArrComputeConfig {
  asOf?: string;
  /** Day passes are excluded unless explicitly enabled (not committed spend). */
  includeDayPasses?: boolean;
}

export interface DerivationStep {
  step: string;
  value?: number;
  unit?: string;
  packs?: number;
  unitPrice?: number;
  annualValue?: number;
  assumptionKey?: string;
  assumptionValue?: number;
  assumptionSource?: string;
  evidence?: string;
  source?: string;
  note?: string;
  bypass?: boolean;
  overrideBy?: string;
  overrideAt?: string;
  originalChain?: DerivationStep[];
}

export interface ArrLine {
  kind: "base" | "addon";
  /** Set on base lines — which product/tier was priced. */
  product?: string;
  tier?: string;
  addonKey: string | null;
  quantity: number | null;
  unit: string | null;
  unitPrice: number | null;
  annualValue: number;
  recurring: boolean;
  stated: boolean;
  inScope: boolean;
  excluded: boolean;
  exclusionReason: string | null;
  confidence: number | null;
  tierConflict?: boolean;
  assumed?: boolean;
  derivationJson: DerivationStep[];
}

export interface ArrComputeResult {
  /** Product key used for price book lookup (e.g. freshdesk_omni). */
  product: string;
  /** Human-readable product label for display. */
  productLabel: string;
  tier: string;
  term: string;
  currency: string;
  region: string | null;
  arrPoint: number | null;
  arrLow: number | null;
  arrHigh: number | null;
  mrr: number | null;
  recurringMrr: number | null;
  consumptionMrr: number | null;
  recurringArr: number;
  consumptionArr: number;
  /** Sum of non-excluded add-on line annual values. */
  addonArr: number;
  /** Add-on share of arrPoint (0–1), null when arrPoint is zero/null. */
  addonShare: number | null;
  confidence: number | null;
  nullReason: string | null;
  lines: ArrLine[];
  priceBookVersion: string;
}

const PRODUCT_LABELS: Record<string, string> = {
  freshdesk: "Freshdesk",
  freshdesk_omni: "Freshdesk Omni",
  freshservice: "Freshservice",
  freshsales: "Freshsales",
};

export function formatProductLabel(product: string): string {
  return PRODUCT_LABELS[product] ?? product;
}

function resultContext(input: ArrComputeInput): Pick<
  ArrComputeResult,
  "product" | "productLabel" | "tier" | "term" | "currency" | "region"
> {
  return {
    product: input.product,
    productLabel: formatProductLabel(input.product),
    tier: input.tier,
    term: input.term,
    currency: input.currency,
    region: input.region,
  };
}

const SESSIONS_ADDON = "freddy_ai_agent_sessions";
const COPILOT_ADDON = "freddy_ai_copilot";
const CONNECTOR_ADDON = "connector_app_tasks";
const DAY_PASS_ADDON = "day_pass";

const ASSUMPTION_CONFIDENCE: Record<string, number> = {
  benchmark: 0.85,
  internal_estimate: 0.5,
  placeholder: 0.3,
};

const SESSION_PRODUCTS = new Set(["freshdesk", "freshdesk_omni"]);

function isRecurringUnit(unit: string): boolean {
  return unit === "agent_month" || unit === "user_month";
}

/** Annualise stated conversation volume (ADDON_ARR_VOLUME §1). */
export function normaliseConversationVolume(
  value: number,
  unit: VolumeUnit
): number {
  switch (unit) {
    case "per_day":
      return value * 365;
    case "per_week":
      return value * 52;
    case "per_month":
      return value * 12;
    case "per_year":
      return value;
    default:
      return value;
  }
}

export function mrrFromArr(arr: number): number {
  return arr / 12;
}

export function displayMrr(arr: number): number {
  return Math.round(arr / 12);
}

function assumptionConfidence(row: AssumptionsBookRow): number {
  return ASSUMPTION_CONFIDENCE[row.source] ?? 0.5;
}

function resolveAiSessionRate(
  books: ArrPriceBooks,
  asOf: string,
  override?: number
): { rate: number; row: AssumptionsBookRow | null; overridden: boolean } {
  if (override !== undefined) {
    const row = lookupAssumption(
      books.assumptionsBook,
      "ai_session_rate",
      "global",
      null,
      asOf
    );
    return { rate: override, row, overridden: true };
  }
  const row = lookupAssumption(
    books.assumptionsBook,
    "ai_session_rate",
    "global",
    null,
    asOf
  );
  if (!row) {
    return { rate: 0.5, row: null, overridden: false };
  }
  return { rate: row.value, row, overridden: false };
}

function computeBandWidth(factors: ArrBandFactors): number {
  let w = 0.1;
  if (factors.agentsInferred) w += 0.25;
  if (factors.tierInferred) w += 0.2;
  if (factors.productAmbiguous) w += 0.15;
  if (factors.usageUnquantified) w += 0.3;
  return w;
}

function regionalBlockReason(
  region: string | null,
  currency: string
): string | null {
  if (!region || region === "US") return null;
  if (currency === "USD") return "no_regional_price";
  return null;
}

function perSeatAnnual(seats: number, unitPrice: number): number {
  return seats * unitPrice * 12;
}

function priceSessionsPacks(
  billableSessions: number,
  unitPrice: number
): { packs: number; annualValue: number } {
  const packs = Math.ceil(Math.max(0, billableSessions) / 100);
  return { packs, annualValue: packs * unitPrice };
}

function priceConnectorTasks(annualTasks: number, unitPrice: number): number {
  const packs = Math.ceil(Math.max(0, annualTasks) / 5000);
  return packs * unitPrice;
}

function annualiseAddonQuantity(
  quantity: number,
  unit: string | null
): number {
  if (unit === "per_month") return quantity * 12;
  if (unit === "per_year") return quantity;
  return quantity;
}

function emptyResult(
  input: ArrComputeInput,
  books: ArrPriceBooks,
  nullReason: string,
  lines: ArrLine[] = []
): ArrComputeResult {
  return {
    ...resultContext(input),
    arrPoint: null,
    arrLow: null,
    arrHigh: null,
    mrr: null,
    recurringMrr: null,
    consumptionMrr: null,
    recurringArr: 0,
    consumptionArr: 0,
    addonArr: 0,
    addonShare: null,
    confidence: null,
    nullReason,
    lines,
    priceBookVersion: books.version,
  };
}

function addonTotals(lines: ArrLine[]): number {
  return lines
    .filter((l) => l.kind === "addon" && !l.excluded)
    .reduce((s, l) => s + l.annualValue, 0);
}

function sumIncludedLines(lines: ArrLine[]): {
  point: number;
  recurringArr: number;
  consumptionArr: number;
  confidence: number | null;
} {
  let point = 0;
  let recurringArr = 0;
  let consumptionArr = 0;
  let confidence: number | null = null;

  for (const line of lines) {
    if (line.excluded) continue;
    point += line.annualValue;
    if (line.recurring) recurringArr += line.annualValue;
    else consumptionArr += line.annualValue;
    if (line.confidence !== null) {
      confidence =
        confidence === null
          ? line.confidence
          : Math.min(confidence, line.confidence);
    }
  }

  return { point, recurringArr, consumptionArr, confidence };
}

function buildSessionsLine(
  input: ArrComputeInput,
  books: ArrPriceBooks,
  asOf: string,
  allowance: number
): ArrLine {
  const lookup = lookupAddonPriceBookRow(
    books.addonPriceBook,
    {
      addon: SESSIONS_ADDON,
      product: input.product,
      tier: input.tier,
      currency: input.currency,
      term: input.term,
    },
    asOf
  );

  const vol = input.conversationVolume;
  const sessionsAddon = input.addons.find((a) => a.addonKey === SESSIONS_ADDON);
  const inScope =
    vol?.inScope === true ||
    sessionsAddon?.inScope === true ||
    (vol?.value !== null && vol?.value !== undefined);

  if (!SESSION_PRODUCTS.has(input.product)) {
    return {
      kind: "addon",
      addonKey: SESSIONS_ADDON,
      quantity: null,
      unit: lookup.found ? lookup.row.unit : "per_100_sessions",
      unitPrice: lookup.found && !lookup.quoteOnly ? lookup.price : null,
      annualValue: 0,
      recurring: false,
      stated: false,
      inScope: false,
      excluded: true,
      exclusionReason: "product_not_applicable",
      confidence: null,
      derivationJson: [],
    };
  }

  if (!lookup.found || lookup.quoteOnly) {
    return {
      kind: "addon",
      addonKey: SESSIONS_ADDON,
      quantity: null,
      unit: "per_100_sessions",
      unitPrice: null,
      annualValue: 0,
      recurring: false,
      stated: false,
      inScope,
      excluded: true,
      exclusionReason: "no_list_price",
      confidence: null,
      derivationJson: [],
    };
  }

  const unitPrice = lookup.price;

  if (input.sessionDirectOverride) {
    const billable = input.accountAllowanceConsumed
      ? input.sessionDirectOverride.annualSessions
      : Math.max(
          0,
          input.sessionDirectOverride.annualSessions - allowance
        );
    const { packs, annualValue } = priceSessionsPacks(billable, unitPrice);
    const originalChain: DerivationStep[] = [];
    if (vol?.value !== null && vol?.value !== undefined && vol.unit) {
      const normalised = normaliseConversationVolume(vol.value, vol.unit);
      const { rate, row } = resolveAiSessionRate(
        books,
        asOf,
        input.aiSessionRateOverride
      );
      originalChain.push(
        { step: "stated", value: vol.value, unit: vol.unit, evidence: vol.evidence, source: "call" },
        { step: "normalised", value: normalised, unit: "per_year" },
        {
          step: "sessions",
          value: normalised * rate,
          assumptionKey: "ai_session_rate",
          assumptionValue: rate,
          assumptionSource: row?.source ?? "override",
        }
      );
    }
    return {
      kind: "addon",
      addonKey: SESSIONS_ADDON,
      quantity: packs,
      unit: lookup.row.unit,
      unitPrice,
      annualValue,
      recurring: false,
      stated: true,
      inScope: true,
      excluded: false,
      exclusionReason: null,
      confidence: 1,
      assumed: false,
      derivationJson: [
        {
          step: "direct_override",
          value: input.sessionDirectOverride.annualSessions,
          unit: "per_year",
          bypass: true,
          overrideBy: input.sessionDirectOverride.by,
          overrideAt: input.sessionDirectOverride.at,
          originalChain,
        },
        {
          step: "billable",
          value: billable,
          note: input.accountAllowanceConsumed
            ? "account allowance already consumed"
            : `less ${allowance} account allowance`,
        },
        { step: "priced", packs, unitPrice, annualValue },
      ],
    };
  }

  if (vol?.basis === "peak") {
    return {
      kind: "addon",
      addonKey: SESSIONS_ADDON,
      quantity: vol.value,
      unit: vol.unit,
      unitPrice,
      annualValue: 0,
      recurring: false,
      stated: vol.value !== null,
      inScope: true,
      excluded: true,
      exclusionReason: "peak_basis_unresolved",
      confidence: vol.confidence ?? null,
      derivationJson: [
        {
          step: "stated",
          value: vol.value ?? undefined,
          unit: vol.unit ?? undefined,
          evidence: vol.evidence,
          source: "call",
          note: "peak basis — not annualised until SE resolves",
        },
      ],
    };
  }

  // Direct stated session quantity (ADDON_ARR §2) — no ai_session_rate.
  if (
    sessionsAddon?.quantity !== null &&
    sessionsAddon?.quantity !== undefined &&
    (vol?.value === null || vol?.value === undefined)
  ) {
    const annualSessions = annualiseAddonQuantity(
      sessionsAddon.quantity,
      sessionsAddon.unit ?? "per_month"
    );
    const billable = input.accountAllowanceConsumed
      ? annualSessions
      : Math.max(0, annualSessions - allowance);
    const { packs, annualValue } = priceSessionsPacks(billable, unitPrice);
    return {
      kind: "addon",
      addonKey: SESSIONS_ADDON,
      quantity: packs,
      unit: lookup.row.unit,
      unitPrice,
      annualValue,
      recurring: false,
      stated: sessionsAddon.stated,
      inScope: sessionsAddon.inScope,
      excluded: false,
      exclusionReason: null,
      confidence: sessionsAddon.stated ? 1 : 0.75,
      derivationJson: [
        {
          step: "stated",
          value: sessionsAddon.quantity,
          unit: sessionsAddon.unit ?? "per_month",
          source: "call",
        },
        { step: "normalised", value: annualSessions, unit: "per_year" },
        {
          step: "billable",
          value: billable,
          note: input.accountAllowanceConsumed
            ? "account allowance already consumed"
            : `less ${allowance} account allowance`,
        },
        { step: "priced", packs, unitPrice, annualValue },
      ],
    };
  }

  if (
    vol?.value === null ||
    vol?.value === undefined ||
    (sessionsAddon?.inScope && sessionsAddon.quantity === null)
  ) {
    if (inScope) {
      return {
        kind: "addon",
        addonKey: SESSIONS_ADDON,
        quantity: null,
        unit: lookup.row.unit,
        unitPrice,
        annualValue: 0,
        recurring: false,
        stated: false,
        inScope: true,
        excluded: true,
        exclusionReason: "not_quantified",
        confidence: null,
        derivationJson: [],
      };
    }
    return {
      kind: "addon",
      addonKey: SESSIONS_ADDON,
      quantity: null,
      unit: lookup.row.unit,
      unitPrice,
      annualValue: 0,
      recurring: false,
      stated: false,
      inScope: false,
      excluded: true,
      exclusionReason: "not_in_scope",
      confidence: null,
      derivationJson: [],
    };
  }

  const statedConfidence = vol.confidence ?? 1;
  const assumptionsConfirmed = input.assumptionsConfirmed === true;
  const { rate, row, overridden } = resolveAiSessionRate(
    books,
    asOf,
    input.aiSessionRateOverride
  );
  const rateConfidence =
    overridden || assumptionsConfirmed ? 1 : row ? assumptionConfidence(row) : 0.5;
  const lineConfidence = statedConfidence * rateConfidence;

  const normalised = normaliseConversationVolume(vol.value, vol.unit!);
  const annualSessions = normalised * rate;
  const billable = input.accountAllowanceConsumed
    ? annualSessions
    : Math.max(0, annualSessions - allowance);
  const { packs, annualValue } = priceSessionsPacks(billable, unitPrice);

  return {
    kind: "addon",
    addonKey: SESSIONS_ADDON,
    quantity: packs,
    unit: lookup.row.unit,
    unitPrice,
    annualValue,
    recurring: false,
    stated: true,
    inScope: true,
    excluded: false,
    exclusionReason: null,
    confidence: lineConfidence,
    assumed: !overridden && !assumptionsConfirmed,
    derivationJson: [
      {
        step: "stated",
        value: vol.value,
        unit: vol.unit ?? undefined,
        evidence: vol.evidence,
        source: "call",
      },
      { step: "normalised", value: normalised, unit: "per_year" },
      {
        step: "sessions",
        value: annualSessions,
        assumptionKey: "ai_session_rate",
        assumptionValue: rate,
        assumptionSource: row?.source ?? "se_override",
        note: overridden ? "SE override" : undefined,
      },
      {
        step: "billable",
        value: billable,
        note: input.accountAllowanceConsumed
          ? "account allowance already consumed"
          : `less ${allowance} account allowance`,
      },
      { step: "priced", packs, unitPrice, annualValue },
    ],
  };
}

function findCopilotBookRow(
  books: ArrPriceBooks,
  product: string,
  currency: string,
  term: string,
  asOf: string
): AddonPriceBookRow | null {
  const matches = books.addonPriceBook.filter(
    (row) =>
      row.addon === COPILOT_ADDON &&
      row.appliesTo.includes(product) &&
      row.currency === currency &&
      row.term === term &&
      asOf >= row.effectiveFrom &&
      (row.effectiveTo === null || asOf <= row.effectiveTo)
  );
  if (matches.length === 0) return null;
  matches.sort((a, b) => b.effectiveFrom.localeCompare(a.effectiveFrom));
  return matches[0] ?? null;
}

function buildCopilotLine(
  input: ArrComputeInput,
  addon: ArrAddonInput,
  books: ArrPriceBooks,
  asOf: string
): ArrLine {
  const bookRow = findCopilotBookRow(
    books,
    input.product,
    input.currency,
    input.term,
    asOf
  );
  const lookup = lookupAddonPriceBookRow(
    books.addonPriceBook,
    {
      addon: COPILOT_ADDON,
      product: input.product,
      tier: input.tier,
      currency: input.currency,
      term: input.term,
    },
    asOf
  );

  const seats = addon.quantity ?? 0;
  const tierBlocked =
    bookRow !== null &&
    bookRow.requiresTier.length > 0 &&
    !bookRow.requiresTier.includes(input.tier);

  if (tierBlocked) {
    return {
      kind: "addon",
      addonKey: COPILOT_ADDON,
      quantity: seats,
      unit: bookRow.unit,
      unitPrice: bookRow.price,
      annualValue: 0,
      recurring: true,
      stated: addon.stated,
      inScope: addon.inScope,
      excluded: true,
      exclusionReason: "tier_conflict",
      tierConflict: true,
      confidence: addon.stated ? 1 : 0.75,
      derivationJson: [
        {
          step: "tier_conflict",
          note: `Copilot requires ${bookRow.requiresTier.join("/")}; deal tier is ${input.tier}`,
        },
      ],
    };
  }

  if (!lookup.found || lookup.quoteOnly) {
    return {
      kind: "addon",
      addonKey: COPILOT_ADDON,
      quantity: seats,
      unit: "agent_month",
      unitPrice: null,
      annualValue: 0,
      recurring: true,
      stated: addon.stated,
      inScope: addon.inScope,
      excluded: true,
      exclusionReason: "no_list_price",
      confidence: null,
      derivationJson: [],
    };
  }

  const annualValue = perSeatAnnual(seats, lookup.price);
  return {
    kind: "addon",
    addonKey: COPILOT_ADDON,
    quantity: seats,
    unit: lookup.row.unit,
    unitPrice: lookup.price,
    annualValue,
    recurring: true,
    stated: addon.stated,
    inScope: addon.inScope,
    excluded: seats === 0,
    exclusionReason: seats === 0 ? "zero_quantity" : null,
    confidence: addon.stated ? 1 : 0.75,
    derivationJson: [
      {
        step: "priced",
        value: seats,
        unit: lookup.row.unit,
        unitPrice: lookup.price,
        annualValue,
      },
    ],
  };
}

function buildConnectorLine(
  input: ArrComputeInput,
  addon: ArrAddonInput,
  books: ArrPriceBooks,
  asOf: string
): ArrLine {
  const lookup = lookupAddonPriceBookRow(
    books.addonPriceBook,
    {
      addon: CONNECTOR_ADDON,
      product: input.product,
      tier: input.tier,
      currency: input.currency,
      term: input.term,
    },
    asOf
  );

  if (!lookup.found || lookup.quoteOnly) {
    return {
      kind: "addon",
      addonKey: CONNECTOR_ADDON,
      quantity: addon.quantity,
      unit: addon.unit,
      unitPrice: null,
      annualValue: 0,
      recurring: false,
      stated: addon.stated,
      inScope: addon.inScope,
      excluded: true,
      exclusionReason: "no_list_price",
      confidence: null,
      derivationJson: [],
    };
  }

  if (addon.quantity === null || addon.quantity === undefined) {
    return {
      kind: "addon",
      addonKey: CONNECTOR_ADDON,
      quantity: null,
      unit: lookup.row.unit,
      unitPrice: lookup.price,
      annualValue: 0,
      recurring: false,
      stated: addon.stated,
      inScope: addon.inScope,
      excluded: true,
      exclusionReason: addon.inScope ? "not_quantified" : "not_in_scope",
      confidence: null,
      derivationJson: [],
    };
  }

  const annualTasks = annualiseAddonQuantity(addon.quantity, addon.unit);
  const annualValue = priceConnectorTasks(annualTasks, lookup.price);
  const packs = Math.ceil(annualTasks / 5000);

  return {
    kind: "addon",
    addonKey: CONNECTOR_ADDON,
    quantity: packs,
    unit: lookup.row.unit,
    unitPrice: lookup.price,
    annualValue,
    recurring: false,
    stated: addon.stated,
    inScope: addon.inScope,
    excluded: false,
    exclusionReason: null,
    confidence: addon.stated ? 1 : 0.75,
    derivationJson: [
      { step: "stated", value: addon.quantity, unit: addon.unit ?? undefined },
      { step: "normalised", value: annualTasks, unit: "per_year" },
      {
        step: "priced",
        packs,
        unitPrice: lookup.price,
        annualValue,
      },
    ],
  };
}

function buildDayPassLine(
  input: ArrComputeInput,
  addon: ArrAddonInput,
  books: ArrPriceBooks,
  asOf: string,
  config: ArrComputeConfig
): ArrLine {
  const lookup = lookupAddonPriceBookRow(
    books.addonPriceBook,
    {
      addon: DAY_PASS_ADDON,
      product: input.product,
      tier: input.tier,
      currency: input.currency,
      term: input.term,
    },
    asOf
  );

  if (!config.includeDayPasses) {
    return {
      kind: "addon",
      addonKey: DAY_PASS_ADDON,
      quantity: addon.quantity,
      unit: addon.unit ?? "per_pass",
      unitPrice: lookup.found && !lookup.quoteOnly ? lookup.price : null,
      annualValue: 0,
      recurring: false,
      stated: addon.stated,
      inScope: addon.inScope,
      excluded: true,
      exclusionReason: "not_committed_spend",
      confidence: null,
      derivationJson: [
        { step: "excluded", note: "day passes are not committed spend by default" },
      ],
    };
  }

  if (!lookup.found || lookup.quoteOnly || addon.quantity === null) {
    return {
      kind: "addon",
      addonKey: DAY_PASS_ADDON,
      quantity: addon.quantity,
      unit: "per_pass",
      unitPrice: null,
      annualValue: 0,
      recurring: false,
      stated: addon.stated,
      inScope: addon.inScope,
      excluded: true,
      exclusionReason:
        addon.quantity === null ? "not_quantified" : "no_list_price",
      confidence: null,
      derivationJson: [],
    };
  }

  const annualValue = addon.quantity * lookup.price;
  return {
    kind: "addon",
    addonKey: DAY_PASS_ADDON,
    quantity: addon.quantity,
    unit: lookup.row.unit,
    unitPrice: lookup.price,
    annualValue,
    recurring: false,
    stated: addon.stated,
    inScope: addon.inScope,
    excluded: false,
    exclusionReason: null,
    confidence: addon.stated ? 1 : 0.75,
    derivationJson: [
      {
        step: "priced",
        value: addon.quantity,
        unitPrice: lookup.price,
        annualValue,
      },
    ],
  };
}

function buildGenericAddonLine(
  input: ArrComputeInput,
  addon: ArrAddonInput,
  books: ArrPriceBooks,
  asOf: string
): ArrLine {
  const lookup = lookupAddonPriceBookRow(
    books.addonPriceBook,
    {
      addon: addon.addonKey,
      product: input.product,
      tier: input.tier,
      currency: input.currency,
      term: input.term,
    },
    asOf
  );

  if (!lookup.found) {
    return {
      kind: "addon",
      addonKey: addon.addonKey,
      quantity: addon.quantity,
      unit: addon.unit,
      unitPrice: null,
      annualValue: 0,
      recurring: false,
      stated: addon.stated,
      inScope: addon.inScope,
      excluded: true,
      exclusionReason: "addon_not_found",
      confidence: null,
      derivationJson: [],
    };
  }

  if (lookup.quoteOnly) {
    return {
      kind: "addon",
      addonKey: addon.addonKey,
      quantity: addon.quantity,
      unit: lookup.row.unit,
      unitPrice: null,
      annualValue: 0,
      recurring: isRecurringUnit(lookup.row.unit),
      stated: addon.stated,
      inScope: addon.inScope,
      excluded: true,
      exclusionReason: "no_list_price",
      confidence: null,
      derivationJson: [],
    };
  }

  const unit = lookup.row.unit;
  const recurring = isRecurringUnit(unit);
  let annualValue = 0;
  if (addon.quantity !== null) {
    if (recurring) {
      annualValue = perSeatAnnual(addon.quantity, lookup.price);
    } else {
      annualValue = addon.quantity * lookup.price;
    }
  }

  return {
    kind: "addon",
    addonKey: addon.addonKey,
    quantity: addon.quantity,
    unit,
    unitPrice: lookup.price,
    annualValue,
    recurring,
    stated: addon.stated,
    inScope: addon.inScope,
    excluded: addon.quantity === null,
    exclusionReason: addon.quantity === null ? "not_quantified" : null,
    confidence: addon.stated ? 1 : 0.75,
    derivationJson: annualValue
      ? [{ step: "priced", unitPrice: lookup.price, annualValue }]
      : [],
  };
}

export function computeArr(
  input: ArrComputeInput,
  books: ArrPriceBooks,
  config: ArrComputeConfig = {}
): ArrComputeResult {
  const asOf = config.asOf ?? "2026-07-24";
  const lines: ArrLine[] = [];

  const regionalReason = regionalBlockReason(input.region, input.currency);
  if (regionalReason) {
    return emptyResult(input, books, regionalReason);
  }

  const baseLookup = lookupPriceBookRow(
    books.priceBook,
    {
      product: input.product,
      tier: input.tier,
      currency: input.currency,
      term: input.term,
    },
    asOf
  );

  if (!baseLookup.found) {
    if (input.term === "monthly") {
      return emptyResult(input, books, "no_monthly_price_row");
    }
    return emptyResult(input, books, "no_price_row");
  }

  if (baseLookup.quoteOnly) {
    return emptyResult(input, books, "no_list_price");
  }

  const baseAnnual = perSeatAnnual(input.agents, baseLookup.price);
  lines.push({
    kind: "base",
    product: input.product,
    tier: input.tier,
    addonKey: null,
    quantity: input.agents,
    unit: baseLookup.row.unit,
    unitPrice: baseLookup.price,
    annualValue: baseAnnual,
    recurring: isRecurringUnit(baseLookup.row.unit),
    stated: !(input.bandFactors?.agentsInferred ?? false),
    inScope: true,
    excluded: false,
    exclusionReason: null,
    confidence: input.bandFactors?.agentsInferred ? 0.75 : 1,
    derivationJson: [
      {
        step: "priced",
        value: input.agents,
        unit: baseLookup.row.unit,
        unitPrice: baseLookup.price,
        annualValue: baseAnnual,
      },
    ],
  });

  const sessionsBookLookup = lookupAddonPriceBookRow(
    books.addonPriceBook,
    {
      addon: SESSIONS_ADDON,
      product: input.product,
      tier: input.tier,
      currency: input.currency,
      term: input.term,
    },
    asOf
  );
  const sessionAllowance =
    sessionsBookLookup.found && !sessionsBookLookup.quoteOnly
      ? sessionsBookLookup.row.includedUnits
      : 500;

  const hasExplicitSessionsAddon = input.addons.some(
    (a) => a.addonKey === SESSIONS_ADDON
  );
  if (
    input.conversationVolume ||
    hasExplicitSessionsAddon ||
    input.sessionDirectOverride
  ) {
    lines.push(
      buildSessionsLine(input, books, asOf, sessionAllowance)
    );
  }

  for (const addon of input.addons) {
    if (addon.addonKey === SESSIONS_ADDON) continue;
    if (addon.addonKey === COPILOT_ADDON) {
      lines.push(buildCopilotLine(input, addon, books, asOf));
    } else if (addon.addonKey === CONNECTOR_ADDON) {
      lines.push(buildConnectorLine(input, addon, books, asOf));
    } else if (addon.addonKey === DAY_PASS_ADDON) {
      lines.push(buildDayPassLine(input, addon, books, asOf, config));
    } else {
      lines.push(buildGenericAddonLine(input, addon, books, asOf));
    }
  }

  const totals = sumIncludedLines(lines);
  const bandFactors: ArrBandFactors = {
    ...input.bandFactors,
    usageUnquantified:
      input.bandFactors?.usageUnquantified ??
      lines.some(
        (l) =>
          l.inScope &&
          l.excluded &&
          (l.exclusionReason === "not_quantified" ||
            l.exclusionReason === "peak_basis_unresolved")
      ),
  };
  const bandWidth = computeBandWidth(bandFactors);

  const arrPoint = totals.point;
  const arrLow = arrPoint * (1 - bandWidth);
  const arrHigh = arrPoint * (1 + bandWidth);
  const mrr = mrrFromArr(arrPoint);
  const recurringMrr = mrrFromArr(totals.recurringArr);
  const consumptionMrr = mrrFromArr(totals.consumptionArr);
  const addonArr = addonTotals(lines);
  const addonShare =
    arrPoint !== null && arrPoint > 0 ? addonArr / arrPoint : null;

  return {
    ...resultContext(input),
    arrPoint,
    arrLow,
    arrHigh,
    mrr,
    recurringMrr,
    consumptionMrr,
    recurringArr: totals.recurringArr,
    consumptionArr: totals.consumptionArr,
    addonArr,
    addonShare,
    confidence: totals.confidence,
    nullReason: null,
    lines,
    priceBookVersion: books.version,
  };
}
