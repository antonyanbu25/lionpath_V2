// Pre-call (Discovery) output shape (v4): header + fit snapshot hero, business context table,
// discovery kit, demo prep flowchart, sources. Model fills JSON; frontend renders one-pager.

const fitRow = {
  type: "object",
  additionalProperties: false,
  required: ["label", "thisCompany", "industryNorm", "gap"],
  properties: {
    label: { type: "string", description: "Row label, max 10 words." },
    thisCompany: { type: "string", description: "Max 10 words." },
    industryNorm: { type: "string", description: "Max 10 words." },
    gap: {
      type: "string",
      enum: ["large", "partial", "parity"],
      description: "large=red dot, partial=amber, parity=green",
    },
  },
} as const;

const discoveryPair = {
  type: "object",
  additionalProperties: false,
  required: ["question", "because"],
  properties: {
    question: { type: "string", description: "Discovery question, max 14 words." },
    because: { type: "string", description: "Why ask — max 12 words." },
  },
} as const;

const pcvRow = {
  type: "object",
  additionalProperties: false,
  required: ["pain", "capability", "value"],
  properties: {
    pain: { type: "string", description: "Max 10 words." },
    capability: { type: "string", description: "Max 10 words." },
    value: { type: "string", description: "Max 10 words." },
  },
} as const;

export const PREP_SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: [
    "description",
    "fitSnapshot",
    "businessContext",
    "discoveryKit",
    "painCapabilityValue",
    "attendees",
    "sources",
  ],
  properties: {
    description: { type: "string", description: "One-line company description, max 25 words." },
    fitSnapshot: {
      type: "array",
      maxItems: 6,
      items: fitRow,
      description: "Hero comparison table — max 6 rows. Facts here must NOT repeat below.",
    },
    businessContext: {
      type: "object",
      additionalProperties: false,
      required: [
        "market",
        "model",
        "users",
        "uptimeNeed",
        "incumbent",
        "industryUseCase",
        "fundingParent",
        "workflows",
      ],
      properties: {
        market: { type: "string", description: "Max 10 words." },
        model: { type: "string", description: "Max 10 words." },
        users: { type: "string", description: "Max 10 words." },
        uptimeNeed: { type: "string", description: "Max 10 words." },
        incumbent: { type: "string", description: "Max 10 words." },
        industryUseCase: { type: "string", description: "Max 10 words." },
        fundingParent: { type: "string", description: "Max 10 words." },
        workflows: {
          type: "array",
          maxItems: 4,
          items: { type: "string", description: "Max 14 words per bullet." },
        },
      },
    },
    discoveryKit: {
      type: "array",
      maxItems: 4,
      items: discoveryPair,
      description: "Ask this / Because pairs for discovery.",
    },
    painCapabilityValue: {
      type: "array",
      maxItems: 3,
      items: pcvRow,
      description: "Demo prep flowchart: Pain → Capability → Value.",
    },
    attendees: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        required: ["name", "role", "decisionPower"],
        properties: {
          name: { type: "string" },
          role: { type: "string", description: "Max 10 words." },
          decisionPower: {
            type: "string",
            enum: ["decision_maker", "influencer", "unknown"],
          },
        },
      },
    },
    sources: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        required: ["claim", "url"],
        properties: {
          claim: { type: "string", description: "Max 14 words." },
          url: { type: "string" },
        },
      },
    },
  },
} as const;

export interface FitSnapshotRow {
  label: string;
  thisCompany: string;
  industryNorm: string;
  gap: "large" | "partial" | "parity";
}

export interface DiscoveryKitItem {
  question: string;
  because: string;
}

export interface PainCapabilityValueRow {
  pain: string;
  capability: string;
  value: string;
}

export interface Prep {
  description: string;
  fitSnapshot: FitSnapshotRow[];
  businessContext: {
    market: string;
    model: string;
    users: string;
    uptimeNeed: string;
    incumbent: string;
    industryUseCase: string;
    fundingParent: string;
    workflows: string[];
  };
  discoveryKit: DiscoveryKitItem[];
  painCapabilityValue: PainCapabilityValueRow[];
  attendees: { name: string; role: string; decisionPower: "decision_maker" | "influencer" | "unknown" }[];
  sources: { claim: string; url: string }[];
}
