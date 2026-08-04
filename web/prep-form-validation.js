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
 * @param {string[]} emails
 * @param {string[]} missingLinkedInEmails from emailsMissingLinkedInPdf()
 * @param {string|undefined} additionalContext
 * @param {Array<{ fileName?: unknown, text?: unknown }>|null|undefined} attachments
 */
export function isPrepFormReady(emails, missingLinkedInEmails, additionalContext, attachments) {
  if (!Array.isArray(emails) || !emails.length) return false;
  if (Array.isArray(missingLinkedInEmails) && missingLinkedInEmails.length) return false;
  return isPrepContextReady(additionalContext, attachments);
}

/** @param {string} message */
export function prepContextRequiredMessage(message = "") {
  return message || "Add context from the AE — type notes or attach a file.";
}
