// Post-call analysis output shape (v4) — momentum hero, follow-up table, signals, next steps,
// quality coach, and artifacts. transcriptMeta is computed in postcall.ts.

export const POSTCALL_SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: [
    "callHeader",
    "momentum",
    "followUpTable",
    "signals",
    "nextSteps",
    "qualityCoach",
    "artifacts",
  ],
  properties: {
    callHeader: {
      type: "object",
      additionalProperties: false,
      required: ["title", "duration", "date", "attendees"],
      properties: {
        title: { type: "string", description: "Call title, max 25 words." },
        duration: { type: "string", description: "e.g. 45 min, max 10 words." },
        date: { type: "string", description: "Meeting date, max 10 words." },
        attendees: {
          type: "array",
          items: {
            type: "object",
            additionalProperties: false,
            required: ["name", "role", "influence"],
            properties: {
              name: { type: "string" },
              role: { type: "string", description: "Max 10 words." },
              influence: {
                type: "string",
                enum: ["high", "medium", "low"],
                description: "Talk influence: high=green, medium=amber, low=grey",
              },
            },
          },
        },
      },
    },
    momentum: {
      type: "object",
      additionalProperties: false,
      required: ["status", "reason", "topAction", "topActionDue"],
      properties: {
        status: {
          type: "string",
          enum: ["Advancing", "Stalled", "At risk"],
        },
        reason: { type: "string", description: "Max 20 words." },
        topAction: { type: "string", description: "Max 10 words." },
        topActionDue: { type: "string", description: "Max 10 words." },
      },
    },
    followUpTable: {
      type: "array",
      description:
        "SINGLE source for decisions, commitments, SE/AE actions, objections, next meeting.",
      items: {
        type: "object",
        additionalProperties: false,
        required: ["category", "thisCall", "followUp"],
        properties: {
          category: {
            type: "string",
            enum: ["decision", "commitment", "se_action", "ae_action", "objection", "next_meeting"],
          },
          thisCall: { type: "string", description: "Max 10 words." },
          followUp: { type: "string", description: "Max 10 words." },
        },
      },
    },
    signals: {
      type: "object",
      additionalProperties: false,
      required: ["painsConfirmed", "objectionsOpen", "competitors"],
      properties: {
        painsConfirmed: {
          type: "array",
          maxItems: 4,
          items: { type: "string", description: "Max 14 words, one line." },
        },
        objectionsOpen: {
          type: "array",
          maxItems: 4,
          items: { type: "string", description: "Max 14 words, one line." },
        },
        competitors: {
          type: "array",
          maxItems: 4,
          items: { type: "string", description: "Max 14 words, one line." },
        },
      },
    },
    nextSteps: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        required: ["owner", "action", "due", "why", "isRisk"],
        properties: {
          owner: { type: "string", description: "Max 10 words." },
          action: { type: "string", description: "Max 10 words." },
          due: { type: "string", description: "Max 10 words." },
          why: { type: "string", description: "Max 10 words." },
          isRisk: {
            type: "boolean",
            description: "true for coach missed-opportunity risk flags",
          },
        },
      },
    },
    qualityCoach: {
      type: "object",
      additionalProperties: false,
      required: ["dimensions", "strengths", "improvements", "missedOpportunities"],
      properties: {
        dimensions: {
          type: "array",
          items: {
            type: "object",
            additionalProperties: false,
            required: ["name", "score", "maxScore", "feedback", "evidence"],
            properties: {
              name: {
                type: "string",
                description:
                  "One of: Discovery, Demo alignment, Objections, Value articulation, Next-step clarity, Talk balance",
              },
              score: { type: "number", minimum: 1, maximum: 5 },
              maxScore: { type: "number", description: "Always 5." },
              feedback: { type: "string", description: "Max 14 words." },
              evidence: { type: "string", description: "Max 14 words." },
            },
          },
        },
        strengths: {
          type: "array",
          maxItems: 2,
          items: { type: "string", description: "Max 14 words." },
        },
        improvements: {
          type: "array",
          maxItems: 2,
          items: { type: "string", description: "Max 14 words." },
        },
        missedOpportunities: {
          type: "array",
          maxItems: 1,
          items: { type: "string", description: "Max 14 words." },
        },
      },
    },
    artifacts: {
      type: "object",
      additionalProperties: false,
      required: ["suggestedFollowUpEmail", "crmNotes"],
      properties: {
        suggestedFollowUpEmail: {
          type: "object",
          additionalProperties: false,
          required: ["subject", "body"],
          properties: {
            subject: { type: "string" },
            body: { type: "string" },
          },
        },
        crmNotes: { type: "string" },
      },
    },
  },
} as const;

export interface PostCallAnalysis {
  callHeader: {
    title: string;
    duration: string;
    date: string;
    attendees: { name: string; role: string; influence: "high" | "medium" | "low" }[];
  };
  momentum: {
    status: "Advancing" | "Stalled" | "At risk";
    reason: string;
    topAction: string;
    topActionDue: string;
  };
  followUpTable: {
    category: "decision" | "commitment" | "se_action" | "ae_action" | "objection" | "next_meeting";
    thisCall: string;
    followUp: string;
  }[];
  signals: {
    painsConfirmed: string[];
    objectionsOpen: string[];
    competitors: string[];
  };
  nextSteps: {
    owner: string;
    action: string;
    due: string;
    why: string;
    isRisk: boolean;
  }[];
  qualityCoach: {
    overallScore: number;
    overallLabel: string;
    dimensions: { name: string; score: number; maxScore: number; feedback: string; evidence: string }[];
    strengths: string[];
    improvements: string[];
    missedOpportunities: string[];
  };
  artifacts: {
    suggestedFollowUpEmail: { subject: string; body: string };
    crmNotes: string;
  };
}

export interface TranscriptMeta {
  format: "vtt" | "plain";
  speakerCount: number;
  wordCount: number;
  durationMinutes: number | null;
  speakers: string[];
}

export interface PostCallResult {
  analysis: PostCallAnalysis;
  transcriptMeta: TranscriptMeta;
}
