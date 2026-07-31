/**
 * Research input hash — must stay in sync with web/prep-input-hash.js
 */

import type { PrepInput } from "./types";
import { mergeContextAttachments } from "./context-attachments";
import { linkedInFingerprint, normalizeLinkedInExports } from "./linkedin-pdf";
import { PLAYBOOK_VERSION } from "./types";

/** Sync fingerprint (not full SHA-256) for stable cross-runtime hashing in browser + worker. */
export function fingerprintString(value: string): string {
  const norm = String(value || "")
    .replace(/\r\n/g, "\n")
    .trim();
  if (!norm) return "";
  let h = 0;
  const tagged = `fp1:${norm}`;
  for (let i = 0; i < tagged.length; i++) h = (Math.imul(31, h) + tagged.charCodeAt(i)) | 0;
  return Math.abs(h).toString(36);
}

/** Stable Kaia cache key fragment without embedding share secrets in research hash payload. */
export function computeKaiaRef(kaiaMeetingUrl: string | undefined): string {
  const raw = String(kaiaMeetingUrl || "").trim().split(/\s/)[0];
  if (!raw) return "";
  try {
    const u = new URL(raw);
    if (u.hostname.toLowerCase() !== "engage.freshworks.com") return "";
    const short = u.pathname.match(/^\/s\/([^/?#]+)/i)?.[1];
    if (short) return `s:${short}`;
    const token = u.pathname.match(/^\/kaia\/share\/([^/?#]+)/i)?.[1];
    if (token) return `share:${fingerprintString(token)}`;
  } catch {
    return "";
  }
  return "";
}

export function computeContextFp(additionalContext: string | undefined): string {
  return fingerprintString(String(additionalContext || ""));
}

export interface InputHashPayload {
  companyDomain: string;
  companyName: string;
  emails: string[];
  playbookVersion: string;
  linkedin: string;
  kaiaRef: string;
  contextFp: string;
}

export function buildInputHashPayload(input: PrepInput, emails: string[]): InputHashPayload {
  const exports = normalizeLinkedInExports(input.linkedinProfileExports);
  return {
    companyDomain: input.companyDomain,
    companyName: String(input.companyName || "").toLowerCase(),
    emails: [...emails].sort(),
    playbookVersion: PLAYBOOK_VERSION,
    linkedin: exports.length ? linkedInFingerprint(exports) : "",
    kaiaRef: computeKaiaRef(input.kaiaMeetingUrl),
    // Hash the *merged* context, not the typed field. Attachments are part of the
    // research input, and folding them in here (rather than adding a new payload key)
    // keeps the hash byte-identical when no files are attached — so shipping
    // attachments does not invalidate every warm research cache entry.
    contextFp: computeContextFp(
      mergeContextAttachments(input.additionalContext, input.contextAttachments),
    ),
  };
}

export function hashInputPayload(payload: InputHashPayload): string {
  let h = 0;
  const s = JSON.stringify(payload);
  for (let i = 0; i < s.length; i++) h = (Math.imul(31, h) + s.charCodeAt(i)) | 0;
  return `h${Math.abs(h).toString(36)}`;
}

export function computeInputHash(input: PrepInput, emails: string[]): string {
  return hashInputPayload(buildInputHashPayload(input, emails));
}
