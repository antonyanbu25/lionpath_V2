// The prep-doc output shape (v2), mirroring SE_Prep_Template_GetGo.md — a tight, scannable
// one-pager: a Research Snapshot table + a compact Demo Plan. Used as the JSON contract the
// model fills (described in the prompt) and the shape the frontend renders. Every field is
// required; the model writes "unknown" (or [] ) where research came up empty, and embeds
// confidence inline in techStack.summary ("inferred from …, medium confidence" / "unconfirmed").

export const PREP_SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: ["researchSnapshot", "demoPlan", "sources"],
  properties: {
    researchSnapshot: {
      type: "object",
      additionalProperties: false,
      required: [
        "attendees",
        "whatTheyDo",
        "size",
        "supportChannels",
        "techStack",
        "painPoints",
        "goals",
        "discoveryGaps",
      ],
      properties: {
        attendees: {
          type: "array",
          items: {
            type: "object",
            additionalProperties: false,
            required: ["name", "email", "note"],
            properties: {
              name: { type: "string" },
              email: { type: "string" },
              // e.g. "role unconfirmed, clarify title/CX ownership early"
              note: { type: "string" },
            },
          },
        },
        whatTheyDo: { type: "string" },
        size: { type: "string" },
        supportChannels: { type: "string" },
        techStack: {
          type: "object",
          additionalProperties: false,
          required: ["summary", "namedVendors"],
          properties: {
            // Prose WITH inline confidence, e.g.
            // "Helpdesk/KB: Zendesk (inferred from help.getgo.sg URL, medium confidence).
            //  CRM/Chat/Phone: unknown."
            summary: { type: "string" },
            // Machine-readable list of incumbent vendors actually detected. Drives the
            // conditional differentiator section. Empty if none confidently identified.
            namedVendors: { type: "array", items: { type: "string" } },
          },
        },
        painPoints: { type: "array", items: { type: "string" } },
        goals: { type: "array", items: { type: "string" } },
        // 3–5 labeled discovery questions targeting the biggest gaps.
        discoveryGaps: {
          type: "array",
          items: {
            type: "object",
            additionalProperties: false,
            required: ["label", "question"],
            properties: {
              label: { type: "string" }, // e.g. "Stack", "Team/volume", "Incidents", "AI maturity"
              question: { type: "string" },
            },
          },
        },
      },
    },
    demoPlan: {
      type: "object",
      additionalProperties: false,
      required: ["flow", "useCases", "close", "differentiators"],
      properties: {
        flow: { type: "string" },
        useCases: {
          type: "array",
          items: {
            type: "object",
            additionalProperties: false,
            required: ["rank", "useCase", "why"],
            properties: {
              rank: { type: "integer" },
              useCase: { type: "string" },
              why: { type: "string" },
            },
          },
        },
        close: { type: "string" },
        // ONLY vendors present in researchSnapshot.techStack.namedVendors. Empty if none.
        differentiators: {
          type: "array",
          items: {
            type: "object",
            additionalProperties: false,
            required: ["vendor", "points"],
            properties: {
              vendor: { type: "string" },
              points: { type: "array", items: { type: "string" } },
            },
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
          claim: { type: "string" },
          url: { type: "string" },
        },
      },
    },
  },
} as const;

// Hand-written TS mirror for the Worker.
export interface Prep {
  researchSnapshot: {
    attendees: { name: string; email: string; note: string }[];
    whatTheyDo: string;
    size: string;
    supportChannels: string;
    techStack: { summary: string; namedVendors: string[] };
    painPoints: string[];
    goals: string[];
    discoveryGaps: { label: string; question: string }[];
  };
  demoPlan: {
    flow: string;
    useCases: { rank: number; useCase: string; why: string }[];
    close: string;
    differentiators: { vendor: string; points: string[] }[];
  };
  sources: { claim: string; url: string }[];
}
