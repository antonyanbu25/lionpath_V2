/**
 * Pass — ARR input extraction (spec §7.5, ADDON_ARR*, ADDON_ARR_VOLUME).
 *
 * INPUTS ONLY — no pricing arithmetic. compute.ts owns all maths.
 */

import { extractJson } from "../json";
import { getPostCallProvider } from "../providers";
import type { ProviderEnv } from "../providers/types";
import type { VolumeBasis, VolumeUnit } from "../arr/compute";
import { parseTranscript, trimTranscript } from "../transcript";
import { trimWords } from "../word-limits";

export type Env = ProviderEnv;

export const ARR_PRODUCTS = [
  "freshdesk",
  "freshdesk_omni",
  "freshservice",
  "freshsales",
] as const;
export type ArrProduct = (typeof ARR_PRODUCTS)[number];

export const ARR_TIERS = ["starter", "growth", "pro", "enterprise"] as const;
export type ArrTier = (typeof ARR_TIERS)[number];

export const ARR_TERMS = ["annual", "monthly"] as const;
export type ArrTerm = (typeof ARR_TERMS)[number];

export const ARR_CURRENCIES = ["USD", "EUR", "INR", "ZAR", "SGD"] as const;
export type ArrCurrency = (typeof ARR_CURRENCIES)[number];

export const ADDON_KEYS = [
  "freddy_ai_copilot",
  "freddy_ai_agent_sessions",
  "connector_app_tasks",
  "day_pass",
  "asset_units",
] as const;
export type AddonKey = (typeof ADDON_KEYS)[number];

export const VOLUME_UNITS: VolumeUnit[] = ["per_day", "per_week", "per_month", "per_year"];
export const VOLUME_BASES: VolumeBasis[] = ["average", "peak", "projected"];

export const CHANNELS = [
  "email",
  "chat",
  "voice",
  "social",
  "whatsapp",
  "portal",
] as const;
export type ArrChannel = (typeof CHANNELS)[number];

export interface ChannelMixEntry {
  channel: ArrChannel;
  share: number | null;
}

export interface ArrVolumeInput {
  value: number | null;
  unit: VolumeUnit | null;
  basis: VolumeBasis | null;
  channelMix: ChannelMixEntry[];
  evidence: string;
  confidence: number;
  inScope: boolean;
}

export interface ArrAddonInputLine {
  addonKey: AddonKey | string;
  quantity: number | null;
  unit: string | null;
  stated: boolean;
  inScope: boolean;
  evidence: string;
  confidence: number;
  tierConflict?: boolean;
}

export interface ArrInputsDraft {
  agents: number | null;
  product: ArrProduct | null;
  tier: ArrTier | null;
  term: ArrTerm;
  currency: ArrCurrency;
  region: string | null;
  addons: ArrAddonInputLine[];
  conversationVolume: ArrVolumeInput | null;
  ticketVolume: ArrVolumeInput | null;
  connectorTasks: ArrVolumeInput | null;
}

export interface PostCallArrInputsInput {
  transcript: string;
  callId?: string | null;
  dealId?: string | null;
  companyName?: string;
  meetingTitle?: string;
  callType?: string;
  /** Known product hint from deal record — weak signal only. */
  productHint?: string | null;
  regionHint?: string | null;
  additionalContext?: string;
  userId?: string;
}

export interface PostCallArrInputsResult extends ArrInputsDraft {}

const CHANNEL_MIX_SCHEMA = {
  type: "object",
  required: ["channel"],
  properties: {
    channel: { type: "string", enum: [...CHANNELS] },
    share: { type: "number", nullable: true, minimum: 0, maximum: 1 },
  },
};

const VOLUME_SCHEMA = {
  type: "object",
  required: ["value", "unit", "basis", "channelMix", "evidence", "confidence", "inScope"],
  properties: {
    value: { type: "number", nullable: true },
    unit: { type: "string", enum: VOLUME_UNITS, nullable: true },
    basis: { type: "string", enum: VOLUME_BASES, nullable: true },
    channelMix: {
      type: "array",
      maxItems: 6,
      items: CHANNEL_MIX_SCHEMA,
    },
    evidence: { type: "string" },
    confidence: { type: "number", minimum: 0, maximum: 1 },
    inScope: { type: "boolean" },
  },
};

