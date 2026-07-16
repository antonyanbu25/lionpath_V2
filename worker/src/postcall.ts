// Post-call analysis pipeline — transcript in, structured summary + next steps + quality coach out.
// No web research; tuned for lower latency than pre-call prep.

import { extractJson } from "./json";
import { getPostCallProvider } from "./providers";
import type { ProviderEnv } from "./providers/types";
import { POSTCALL_SCHEMA, type PostCallAnalysis, type PostCallResult } from "./postcall-schema";
import { normalizeQualityCoach } from "./quality-score";
import { parseTranscript, trimTranscript } from "./transcript";
import { fetchTranscriptFromShareLink } from "./zoomShare";
import { normalizePostCallOutput } from "./word-limits";

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
    ? `OUTPUT — CRITICAL: one JSON object only (callHeader, momentum, followUpTable, signals, nextSteps, qualityCoach, artifacts). No markdown.`
    : `OUTPUT — CRITICAL: respond with a SINGLE JSON object and nothing else. No markdown, no code
fences. It must match exactly this JSON Schema (all fields required):

${JSON.stringify(POSTCALL_SCHEMA)}`;

  return `You are a senior Freshworks Solution Engineering manager reviewing a completed customer call.
Score like a sales engineering manager doing QA, not a cheerleader.

Produce a scannable post-call one-pager with tables and bullets ONLY (no paragraphs).

WORD CAPS (strict):
- Table cells (followUpTable, nextSteps owner/action/due, callHeader duration/date): max 8 words.
- Bullets (signals.*, qualityCoach strengths/improvements/missed, dimension feedback): max 12 words.
- nextSteps.why: max 14 words.
- momentum.reason: max 18 words.
- callHeader.title: max 15 words.

STRUCTURE (UI render order — callHeader first, then momentum hero):
1. callHeader — title, duration, date, attendees with influence enum (high|medium|low).
2. momentum — HERO immediately below header. status enum Advancing|Stalled|At risk, reason (max 18 words),
   topAction, topActionDue. Deal momentum ≠ quality score.
3. followUpTable — SINGLE summary of decisions, commitments, SE actions, AE actions,
   objections, next meeting. Each row: category, thisCall (max 8 words), followUp (max 8 words).
   Do NOT repeat these rows in nextSteps.
4. signals — painsConfirmed (max 4), objectionsOpen (max 4), competitors (max 4), one line each.
5. nextSteps — Owner|Action|Due|Why table for actionable items NOT already in followUpTable.
   Include AE follow-ups, customer internal-review commitments, and coach missed opportunities.
   Why max 14 words. Set isRisk=true for rows from missedOpportunities (concrete action, no "Risk:" prefix).
6. qualityCoach — six dimensions 1–5 with feedback and evidence (max 12 words each).
   strengths: top 2, improvements: top 2, missedOpportunities: top 1 only.
   Do not output overall score — computed from dimensions.
7. artifacts — suggestedFollowUpEmail (subject+body) and crmNotes (collapsible in UI).

DEDUPE RULE — followUpTable vs nextSteps:
- followUpTable = what was decided/committed on the call (summary pairs).
- nextSteps = who must do what next that is NOT already captured in followUpTable.
- Never put the same action in both (e.g. "send link" / "share recording" belong in followUpTable only).

DIMENSION SCORING RUBRIC (strict — calibrate to real SE QA standards):
- 5/5 Exceptional (rare): repeated, specific transcript evidence of best-in-class execution
- 4/5 Solid: meets SE expectations with only minor gaps
- 3/5 Acceptable: basic execution but noticeable weaknesses — typical average call
- 2/5 Needs improvement: significant misses or weak execution
- 1/5 Missed: dimension largely absent or handled poorly

CALIBRATION — apply strictly:
- A typical average SE call should land ~3–3.5/5 per dimension, NOT 4–5
- Only award 5 when there is clear, specific transcript evidence of excellence
- Score DOWN for shallow discovery, generic demo, weak next steps, SE talk dominance
- If evidence is thin, score 2–3 and say why in feedback

Rules: never fabricate; empty arrays if not discussed; cite transcript evidence.

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

function parseAnalysis(
  raw: Omit<PostCallAnalysis, "qualityCoach"> & {
    qualityCoach: Parameters<typeof normalizeQualityCoach>[0];
  },
): PostCallAnalysis {
  const trimmed = normalizePostCallOutput({
    ...raw,
    qualityCoach: {
      ...raw.qualityCoach,
      overallScore: 0,
      overallLabel: "",
    },
  });
  return {
    ...trimmed,
    qualityCoach: normalizeQualityCoach(trimmed.qualityCoach),
  };
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

  const analysis = parseAnalysis(
    extractJson<
      Omit<PostCallAnalysis, "qualityCoach"> & {
        qualityCoach: Parameters<typeof normalizeQualityCoach>[0];
      }
    >(result.text),
  );

  const header = analysis.callHeader;
  if (!header.duration && parsed.durationMinutes != null) {
    header.duration = `~${parsed.durationMinutes} min`;
  }
  if (!header.title && meetingTitle) {
    header.title = meetingTitle;
  }
  if (!header.date && input.meetingDate) {
    header.date = input.meetingDate;
  }
  if (!header.attendees?.length && parsed.speakers.length) {
    header.attendees = parsed.speakers.slice(0, 8).map((name) => ({
      name,
      role: "unknown",
      influence: "medium" as const,
    }));
  }

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
