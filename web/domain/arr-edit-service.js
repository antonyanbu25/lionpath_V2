/**
 * Deal ARR inline edit — merge inputs, worker compute, override log (ADDON_ARR_VOLUME §5, ADDON_ARR_MRR §5).
 * All arithmetic stays in worker computeArr(); browser only merges and displays.
 */

import { WORKER_BASE_URL } from "../firebase-config.js";
import { getStore } from "./store.js";
import { newId, now } from "./types.js";
import {
  accountAllowanceConsumedForDeal,
  persistArrLines,
  persistDealArrEstimate,
  selectLatestArrLines,
} from "./arr-service.js";

const ARR_COMPUTE_URL = `${WORKER_BASE_URL}/api/postcall/arr-compute`;
export const ARR_DISPLAY_UNIT_KEY = "lionpath.arrDisplayUnit";

const COPILOT_ADDON = "freddy_ai_copilot";
const CONNECTOR_ADDON = "connector_app_tasks";

/** @typedef {"ARR"|"MRR"} ArrDisplayUnit */
/** @typedef {"stated"|"derived"|"se_override"} ArrProvenanceKind */

/**
 * @returns {ArrDisplayUnit}
 */
export function getArrDisplayUnit() {
  try {
    const v = localStorage.getItem(ARR_DISPLAY_UNIT_KEY);
    return v === "MRR" ? "MRR" : "ARR";
  } catch {
    return "ARR";
  }
}

/** @param {ArrDisplayUnit} unit */
export function setArrDisplayUnit(unit) {
  try {
    localStorage.setItem(ARR_DISPLAY_UNIT_KEY, unit === "MRR" ? "MRR" : "ARR");
  } catch {
    /* ignore */
  }
}

/** @param {number|null|undefined} arr @param {ArrDisplayUnit} unit */
export function displayMoneyAmount(arr, unit = "ARR") {
  if (arr == null || !Number.isFinite(arr)) return null;
  if (unit === "MRR") return Math.round(arr / 12);
  return Math.round(arr);
}

/**
 * @param {number|null|undefined} raw @param {ArrDisplayUnit} displayUnit
 * @param {"per_month"|"per_year"|null} [quantityUnit]
 */
export function parseEditedMoneyToArr(raw, displayUnit, quantityUnit = null) {
  if (raw == null || raw === "") return null;
  const n = Number(raw);
  if (!Number.isFinite(n)) return null;
  if (quantityUnit === "per_month") {
    return displayUnit === "MRR" ? n * 12 : n;
  }
  return displayUnit === "MRR" ? n * 12 : n;
}

/** @param {object|null|undefined} deal */
export function readArrEdits(deal) {
  return deal?.metadata?.arrEdits || {};
}

/**
 * @param {object|null|undefined} deal
 * @param {object[]} lines
 */
