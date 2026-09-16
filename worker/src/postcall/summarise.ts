/**
 * Pass 7 — Commitments + call notes + MoM draft.
 *
 * followUps / objections → queryable collections (via web persist).
 * callNotes → PostCall.analysis blob (internal, blunt).
 * momDraft → momDrafts collection (customer-facing; never auto-send).
 *
 * Call notes ≠ MoM — generated in separate model calls; never derived by editing the other.
 */

import { extractJson } from "../json";
import { getPostCallProvider } from "../providers";
import type { ProviderEnv } from "../providers/types";
import type { PostCallTranscriptCacheBundle } from "../providers/gemini-cache";
import { formatTimestampedTranscript, parseTranscript, parseTranscriptCues } from "../transcript";
import { transcriptCacheHandle } from "./transcript-cache-context";
import { trimWords } from "../word-limits";
import { assembleMomEmailDraft } from "./mom-email-draft.js";
import { locateQuoteAtS } from "./timeline";
import type {
  FollowUpDraft,
  FollowUpOwner,
  FollowUpStatus,
  MomActionItem,
  MomDraftDraft,
  MomKeyPoint,
  ObjectionDraft,
} from "../domain-model/commitments";

export type Env = ProviderEnv;

export interface PostCallSummariseInput {
  transcript: string;
  callId?: string | null;
  dealId?: string | null;
  companyName?: string;
  meetingTitle?: string;
  callType?: string;
  /** Optional brief / context for unanswered discovery fields. */
  additionalContext?: string;
  userId?: string;
  transcriptCaches?: PostCallTranscriptCacheBundle;
}

export interface PostCallSummariseResult {
  followUps: FollowUpDraft[];
  objections: ObjectionDraft[];
  /** Internal blunt narrative — merge into PostCall.analysis.callNotes. */
  callNotes: string;
  /** Customer-facing draft — persist to momDrafts; sentAt always null here. */
  momDraft: MomDraftDraft;
}

const FOLLOW_UP_OWNERS: FollowUpOwner[] = ["se", "ae", "customer"];
const FOLLOW_UP_STATUSES: FollowUpStatus[] = ["open", "done", "cancelled"];

const COMMITMENTS_SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: ["followUps", "objections"],
  properties: {
    followUps: {
      type: "array",
      maxItems: 12,
      items: {
        type: "object",
        additionalProperties: false,
        required: ["description", "owner", "dueDate", "status", "sourceQuote"],
        properties: {
          description: { type: "string" },
          owner: { type: "string", enum: FOLLOW_UP_OWNERS },
          dueDate: { type: "string", nullable: true },
          status: { type: "string", enum: FOLLOW_UP_STATUSES },
          sourceQuote: { type: "string", nullable: true },
        },
      },
    },
    objections: {
      type: "array",
      maxItems: 8,
      items: {
        type: "object",
        additionalProperties: false,
        required: ["objectionText", "handling", "landed", "theme"],
        properties: {
          objectionText: { type: "string" },
          handling: { type: "string", nullable: true },
          landed: { type: "boolean" },
          theme: { type: "string", nullable: true },
        },
      },
    },
  },
};

const CALL_NOTES_SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: ["callNotes"],
  properties: {
    callNotes: { type: "string" },
  },
};

const MOM_SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: ["outcome", "keyPoints", "actionItems", "draftBody"],
  properties: {
    outcome: { type: "string" },
    keyPoints: {
      type: "array",
      maxItems: 10,
      items: {
        type: "object",
        additionalProperties: false,
        required: ["title", "detail"],
        properties: {
          title: { type: "string" },
          detail: { type: "string", nullable: true },
        },
      },
    },
    actionItems: {
      type: "array",
      maxItems: 12,
      items: {
        type: "object",
        additionalProperties: false,
        required: ["text", "owner", "dueDate", "atS", "sourceQuote"],
        properties: {
          text: { type: "string" },
          owner: { type: "string", enum: FOLLOW_UP_OWNERS, nullable: true },
          dueDate: { type: "string", nullable: true },
          atS: { type: "number", nullable: true },
          sourceQuote: { type: "string", nullable: true },
        },
      },
    },
    draftBody: { type: "string" },
  },
};

