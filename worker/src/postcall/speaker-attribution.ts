/**
 * Speaker attribution pass — runs between resolve and the confirm-page render.
 *
 * Kaia/Zoom transcripts sometimes carry a shared device/meeting-room mic label (e.g.
 * "Meeting Room", "Conference Room B") that picks up several real people, plus speakers
 * that never introduce themselves by full name. This pass makes ONE LLM call (mirrors
 * ../postcall/classify.ts's provider/temperature/schema/extractJson pattern) that proposes:
 *   - roster: merge suggestions for ambiguous/device speaker labels into real people
 *   - roomSegments: time spans of a shared-mic label attributable to one person
 *
 * These are SUGGESTIONS ONLY — never auto-applied. The confirm page (web/postcall.js)
 * renders them for the SE to accept, edit, or reject before generate.
 */

import { extractJson } from "../json";
import { getPostCallProvider } from "../providers";
import type { ProviderEnv } from "../providers/types";
import { formatTimestampedTranscript, parseTranscriptCues } from "../transcript";

export type Env = ProviderEnv;

/** Keep in sync with CONFIRM_ROLE_SET in web/postcall.js. */
export const SPEAKER_ATTRIBUTION_ROLE_OPTIONS = [
  "Customer",
  "Primary SE",
  "Secondary SE",
  "AE",
  "Partner",
  "Meeting room",
  "Manager",
  "Executive",
] as const;

export type SpeakerAttributionRole = (typeof SPEAKER_ATTRIBUTION_ROLE_OPTIONS)[number];

export interface SpeakerRosterEntry {
  /** Raw speaker label as it appears in the transcript. */
  label: string;
  /** Best-guess real name for this label (may equal `label` when already a real name). */
  canonicalName: string;
  suggestedRole: SpeakerAttributionRole;
  confidence: number;
  /** Short transcript-grounded justification — never fabricated. */
  evidence: string;
}

export interface RoomSegmentSuggestion {
  /** The shared device/meeting-room speaker label this segment came from. */
  label: string;
  startS: number;
  endS: number;
  /** Best-guess real person speaking during this span. */
  attributedTo: string;
  confidence: number;
  /** Short verbatim-ish quote grounding the attribution. */
  quote: string;
  /** Short justification (self-reference, introduction, content cue, etc). */
  reason: string;
}

export interface SpeakerAttributionResult {
  roster: SpeakerRosterEntry[];
  roomSegments: RoomSegmentSuggestion[];
}

export interface SpeakerAttributionInput {
  transcript: string;
  /** Known participants — resolve.ts identity hints + confirm-page attendees, when available. */
  participants?: string[];
  userId?: string;
  callId?: string;
}

const SPEAKER_ATTRIBUTION_SCHEMA = {
  type: "object",
  required: ["roster", "roomSegments"],
  properties: {
    roster: {
      type: "array",
      maxItems: 30,
      items: {
        type: "object",
        required: ["label", "canonicalName", "suggestedRole", "confidence", "evidence"],
        properties: {
          label: { type: "string" },
          canonicalName: { type: "string" },
          suggestedRole: { type: "string", enum: [...SPEAKER_ATTRIBUTION_ROLE_OPTIONS] },
          confidence: { type: "number", minimum: 0, maximum: 1 },
          evidence: { type: "string" },
        },
      },
    },
    roomSegments: {
      type: "array",
      maxItems: 40,
      items: {
        type: "object",
        required: ["label", "startS", "endS", "attributedTo", "confidence", "quote", "reason"],
        properties: {
          label: { type: "string" },
          startS: { type: "number" },
          endS: { type: "number" },
          attributedTo: { type: "string" },
          confidence: { type: "number", minimum: 0, maximum: 1 },
          quote: { type: "string" },
          reason: { type: "string" },
        },
      },
    },
  },
};

