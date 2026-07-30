// Deterministic transcript parsing — VTT (Zoom default) and plain text paste.

export interface ParsedTranscript {
  text: string;
  format: "vtt" | "plain";
  speakers: string[];
  wordCount: number;
  durationMinutes: number | null;
}

const SPEAKER_LINE = /^([^\n:]{1,80}):\s*(.+)$/;

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
      if (speakerMatch) {
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
      if (m) {
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
    cues.push({
      startS,
      endS,
      speaker: speakerMatch ? speakerMatch[1].trim() : null,
      text: speakerMatch ? speakerMatch[2].trim() : clean,
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