export function buildArrFieldState(deal, lines) {
  const inputs = deal?.arrInputsJson || {};
  const edits = readArrEdits(deal);
  const fields = edits.fields || {};
  const latestLines = selectLatestArrLines(lines || []);

  const copilotAddon = (inputs.addons || []).find((a) => a.addonKey === COPILOT_ADDON);
  const sessionsLine = latestLines.find((l) => l.addonKey === "freddy_ai_agent_sessions");
  const sessionsChain = sessionsLine?.derivationJson || [];
  const statedStep = sessionsChain.find((s) => s.step === "stated");
  const sessionsStep = sessionsChain.find((s) => s.step === "sessions");
  const directStep = sessionsChain.find((s) => s.step === "direct_override");

  const defaultRate =
    fields.aiSessionRate?.value ??
    sessionsStep?.assumptionValue ??
    0.5;

  return {
    assumptionsConfirmed: !!edits.assumptionsConfirmed,
    agents: mergeFieldState("agents", fields.agents, {
      value: inputs.agents,
      provenance: inputs.agentsEvidence
        ? "stated"
        : inputs.agents != null
          ? "derived"
          : "derived",
      sourceLabel: inputs.agentsEvidence
        ? `"${inputs.agentsEvidence}"`
        : inputs.agents != null
          ? "Inferred from call. not directly quoted"
          : "Not extracted",
      sourceDetail: inputs.agentsEvidence || null,
    }),
    conversationVolume: mergeFieldState("conversationVolume", fields.conversationVolume, {
      value: fields.conversationVolume?.value ?? inputs.conversationVolume?.value ?? statedStep?.value ?? null,
      unit:
        fields.conversationVolume?.unit ??
        inputs.conversationVolume?.unit ??
        statedStep?.unit ??
        "per_month",
      provenance: fields.conversationVolume?.provenance ?? (statedStep?.source === "call" ? "stated" : "derived"),
      sourceLabel:
        fields.conversationVolume?.sourceLabel ??
        (inputs.conversationVolume?.evidence
          ? `"${inputs.conversationVolume.evidence}"`
          : statedStep?.evidence
            ? `"${statedStep.evidence}"`
            : "Not stated on call"),
      sourceDetail:
        fields.conversationVolume?.sourceDetail ??
        inputs.conversationVolume?.evidence ??
        statedStep?.evidence ??
        null,
    }),
    aiSessionRate: mergeFieldState("aiSessionRate", fields.aiSessionRate, {
      value: defaultRate,
      provenance:
        fields.aiSessionRate?.provenance ??
        (sessionsStep?.assumptionSource === "internal_estimate" ? "derived" : "derived"),
      sourceLabel:
        fields.aiSessionRate?.sourceLabel ??
        `Assumption: ai_session_rate (${Math.round(defaultRate * 100)}% of volume)`,
      sourceDetail: sessionsStep?.assumptionSource || "internal_estimate",
    }),
    copilotSeats: mergeFieldState("copilotSeats", fields.copilotSeats, {
      value: fields.copilotSeats?.value ?? copilotAddon?.quantity ?? null,
      provenance:
        fields.copilotSeats?.provenance ??
        (copilotAddon?.stated ? "stated" : copilotAddon?.quantity != null ? "derived" : "derived"),
      sourceLabel:
        fields.copilotSeats?.sourceLabel ??
        (copilotAddon?.evidence ? `"${copilotAddon.evidence}"` : "Extracted from call"),
      sourceDetail: copilotAddon?.evidence || null,
    }),
    connectorTasks: mergeFieldState("connectorTasks", fields.connectorTasks, {
      value:
        fields.connectorTasks?.value ??
        inputs.connectorTasks?.value ??
        null,
      unit: fields.connectorTasks?.unit ?? inputs.connectorTasks?.unit ?? "per_month",
      provenance:
        fields.connectorTasks?.provenance ??
        (inputs.connectorTasks?.evidence ? "stated" : "derived"),
      sourceLabel:
        fields.connectorTasks?.sourceLabel ??
        (inputs.connectorTasks?.evidence
          ? `"${inputs.connectorTasks.evidence}"`
          : "Not stated on call"),
      sourceDetail: inputs.connectorTasks?.evidence || null,
    }),
    sessionDirectOverride: mergeFieldState(
      "sessionDirectOverride",
      fields.sessionDirectOverride,
      {
        value: fields.sessionDirectOverride?.value ?? directStep?.value ?? null,
        provenance: fields.sessionDirectOverride?.provenance ?? (directStep ? "se_override" : "derived"),
        sourceLabel:
          fields.sessionDirectOverride?.sourceLabel ??
          (directStep ? "Direct session override" : "Derived from volume chain"),
        sourceDetail: directStep?.overrideBy || null,
      },
    ),
  };
}

/**
 * @param {string} _key
 * @param {object|undefined} saved
 * @param {object} defaults
 */
function mergeFieldState(_key, saved, defaults) {
  const out = {
    value: saved?.value ?? defaults.value ?? null,
    unit: saved?.unit ?? defaults.unit ?? null,
    provenance: saved?.provenance ?? defaults.provenance ?? "derived",
    sourceLabel: saved?.sourceLabel ?? defaults.sourceLabel ?? "",
    sourceDetail: saved?.sourceDetail ?? defaults.sourceDetail ?? null,
    previousValue: saved?.previousValue ?? null,
    previousUnit: saved?.previousUnit ?? null,
    editedBy: saved?.editedBy ?? null,
    editedAt: saved?.editedAt ?? null,
  };
  if (saved?.sourceLabel) out.sourceLabel = saved.sourceLabel;
  return out;
}

/**
 * @param {object|null|undefined} deal
 * @param {ReturnType<typeof buildArrFieldState>} fieldState
 * @param {object} [opts]
 */
