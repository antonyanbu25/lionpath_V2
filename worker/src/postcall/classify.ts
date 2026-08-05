import { extractJson } from "../json";
import { getPostCallProvider } from "../providers";
import type { ProviderEnv } from "../providers/types";
import { CALL_TYPES, type CallType } from "../rubric-profiles";
import { parseTranscript, trimTranscript } from "../transcript";
import type { PostCallClassifyInput, PostCallClassifyResult } from "./types";

export type Env = ProviderEnv;

const CLASSIFY_SCHEMA = {
  type: "object",
  required: ["primary", "mix", "confidence"],
  properties: {
    primary: { type: "string", enum: [...CALL_TYPES] },
    mix: {
      type: "array",
      maxItems: 4,
      items: {
        type: "object",
        required: ["type", "weight"],
        properties: {
          type: { type: "string", enum: [...CALL_TYPES] },
          weight: { type: "number", minimum: 0, maximum: 1 },
        },
      },
    },
    confidence: { type: "number", minimum: 0, maximum: 1 },
  },
};

function systemPrompt(): string {
  return `You classify customer Solution Engineering calls into exactly one primary type.
Use transcript evidence only — ignore meeting titles unless the opening confirms them.

Primary type must be one of:
demo, discovery, technical_deep_dive, reverse_demo, use_case_discussion, trial_setup, troubleshooting, qa_session

Rules:
- Emit a mix array (max 4 entries) when the call is hybrid; weights 0..1 should sum to ~1.
- confidence 0..1 — report low confidence honestly when evidence is thin; do not force a label.
- Prefer the opening 10 minutes and what the SE actually did over generic small talk.
- reverse_demo = customer shows their environment/process to the SE.
- qa_session = office hours / open Q&A, not structured discovery.

Respond with JSON only: { primary, mix, confidence }.`;
}

function userPrompt(input: PostCallClassifyInput, parsed: ReturnType<typeof parseTranscript>): string {
  const lines = [
    "Classify this call.",
    "",
    `Speakers: ${parsed.speakers.length ? parsed.speakers.join(", ") : "unknown"}`,
    `Word count: ${parsed.wordCount}`,
  ];
  if (input.meetingTitle) {
    lines.push(`Meeting title (weak signal only): ${input.meetingTitle}`);
  }
  lines.push("", "=== TRANSCRIPT OPENING ===", trimTranscript(parsed.text, 2500, "head_tail"));
  return lines.join("\n");
}

function normalizeMix(raw: { type?: string; weight?: number }[] | undefined): PostCallClassifyResult["mix"] {
  const out: PostCallClassifyResult["mix"] = [];
  for (const entry of raw || []) {
    const type = String(entry.type || "") as CallType;
    if (!CALL_TYPES.includes(type)) continue;
    const weight = Math.max(0, Math.min(1, Number(entry.weight) || 0));
    if (weight <= 0) continue;
    out.push({ type, weight });
    if (out.length >= 4) break;
  }
  return out;
}

function normalizeClassify(raw: {
  primary?: string;
  mix?: { type?: string; weight?: number }[];
  confidence?: number;
}): PostCallClassifyResult {
  const primary = CALL_TYPES.includes(raw.primary as CallType)
    ? (raw.primary as CallType)
    : "discovery";
  let mix = normalizeMix(raw.mix);
  if (!mix.length) mix = [{ type: primary, weight: 1 }];
  const confidence = Math.max(0, Math.min(1, Number(raw.confidence) || 0));
  return { primary, mix, confidence };
}

export async function runPostCallClassify(
  env: Env,
  input: PostCallClassifyInput,
): Promise<PostCallClassifyResult> {
  const transcript = input.transcript?.trim();
  if (!transcript) throw new Error("transcript is required.");

  const parsed = parseTranscript(transcript);
  const provider = getPostCallProvider(env);
  const result = await provider.generate({
    maxTokens: 800,
    system: systemPrompt(),
    user: userPrompt(input, parsed),
    effort: env.POSTCALL_EFFORT || env.EFFORT || "low",
    research: false,
    thinkingBudget: 0,
    jsonSchema: CLASSIFY_SCHEMA as unknown as Record<string, unknown>,
    passName: "classify",
    userId: input.userId,
    callId: input.callId,
  });

  return normalizeClassify(extractJson(result.text));
}
