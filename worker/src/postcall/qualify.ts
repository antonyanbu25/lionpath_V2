/**
 * Pass 4 — MEDDPICC qualification (deal intelligence, not QIP).
 *
 * Each slot emits { value, evidence, surfaced }. Never infer a champion from
 * enthusiasm alone — evidence per line (spec §9).
 */

import { extractJson } from "../json";
import { getPostCallProvider } from "../providers";
import type { ProviderEnv } from "../providers/types";
import { MEDDPICC_FIELD_KEYS, type MeddpiccFieldKey } from "../domain-model/meddpicc";
import type { QualificationDraft, QualificationElement } from "../domain-model/qualification";
import { parseTranscript, trimTranscript } from "../transcript";
import { trimWords } from "../word-limits";

export type Env = ProviderEnv;

export interface PostCallQualifyInput {
  transcript: string;
  callId?: string | null;
  dealId?: string | null;
  companyName?: string;
  meetingTitle?: string;
  callType?: string;
  /** Pre-call brief text — answer key for champion / economic buyer (spec §3.3). */
  briefContext?: string | null;
  additionalContext?: string;
}

export interface PostCallQualifyResult {
  framework: "MEDDPICC";
  qualification: QualificationDraft;
}

const QUALIFICATION_ELEMENT_SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: ["value", "evidence", "surfaced"],
  properties: {
    value: { type: "string" },
    evidence: { type: "string" },
    surfaced: { type: "boolean" },
    contactId: { type: "string", nullable: true },
  },
};

const QUALIFICATION_SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: [...MEDDPICC_FIELD_KEYS],
  properties: Object.fromEntries(
    MEDDPICC_FIELD_KEYS.map((key) => [key, QUALIFICATION_ELEMENT_SCHEMA]),
  ),
};

const NOT_SURFACED_EVIDENCE = "not surfaced";

function trimEvidence(text: unknown): string {
  const raw = String(text ?? "").trim();
  if (!raw) return NOT_SURFACED_EVIDENCE;
  return trimWords(raw, 40);
}

function trimValue(text: unknown): string {
  return trimWords(String(text ?? "").trim(), 20);
}

function normalizeElement(raw: Partial<QualificationElement> | undefined): QualificationElement {
  const surfaced = !!raw?.surfaced;
  const value = trimValue(raw?.value);
  let evidence = trimEvidence(raw?.evidence);

  if (!surfaced) {
    return {
      value: "",
      evidence: evidence === NOT_SURFACED_EVIDENCE ? evidence : NOT_SURFACED_EVIDENCE,
      surfaced: false,
      contactId: null,
    };
  }

  if (!raw?.evidence?.trim() || trimEvidence(raw.evidence) === NOT_SURFACED_EVIDENCE) {
    return {
      value: "",
      evidence: NOT_SURFACED_EVIDENCE,
      surfaced: false,
      contactId: null,
    };
  }

  if (!value || value.toLowerCase() === "unknown") {
    return {
      value: "",
      evidence: NOT_SURFACED_EVIDENCE,
      surfaced: false,
      contactId: null,
    };
  }

  if (!evidence || evidence === NOT_SURFACED_EVIDENCE) {
    return {
      value: "",
      evidence: NOT_SURFACED_EVIDENCE,
      surfaced: false,
      contactId: null,
    };
  }

  const contactId = raw?.contactId ? String(raw.contactId).trim() : null;
  return {
    value,
    evidence,
    surfaced: true,
    contactId: contactId || null,
  };
}

/** Exported for unit tests (no LLM). */
export function normalizeQualificationOutput(raw: Partial<QualificationDraft>): QualificationDraft {
  const out = {} as QualificationDraft;
  for (const key of MEDDPICC_FIELD_KEYS) {
    out[key] = normalizeElement(raw?.[key]);
  }
  return out;
}

function systemPrompt(): string {
  const slots = MEDDPICC_FIELD_KEYS.join(", ");
  return `You extract MEDDPICC deal qualification from a Solution Engineering customer call transcript.

Emit JSON only — one object with exactly these keys: ${slots}.

Each key is an object { value, evidence, surfaced }:
- surfaced: true ONLY when the call contains direct evidence for that MEDDPICC element.
- surfaced: false when not discussed — set value to "" and evidence to "not surfaced".
- evidence: short verbatim quote or concrete observation from the transcript (max 40 words).
  When surfaced is false, evidence MUST be exactly "not surfaced".
- value: concise field value when surfaced (max 20 words); empty string when not surfaced.

Rules (strict):
- Never fabricate. Every surfaced line needs transcript evidence in evidence.
- Never infer a champion from enthusiasm, politeness, or scheduling help alone.
  Champion requires explicit advocacy, internal selling, or named ownership of the initiative.
- economicBuyer requires budget/sign-off authority stated or clearly implied with evidence.
- identifyPain: customer-stated business pain only — not product gaps the SE raised.
- competition: named alternatives or incumbents the customer mentioned.
- metrics: quantified success criteria or KPIs the customer stated.
- decisionCriteria / decisionProcess / paperProcess: only what the customer described.

Optional contactId on champion or economicBuyer when a named attendee is obvious from context.

Do not score the SE. This is deal state, not call quality.`;
}

function userPrompt(input: PostCallQualifyInput, parsed: ReturnType<typeof parseTranscript>): string {
  const lines = [
    "Extract MEDDPICC qualification from this call.",
    "",
    `Word count: ${parsed.wordCount}`,
  ];
  if (input.companyName) lines.push(`Company: ${input.companyName}`);
  if (input.meetingTitle) lines.push(`Meeting: ${input.meetingTitle}`);
  if (input.callType) lines.push(`Call type: ${input.callType}`);
  if (input.briefContext?.trim()) {
    lines.push("", "Pre-call brief (answer key — diff transcript against this):", input.briefContext.trim());
  }
  if (input.additionalContext?.trim()) {
    lines.push("", "Additional SE context:", input.additionalContext.trim());
  }
  lines.push("", "=== TRANSCRIPT ===", trimTranscript(parsed.text, 6000, "tail"), "=== END TRANSCRIPT ===");
  return lines.join("\n");
}

export async function runPostCallQualify(env: Env, input: PostCallQualifyInput): Promise<PostCallQualifyResult> {
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
    jsonSchema: QUALIFICATION_SCHEMA as unknown as Record<string, unknown>,
  });

  const qualification = normalizeQualificationOutput(
    extractJson<Partial<QualificationDraft>>(result.text),
  );

  return {
    framework: "MEDDPICC",
    qualification,
  };
}

export { MEDDPICC_FIELD_KEYS, type MeddpiccFieldKey, type QualificationElement, type QualificationDraft };