function commitmentsSystemPrompt(): string {
  return `You extract commitments and objections from a Solution Engineering customer call transcript.

Emit JSON only: { followUps, objections }.

followUps — commitments made aloud, unanswered questions, promised builds, discovery fields still unknown, next steps with owners.
Each followUp:
- description: what must happen (concrete, max 25 words)
- owner: exactly one of se | ae | customer
- dueDate: ISO date or relative phrase from the call, or null if none stated
- status: open for new items; done only if completed on the call; cancelled only if explicitly dropped
- sourceQuote: short verbatim quote supporting the item, or null

objections — pushback, concerns, competitive comparisons raised by the customer.
Each objection:
- objectionText: what they said (max 30 words)
- handling: how the SE/AE responded (max 30 words), or null if unhandled
- landed: true if the concern was resolved or accepted; false if still open
- theme: short label (pricing, security, competitor, timeline, product_gap, process, other) or null

Rules:
- Only include items evidenced in the transcript. Do not invent.
- Prefer customer-owned next steps when they exist; surface missing customer ownership as an open follow-up when the call ended without one.
- Empty arrays are valid when nothing was committed or objected.`;
}

function callNotesSystemPrompt(): string {
  return `You write INTERNAL call notes for a Solution Engineer. This is NOT the customer MoM.

Voice: blunt, honest, coaching-useful. Name what went well and what quietly failed.
Example tone: "The call ended without a customer-owned next step, which is what turned a good demo into 60 days of silence."

Rules:
- Internal only — never diplomatic fluff, never customer-facing language.
- Cover: what happened, what moved, what stalled, open risks, coaching observation.
- Format: 5–7 bullet points. Each bullet is one crisp coaching observation (15–35 words). Start each line with "- ".
- On-point density: not a CRM dump, not a single vague sentence — enough context to coach from.
- Use transcript evidence only. Do not invent attendees or commitments.
- Do NOT write minutes-of-meeting. Do NOT soften failures.

Respond with JSON only: { callNotes } where callNotes is a single string with newline-separated bullets (each line starts with "- ").`;
}

function momSystemPrompt(): string {
  return `You draft customer-facing Minutes of Meeting (MoM) for a Solution Engineering call.

Voice: diplomatic, clear, professional. Suitable to send to the customer after human edit.
This is NOT internal call notes — do not include coaching critique or blame.

Emit JSON with four fields:

outcome — 2–5 sentences. Lead with explicit decisions and agreements (trial agreed, POC scheduled, pricing sent, security review booked). Then briefly frame what the meeting covered. Customer-facing; no vague filler like "demonstration of X to centralize..." unless that was literally the agreed outcome.
keyPoints — 3–8 topic headers the call covered. Each:
  - title: short topic label (max 12 words)
  - detail: 1–3 sentences expanding the point, or null
actionItems — concrete next steps with owners. Each:
  - text: what will happen (max 25 words)
  - owner: se | ae | customer | null
  - dueDate: ISO date or relative phrase (e.g. "Friday", "next week") when stated or implied in transcript; null only if no timing was discussed
  - atS: seconds from call start when the commitment was made (from [mm:ss] transcript prefixes), or null
  - sourceQuote: short verbatim supporting the item, or null
draftBody — leave as empty string ""; the server assembles the email from structured fields.

Rules:
- Customer-facing only. No internal coaching language.
- Do not invent decisions, dates, or commitments not in the transcript.
- When the transcript states or implies a deadline, capture it in dueDate — do not leave action items undated if timing was mentioned.
- Avoid generic recap filler; every sentence should reflect a specific outcome, topic, or commitment from this call.
- Prefer atS from the [mm:ss] prefixes on the transcript lines.
- This draft will be human-edited before send. Never imply it was already sent.
- Do NOT reuse or lightly edit internal call notes — write the MoM from the transcript directly.`;
}

function sharedUserPreamble(input: PostCallSummariseInput, omitTranscript = false): string[] {
  const parsed = parseTranscript(input.transcript);
  const lines = [
    `Company: ${input.companyName || "unknown"}`,
    `Meeting title: ${input.meetingTitle || "unknown"}`,
    `Call type: ${input.callType || "unknown"}`,
    `Speakers: ${parsed.speakers.length ? parsed.speakers.join(", ") : "unknown"}`,
  ];
  if (input.additionalContext?.trim()) {
    lines.push("", "Additional context:", input.additionalContext.trim());
  }
  if (!omitTranscript) {
    lines.push("", "=== TRANSCRIPT ===");
    lines.push(formatTimestampedTranscript(input.transcript, 5500));
  }
  return lines;
}

