/**
 * Pre-call form readiness — shared by submit validation and Generate button gate.
 */

import { mergeContextAttachments } from "./prep-context-attachments.js";

/**
 * @param {string|undefined} additionalContext
 * @param {Array<{ fileName?: unknown, text?: unknown }>|null|undefined} attachments
 */
export function isPrepContextReady(additionalContext, attachments) {
  return !!mergeContextAttachments(additionalContext, attachments).trim();
}

/**
 * LinkedIn PDF per email AND non-empty merged AE context.
 * Managers must also pick a proxy SE (see isProxySeReady).
 * @param {string[]} emails
 * @param {string[]} missingLinkedInEmails from emailsMissingLinkedInPdf()
 * @param {string|undefined} additionalContext
 * @param {Array<{ fileName?: unknown, text?: unknown }>|null|undefined} attachments
 * @param {{ isManager?: boolean, proxySeUserId?: string|null }} [opts]
 */
export function isPrepFormReady(emails, missingLinkedInEmails, additionalContext, attachments, opts = {}) {
  if (!Array.isArray(emails) || !emails.length) return false;
  if (Array.isArray(missingLinkedInEmails) && missingLinkedInEmails.length) return false;
  if (!isPrepContextReady(additionalContext, attachments)) return false;
  if (opts.isManager && !String(opts.proxySeUserId || "").trim()) return false;
  return true;
}

/** @param {boolean} isManager @param {string|null|undefined} proxySeUserId */
export function isProxySeReady(isManager, proxySeUserId) {
  if (!isManager) return true;
  return !!String(proxySeUserId || "").trim();
}

/** @returns {string} */
export function proxySeRequiredMessage() {
  return "Select which SE you are running this for.";
}

/** @param {string} message */
export function prepContextRequiredMessage(message = "") {
  return message || "Add context from the AE — type notes or attach a file.";
}
