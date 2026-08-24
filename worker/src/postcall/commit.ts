/**
 * Pass 5 — Technical commit: the whiteboard decomposition, plus what this call moved.
 *
 * The model extracts current state with evidence per slot. Deltas against the prior deal
 * snapshot are then computed as a pure function — the model never decides whether something
 * "changed", because that judgement has to be reproducible and auditable.
 *
 * TC is deal state, not call quality. Nothing here feeds QIP.
 */

import { extractJson } from "../json";
import { getPostCallProvider } from "../providers";
import type { LlmProvider, LlmResult, ProviderEnv } from "../providers/types";
import { logInfo } from "../logger";
import type { PostCallTranscriptCacheBundle } from "../providers/gemini-cache";
import { jsonrepair } from "jsonrepair";
import { redactTranscriptPii } from "../data/transcript-redaction";
import {
  TC_SLOT_KEYS,
  TC_STATUSES,
  type AiAttachValue,
  type TcChangeType,
  type TcDeltaDraft,
  type TcFieldSlot,
  type TcSlotKey,
  type TcStatus,
  type TechnicalCommitDraft,
} from "../domain-model/technical-commit";
import { parseTranscript, trimTranscript } from "../transcript";
import { trimWords } from "../word-limits";
import { transcriptCacheHandle } from "./transcript-cache-context";

export type Env = ProviderEnv;

export interface PostCallCommitInput {
  transcript: string;
  callId?: string | null;
  dealId?: string | null;
  companyName?: string;
  meetingTitle?: string;
  callType?: string;
  /** Prior snapshot for this deal — the answer key deltas are measured against. */
  previous?: Partial<TechnicalCommitDraft> | null;
  briefContext?: string | null;
  additionalContext?: string;
  userId?: string;
  transcriptCaches?: PostCallTranscriptCacheBundle;
}

export interface PostCallCommitResult {
  technicalCommit: TechnicalCommitDraft;
  tcDeltas: TcDeltaDraft[];
}

const NOT_SURFACED = "not surfaced";

const SLOT_SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: ["value", "evidence", "surfaced"],
  properties: {
    value: { type: "string" },
    evidence: { type: "string" },
    surfaced: { type: "boolean" },
  },
};

const COMMIT_SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: ["status", "justification", ...TC_SLOT_KEYS, "aiAttach"],
  properties: {
    status: { type: "string", enum: [...TC_STATUSES] },
    justification: { type: "string", nullable: true },
    ...Object.fromEntries(TC_SLOT_KEYS.map((key) => [key, SLOT_SCHEMA])),
    aiAttach: {
      type: "object",
      additionalProperties: false,
      required: ["surfaced"],
      properties: {
        surfaced: { type: "boolean" },
        product: { type: "string", nullable: true },
        agentCount: { type: "integer", nullable: true, minimum: 0 },
        agentTotal: { type: "integer", nullable: true, minimum: 0 },
        summary: { type: "string", nullable: true },
        optedInAfterDemo: { type: "boolean", nullable: true },
      },
    },
  },
};

interface RawSlot {
  value?: string;
  evidence?: string;
  surfaced?: boolean;
}

interface RawCommit {
  status?: string;
  justification?: string | null;
  aiAttach?: {
    surfaced?: boolean;
    product?: string | null;
    agentCount?: number | null;
    agentTotal?: number | null;
    summary?: string | null;
    optedInAfterDemo?: boolean | null;
  };
  [key: string]: unknown;
}

function safeParseJson<T>(text: string): T {
  const parse = (raw: string): T => {
    const parsed = extractJson<T>(raw);
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
      throw new Error("Model JSON was not an object.");
    }
    return parsed;
  };
  try {
    return parse(text);
  } catch (firstErr) {
    try {
      // NEW-9: cap the input to jsonrepair to prevent DoS via oversized
      // LLM output. 256KB is generous for any structured JSON response.
      const capped = text.length > 256 * 1024 ? text.slice(0, 256 * 1024) : text;
      return parse(jsonrepair(capped));
    } catch {
      throw firstErr;
    }
  }
}

