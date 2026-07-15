// Pre-call (Discovery) output shape (v5): must-see top strip + collapsible good-to-see.
// Model fills JSON; frontend renders one-pager with glance hierarchy.

const fitRow = {
  type: "object",
  additionalProperties: false,
  required: ["label", "thisCompany", "industryNorm", "gap", "gapVerdict"],
  properties: {
    label: { type: "string", description: "Row label, max 8 words." },
    thisCompany: { type: "string", description: "Max 8 words." },
    industryNorm: { type: "string", description: "Max 8 words." },
    gap: {
      type: "string",
      enum: ["large", "partial", "parity"],
      description: "large=red dot, partial=amber, parity=green",
    },
    gapVerdict: {
      type: "string",
      description: "One-word GAP verdict shown with dot (e.g. Behind, Partial, Aligned).",
    },
  },
} as const;

const discoveryPair = {
  type: "object",
  additionalProperties: false,
  required: ["question", "because"],
  properties: {
    question: { type: "string", description: "Discovery question, max 12 words." },
    because: { type: "string", description: "Why ask — max 12 words." },
  },
} as const;

const pcvRow = {
  type: "object",
  additionalProperties: false,
  required: ["pain", "capability", "value"],
  properties: {
    pain: { type: "string", description: "Max 8 words." },
    capability: { type: "string", description: "Max 8 words." },
    value: {
      type: "string",
      description: "Qualitative value only — max 8 words. NO fabricated stats.",
    },
  },
} as const;

const maturityFlag = {
  type: "string",
  enum: ["Y", "N", "unknown"],
  description: "Y=confirmed, N=not present, unknown=not found",
} as const;

export const PREP_SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: [
    "description",
    "incumbent",
    "fitSnapshot",
    "supportMaturity",
    "industryUseCases",
    "companySizeAgents",
    "businessContext",
    "discoveryKit",
    "painCapabilityValue",
    "attendees",
    "sources",
  ],
  properties: {
    description: { type: "string", description: "One-line company description, max 15 words." },
    incumbent: {
      type: "object",
      additionalProperties: false,
      required: ["incumbent_name", "displacement"],
      properties: {
        incumbent_name: { type: "string", description: "Current support stack/vendor, max 8 words." },
        displacement: {
          type: "string",
          enum: ["greenfield", "homegrown", "entrenched"],
          description: "greenfield=no incumbent, homegrown=internal tools, entrenched=locked vendor",
        },
      },
    },
    fitSnapshot: {
      type: "array",
      maxItems: 6,
      items: fitRow,
      description:
        "Must-see comparison — max 6 rows. Drop zero-signal rows where industry norm restates company.",
    },
    supportMaturity: {
      type: "object",
      additionalProperties: false,
      required: ["selfServicePortal", "webChat", "phone", "omnichannel"],
      properties: {
        selfServicePortal: maturityFlag,
        webChat: maturityFlag,
        phone: maturityFlag,
        omnichannel: maturityFlag,
      },
    },
    industryUseCases: {
      type: "array",
      maxItems: 3,
      items: { type: "string", description: "Industry use case, max 10 words each." },
    },
    companySizeAgents: {
      type: "object",
      additionalProperties: false,
      required: ["agents", "estimated"],
      properties: {
        agents: { type: "string", description: "Support agent count or range, max 8 words." },
        estimated: {
          type: "boolean",
          description: "true if count is inferred — UI shows est. label",
        },
      },
    },
    businessContext: {
      type: "object",
      additionalProperties: false,
      required: [
        "market",
        "model",
        "users",
        "uptimeNeed",
        "fundingParent",
        "headOffice",
        "demography",
        "languages",
        "signals",
        "workflows",
      ],
      properties: {
        market: { type: "string", description: "Max 8 words." },
        model: { type: "string", description: "Max 8 words." },
        users: { type: "string", description: "Max 8 words." },
        uptimeNeed: { type: "string", description: "Max 8 words." },
        fundingParent: { type: "string", description: "Max 8 words." },
        headOffice: { type: "string", description: "Max 8 words." },
        demography: { type: "string", description: "Max 8 words." },
        languages: { type: "string", description: "Max 8 words." },
        signals: {
          type: "object",
          additionalProperties: false,
          required: ["supportJobListings", "similarwebVisitors"],
          properties: {
            supportJobListings: { type: "string", description: "Max 8 words or unknown." },
            similarwebVisitors: { type: "string", description: "Max 8 words or unknown." },
          },
        },
        workflows: {
          type: "array",
          maxItems: 4,
          items: { type: "string", description: "Max 12 words per bullet." },
        },
      },
    },
    discoveryKit: {
      type: "array",
      maxItems: 3,
      items: discoveryPair,
      description: "Ask this / Because pairs for discovery.",
    },
    painCapabilityValue: {
      type: "array",
      maxItems: 3,
      items: pcvRow,
      description: "Demo prep flowchart: Pain → Capability → Value. Qualitative only.",
    },
    attendees: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        required: ["name", "role", "decisionPower"],
        properties: {
          name: { type: "string" },
          role: { type: "string", description: "Max 8 words." },
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
          claim: { type: "string", description: "Max 12 words." },
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
  gapVerdict: string;
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
  incumbent: {
    incumbent_name: string;
    displacement: "greenfield" | "homegrown" | "entrenched";
  };
  fitSnapshot: FitSnapshotRow[];
  supportMaturity: {
    selfServicePortal: "Y" | "N" | "unknown";
    webChat: "Y" | "N" | "unknown";
    phone: "Y" | "N" | "unknown";
    omnichannel: "Y" | "N" | "unknown";
  };
  industryUseCases: string[];
  companySizeAgents: {
    agents: string;
    estimated: boolean;
  };
  businessContext: {
    market: string;
    model: string;
    users: string;
    uptimeNeed: string;
    fundingParent: string;
    headOffice: string;
    demography: string;
    languages: string;
    signals: {
      supportJobListings: string;
      similarwebVisitors: string;
    };
    workflows: string[];
  };
  discoveryKit: DiscoveryKitItem[];
  painCapabilityValue: PainCapabilityValueRow[];
  attendees: { name: string; role: string; decisionPower: "decision_maker" | "influencer" | "unknown" }[];
  sources: { claim: string; url: string }[];
}
