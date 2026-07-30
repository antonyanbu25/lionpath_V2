/**
 * Map extracted ARR inputs (arr-inputs pass) → computeArr input. Pure — no LLM, no I/O.
 */

import type { ArrInputsDraft, ArrAddonInputLine, ArrVolumeInput } from "../postcall/arr-inputs";
import type {
  ArrAddonInput,
  ArrBandFactors,
  ArrComputeInput,
  ConversationVolumeInput,
} from "./compute";

const CONNECTOR_ADDON = "connector_app_tasks";
const SESSIONS_ADDON = "freddy_ai_agent_sessions";

export interface MapArrInputsOptions {
  accountAllowanceConsumed?: boolean;
  aiSessionRateOverride?: number;
  sessionDirectOverride?: ArrComputeInput["sessionDirectOverride"];
  assumptionsConfirmed?: boolean;
  /** When true, tier/product/agent inference widens confidence bands. */
  tierInferred?: boolean;
  agentsInferred?: boolean;
}

export interface MapArrInputsResult {
  input: ArrComputeInput | null;
  errors: string[];
  bandFactors: ArrBandFactors;
}

function toConversationVolume(
  vol: ArrVolumeInput | null,
): ConversationVolumeInput | null {
  if (!vol) return null;
  return {
    value: vol.value,
    unit: vol.unit,
    basis: vol.basis,
    confidence: vol.confidence,
    evidence: vol.evidence,
    inScope: vol.inScope,
  };
}

function toComputeAddon(line: ArrAddonInputLine): ArrAddonInput {
  return {
    addonKey: line.addonKey,
    quantity: line.quantity,
    unit: line.unit,
    stated: line.stated,
    inScope: line.inScope,
  };
}

function mergeConnectorVolume(
  draft: ArrInputsDraft,
  addons: ArrAddonInput[],
): ArrAddonInput[] {
  const ct = draft.connectorTasks;
  if (!ct || ct.value === null) return addons;

  const existing = addons.find((a) => a.addonKey === CONNECTOR_ADDON);
  if (existing?.quantity !== null && existing?.quantity !== undefined) {
    return addons;
  }

  const rest = addons.filter((a) => a.addonKey !== CONNECTOR_ADDON);
  rest.push({
    addonKey: CONNECTOR_ADDON,
    quantity: ct.value,
    unit: ct.unit ?? "per_month",
    stated: true,
    inScope: ct.inScope,
  });
  return rest;
}

function ensureSessionsInScopeAddon(
  draft: ArrInputsDraft,
  addons: ArrAddonInput[],
): ArrAddonInput[] {
  const vol = draft.conversationVolume;
  const needsInScopeLine =
    vol?.inScope === true &&
    (vol.value === null || vol.value === undefined) &&
    !addons.some((a) => a.addonKey === SESSIONS_ADDON);

  if (!needsInScopeLine) return addons;

  return [
    ...addons,
    {
      addonKey: SESSIONS_ADDON,
      quantity: null,
      unit: null,
      stated: false,
      inScope: true,
    },
  ];
}

function deriveBandFactors(
  draft: ArrInputsDraft,
  options: MapArrInputsOptions,
): ArrBandFactors {
  const usageUnquantified =
    draft.addons.some((a) => a.inScope && a.quantity === null) ||
    (draft.conversationVolume?.inScope === true &&
      (draft.conversationVolume.value === null ||
        draft.conversationVolume.basis === "peak")) ||
    (draft.connectorTasks?.inScope === true &&
      draft.connectorTasks.value === null);

  return {
    agentsInferred: options.agentsInferred ?? false,
    tierInferred: options.tierInferred ?? true,
    productAmbiguous: false,
    usageUnquantified,
  };
}

/** Map normalized extraction output to computeArr input. */
export function mapArrInputsToComputeInput(
  draft: ArrInputsDraft,
  options: MapArrInputsOptions = {},
): MapArrInputsResult {
  const errors: string[] = [];

  if (draft.agents === null || draft.agents === undefined || draft.agents <= 0) {
    errors.push("agents is required and must be a positive integer.");
  }
  if (!draft.product) {
    errors.push("product is required.");
  }
  if (!draft.tier) {
    errors.push("tier is required.");
  }

  const bandFactors = deriveBandFactors(draft, options);

  if (errors.length) {
    return { input: null, errors, bandFactors };
  }

  let addons = draft.addons.map(toComputeAddon);
  addons = mergeConnectorVolume(draft, addons);
  addons = ensureSessionsInScopeAddon(draft, addons);

  const input: ArrComputeInput = {
    agents: draft.agents!,
    product: draft.product!,
    tier: draft.tier!,
    term: draft.term,
    currency: draft.currency,
    region: draft.region,
    addons,
    conversationVolume: toConversationVolume(draft.conversationVolume),
    accountAllowanceConsumed: options.accountAllowanceConsumed ?? false,
    bandFactors,
    aiSessionRateOverride: options.aiSessionRateOverride,
    sessionDirectOverride: options.sessionDirectOverride,
    assumptionsConfirmed: options.assumptionsConfirmed,
  };

  return { input, errors: [], bandFactors };
}
