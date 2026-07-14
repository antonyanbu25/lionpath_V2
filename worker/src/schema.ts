// Pre-call output shape (v3): a single scannable SE one-pager — comparison table hero,
// bullet sections, compact SE action blocks, footer attendees + sources. Used as the JSON
// contract the model fills and the frontend renders. Unknown prospect facts use "-" (or [] ).

const comparisonRow = {
  type: "object",
  additionalProperties: false,
  required: ["thisCompany", "industryNorm"],
  properties: {
    thisCompany: { type: "string" },
    industryNorm: { type: "string" },
  },
} as const;

export const PREP_SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: [
    "comparison",
    "aboutBusiness",
    "supportProcess",
    "workflows",
    "seActions",
    "attendees",
    "sources",
  ],
  properties: {
    comparison: {
      type: "object",
      additionalProperties: false,
      required: [
        "industry",
        "sizeAgents",
        "supportChannels",
        "incumbentStack",
        "supportPortal",
        "integrations",
        "webChatWidget",
        "fundingParent",
      ],
      properties: {
        industry: comparisonRow,
        sizeAgents: comparisonRow,
        supportChannels: comparisonRow,
        incumbentStack: comparisonRow,
        supportPortal: comparisonRow,
        integrations: comparisonRow,
        webChatWidget: comparisonRow,
        fundingParent: comparisonRow,
      },
    },
    aboutBusiness: { type: "array", items: { type: "string" } },
    supportProcess: { type: "array", items: { type: "string" } },
    workflows: { type: "array", items: { type: "string" } },
    seActions: {
      type: "object",
      additionalProperties: false,
      required: ["topUseCase", "painPoints", "discoveryGaps", "demoFlow"],
      properties: {
        topUseCase: { type: "string" },
        painPoints: { type: "array", items: { type: "string" } },
        discoveryGaps: { type: "array", items: { type: "string" } },
        demoFlow: { type: "array", items: { type: "string" } },
      },
    },
    attendees: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        required: ["name", "email", "note"],
        properties: {
          name: { type: "string" },
          email: { type: "string" },
          note: { type: "string" },
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
          claim: { type: "string" },
          url: { type: "string" },
        },
      },
    },
  },
} as const;

export interface ComparisonRow {
  thisCompany: string;
  industryNorm: string;
}

export interface Prep {
  comparison: {
    industry: ComparisonRow;
    sizeAgents: ComparisonRow;
    supportChannels: ComparisonRow;
    incumbentStack: ComparisonRow;
    supportPortal: ComparisonRow;
    integrations: ComparisonRow;
    webChatWidget: ComparisonRow;
    fundingParent: ComparisonRow;
  };
  aboutBusiness: string[];
  supportProcess: string[];
  workflows: string[];
  seActions: {
    topUseCase: string;
    painPoints: string[];
    discoveryGaps: string[];
    demoFlow: string[];
  };
  attendees: { name: string; email: string; note: string }[];
  sources: { claim: string; url: string }[];
}