const ADDON_SCHEMA = {
  type: "object",
  required: ["addonKey", "quantity", "unit", "stated", "inScope", "evidence", "confidence"],
  properties: {
    addonKey: { type: "string", enum: [...ADDON_KEYS] },
    quantity: { type: "number", nullable: true },
    unit: { type: "string", nullable: true },
    stated: { type: "boolean" },
    inScope: { type: "boolean" },
    evidence: { type: "string" },
    confidence: { type: "number", minimum: 0, maximum: 1 },
    tierConflict: { type: "boolean", nullable: true },
  },
};

const ARR_INPUTS_SCHEMA = {
  type: "object",
  required: [
    "agents",
    "product",
    "tier",
    "term",
    "currency",
    "region",
    "addons",
    "conversationVolume",
    "ticketVolume",
    "connectorTasks",
  ],
  properties: {
    agents: { type: "number", nullable: true },
    product: { type: "string", enum: [...ARR_PRODUCTS], nullable: true },
    tier: { type: "string", enum: [...ARR_TIERS], nullable: true },
    term: { type: "string", enum: [...ARR_TERMS] },
    currency: { type: "string", enum: [...ARR_CURRENCIES] },
    region: { type: "string", nullable: true },
    addons: {
      type: "array",
      maxItems: 8,
      items: ADDON_SCHEMA,
    },
    conversationVolume: { ...VOLUME_SCHEMA, nullable: true },
    ticketVolume: { ...VOLUME_SCHEMA, nullable: true },
    connectorTasks: { ...VOLUME_SCHEMA, nullable: true },
  },
};

function clampConfidence(value: unknown, fallback = 0.5): number {
  const n = Number(value);
  if (!Number.isFinite(n)) return fallback;
  return Math.max(0, Math.min(1, n));
}

function trimEvidence(text: unknown): string {
  return trimWords(String(text ?? "").trim(), 40);
}

function normalizeQuantity(value: unknown): number | null {
  if (value === null || value === undefined || value === "") return null;
  const n = Number(value);
  if (!Number.isFinite(n) || n < 0) return null;
  return n;
}

function normalizeProduct(value: unknown): ArrProduct | null {
  const raw = String(value ?? "").trim().toLowerCase();
  if (ARR_PRODUCTS.includes(raw as ArrProduct)) return raw as ArrProduct;
  if (raw === "fd_support" || raw === "freshdesk_support") return "freshdesk";
  if (raw === "fd_omni" || raw === "omni") return "freshdesk_omni";
  return null;
}

function normalizeTier(value: unknown, product: ArrProduct | null): ArrTier | null {
  const raw = String(value ?? "").trim().toLowerCase();
  if (!ARR_TIERS.includes(raw as ArrTier)) return null;
  if (raw === "starter" && product !== "freshservice") return null;
  return raw as ArrTier;
}

function normalizeTerm(value: unknown): ArrTerm {
  const raw = String(value ?? "").trim().toLowerCase();
  return raw === "monthly" ? "monthly" : "annual";
}

function normalizeCurrency(value: unknown): ArrCurrency {
  const raw = String(value ?? "").trim().toUpperCase();
  return ARR_CURRENCIES.includes(raw as ArrCurrency) ? (raw as ArrCurrency) : "USD";
}

function normalizeChannelMix(raw: unknown): ChannelMixEntry[] {
  if (!Array.isArray(raw)) return [];
  const out: ChannelMixEntry[] = [];
  for (const entry of raw) {
    if (!entry || typeof entry !== "object") continue;
    const channel = String((entry as { channel?: string }).channel ?? "").trim().toLowerCase();
    if (!CHANNELS.includes(channel as ArrChannel)) continue;
    const shareRaw = (entry as { share?: number | null }).share;
    const share =
      shareRaw === null || shareRaw === undefined
        ? null
        : Math.max(0, Math.min(1, Number(shareRaw) || 0));
    out.push({ channel: channel as ArrChannel, share });
    if (out.length >= 6) break;
  }
  return out;
}

function normalizeVolume(raw: Partial<ArrVolumeInput> | null | undefined): ArrVolumeInput | null {
  if (!raw) return null;

  const inScope = !!raw.inScope;
  let value = normalizeQuantity(raw.value);
  const unit = VOLUME_UNITS.includes(raw.unit as VolumeUnit)
    ? (raw.unit as VolumeUnit)
    : null;
  const basis = VOLUME_BASES.includes(raw.basis as VolumeBasis)
    ? (raw.basis as VolumeBasis)
    : null;
  let evidence = trimEvidence(raw.evidence);
  let confidence = clampConfidence(raw.confidence, inScope ? 0.4 : 0.5);

  if (value !== null && !evidence) {
    value = null;
  }

  if (!inScope && value === null && !evidence) {
    return null;
  }

  if (inScope && value === null && !evidence) {
    evidence = "discussed in scope — no volume stated";
    confidence = Math.min(confidence, 0.4);
  }

  return {
    value,
    unit: value !== null ? unit : null,
    basis: value !== null ? basis : basis,
    channelMix: normalizeChannelMix(raw.channelMix),
    evidence,
    confidence,
    inScope,
  };
}

