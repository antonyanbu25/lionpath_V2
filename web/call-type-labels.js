/**
 * Human labels for post-call call types. Shared so call titles ("Discovery with Acme")
 * and call-view pills stay consistent.
 */

export const CALL_TYPE_LABELS = {
  demo: "Demo",
  discovery: "Discovery",
  technical_deep_dive: "Technical deep dive",
  reverse_demo: "Reverse demo",
  use_case_discussion: "Use case discussion",
  trial_setup: "Trial setup",
  troubleshooting: "Troubleshooting",
  qa_session: "Q&A session",
};

/**
 * Label for a call type. Falls back to a de-underscored, capitalized version of an
 * unknown type, or "Call" when empty.
 * @param {string} [callType]
 */
export function callTypeLabel(callType) {
  const t = String(callType || "").trim();
  if (!t) return "Call";
  if (CALL_TYPE_LABELS[t]) return CALL_TYPE_LABELS[t];
  const spaced = t.replace(/_/g, " ");
  return spaced.charAt(0).toUpperCase() + spaced.slice(1);
}

/**
 * Canonical call title: "<Type> with <Account>".
 * @param {string} [callType]
 * @param {string} [accountName]
 */
export function callTitleFor(callType, accountName) {
  const name = String(accountName || "").trim();
  if (!name) return null;
  return `${callTypeLabel(callType)} with ${name}`;
}