function retryPrompt(input: PostCallCommitInput, parsed: ReturnType<typeof parseTranscript>, omitTranscript: boolean, env?: Env): string {
  return [
    userPrompt(input, parsed, omitTranscript, env),
    "",
    "Your previous response was truncated. Produce the COMPLETE JSON in a single response. Keep the justification field under 150 words. Do not include any text outside the JSON object.",
  ].join("\n");
}

function continuationPrompt(partialJson: string): string {
  return [
    "The previous response ended before the JSON object was complete.",
    "Continue from the exact final character of the partial JSON below.",
    "Return only the missing JSON suffix needed to complete the object. Do not repeat any prefix.",
    "",
    "PARTIAL JSON:",
    partialJson,
  ].join("\n");
}

function logCommitRetry(label: string, result: LlmResult): void {
  logInfo("[postcall-commit] retry result", {
    label,
    finishReason: result.finishReason ?? "unknown",
    outputTokens: result.usage?.outputTokens ?? 0,
  });
}

/** A slot without evidence is not a slot — it collapses to null rather than an empty claim. */
function normalizeSlot(raw: RawSlot | undefined): TcFieldSlot | null {
  if (!raw?.surfaced) return null;
  const value = trimWords(String(raw.value ?? "").trim(), 25);
  const evidence = trimWords(String(raw.evidence ?? "").trim(), 40);
  if (!value || value.toLowerCase() === "unknown") return null;
  if (!evidence || evidence.toLowerCase() === NOT_SURFACED) return null;
  return { value, evidence };
}

function normalizeAiAttach(raw: RawCommit["aiAttach"]): AiAttachValue | null {
  if (!raw?.surfaced) return null;
  const product = raw.product ? trimWords(String(raw.product).trim(), 6) : undefined;
  const agentCount = Number.isFinite(Number(raw.agentCount)) && raw.agentCount != null
    ? Number(raw.agentCount)
    : undefined;
  const agentTotal = Number.isFinite(Number(raw.agentTotal)) && raw.agentTotal != null
    ? Number(raw.agentTotal)
    : undefined;
  const summary = raw.summary ? trimWords(String(raw.summary).trim(), 15) : undefined;

  if (!product && agentCount == null && agentTotal == null && !summary) return null;

  const derived =
    summary ||
    (product && agentCount != null && agentTotal != null
      ? `${product} ${agentCount}/${agentTotal}`
      : product) ||
    undefined;

  return {
    ...(product ? { product } : {}),
    ...(agentCount != null ? { agentCount } : {}),
    ...(agentTotal != null ? { agentTotal } : {}),
    ...(derived ? { summary: derived } : {}),
    ...(raw.optedInAfterDemo != null ? { optedInAfterDemo: !!raw.optedInAfterDemo } : {}),
  };
}

/** Exported for unit tests (no LLM). */
export function normalizeCommitOutput(raw: Partial<RawCommit>): TechnicalCommitDraft {
  const status = TC_STATUSES.includes(raw?.status as TcStatus)
    ? (raw!.status as TcStatus)
    : "pending";
  const justificationRaw = String(raw?.justification ?? "").trim();

  const out = {
    status,
    justification: justificationRaw ? trimWords(justificationRaw, 40) : null,
    aiAttach: normalizeAiAttach(raw?.aiAttach),
  } as TechnicalCommitDraft;

  for (const key of TC_SLOT_KEYS) {
    out[key] = normalizeSlot(raw?.[key] as RawSlot | undefined);
  }
  return out;
}

function slotsEqual(a: TcFieldSlot | null, b: TcFieldSlot | null): boolean {
  if (!a && !b) return true;
  if (!a || !b) return false;
  return a.value.trim().toLowerCase() === b.value.trim().toLowerCase();
}

function aiAttachEqual(a: AiAttachValue | null, b: AiAttachValue | null): boolean {
  if (!a && !b) return true;
  if (!a || !b) return false;
  return (
    (a.product || "").toLowerCase() === (b.product || "").toLowerCase() &&
    a.agentCount === b.agentCount &&
    a.agentTotal === b.agentTotal
  );
}

function changeTypeFor(hadPrevious: boolean, unchanged: boolean): TcChangeType {
  if (!hadPrevious) return "new";
  return unchanged ? "confirmed" : "changed";
}