function systemPrompt(): string {
  return `You resolve speaker identity on a Solution Engineering call transcript. You NEVER auto-apply anything —
your output is reviewed and edited by the SE before it is used.

Task 1 — roster: for every distinct speaker label in the transcript, decide whether it is already a real
person's name or whether it is an ambiguous/device/meeting-room label that should be merged into a real
person. Use introductions ("Hi, I'm ..."), self-references, and content cues:
  - deep product/technical questions or answers → Secondary SE or Primary SE
  - pricing, contract, next-steps ownership → AE
  - requirements, business pain, budget, approvals → Customer
  - org-chart / decision-authority language ("I run this team", "I'll need to sign off") → Manager or Executive
  - a label that clearly names a physical room or shared device (e.g. "Meeting Room", "Conference Room B",
    "Room 3 Mic") rather than a person → suggestedRole "Meeting room"

Task 2 — roomSegments: ONLY for speaker labels that look like a shared device/meeting-room mic (multiple
people's voices under one label). Break its speaking time into segments and attribute each segment to the
most likely real person speaking, using the same evidence types as above.

RULES (mandatory):
1. NEVER fabricate a name, role, or quote that is not grounded in the transcript. If you cannot tell who is
   speaking, still emit the entry with confidence <= 0.3 and evidence/reason explaining the uncertainty —
   do not omit it and do not invent certainty.
2. Every quote must be verbatim (or near-verbatim, trimmed) transcript text, never invented.
3. confidence is 0..1 — report low confidence honestly when evidence is thin.
4. Only propose roomSegments for labels that plausibly represent a shared device/room, not for normal
   individual speakers who simply lack a title.
5. Respond with JSON only: { roster, roomSegments }.`;
}

function userPrompt(input: SpeakerAttributionInput): string {
  const cues = parseTranscriptCues(input.transcript);
  const lines = [
    "Resolve speaker identity for this call.",
    "",
    `Known participants (identity hints — not exhaustive): ${
      input.participants?.length ? input.participants.join(", ") : "none provided"
    }`,
    `Cue count: ${cues.length} (0 means no per-utterance timestamps were parseable — roomSegments will then be empty)`,
    "",
    "=== TIMESTAMPED TRANSCRIPT ===",
    formatTimestampedTranscript(input.transcript, 5500),
    "=== END TRANSCRIPT ===",
  ];
  return lines.join("\n");
}

function clamp01(n: unknown): number {
  const v = typeof n === "number" && Number.isFinite(n) ? n : 0;
  return Math.max(0, Math.min(1, v));
}

function normalizeRole(raw: unknown): SpeakerAttributionRole {
  const s = String(raw || "");
  return (SPEAKER_ATTRIBUTION_ROLE_OPTIONS as readonly string[]).includes(s)
    ? (s as SpeakerAttributionRole)
    : "Customer";
}

function normalizeRoster(raw: unknown): SpeakerRosterEntry[] {
  const arr = Array.isArray(raw) ? raw : [];
  const out: SpeakerRosterEntry[] = [];
  for (const item of arr) {
    if (!item || typeof item !== "object") continue;
    const row = item as Record<string, unknown>;
    const label = String(row.label || "").trim();
    if (!label) continue;
    out.push({
      label,
      canonicalName: String(row.canonicalName || label).trim() || label,
      suggestedRole: normalizeRole(row.suggestedRole),
      confidence: clamp01(row.confidence),
      evidence: String(row.evidence || "").trim(),
    });
    if (out.length >= 30) break;
  }
  return out;
}

function normalizeRoomSegments(raw: unknown): RoomSegmentSuggestion[] {
  const arr = Array.isArray(raw) ? raw : [];
  const out: RoomSegmentSuggestion[] = [];
  for (const item of arr) {
    if (!item || typeof item !== "object") continue;
    const row = item as Record<string, unknown>;
    const label = String(row.label || "").trim();
    const attributedTo = String(row.attributedTo || "").trim();
    if (!label || !attributedTo) continue;
    const startS = typeof row.startS === "number" && Number.isFinite(row.startS) ? row.startS : 0;
    const endSRaw = typeof row.endS === "number" && Number.isFinite(row.endS) ? row.endS : startS;
    const endS = Math.max(startS, endSRaw);
    out.push({
      label,
      startS: Math.max(0, startS),
      endS,
      attributedTo,
      confidence: clamp01(row.confidence),
      quote: String(row.quote || "").trim(),
      reason: String(row.reason || "").trim(),
    });
    if (out.length >= 40) break;
  }
  return out.sort((a, b) => a.startS - b.startS);
}

