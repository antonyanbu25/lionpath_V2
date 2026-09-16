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

/**
 * UAT-002 — Generate is correctly disabled while isPrepFormReady() is false, but that
 * gate alone tells the user nothing about WHAT to add. This never changes the gate
 * itself (still isPrepFormReady, still checked the same way) — it only explains a
 * disabled state in terms of the exact same checks, so the two can never drift apart.
 * @param {string[]} emails
 * @param {string[]} missingLinkedInEmails from emailsMissingLinkedInPdf()
 * @param {string|undefined} additionalContext
 * @param {Array<{ fileName?: unknown, text?: unknown }>|null|undefined} attachments
 * @param {{ isManager?: boolean, proxySeUserId?: string|null }} [opts]
 * @returns {string} empty string once every required field is present
 */
export function prepFormReadyHintMessage(emails, missingLinkedInEmails, additionalContext, attachments, opts = {}) {
  const missing = [];
  const emailList = Array.isArray(emails) ? emails : [];
  if (!emailList.length) {
    missing.push("a prospect email");
  } else if (Array.isArray(missingLinkedInEmails) && missingLinkedInEmails.length) {
    missing.push(
      missingLinkedInEmails.length === 1
        ? "a LinkedIn PDF for the attendee"
        : `LinkedIn PDFs for ${missingLinkedInEmails.length} attendees`,
    );
  }
  if (!isPrepContextReady(additionalContext, attachments)) {
    missing.push("context from the AE (notes or a file)");
  }
  if (opts.isManager && !String(opts.proxySeUserId || "").trim()) {
    missing.push("which SE you're running this for");
  }
  if (!missing.length) return "";
  const list = new Intl.ListFormat("en", { style: "long", type: "conjunction" }).format(missing);
  return `Add ${list} to enable Generate brief.`;
}
