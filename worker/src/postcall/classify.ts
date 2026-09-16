import { extractJson } from "../json";
import { getPostCallProvider } from "../providers";
import type { ProviderEnv } from "../providers/types";
import {
  callTypesForMotion,
  canonicalizeSeMotion,
  remapCallTypeForMotion,
  type CallType,
  type SeMotion,
} from "../rubric-profiles";
import { parseTranscript, trimTranscript } from "../transcript";
import type { PostCallClassifyInput, PostCallClassifyResult } from "./types";

export type Env = ProviderEnv;

export function classifySchema(seMotion: SeMotion) {
  const types = callTypesForMotion(seMotion);
  return {
    type: "object",
    required: ["primary", "mix", "confidence"],
    properties: {
      primary: { type: "string", enum: types },
      mix: {
        type: "array",
        maxItems: 4,
        items: {
          type: "object",
          required: ["type", "weight"],
          properties: {
            type: { type: "string", enum: types },
            weight: { type: "number", minimum: 0, maximum: 1 },
          },
        },
      },
      confidence: { type: "number", minimum: 0, maximum: 1 },
    },
  };
}

function systemPrompt(seMotion: SeMotion): string {
  const types = callTypesForMotion(seMotion).join(", ");
  if (seMotion === "expansion") {
    return `You classify customer Solution Engineering calls on LIVE / expansion accounts into exactly one primary type.
Use transcript evidence only — ignore meeting titles unless the opening confirms them.

Primary type must be one of:
${types}

Rules:
- Emit a mix array (max 4 entries) when the call is hybrid; weights 0..1 should sum to ~1.
- confidence 0..1 — report low confidence honestly when evidence is thin; do not force a label.
- Prefer the opening 10 minutes and what the SE actually did over generic small talk.
- demo_plan_upgrade = positioning a higher plan / more seats / AI add-on on the current product they already run.
- demo_cross_sell = positioning an adjacent product or module (not just a plan upgrade of what they have).
- ai_vision_demo = the call is specifically about Freddy / Copilot / agents / AI readiness, not a generic product demo.
- churn_mitigation = save / retention / "we're leaving" / usage collapse — not ordinary troubleshooting of one ticket.
- reverse_demo = customer shows their environment/process to the SE.
- qa_session = office hours / open Q&A, not structured discovery.

Respond with JSON only: { primary, mix, confidence }.`;
  }
  return `You classify customer Solution Engineering calls into exactly one primary type.
Use transcript evidence only — ignore meeting titles unless the opening confirms them.

Primary type must be one of:
${types}

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

function normalizeMix(
  raw: { type?: string; weight?: number }[] | undefined,
  seMotion: SeMotion,
): PostCallClassifyResult["mix"] {
  const allowed = new Set(callTypesForMotion(seMotion));
  const out: PostCallClassifyResult["mix"] = [];
  for (const entry of raw || []) {
    const type = remapCallTypeForMotion(String(entry.type || ""), seMotion);
    if (!allowed.has(type)) continue;
    const weight = Math.max(0, Math.min(1, Number(entry.weight) || 0));
    if (weight <= 0) continue;
    out.push({ type, weight });
    if (out.length >= 4) break;
  }
  return out;
}

function normalizeClassify(
  raw: {
    primary?: string;
    mix?: { type?: string; weight?: number }[];
    confidence?: number;
  },
  seMotion: SeMotion,
): PostCallClassifyResult {
  const allowed = callTypesForMotion(seMotion);
  const remapped = remapCallTypeForMotion(raw.primary, seMotion);
  const primary = allowed.includes(remapped) ? remapped : remapCallTypeForMotion("discovery", seMotion);
  let mix = normalizeMix(raw.mix, seMotion);
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

  const seMotion = canonicalizeSeMotion(input.seMotion);
  const parsed = parseTranscript(transcript);
  const provider = getPostCallProvider(env);
  const result = await provider.generate({
    maxTokens: 800,
    system: systemPrompt(seMotion),
    user: userPrompt(input, parsed),
    effort: env.POSTCALL_EFFORT || env.EFFORT || "low",
    research: false,
    thinkingBudget: 0,
    jsonSchema: classifySchema(seMotion) as unknown as Record<string, unknown>,
    passName: "classify",
    userId: input.userId,
    callId: input.callId,
  });

  return normalizeClassify(extractJson(result.text), seMotion);
}
