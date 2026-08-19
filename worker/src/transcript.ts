// Deterministic transcript parsing — VTT (Zoom default), Kaia export, and plain text paste.

export interface ParsedTranscript {
  text: string;
  format: "vtt" | "plain" | "kaia";
  speakers: string[];
  wordCount: number;
  durationMinutes: number | null;
}

const SPEAKER_LINE = /^([^\n:]{1,80}):\s*(.+)$/;

/** Bare clock fragment, e.g. "0:12" or "00:12:04" — never a real speaker name. */
const CLOCK_FRAGMENT = /^\d{1,2}(?::\d{2}){1,2}$/;

/**
 * Rejects speaker labels that are actually leading timestamp fragments rather than a
 * real name. Kaia and plain-paste exports sometimes place a clock value (or a bare
 * numeric device index like "00" / "01") where a speaker label should be — without this
 * guard those get captured as bogus "speakers". Used at every speaker-detection site in
 * this file so the behavior is consistent.
 */
export function isValidSpeakerLabel(label: string | null | undefined): boolean {
  const trimmed = (label || "").trim();
  if (!trimmed) return false;
  if (/^\d+$/.test(trimmed)) return false; // purely numeric, e.g. "00", "01"
  if (CLOCK_FRAGMENT.test(trimmed)) return false; // clock fragment, e.g. "00:12:04"
  if (/^\d+:/.test(trimmed)) return false; // starts with digit immediately followed by ":"
  return true;
}

const KAIA_CLOCK = "\\d{1,2}:\\d{2}(?::\\d{2})?";
const KAIA_NAME = "[A-Za-z][A-Za-z0-9 .'\\-]{0,60}[A-Za-z0-9.]";
const KAIA_HEADER_CLOCK_FIRST = new RegExp(`^(${KAIA_CLOCK})\\s+(${KAIA_NAME})$`);
const KAIA_HEADER_NAME_FIRST = new RegExp(`^(${KAIA_NAME})\\s+(${KAIA_CLOCK})$`);

/**
 * Matches a Kaia-export speaker header line — either "HH:MM:SS Speaker Name" or
 * "Speaker Name HH:MM:SS" on a line by itself (the utterance text follows on subsequent
 * lines until the next header). Returns null for anything else, including ordinary
 * "Speaker: text" lines (which are handled by the VTT/plain paths).
 */
function matchKaiaHeader(line: string): { name: string; ts: string } | null {
  const trimmed = line.trim();
  if (!trimmed || trimmed.includes(":") === false) return null;
  if (trimmed.includes("-->")) return null;
  let m = trimmed.match(KAIA_HEADER_CLOCK_FIRST);
  if (m) return { ts: m[1], name: m[2].trim() };
  m = trimmed.match(KAIA_HEADER_NAME_FIRST);
  if (m) return { ts: m[2], name: m[1].trim() };
  return null;
}

/** Heuristic: at least two valid "clock + name" header lines in the opening window. */
function looksLikeKaiaFormat(input: string): boolean {
  if (/^WEBVTT/i.test(input)) return false;
  const lines = input
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter(Boolean)
    .slice(0, 60);
  let headers = 0;
  for (const line of lines) {
    const hit = matchKaiaHeader(line);
    if (hit && isValidSpeakerLabel(hit.name)) headers++;
  }
  return headers >= 2;
}

/** Cue-level parse of a Kaia-format export (shared by parseTranscript/parseTranscriptCues/formatTimestampedTranscript). */
function parseKaiaCues(input: string): TranscriptCue[] {
  const lines = input.split(/\r?\n/);
  const cues: TranscriptCue[] = [];
  let current: { start: number; speaker: string; text: string[] } | null = null;

  const flush = () => {
    if (!current) return;
    const text = current.text.join(" ").trim();
    if (text) cues.push({ startS: current.start, endS: null, speaker: current.speaker, text });
    current = null;
  };

  for (const rawLine of lines) {
    const line = rawLine.trim();
    if (!line) continue;
    const header = matchKaiaHeader(line);
    if (header && isValidSpeakerLabel(header.name)) {
      flush();
      const start = parseVttTimestamp(header.ts) ?? 0;
      current = { start, speaker: header.name, text: [] };
      continue;
    }
    if (current) {
      current.text.push(line);
    }
  }
  flush();
  return cues;
}

function parseKaiaTranscript(input: string): ParsedTranscript {
  const cues = parseKaiaCues(input);
  const speakers = new Set<string>();
  let maxStart = 0;
  const formatted = cues
    .map((cue) => {
      if (cue.speaker) speakers.add(cue.speaker);
      maxStart = Math.max(maxStart, cue.startS);
      return cue.speaker ? `${cue.speaker}: ${cue.text}` : cue.text;
    })
    .join("\n");

  const wordCount = formatted.split(/\s+/).filter(Boolean).length;
  return {
    text: formatted || input,
    format: "kaia",
    speakers: [...speakers],
    wordCount,
    durationMinutes: maxStart > 0 ? Math.round((maxStart / 60) * 10) / 10 : null,
  };
}

