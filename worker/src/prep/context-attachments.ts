/**
 * SE-attached context files (PDF / DOCX / XLSX / TXT …).
 *
 * Text extraction happens in the browser (web/prep-context-files.js) — the worker
 * only ever sees `{ fileName, text }`. This module is the single definition of how
 * that text folds into the SE's typed Additional context, so the research prompt,
 * the synthesis prompt and the research cache key all agree on one string.
 *
 * MUST stay in sync with web/prep-context-attachments.js — both run against
 * worker/testdata/context-attachments/cases.json.
 */

export interface ContextAttachment {
  fileName: string;
  text: string;
  /** Set when extraction hit the per-file cap. Advisory only — not sent upstream. */
  truncated?: boolean;
}

export const MAX_CONTEXT_ATTACHMENTS = 5;
/** Per file. A 40-page deck of notes is useful; a 200-page manual is prompt bloat. */
export const MAX_CONTEXT_ATTACHMENT_CHARS = 20_000;
/** Across all files, so five big spreadsheets cannot crowd out the research facts. */
export const MAX_CONTEXT_ATTACHMENTS_TOTAL_CHARS = 40_000;
/** Below this, extraction almost certainly failed (scanned PDF, empty sheet). */
export const MIN_CONTEXT_ATTACHMENT_CHARS = 20;

const CONTROL_CHARS = /[\x00-\x08\x0b\x0c\x0e-\x1f]/g;

/** `=== Attached file: x.pdf ===` — a header the model can attribute text to. */
export function contextAttachmentHeader(fileName: string): string {
  return `=== Attached file: ${fileName} ===`;
}

/**
 * Trim, cap and drop unusable entries. Order is preserved (the SE's attach order)
 * and duplicate file names are dropped so a double-attach cannot double-count.
 */
export function normalizeContextAttachments(
  raw: Array<{ fileName?: unknown; text?: unknown; truncated?: unknown }> | undefined | null,
): ContextAttachment[] {
  if (!Array.isArray(raw) || !raw.length) return [];
  const out: ContextAttachment[] = [];
  const seen = new Set<string>();
  let budget = MAX_CONTEXT_ATTACHMENTS_TOTAL_CHARS;

  for (const item of raw) {
    if (out.length >= MAX_CONTEXT_ATTACHMENTS) break;
    if (budget <= 0) break;

    const fileName = String(item?.fileName || "attachment").trim().slice(0, 200) || "attachment";
    const key = fileName.toLowerCase();
    if (seen.has(key)) continue;

    let text = String(item?.text || "").replace(CONTROL_CHARS, " ").trim();
    if (text.length < MIN_CONTEXT_ATTACHMENT_CHARS) continue;

    const cap = Math.min(MAX_CONTEXT_ATTACHMENT_CHARS, budget);
    // Carry an incoming flag forward: text already cut to exactly `cap` is still
    // truncated, so without this a second pass would silently call it complete.
    const truncated = text.length > cap || !!item?.truncated;
    if (text.length > cap) text = text.slice(0, cap).trim();

    seen.add(key);
    budget -= text.length;
    out.push(truncated ? { fileName, text, truncated } : { fileName, text });
  }

  return out;
}

/**
 * The one string the model sees. Typed context leads — it is the SE's own framing —
 * and each file follows in its own labelled block.
 */
export function mergeContextAttachments(
  additionalContext: string | undefined,
  attachments: Array<{ fileName?: unknown; text?: unknown }> | undefined | null,
): string {
  const typed = String(additionalContext || "").trim();
  const files = normalizeContextAttachments(attachments);
  if (!files.length) return typed;

  const blocks = files.map((f) => `${contextAttachmentHeader(f.fileName)}\n${f.text}`);
  return [typed, ...blocks].filter(Boolean).join("\n\n");
}

/** Stable per-file fingerprint for cache keys and change detection. */
export function contextAttachmentsFingerprint(
  attachments: Array<{ fileName?: unknown; text?: unknown }> | undefined | null,
): string {
  const files = normalizeContextAttachments(attachments);
  if (!files.length) return "";
  return files
    .map((f) => `${f.fileName}:${f.text.length}:${f.text.slice(0, 200)}`)
    .sort()
    .join("|");
}