function normalizeOwner(raw: unknown): FollowUpOwner {
  const v = String(raw || "").toLowerCase().trim();
  if (FOLLOW_UP_OWNERS.includes(v as FollowUpOwner)) return v as FollowUpOwner;
  if (v.includes("customer") || v.includes("prospect")) return "customer";
  if (v.includes("ae") || v.includes("account exec") || v.includes("sales")) return "ae";
  return "se";
}

function normalizeStatus(raw: unknown): FollowUpStatus {
  const v = String(raw || "").toLowerCase().trim();
  if (FOLLOW_UP_STATUSES.includes(v as FollowUpStatus)) return v as FollowUpStatus;
  return "open";
}

export function normalizeFollowUps(raw: unknown): FollowUpDraft[] {
  if (!Array.isArray(raw)) return [];
  const out: FollowUpDraft[] = [];
  for (const row of raw) {
    if (!row || typeof row !== "object") continue;
    const r = row as Record<string, unknown>;
    const description = trimWords(String(r.description || ""), 25);
    if (!description) continue;
    out.push({
      description,
      owner: normalizeOwner(r.owner),
      dueDate: r.dueDate == null || r.dueDate === "" ? null : trimWords(String(r.dueDate), 12),
      status: normalizeStatus(r.status),
      sourceQuote: r.sourceQuote == null || r.sourceQuote === ""
        ? null
        : trimWords(String(r.sourceQuote), 40),
    });
    if (out.length >= 12) break;
  }
  return out;
}

export function normalizeObjections(raw: unknown): ObjectionDraft[] {
  if (!Array.isArray(raw)) return [];
  const out: ObjectionDraft[] = [];
  for (const row of raw) {
    if (!row || typeof row !== "object") continue;
    const r = row as Record<string, unknown>;
    const objectionText = trimWords(String(r.objectionText || ""), 30);
    if (!objectionText) continue;
    out.push({
      objectionText,
      handling: r.handling == null || r.handling === ""
        ? null
        : trimWords(String(r.handling), 30),
      landed: !!r.landed,
      theme: r.theme == null || r.theme === "" ? null : trimWords(String(r.theme), 6),
    });
    if (out.length >= 8) break;
  }
  return out;
}

export function normalizeCallNotes(raw: unknown): string {
  if (typeof raw === "string") return trimWords(raw, 400);
  if (raw && typeof raw === "object" && "callNotes" in (raw as object)) {
    return trimWords(String((raw as { callNotes?: unknown }).callNotes || ""), 400);
  }
  return "";
}

export function normalizeMomKeyPoints(raw: unknown): MomKeyPoint[] {
  if (!Array.isArray(raw)) return [];
  const out: MomKeyPoint[] = [];
  for (const row of raw) {
    if (!row || typeof row !== "object") continue;
    const r = row as Record<string, unknown>;
    const title = trimWords(String(r.title || ""), 12);
    if (!title) continue;
    out.push({
      title,
      detail: r.detail == null || r.detail === "" ? null : trimWords(String(r.detail), 60),
    });
    if (out.length >= 10) break;
  }
  return out;
}

export function normalizeMomActionItems(raw: unknown): MomActionItem[] {
  if (!Array.isArray(raw)) return [];
  const out: MomActionItem[] = [];
  for (const row of raw) {
    if (!row || typeof row !== "object") continue;
    const r = row as Record<string, unknown>;
    const text = trimWords(String(r.text || ""), 25);
    if (!text) continue;
    const atSRaw = r.atS;
    const atS =
      typeof atSRaw === "number" && Number.isFinite(atSRaw) && atSRaw >= 0
        ? Math.round(atSRaw)
        : null;
    out.push({
      text,
      owner: r.owner == null || r.owner === "" ? null : normalizeOwner(r.owner),
      dueDate: r.dueDate == null || r.dueDate === "" ? null : trimWords(String(r.dueDate), 12),
      atS,
      sourceQuote:
        r.sourceQuote == null || r.sourceQuote === ""
          ? null
          : trimWords(String(r.sourceQuote), 40),
    });
    if (out.length >= 12) break;
  }
  return out;
}

function assembleMomDraftBody(
  outcome: string,
  keyPoints: MomKeyPoint[],
  actionItems: MomActionItem[],
  fallbackBody: string,
): string {
  const hasStructured =
    outcome.trim().length > 0 || keyPoints.length > 0 || actionItems.length > 0;
  if (hasStructured) {
    return assembleMomEmailDraft({ outcome, keyPoints, actionItems });
  }
  if (fallbackBody.trim()) return trimWords(fallbackBody, 450);
  return "";
}

/**
 * Stamp missing atS by locating sourceQuote (or text) in the cue stream.
 * Never invents a timestamp — unplaced items stay null.
 */