/**
 * Deltas for slots this call actually surfaced. Silence is not movement — a slot the call
 * never mentioned emits nothing, rather than a false "confirmed".
 *
 * Exported for unit tests (no LLM).
 */
export function buildTcDeltaDrafts(
  previous: Partial<TechnicalCommitDraft> | null | undefined,
  current: TechnicalCommitDraft,
): TcDeltaDraft[] {
  const deltas: TcDeltaDraft[] = [];
  const prev = previous || {};

  for (const key of TC_SLOT_KEYS) {
    const now = current[key as TcSlotKey];
    if (!now) continue;
    const before = (prev[key as TcSlotKey] as TcFieldSlot | null | undefined) ?? null;
    deltas.push({
      field: key,
      previous: before,
      current: now,
      changeType: changeTypeFor(!!before, slotsEqual(before, now)),
      evidence: now.evidence || NOT_SURFACED,
    });
  }

  if (current.aiAttach) {
    const before = (prev.aiAttach as AiAttachValue | null | undefined) ?? null;
    deltas.push({
      field: "aiAttach",
      previous: before,
      current: current.aiAttach,
      changeType: changeTypeFor(!!before, aiAttachEqual(before, current.aiAttach)),
      evidence: current.aiAttach.summary || NOT_SURFACED,
    });
  }

  const prevStatus = (prev.status as TcStatus | undefined) ?? null;
  if (prevStatus !== current.status || !prevStatus) {
    deltas.push({
      field: "status",
      previous: prevStatus,
      current: current.status,
      changeType: changeTypeFor(!!prevStatus, prevStatus === current.status),
      evidence: current.justification || NOT_SURFACED,
    });
  }

  return deltas;
}

function systemPrompt(): string {
  return `You extract the TECHNICAL COMMIT state of a deal from a Solution Engineering customer call transcript.

Emit JSON only, with exactly these keys: status, justification, ${TC_SLOT_KEYS.join(", ")}, aiAttach.

Each of ${TC_SLOT_KEYS.join(", ")} is an object { value, evidence, surfaced }:
- surfaced: true ONLY when this call contains direct evidence for that field.
- surfaced: false when the call did not cover it — set value to "" and evidence to "not surfaced".
- value: concise state, max 25 words.
- evidence: short verbatim quote from the transcript, max 40 words.

Field meanings:
- incumbent: the tool or process they use today.
- competitor: named alternatives they are evaluating against us.
- identifiedRisk: the concrete thing that could kill or delay this deal — technical, security, resourcing or political.
- timelineForClosure: dates or timeframes the customer stated for deciding or going live.
- reasonForEvaluation: why they are looking at all, in the customer's own framing.
- whatsWorking: capabilities the customer reacted positively to on this call.

status is the technical commit: "yes" only when the customer expressed technical confidence to proceed, "at_risk" when a blocker was raised and left unresolved, "no" when they ruled us out technically, "pending" otherwise. Default to "pending" — do not read enthusiasm as commitment.

justification: one sentence, max 40 words, explaining the status. Null when the call gives no basis.

aiAttach { surfaced, product, agentCount, agentTotal, summary, optedInAfterDemo }:
- surfaced false unless AI/Copilot/agent scope was actually discussed.
- agentCount/agentTotal only when the customer stated numbers.
- optedInAfterDemo true only when they opted in AFTER being shown it, not before.

Rules (strict):
- Never fabricate. Every surfaced field needs transcript evidence.
- Report only what THIS call establishes. Do not restate the prior snapshot as new evidence.
- This is deal state, not SE performance. Do not score the SE.`;
}

function slotLine(key: string, slot: TcFieldSlot | null | undefined): string | null {
  return slot?.value ? `- ${key}: ${slot.value}` : null;
}

