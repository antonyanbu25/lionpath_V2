// Post-call analysis pipeline — transcript in, structured summary + next steps + quality coach out.
// No web research; tuned for lower latency than pre-call prep.

import { extractJson } from "./json";
import { getPostCallProvider } from "./providers";
import type { ProviderEnv } from "./providers/types";
import { POSTCALL_SCHEMA, type PostCallAnalysis, type PostCallResult } from "./postcall-schema";
import { normalizeQualityCoach } from "./quality-score";
import { parseTranscript, trimTranscript } from "./transcript";
import { fetchTranscriptFromShareLink } from "./zoomShare";

export type Env = ProviderEnv;

export interface PostCallInput {
  transcript?: string;
  recordingUrl?: string;
  recordingPassword?: string;
  companyName?: string;
  meetingTitle?: string;
  meetingDate?: string;
  additionalContext?: string;
  effort?: string;
}

const ALLOWED_EFFORT = ["low", "medium", "high", "xhigh", "max"];

function usesGeminiStructuredOutput(env: Env): boolean {
  const provider = (env.POSTCALL_LLM_PROVIDER || env.LLM_PROVIDER || "gemini").toLowerCase();
  return provider === "gemini";
}

function systemPrompt(env: Env): string {
  const schemaBlock = usesGeminiStructuredOutput(env)
    ? `OUTPUT — CRITICAL: one JSON object only (callSummary, nextSteps, qualityCoach). No markdown.`
    : `OUTPUT — CRITICAL: respond with a SINGLE JSON object and nothing else. No markdown, no code
fences. It must match exactly this JSON Schema (all fields required):

${JSON.stringify(POSTCALL_SCHEMA)}`;

  return `You are a senior Freshworks Solution Engineering manager reviewing a completed customer call.
Produce: (1) callSummary — factual recap; (2) nextSteps — SE/AE actions, follow-up email, CRM notes;
(3) qualityCoach — score six dimensions 1–5 each (discovery, demo alignment, objections, value articulation,
next-step clarity, talk balance) with feedback and transcript evidence; list strengths, improvements,
and missedOpportunities. Do not output an overall score — it is computed from dimension averages.

Rules: never fabricate; empty arrays if not discussed; cite transcript evidence; keep lists scannable.

${schemaBlock}`;
}

function userPrompt(input: PostCallInput, parsed: ReturnType<typeof parseTranscript>): string {
  const lines = [
    "Analyze this call transcript.",
    "",
    `Transcript format: ${parsed.format}`,
    `Speakers detected: ${parsed.speakers.length ? parsed.speakers.join(", ") : "unknown"}`,
    `Word count: ${parsed.wordCount}`,
  ];
  if (parsed.durationMinutes != null) lines.push(`Approx duration: ${parsed.durationMinutes} minutes`);
  if (input.companyName) lines.push(`Company: ${input.companyName}`);
  if (input.meetingTitle) lines.push(`Meeting title: ${input.meetingTitle}`);
  if (input.meetingDate) lines.push(`Meeting date: ${input.meetingDate}`);
  if (input.additionalContext) {
    lines.push("", "Additional context from SE (RH answers, notes):", input.additionalContext);
  }
  lines.push("", "=== TRANSCRIPT ===", trimTranscript(parsed.text, 6000, "tail"), "=== END TRANSCRIPT ===");
  return lines.join("\n");
}

export async function analyzePostCall(env: Env, input: PostCallInput): Promise<PostCallResult> {
  let transcript = input.transcript?.trim() || "";
  let meetingTitle = input.meetingTitle;

  if (!transcript && input.recordingUrl?.trim()) {
    const fetched = await fetchTranscriptFromShareLink(
      input.recordingUrl.trim(),
      input.recordingPassword?.trim(),
    );
    transcript = fetched.transcript;
    if (!meetingTitle && fetched.topic) meetingTitle = fetched.topic;
  }

  if (!transcript) {
    throw new Error("Provide a transcript, a Zoom recording link, or both.");
  }

  const parsed = parseTranscript(transcript);
  const effort = ALLOWED_EFFORT.includes(input.effort || "")
    ? (input.effort as string)
    : env.POSTCALL_EFFORT || env.EFFORT || "low";

  const provider = getPostCallProvider(env);
  const result = await provider.generate({
    maxTokens: 6000,
    system: systemPrompt(env),
    user: userPrompt({ ...input, meetingTitle }, parsed),
    effort,
    research: false,
    thinkingBudget: 0,
    jsonSchema: POSTCALL_SCHEMA as unknown as Record<string, unknown>,
  });

  const raw = extractJson<Omit<PostCallAnalysis, "qualityCoach"> & { qualityCoach: Parameters<typeof normalizeQualityCoach>[0] }>(
    result.text,
  );
  const analysis: PostCallAnalysis = {
    ...raw,
    qualityCoach: normalizeQualityCoach(raw.qualityCoach),
  };
  return {
    analysis,
    transcriptMeta: {
      format: parsed.format,
      speakerCount: parsed.speakers.length,
      wordCount: parsed.wordCount,
      durationMinutes: parsed.durationMinutes,
      speakers: parsed.speakers,
    },
  };
}