/** Empty, never-fails result — used when the pass is skipped or fails (soft-fail caller). */
export function emptySpeakerAttribution(): SpeakerAttributionResult {
  return { roster: [], roomSegments: [] };
}

export async function runPostCallSpeakerAttribution(
  env: Env,
  input: SpeakerAttributionInput,
): Promise<SpeakerAttributionResult> {
  const transcript = input.transcript?.trim();
  if (!transcript) return emptySpeakerAttribution();

  const provider = getPostCallProvider(env);
  const result = await provider.generate({
    maxTokens: 3000,
    system: systemPrompt(),
    user: userPrompt(input),
    effort: env.POSTCALL_EFFORT || env.EFFORT || "low",
    research: false,
    thinkingBudget: 0,
    temperature: 0,
    jsonSchema: SPEAKER_ATTRIBUTION_SCHEMA as unknown as Record<string, unknown>,
    passName: "speaker-attribution",
    userId: input.userId,
    callId: input.callId,
  });

  const parsed = extractJson<{ roster?: unknown; roomSegments?: unknown }>(result.text);
  return {
    roster: normalizeRoster(parsed.roster),
    roomSegments: normalizeRoomSegments(parsed.roomSegments),
  };
}

// --- Effective-transcript rewrite (used for scorecard scoring only, see ./generate.ts) ---

export interface ConfirmedRoomAttributionSpan {
  startS: number;
  endS: number;
  person: string;
  role?: string;
}

export interface ConfirmedRoomAttribution {
  roomLabel: string;
  spans: ConfirmedRoomAttributionSpan[];
}

function findAttributedPerson(
  attributions: ConfirmedRoomAttribution[],
  speakerLabel: string,
  startS: number,
): string | null {
  const speakerKey = speakerLabel.trim().toLowerCase();
  for (const attribution of attributions) {
    if (attribution.roomLabel.trim().toLowerCase() !== speakerKey) continue;
    for (const span of attribution.spans || []) {
      if (startS >= span.startS && startS <= span.endS && span.person?.trim()) {
        return span.person.trim();
      }
    }
  }
  return null;
}

/**
 * Rewrite a raw transcript into an "effective" transcript for scorecard scoring: any cue
 * whose speaker is a confirmed meeting-room label AND whose start time falls inside a
 * confirmed attribution span gets its speaker rewritten to "Person (via meeting room)".
 * Everything else (unattributed room speech, normal speakers) is left untouched.
 *
 * Only meaningful for transcripts with parseable per-cue timestamps (VTT/Kaia/bracketed
 * plain). When there are no cues, or no confirmed attributions, the raw transcript is
 * returned unchanged — this function must never throw.
 */
export function buildEffectiveTranscriptForScoring(
  rawTranscript: string,
  roomAttributions: ConfirmedRoomAttribution[] | null | undefined,
): string {
  const transcript = rawTranscript || "";
  if (!transcript.trim() || !roomAttributions?.length) return transcript;

  const cues = parseTranscriptCues(transcript);
  if (!cues.length) return transcript;

  const formatClock = (seconds: number): string => {
    const s = Math.max(0, Math.floor(seconds));
    const h = Math.floor(s / 3600);
    const m = Math.floor((s % 3600) / 60);
    const sec = s % 60;
    if (h > 0) {
      return `${h}:${String(m).padStart(2, "0")}:${String(sec).padStart(2, "0")}`;
    }
    return `${String(m).padStart(2, "0")}:${String(sec).padStart(2, "0")}`;
  };

  let rewroteAny = false;
  const lines = cues.map((cue) => {
    const ts = formatClock(cue.startS);
    if (!cue.speaker) return `[${ts}] ${cue.text}`;
    const attributedPerson = findAttributedPerson(roomAttributions, cue.speaker, cue.startS);
    if (attributedPerson) {
      rewroteAny = true;
      return `[${ts}] ${attributedPerson} (via meeting room): ${cue.text}`;
    }
    return `[${ts}] ${cue.speaker}: ${cue.text}`;
  });

  // If nothing actually matched a room attribution, prefer returning the raw transcript
  // untouched rather than a reformatted-but-unchanged copy (keeps cache fingerprints stable).
  if (!rewroteAny) return transcript;
  return lines.join("\n");
}