export function mergeDraftForCompute(deal, fieldState, opts = {}) {
  const base = deal?.arrInputsJson || {};
  const edits = readArrEdits(deal);
  const addons = (base.addons || []).map((a) => ({ ...a }));

  let copilot = addons.find((a) => a.addonKey === COPILOT_ADDON);
  if (!copilot && fieldState.copilotSeats.value != null) {
    copilot = {
      addonKey: COPILOT_ADDON,
      quantity: null,
      unit: "agent_month",
      stated: false,
      inScope: true,
      evidence: "",
      confidence: 0.75,
    };
    addons.push(copilot);
  }
  if (copilot && fieldState.copilotSeats.value != null) {
    copilot.quantity = fieldState.copilotSeats.value;
  }

  const draft = {
    ...base,
    agents: fieldState.agents.value ?? base.agents,
    addons,
    conversationVolume: base.conversationVolume
      ? { ...base.conversationVolume }
      : fieldState.conversationVolume.value != null
        ? {
            value: null,
            unit: null,
            basis: "average",
            channelMix: [],
            evidence: fieldState.conversationVolume.sourceDetail || "",
            confidence: 0.9,
            inScope: true,
          }
        : null,
    connectorTasks: base.connectorTasks
      ? { ...base.connectorTasks }
      : fieldState.connectorTasks.value != null
        ? {
            value: null,
            unit: "per_month",
            basis: "average",
            channelMix: [],
            evidence: "",
            confidence: 0.75,
            inScope: true,
          }
        : null,
  };

  if (fieldState.conversationVolume.value != null) {
    draft.conversationVolume = {
      ...(draft.conversationVolume || {
        basis: "average",
        channelMix: [],
        confidence: 0.9,
        inScope: true,
      }),
      value: fieldState.conversationVolume.value,
      unit: fieldState.conversationVolume.unit || "per_month",
      evidence:
        fieldState.conversationVolume.sourceDetail ||
        draft.conversationVolume?.evidence ||
        "SE edit",
      inScope: true,
    };
  }

  if (fieldState.connectorTasks.value != null) {
    draft.connectorTasks = {
      ...(draft.connectorTasks || {
        basis: "average",
        channelMix: [],
        confidence: 0.75,
        inScope: true,
      }),
      value: fieldState.connectorTasks.value,
      unit: fieldState.connectorTasks.unit || "per_month",
      evidence:
        fieldState.connectorTasks.sourceDetail ||
        draft.connectorTasks?.evidence ||
        "SE edit",
      inScope: true,
    };
  }

  const computeOpts = {
    accountAllowanceConsumed: opts.accountAllowanceConsumed ?? false,
    assumptionsConfirmed:
      opts.assumptionsConfirmed ?? fieldState.assumptionsConfirmed ?? false,
  };

  if (
    fieldState.aiSessionRate?.value != null &&
    (fieldState.aiSessionRate.provenance === "se_override" ||
      fieldState.aiSessionRate.value !== 0.5)
  ) {
    computeOpts.aiSessionRateOverride = fieldState.aiSessionRate.value;
  }

  if (fieldState.sessionDirectOverride?.value != null) {
    const by = opts.userLabel || edits.confirmedBy || "se";
    computeOpts.sessionDirectOverride = {
      annualSessions: fieldState.sessionDirectOverride.value,
      by,
      at: new Date().toISOString(),
    };
  }

  return { draft, computeOpts };
}

/**
 * @param {object} draft
 * @param {object} computeOpts
 * @param {() => Promise<Record<string, string>>} getAuthHeaders
 */
export async function fetchArrCompute(draft, computeOpts, getAuthHeaders) {
  const headers = await getAuthHeaders();
  const res = await fetch(ARR_COMPUTE_URL, {
    method: "POST",
    headers: { "Content-Type": "application/json", ...headers },
    body: JSON.stringify({ ...draft, ...computeOpts }),
  });
  const raw = await res.text();
  let data;
  try {
    data = JSON.parse(raw);
  } catch {
    throw new Error(raw.slice(0, 300) || `ARR compute failed (${res.status}).`);
  }
  if (!res.ok) throw new Error(data.error || `ARR compute failed (${res.status}).`);
  return data;
}

/**
 * @param {object} deal
 * @param {string} fieldKey
 * @param {unknown} newValue
 * @param {object} prevField
 * @param {string} userId
 * @param {ArrDisplayUnit} displayUnit
 */
