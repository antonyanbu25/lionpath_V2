/**
 * SE-attached context files — pure merge/normalize rules.
 *
 * MUST stay in sync with worker/src/prep/context-attachments.ts. Both suites run
 * worker/testdata/context-attachments/cases.json, so drift fails a test rather
 * than silently changing the research cache key on one side only.
 *
 * File → text extraction lives in prep-context-files.js (browser-only, needs
 * pdf.js / fflate / SheetJS). This module stays dependency-free so the worker
 * mirror and the tests can share it.
 */

export const MAX_CONTEXT_ATTACHMENTS = 5;
export const MAX_CONTEXT_ATTACHMENT_CHARS = 20_000;
export const MAX_CONTEXT_ATTACHMENTS_TOTAL_CHARS = 40_000;
export const MIN_CONTEXT_ATTACHMENT_CHARS = 20;

const CONTROL_CHARS = /[\x00-\x08\x0b\x0c\x0e-\x1f]/g;

/** @typedef {{ fileName: string, text: string, truncated?: boolean }} ContextAttachment */

/** @param {string} fileName */
export function contextAttachmentHeader(fileName) {
  return `=== Attached file: ${fileName} ===`;
}

/**
 * @param {Array<{ fileName?: unknown, text?: unknown, truncated?: unknown }>|null|undefined} raw
 * @returns {ContextAttachment[]}
 */
export function normalizeContextAttachments(raw) {
  if (!Array.isArray(raw) || !raw.length) return [];
  const out = [];
  const seen = new Set();
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
 * @param {string|undefined} additionalContext
 * @param {Array<{ fileName?: unknown, text?: unknown }>|null|undefined} attachments
 * @returns {string}
 */
export function mergeContextAttachments(additionalContext, attachments) {
  const typed = String(additionalContext || "").trim();
  const files = normalizeContextAttachments(attachments);
  if (!files.length) return typed;

  const blocks = files.map((f) => `${contextAttachmentHeader(f.fileName)}\n${f.text}`);
  return [typed, ...blocks].filter(Boolean).join("\n\n");
}

/**
 * @param {Array<{ fileName?: unknown, text?: unknown }>|null|undefined} attachments
 * @returns {string}
 */
export function contextAttachmentsFingerprint(attachments) {
  const files = normalizeContextAttachments(attachments);
  if (!files.length) return "";
  return files
    .map((f) => `${f.fileName}:${f.text.length}:${f.text.slice(0, 200)}`)
    .sort()
    .join("|");
}