function copilotTierConflict(tier: ArrTier | null, addon: ArrAddonInputLine): boolean {
  if (addon.addonKey !== "freddy_ai_copilot") return !!addon.tierConflict;
  if (addon.tierConflict) return true;
  if (!tier) return false;
  return tier === "starter" || tier === "growth";
}

function normalizeAddon(
  raw: Partial<ArrAddonInputLine> | undefined,
  tier: ArrTier | null,
): ArrAddonInputLine | null {
  if (!raw) return null;
  const addonKeyRaw = String(raw.addonKey ?? "").trim();
  if (!addonKeyRaw) return null;

  let quantity = normalizeQuantity(raw.quantity);
  let stated = !!raw.stated;
  let inScope = !!raw.inScope;
  let evidence = trimEvidence(raw.evidence);
  let confidence = clampConfidence(raw.confidence, 0.5);
  const unit = raw.unit ? String(raw.unit).trim() : null;

  if (addonKeyRaw === "freddy_ai_agent_sessions") {
    quantity = null;
    stated = false;
  }

  if (quantity !== null && !evidence) {
    quantity = null;
    stated = false;
  }

  if (quantity === null) {
    stated = false;
  }

  if (inScope && quantity === null && !evidence) {
    evidence = "discussed in scope — quantity not stated";
    confidence = Math.min(confidence, 0.4);
  }

  if (!inScope && quantity === null && !evidence) {
    return null;
  }

  const line: ArrAddonInputLine = {
    addonKey: addonKeyRaw,
    quantity,
    unit,
    stated,
    inScope,
    evidence,
    confidence,
  };

  if (copilotTierConflict(tier, line)) {
    line.tierConflict = true;
  }

  return line;
}

/** Exported for unit tests (no LLM). */
export function normalizeArrInputsOutput(raw: Partial<ArrInputsDraft>): ArrInputsDraft {
  const product = normalizeProduct(raw.product);
  const tier = normalizeTier(raw.tier, product);

  const addons: ArrAddonInputLine[] = [];
  for (const entry of raw.addons || []) {
    const line = normalizeAddon(entry, tier);
    if (line) addons.push(line);
  }

  let agents = normalizeQuantity(raw.agents);
  if (agents !== null && agents % 1 !== 0) {
    agents = Math.round(agents);
  }

  const conversationVolume = normalizeVolume(raw.conversationVolume ?? undefined);
  const ticketVolume = normalizeVolume(raw.ticketVolume ?? undefined);
  const connectorTasks = normalizeVolume(raw.connectorTasks ?? undefined);

  return {
    agents,
    product,
    tier,
    term: normalizeTerm(raw.term),
    currency: normalizeCurrency(raw.currency),
    region: raw.region ? String(raw.region).trim() : null,
    addons,
    conversationVolume,
    ticketVolume,
    connectorTasks,
  };
}