function stripVttTags(line: string): string {
  return line
    .replace(/<[^>]+>/g, "")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .trim();
}

function parseVttTimestamp(ts: string): number | null {
  const m = ts.trim().match(/(?:(\d+):)?(\d{2}):(\d{2})(?:\.(\d{1,3}))?/);
  if (!m) return null;
  const hours = Number(m[1] || 0);
  const mins = Number(m[2]);
  const secs = Number(m[3]);
  const ms = Number((m[4] || "0").padEnd(3, "0"));
  return hours * 3600 + mins * 60 + secs + ms / 1000;
}

export function parseTranscript(raw: string): ParsedTranscript {
  const input = (raw || "").trim();
  if (!input) throw new Error("Transcript is empty.");

  if (/^WEBVTT/i.test(input) || /-->\s*\d{2}:\d{2}/.test(input.slice(0, 500))) {
    return parseVtt(input);
  }
  if (looksLikeKaiaFormat(input)) {
    return parseKaiaTranscript(input);
  }
  return parsePlain(input);
}

function parseVtt(input: string): ParsedTranscript {
  const lines = input.split(/\r?\n/);
  const cues: { start: number | null; text: string }[] = [];
  let i = 0;
  let maxEnd = 0;

  while (i < lines.length) {
    const line = lines[i].trim();
    if (!line || line === "WEBVTT" || line.startsWith("NOTE") || /^\d+$/.test(line)) {
      i++;
      continue;
    }

    const arrow = line.includes("-->") ? line : lines[i + 1]?.includes("-->") ? lines[++i] : "";
    if (arrow.includes("-->")) {
      const [startRaw, endRaw] = arrow.split("-->").map((s) => s.trim().split(" ")[0]);
      const start = parseVttTimestamp(startRaw);
      const end = parseVttTimestamp(endRaw);
      if (end != null) maxEnd = Math.max(maxEnd, end);
      i++;
      const textLines: string[] = [];
      while (i < lines.length && lines[i].trim() && !lines[i].includes("-->") && !/^\d+$/.test(lines[i].trim())) {
        textLines.push(stripVttTags(lines[i]));
        i++;
      }
      const text = textLines.join(" ").trim();
      if (text) cues.push({ start, text });
      continue;
    }
    i++;
  }

  const speakers = new Set<string>();
  const formatted = cues
    .map((cue) => {
      const speakerMatch = cue.text.match(/^([^:]+):\s*(.+)$/);
      if (speakerMatch && isValidSpeakerLabel(speakerMatch[1])) {
        const speaker = speakerMatch[1].trim();
        speakers.add(speaker);
        return `${speaker}: ${speakerMatch[2].trim()}`;
      }
      return cue.text;
    })
    .join("\n");

  const wordCount = formatted.split(/\s+/).filter(Boolean).length;
  return {
    text: formatted || input,
    format: "vtt",
    speakers: [...speakers],
    wordCount,
    durationMinutes: maxEnd > 0 ? Math.round((maxEnd / 60) * 10) / 10 : null,
  };
}

function parsePlain(input: string): ParsedTranscript {
  const speakers = new Set<string>();
  const lines = input.split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
  const normalized = lines
    .map((line) => {
      const m = line.match(SPEAKER_LINE);
      if (m && isValidSpeakerLabel(m[1])) {
        speakers.add(m[1].trim());
        return `${m[1].trim()}: ${m[2].trim()}`;
      }
      return line;
    })
    .join("\n");

  const wordCount = normalized.split(/\s+/).filter(Boolean).length;
  return {
    text: normalized,
    format: "plain",
    speakers: [...speakers],
    wordCount,
    durationMinutes: null,
  };
}

/** One timestamped utterance. Speaker is null when the cue carries no `Name:` prefix. */
export interface TranscriptCue {
  startS: number;
  endS: number | null;
  speaker: string | null;
  text: string;
}

/**
 * Cue-level parse with timestamps retained, for timeline derivation.
 *
 * Accepts VTT and the `[mm:ss] Speaker: text` form that `formatTimestampedTranscript`
 * emits. A plain-text paste has no clock, so it yields an empty list — callers must
 * treat "no cues" as "no timeline", never as "timeline at zero".
 */