function userPrompt(
  input: PostCallCommitInput,
  parsed: ReturnType<typeof parseTranscript>,
  omitTranscript = false,
  env?: Env,
): string {
  const lines = ["Extract the technical commit state from this call.", "", `Word count: ${parsed.wordCount}`];
  if (input.companyName) lines.push(`Company: ${input.companyName}`);
  if (input.meetingTitle) lines.push(`Meeting: ${input.meetingTitle}`);
  if (input.callType) lines.push(`Call type: ${input.callType}`);

  const prev = input.previous;
  if (prev) {
    const prevLines = [
      prev.status ? `- status: ${prev.status}` : null,
      ...TC_SLOT_KEYS.map((key) => slotLine(key, prev[key as TcSlotKey])),
      prev.aiAttach?.summary ? `- aiAttach: ${prev.aiAttach.summary}` : null,
    ].filter(Boolean);
    if (prevLines.length) {
      lines.push(
        "",
        "Prior technical commit snapshot for this deal (context only — do not repeat it as this call's evidence):",
        ...(prevLines as string[]),
      );
    }
  }

  if (input.briefContext?.trim()) {
    lines.push("", "Pre-call brief:", input.briefContext.trim());
  }
  if (input.additionalContext?.trim()) {
    lines.push("", "Additional SE context:", input.additionalContext.trim());
  }
  if (!omitTranscript) {
    // NEW-4: redact PII (emails/phones/CCs) from the transcript before
    // sending to the LLM when LLM_TRANSCRIPT_REDACTION=1.
    const transcriptText = redactTranscriptPii(trimTranscript(parsed.text, 6000, "tail"), env);
    lines.push("", "=== TRANSCRIPT ===", transcriptText, "=== END TRANSCRIPT ===");
  }
  return lines.join("\n");
}

export async function runPostCallCommit(
  env: Env,
  input: PostCallCommitInput,
): Promise<PostCallCommitResult> {
  return runPostCallCommitWithProvider(env, input, getPostCallProvider(env));
}

export async function runPostCallCommitWithProvider(
  env: Env,
  input: PostCallCommitInput,
  provider: LlmProvider,
): Promise<PostCallCommitResult> {
  const transcript = input.transcript?.trim();
  if (!transcript) {
    throw Object.assign(new Error("transcript is required."), { status: 400 });
  }

  const parsed = parseTranscript(transcript);
  const effort = env.POSTCALL_EFFORT || env.EFFORT || "low";
  const transcriptCache = transcriptCacheHandle(input.transcriptCaches, "tail6000");

  let result = await provider.generate({
    maxTokens: 4000,
    system: systemPrompt(),
    user: userPrompt(input, parsed, !!transcriptCache, env),
    effort,
    research: false,
    thinkingBudget: 0,
    jsonSchema: COMMIT_SCHEMA as unknown as Record<string, unknown>,
    passName: "commit",
    userId: input.userId,
    callId: input.callId ?? undefined,
    cachedContent: transcriptCache,
  });

  let raw: Partial<RawCommit>;
  try {
    raw = safeParseJson<Partial<RawCommit>>(result.text);
  } catch (firstErr) {
    const partialJson = result.text;
    result = await provider.generate({
      maxTokens: 6000,
      system: systemPrompt(),
      user: retryPrompt(input, parsed, !!transcriptCache, env),
      effort,
      research: false,
      thinkingBudget: 0,
      jsonSchema: COMMIT_SCHEMA as unknown as Record<string, unknown>,
      passName: "commit",
      userId: input.userId,
      callId: input.callId ?? undefined,
      cachedContent: transcriptCache,
      retryAttempt: 1,
    });
    logCommitRetry("complete-json", result);
    try {
      raw = safeParseJson<Partial<RawCommit>>(result.text);
    } catch (secondErr) {
      const continuation = await provider.generate({
        maxTokens: 8000,
        system: systemPrompt(),
        user: continuationPrompt(partialJson),
        effort,
        research: false,
        thinkingBudget: 0,
        passName: "commit",
        userId: input.userId,
        callId: input.callId ?? undefined,
        retryAttempt: 2,
        temperature: 0.2,
      });
      logCommitRetry("continuation", continuation);
      try {
        raw = safeParseJson<Partial<RawCommit>>(`${partialJson}${continuation.text}`);
      } catch {
        const err = new Error(
          `Technical commit JSON parse failed after 3 attempts. Initial: ${(firstErr as Error).message}. Retry: ${(secondErr as Error).message}. Raw output: ${result.text}`,
        );
        throw Object.assign(err, { rawOutput: result.text, partialJson });
      }
    }
  }

  const technicalCommit = normalizeCommitOutput(raw);

  return {
    technicalCommit,
    tcDeltas: buildTcDeltaDrafts(input.previous, technicalCommit),
  };
}