function systemPrompt(): string {
  return `You extract ARR pricing INPUTS ONLY from a Solution Engineering customer call transcript.
Do NOT compute prices, ARR, MRR, annual totals, pack counts, or discounts. Extraction only — arithmetic happens in compute.ts.

Return JSON with exactly these top-level fields:
agents, product, tier, term, currency, region, addons, conversationVolume, ticketVolume, connectorTasks.

Top-level fields:
- agents: licensed support agent seats (integer or null). NOT company headcount.
- product: one of freshdesk | freshdesk_omni | freshservice | freshsales (or null if ambiguous).
- tier: starter (Freshservice only) | growth | pro | enterprise (or null if unknown).
- term: annual | monthly — default annual when not discussed.
- currency: USD | EUR | INR | ZAR | SGD — use regional list currency; never FX-convert USD list prices.
- region: ISO-ish region hint (e.g. US, IN, EU) or null.

addons: array of { addonKey, quantity, unit, stated, inScope, evidence, confidence, tierConflict? }.
  addonKey one of: freddy_ai_copilot, freddy_ai_agent_sessions, connector_app_tasks, day_pass, asset_units.
  freddy_ai_copilot quantity = SEATS (subset of agents — never default to agent count).
  connector_app_tasks quantity = TASKS PER MONTH when stated.
  day_pass quantity = PASSES PER MONTH when stated.
  asset_units = Freshservice ITAM asset count when stated.
  stated:true only when a numeric quantity was explicitly said.
  inScope:true when clearly discussed even if no number was given.

conversationVolume, ticketVolume, connectorTasks (each nullable):
  { value, unit, basis, channelMix[], evidence, confidence, inScope }
  unit: per_day | per_week | per_month | per_year
  basis: average | peak | projected
  channelMix: optional [{ channel: email|chat|voice|social|whatsapp|portal, share: 0..1|null }]
  Capture ticketVolume and connectorTasks only when a volume was actually stated for that metric.

EXTRACTION TRAPS — follow verbatim:
- "We have 200 people" is NOT 200 agents. Licensed support agents only. Largest source of drift.
- Omni vs Freshdesk is a real fork: Growth +$10, Pro +$24, Enterprise +$30 per agent per month.
  WhatsApp or live chat in scope means Omni. On a 40-agent Enterprise deal, misreading this is
  a $14,400/year error.
- Tier is almost never stated. Infer from features discussed. Flag low confidence.
- Copilot seats are a subset — "14 of 40" is the normal shape. Never assume parity.
- Do NOT extract session counts. Extract CONVERSATION VOLUME. Customers say "12,000 tickets a
  month", never "72,000 sessions". Conversion happens in compute.ts.
- Discount is not extractable pre-contract. Always 0.
- Never FX-convert a USD list price. Look up the regional row.

TIER NAMES COLLIDE ACROSS PRODUCTS. "Growth" is $19 in Freshdesk, $29 in Omni, $49 in
Freshservice, $9 in Freshsales. A tier without a confident product is unresolvable — return low
confidence on both rather than guessing either.

EXCLUSIONS ARE OUTPUT, NOT SILENCE. Add-on clearly discussed but no volume given →
{ quantity: null, stated: false, inScope: true, evidence: "<quote>" }.

BASIS MATTERS. "We peak at 20,000 in December" is basis:"peak", not an annual run rate. Never
annualise a stated peak.

Every extracted value carries its evidence quote. A number without a quote cannot be argued with,
and the SE will need to argue with it.

Never estimate quantities. Never derive quantities from agent count. Never compute ARR.`;
}

function userPrompt(
  input: PostCallArrInputsInput,
  parsed: ReturnType<typeof parseTranscript>,
): string {
  const lines = [
    "Extract ARR pricing inputs from this call.",
    "",
    `Word count: ${parsed.wordCount}`,
  ];
  if (input.companyName) lines.push(`Company: ${input.companyName}`);
  if (input.meetingTitle) lines.push(`Meeting: ${input.meetingTitle}`);
  if (input.callType) lines.push(`Call type: ${input.callType}`);
  if (input.productHint?.trim()) {
    lines.push(`Product hint (weak — confirm in transcript): ${input.productHint.trim()}`);
  }
  if (input.regionHint?.trim()) {
    lines.push(`Region hint (weak): ${input.regionHint.trim()}`);
  }
  if (input.additionalContext?.trim()) {
    lines.push("", "Additional SE context:", input.additionalContext.trim());
  }
  lines.push("", "=== TRANSCRIPT ===", trimTranscript(parsed.text, 6000, "tail"), "=== END TRANSCRIPT ===");
  return lines.join("\n");
}

export async function runPostCallArrInputs(
  env: Env,
  input: PostCallArrInputsInput,
): Promise<PostCallArrInputsResult> {
  const transcript = input.transcript?.trim();
  if (!transcript) {
    throw Object.assign(new Error("transcript is required."), { status: 400 });
  }

  const parsed = parseTranscript(transcript);
  const provider = getPostCallProvider(env);
  const effort = env.POSTCALL_EFFORT || env.EFFORT || "low";

  const result = await provider.generate({
    maxTokens: 4000,
    system: systemPrompt(),
    user: userPrompt(input, parsed),
    effort,
    research: false,
    thinkingBudget: 0,
    jsonSchema: ARR_INPUTS_SCHEMA as unknown as Record<string, unknown>,
    passName: "arr-inputs",
    userId: input.userId,
    callId: input.callId ?? undefined,
  });

  const inputs = normalizeArrInputsOutput(extractJson<Partial<ArrInputsDraft>>(result.text));

  return inputs;
}