export function parseTranscriptCues(raw: string): TranscriptCue[] {
  const input = (raw || "").trim();
  if (!input) return [];

  const cues: TranscriptCue[] = [];
  const push = (startS: number, endS: number | null, text: string) => {
    const clean = text.trim();
    if (!clean) return;
    const speakerMatch = clean.match(/^([^:]{1,80}):\s*(.+)$/s);
    const validSpeaker = speakerMatch && isValidSpeakerLabel(speakerMatch[1]);
    cues.push({
      startS,
      endS,
      speaker: validSpeaker ? speakerMatch![1].trim() : null,
      text: validSpeaker ? speakerMatch![2].trim() : clean,
    });
  };

  if (/^WEBVTT/i.test(input) || /-->\s*\d{2}:\d{2}/.test(input.slice(0, 500))) {
    const lines = input.split(/\r?\n/);
    let i = 0;
    while (i < lines.length) {
      const line = lines[i].trim();
      if (!line || line === "WEBVTT" || line.startsWith("NOTE") || /^\d+$/.test(line)) {
        i++;
        continue;
      }
      const arrow = line.includes("-->") ? line : lines[i + 1]?.includes("-->") ? lines[++i] : "";
      if (arrow.includes("-->")) {
        const [startRaw, endRaw] = arrow.split("-->").map((s) => s.trim().split(" ")[0]);
        const start = parseVttTimestamp(startRaw);
        const end = parseVttTimestamp(endRaw);
        i++;
        const textLines: string[] = [];
        while (
          i < lines.length &&
          lines[i].trim() &&
          !lines[i].includes("-->") &&
          !/^\d+$/.test(lines[i].trim())
        ) {
          textLines.push(stripVttTags(lines[i]));
          i++;
        }
        if (start != null) push(start, end, textLines.join(" "));
        continue;
      }
      i++;
    }
    return cues;
  }

  if (looksLikeKaiaFormat(input)) {
    return parseKaiaCues(input);
  }

  for (const line of input.split(/\r?\n/)) {
    const m = line.trim().match(/^\[(\d{1,2}:\d{2}(?::\d{2})?)\]\s*(.+)$/);
    if (!m) continue;
    const start = parseVttTimestamp(m[1].length <= 5 ? `00:${m[1]}` : m[1]);
    if (start != null) push(start, null, m[2]);
  }
  return cues;
}

/** Format VTT/plain transcript with `[mm:ss]` prefixes for scorecard evidence timestamps. */
export function formatTimestampedTranscript(raw: string, maxWords = 6000): string {
  const input = (raw || "").trim();
  if (!input) return "";

  if (/^WEBVTT/i.test(input) || /-->\s*\d{2}:\d{2}/.test(input.slice(0, 500))) {
    const lines = input.split(/\r?\n/);
    const out: string[] = [];
    let i = 0;
    while (i < lines.length) {
      const line = lines[i].trim();
      if (!line || line === "WEBVTT" || line.startsWith("NOTE") || /^\d+$/.test(line)) {
        i++;
        continue;
      }
      const arrow = line.includes("-->") ? line : lines[i + 1]?.includes("-->") ? lines[++i] : "";
      if (arrow.includes("-->")) {
        const [startRaw] = arrow.split("-->").map((s) => s.trim().split(" ")[0]);
        const start = parseVttTimestamp(startRaw);
        i++;
        const textLines: string[] = [];
        while (
          i < lines.length &&
          lines[i].trim() &&
          !lines[i].includes("-->") &&
          !/^\d+$/.test(lines[i].trim())
        ) {
          textLines.push(stripVttTags(lines[i]));
          i++;
        }
        const text = textLines.join(" ").trim();
        if (text) {
          const ts = start != null ? formatClock(start) : "??:??";
          out.push(`[${ts}] ${text}`);
        }
        continue;
      }
      i++;
    }
    return trimTranscript(out.join("\n"), maxWords, "tail");
  }

  if (looksLikeKaiaFormat(input)) {
    const out = parseKaiaCues(input).map((cue) => {
      const ts = formatClock(cue.startS);
      return cue.speaker ? `[${ts}] ${cue.speaker}: ${cue.text}` : `[${ts}] ${cue.text}`;
    });
    return trimTranscript(out.join("\n"), maxWords, "tail");
  }

  return trimTranscript(input, maxWords, "tail");
}

function formatClock(seconds: number): string {
  const s = Math.max(0, Math.floor(seconds));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = s % 60;
  if (h > 0) {
    return `${h}:${String(m).padStart(2, "0")}:${String(sec).padStart(2, "0")}`;
  }
  return `${String(m).padStart(2, "0")}:${String(sec).padStart(2, "0")}`;
}

/** Cap long transcripts for LLM latency. Default keeps the tail (~last 30–40 min of speech). */
export function trimTranscript(
  text: string,
  maxWords = 6000,
  strategy: "tail" | "head_tail" = "tail",
): string {
  const words = text.split(/\s+/).filter(Boolean);
  if (words.length <= maxWords) return text;

  if (strategy === "tail") {
    const approxMinutes = Math.round(maxWords / 150);
    return (
      `[... earlier transcript omitted — analyzing last ~${approxMinutes} minutes ...]\n\n` +
      words.slice(-maxWords).join(" ")
    );
  }

  const head = words.slice(0, Math.floor(maxWords * 0.85)).join(" ");
  const tail = words.slice(-Math.floor(maxWords * 0.15)).join(" ");
  return `${head}\n\n[... middle of transcript truncated for analysis ...]\n\n${tail}`;
}