export function stampMomActionTimestamps(
  items: MomActionItem[],
  transcript: string,
): MomActionItem[] {
  const cues = parseTranscriptCues(transcript);
  if (!cues.length) return items;
  return items.map((item) => {
    if (item.atS != null) return item;
    const probe = item.sourceQuote || item.text;
    const atS = locateQuoteAtS(probe, cues);
    return atS == null ? item : { ...item, atS };
  });
}

export function normalizeMomDraft(raw: unknown, transcript = ""): MomDraftDraft {
  let body = "";
  let outcome = "";
  let keyPoints: MomKeyPoint[] = [];
  let actionItems: MomActionItem[] = [];

  if (typeof raw === "string") {
    body = raw;
  } else if (raw && typeof raw === "object") {
    const r = raw as Record<string, unknown>;
    body = String(r.draftBody || "");
    outcome = typeof r.outcome === "string" ? trimWords(r.outcome, 120) : "";
    keyPoints = normalizeMomKeyPoints(r.keyPoints);
    actionItems = stampMomActionTimestamps(normalizeMomActionItems(r.actionItems), transcript);
  }

  if (!outcome && body.trim()) outcome = trimWords(body, 120);

  const draftBody = assembleMomDraftBody(outcome, keyPoints, actionItems, body);

  return {
    draftBody,
    outcome: outcome || null,
    keyPoints,
    actionItems,
    editedBody: null,
    sentAt: null,
    sentBy: null,
  };
}

async function generateJson(
  env: Env,
  opts: {
    system: string;
    user: string;
    jsonSchema: Record<string, unknown>;
    maxTokens: number;
    step: string;
    cachedContent?: string;
  },
  usage?: { userId?: string; callId?: string | null },
): Promise<unknown> {
  const provider = getPostCallProvider(env);
  const result = await provider.generate({
    maxTokens: opts.maxTokens,
    system: opts.system,
    user: opts.user,
    effort: env.POSTCALL_EFFORT || env.EFFORT || "medium",
    research: false,
    jsonSchema: opts.jsonSchema,
    step: opts.step,
    passName: "summarise",
    userId: usage?.userId,
    callId: usage?.callId ?? undefined,
    cachedContent: opts.cachedContent,
  });
  return extractJson(result.text);
}

/**
 * Pass 7 entry — three separate model calls so call notes and MoM are never
 * lightly edited versions of each other.
 */
export async function runPostCallSummarise(
  env: Env,
  input: PostCallSummariseInput,
): Promise<PostCallSummariseResult> {
  const transcript = input.transcript?.trim();
  if (!transcript) throw Object.assign(new Error("transcript is required."), { status: 400 });

  const transcriptCache = transcriptCacheHandle(input.transcriptCaches, "timestampedSummarise");
  const preamble = sharedUserPreamble(input, !!transcriptCache).join("\n");

  const usage = { userId: input.userId, callId: input.callId };
  const [commitmentsRaw, notesRaw, momRaw] = await Promise.all([
    generateJson(env, {
      system: commitmentsSystemPrompt(),
      user: ["Extract follow-ups and objections from this call.", "", preamble].join("\n"),
      jsonSchema: COMMITMENTS_SCHEMA as unknown as Record<string, unknown>,
      maxTokens: 4000,
      step: "postcall-summarise-commitments",
      cachedContent: transcriptCache,
    }, usage),
    generateJson(env, {
      system: callNotesSystemPrompt(),
      user: ["Write internal call notes for this call.", "", preamble].join("\n"),
      jsonSchema: CALL_NOTES_SCHEMA as unknown as Record<string, unknown>,
      maxTokens: 2500,
      step: "postcall-summarise-call-notes",
      cachedContent: transcriptCache,
    }, usage),
    generateJson(env, {
      system: momSystemPrompt(),
      user: ["Draft customer-facing minutes of meeting for this call.", "", preamble].join("\n"),
      jsonSchema: MOM_SCHEMA as unknown as Record<string, unknown>,
      maxTokens: 2500,
      step: "postcall-summarise-mom",
      cachedContent: transcriptCache,
    }, usage),
  ]);

  const commitments = (commitmentsRaw || {}) as { followUps?: unknown; objections?: unknown };

  return {
    followUps: normalizeFollowUps(commitments.followUps),
    objections: normalizeObjections(commitments.objections),
    callNotes: normalizeCallNotes(notesRaw),
    momDraft: normalizeMomDraft(momRaw, transcript),
  };
}