export function patchFieldEdit(deal, fieldKey, newValue, prevField, userId, displayUnit) {
  const edits = readArrEdits(deal);
  const fields = { ...(edits.fields || {}) };
  const at = now();
  const prev = fields[fieldKey] || prevField;

  /** @type {Record<string, unknown>} */
  const next = {
    ...(typeof newValue === "object" && newValue ? newValue : { value: newValue }),
    provenance: "se_override",
    sourceLabel: `SE edit (${displayUnit})`,
    sourceDetail: null,
    previousValue: prev?.value ?? null,
    previousUnit: prev?.unit ?? null,
    editedBy: userId,
    editedAt: at,
  };

  fields[fieldKey] = next;

  return {
    metadata: {
      ...(deal.metadata || {}),
      arrEdits: {
        ...edits,
        fields,
      },
    },
  };
}

/**
 * @param {string} dealId
 * @param {object} deal
 * @param {object} computeResult
 * @param {object} ctx
 */
export async function persistDealArrRecompute(dealId, deal, computeResult, ctx) {
  const store = getStore();
  const computedAt = now();
  const latestLines = store.listArrLinesByDeal
    ? await store.listArrLinesByDeal(dealId)
    : [];
  const callId =
    selectLatestArrLines(latestLines)[0]?.callId ||
    (store.listPostCallsByDeal ? (await store.listPostCallsByDeal(dealId, 1))[0]?.id : null) ||
    `deal_${dealId}`;

  const persistCtx = {
    callId,
    dealId,
    accountId: deal.accountId,
    ownerId: deal.ownerId,
    teamId: deal.teamId,
    orgId: deal.orgId,
  };

  await persistArrLines(computeResult, persistCtx);

  const updated = await persistDealArrEstimate(dealId, computeResult, deal);
  if (updated && store.updateDeal) {
    await store.updateDeal(dealId, {
      arrSource: "se_override",
      metadata: deal.metadata,
      lastActivityAt: computedAt,
    });
  }

  return { lines: await store.listArrLinesByDeal?.(dealId), deal: updated };
}

/**
 * @param {object} params
 */
export async function logArrOverride(params) {
  const store = getStore();
  if (!store.upsertArrOverride) return null;

  const row = {
    id: newId("arrOverride"),
    dealId: params.dealId,
    accountId: params.accountId,
    field: params.field,
    action: params.action || "edit",
    original: params.original ?? null,
    override: params.override ?? null,
    arrEstimatePoint: params.arrEstimatePoint ?? 0,
    displayUnit: params.displayUnit ?? null,
    userId: params.userId,
    reason: params.reason || "",
    ownerId: params.ownerId,
    teamId: params.teamId,
    orgId: params.orgId,
    createdAt: now(),
  };

  await store.upsertArrOverride(row);
  return row;
}

/**
 * @param {string} dealId
 * @param {object} deal
 * @param {object} session
 * @param {() => Promise<Record<string, string>>} getAuthHeaders
 */
export async function confirmArrAssumptions(dealId, deal, session, getAuthHeaders) {
  const store = getStore();
  const userId = session.userId || session.uid || "";
  const fieldState = buildArrFieldState(deal, await store.listArrLinesByDeal?.(dealId));
  fieldState.assumptionsConfirmed = true;

  const allowanceConsumed = await accountAllowanceConsumedForDeal(store, deal.accountId, dealId);
  const { draft, computeOpts } = mergeDraftForCompute(deal, fieldState, {
    accountAllowanceConsumed: allowanceConsumed,
    assumptionsConfirmed: true,
    userLabel: session.email || userId,
  });
  computeOpts.assumptionsConfirmed = true;

  const computeResult = await fetchArrCompute(draft, computeOpts, getAuthHeaders);

  const metadata = {
    ...(deal.metadata || {}),
    arrEdits: {
      ...(readArrEdits(deal)),
      assumptionsConfirmed: true,
      assumptionsConfirmedAt: now(),
      assumptionsConfirmedBy: userId,
      fields: readArrEdits(deal).fields || {},
    },
  };
  deal.metadata = metadata;

  await persistDealArrRecompute(dealId, deal, computeResult, { userId });
  await logArrOverride({
    dealId,
    accountId: deal.accountId,
    field: "assumptionsConfirmed",
    action: "confirm_assumptions",
    original: { assumptionsConfirmed: false },
    override: { assumptionsConfirmed: true },
    arrEstimatePoint: computeResult.arrPoint ?? 0,
    displayUnit: getArrDisplayUnit(),
    userId,
    ownerId: deal.ownerId,
    teamId: deal.teamId,
    orgId: deal.orgId,
  });

  return computeResult;
}
