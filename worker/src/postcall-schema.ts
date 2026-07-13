// Post-call analysis output shape — call summary, SE next steps, and quality coaching.
// The model fills this JSON; transcriptMeta is computed deterministically in postcall.ts.

export const POSTCALL_SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: ["callSummary", "nextSteps", "qualityCoach"],
  properties: {
    callSummary: {
      type: "object",
      additionalProperties: false,
      required: [
        "headline",
        "attendees",
        "keyTopics",
        "customerContext",
        "painPointsConfirmed",
        "objectionsRaised",
        "competitiveMentions",
        "decisionsMade",
        "openQuestions",
      ],
      properties: {
        headline: { type: "string" },
        attendees: {
          type: "array",
          items: {
            type: "object",
            additionalProperties: false,
            required: ["name", "role", "engagement"],
            properties: {
              name: { type: "string" },
              role: { type: "string" },
              engagement: { type: "string" },
            },
          },
        },
        keyTopics: { type: "array", items: { type: "string" } },
        customerContext: { type: "string" },
        painPointsConfirmed: { type: "array", items: { type: "string" } },
        objectionsRaised: { type: "array", items: { type: "string" } },
        competitiveMentions: { type: "array", items: { type: "string" } },
        decisionsMade: { type: "array", items: { type: "string" } },
        openQuestions: { type: "array", items: { type: "string" } },
      },
    },
    nextSteps: {
      type: "object",
      additionalProperties: false,
      required: [
        "seActions",
        "aeActions",
        "customerCommitments",
        "suggestedFollowUpEmail",
        "crmNotes",
      ],
      properties: {
        seActions: {
          type: "array",
          items: {
            type: "object",
            additionalProperties: false,
            required: ["action", "priority", "dueHint", "rationale"],
            properties: {
              action: { type: "string" },
              priority: { type: "string", enum: ["high", "medium", "low"] },
              dueHint: { type: "string" },
              rationale: { type: "string" },
            },
          },
        },
        aeActions: {
          type: "array",
          items: {
            type: "object",
            additionalProperties: false,
            required: ["action", "priority", "rationale"],
            properties: {
              action: { type: "string" },
              priority: { type: "string", enum: ["high", "medium", "low"] },
              rationale: { type: "string" },
            },
          },
        },
        customerCommitments: { type: "array", items: { type: "string" } },
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
              name: { type: "string" },
              score: { type: "number" },
              maxScore: { type: "number" },
              feedback: { type: "string" },
              evidence: { type: "string" },
            },
          },
        },
        strengths: { type: "array", items: { type: "string" } },
        improvements: { type: "array", items: { type: "string" } },
        missedOpportunities: { type: "array", items: { type: "string" } },
      },
    },
  },
} as const;

export interface PostCallAnalysis {
  callSummary: {
    headline: string;
    attendees: { name: string; role: string; engagement: string }[];
    keyTopics: string[];
    customerContext: string;
    painPointsConfirmed: string[];
    objectionsRaised: string[];
    competitiveMentions: string[];
    decisionsMade: string[];
    openQuestions: string[];
  };
  nextSteps: {
    seActions: { action: string; priority: "high" | "medium" | "low"; dueHint: string; rationale: string }[];
    aeActions: { action: string; priority: "high" | "medium" | "low"; rationale: string }[];
    customerCommitments: string[];
    suggestedFollowUpEmail: { subject: string; body: string };
    crmNotes: string;
  };
  qualityCoach: {
    overallScore: number;
    overallLabel: string;
    dimensions: { name: string; score: number; maxScore: number; feedback: string; evidence: string }[];
    strengths: string[];
    improvements: string[];
    missedOpportunities: string[];
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
