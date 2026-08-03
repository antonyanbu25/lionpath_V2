/**
 * Human labels for post-call call types. Shared so call titles and call-view pills stay consistent.
 */

import { formatProductLabel } from "./domain/account-arr-service.js";
import { titleCaseDisplayName } from "./shared.js";
import { CALL_TYPES } from "./rubric-profiles.js";

export const CALL_TYPE_LABELS = {
  demo: "Demo",
  discovery: "Discovery",
  technical_deep_dive: "Technical deep dive",
  reverse_demo: "Reverse demo",
  use_case_discussion: "Use case discussion",
  trial_setup: "Trial setup",
  troubleshooting: "Troubleshooting",
  qa_session: "Q&A session",
  internal_meeting: "Internal meeting",
  poc: "POC",
  negotiation: "Negotiation",
  follow_up: "Follow-up",
};

/** @type {Map<string, string>} display label (lower) → profile key */
const LABEL_TO_CANONICAL = new Map(
  Object.entries(CALL_TYPE_LABELS).map(([key, label]) => [String(label).trim().toLowerCase(), key]),
);

/**
 * Normalize legacy / display call types to a QIP profile key (e.g. "Demo" → "demo").
 * @param {string} [raw]
 * @param {string} [fallback]
 */
export function canonicalCallType(raw, fallback = "demo") {
  const t = String(raw || "").trim();
  if (!t) return fallback;
  if (CALL_TYPES.includes(t)) return t;
  const lower = t.toLowerCase();
  if (CALL_TYPES.includes(lower)) return lower;
  const fromLabel = LABEL_TO_CANONICAL.get(lower);
  if (fromLabel && CALL_TYPES.includes(fromLabel)) return fromLabel;
  const snake = lower
    .replace(/&/g, "and")
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_|_$/g, "");
  if (CALL_TYPES.includes(snake)) return snake;
  if (CALL_TYPE_LABELS[t] && CALL_TYPES.includes(t)) return t;
  return fallback;
}

const LEGACY_CALL_WITH_RE = /^(.+?) with (.+)$/i;

/**
 * Label for a call type. Falls back to a de-underscored, capitalized version of an
 * unknown type, or "Call" when empty.
 * @param {string} [callType]
 */
export function callTypeLabel(callType) {
  const canonical = canonicalCallType(callType, "");
  const t = canonical || String(callType || "").trim();
  if (!t) return "Call";
  if (CALL_TYPE_LABELS[t]) return CALL_TYPE_LABELS[t];
  const spaced = t.replace(/_/g, " ");
  return spaced.charAt(0).toUpperCase() + spaced.slice(1);
}

/** @param {string} [text] @param {number} [maxLen] */
function compactShortForm(text, maxLen = 72) {
  const s = String(text || "")
    .trim()
    .replace(/\s+/g, " ");
  if (!s) return null;
  if (s.length <= maxLen) return s;
  return `${s.slice(0, maxLen - 1).trimEnd()}…`;
}

/** @param {string} [area] @param {string} [subArea] */
export function formatProductAreaLabel(area, subArea) {
  const a = String(area || "other")
    .replace(/_/g, " ")
    .replace(/\b\w/g, (c) => c.toUpperCase());
  if (!subArea || subArea === "other") return a;
  const sub = String(subArea).replace(/_/g, " ");
  return `${a} › ${sub}`;
}

/**
 * Product discussed — from ARR compute, technical commit, or pass-6 product signal.
 * @param {{ arrCompute?: object, pass6?: object, analysis?: object }} [ctx]
 */
export function productDiscussedFromContext(ctx = {}) {
  const { arrCompute, pass6, analysis } = ctx;
  if (arrCompute?.productLabel) return String(arrCompute.productLabel).trim();
  if (arrCompute?.product) return formatProductLabel(arrCompute.product);
  const aiProduct = analysis?.technicalCommit?.aiAttach?.product;
  if (typeof aiProduct === "string" && aiProduct.trim()) return aiProduct.trim();
  const gap = pass6?.productGaps?.[0];
  if (gap?.productArea) return formatProductAreaLabel(gap.productArea, gap.subArea);
  const win = pass6?.whatWorks?.[0];
  if (win?.productArea) return formatProductAreaLabel(win.productArea, win.subArea);
  return null;
}

/** @param {object} [analysis] */
export function aiShortFormFromAnalysis(analysis) {
  const cs = analysis?.callSummary;
  if (cs?.headline?.trim()) return compactShortForm(cs.headline);
  if (cs?.summary?.trim()) return compactShortForm(cs.summary, 60);
  return null;
}

/**
 * Legacy scheme: "<Type> with <Account>" (or empty / generic placeholders).
 * @param {string} [title]
 * @param {string} [accountName]
 */
export function isLegacyCallTitle(title, accountName) {
  const s = String(title || "").trim();
  if (!s) return true;
  if (s === "Call analysis" || s === "Call" || s === "Post-call") return true;
  if (LEGACY_CALL_WITH_RE.test(s)) return true;
  return false;
}

/**
 * Extract company from a canonical call title (first segment before ·).
 * @param {string} [title]
 */
export function companyFromCallTitle(title) {
  const s = String(title || "").trim();
  if (!s) return "";
  const parts = s.split(/\s·\s/);
  return (parts[0] || s).trim();
}

/**
 * Build canonical call title:
 *   `<Company> · <meeting type> - <product discussed> - <AI short-form>`
 * Trailing segments drop gracefully when product or summary are missing.
 *
 * @param {string} [callType]
 * @param {string} [accountName]
 * @param {{ productDiscussed?: string|null, aiShortForm?: string|null }} [extras]
 */
export function callTitleFor(callType, accountName, extras = {}) {
  const company = titleCaseDisplayName(accountName) || String(accountName || "").trim();
  if (!company) return null;

  const meetingType = callTypeLabel(callType);
  let title = `${company} · ${meetingType}`;

  const product = String(extras.productDiscussed || "").trim();
  if (product) title += ` - ${product}`;

  const summary = String(extras.aiShortForm || "").trim();
  if (summary) title += ` - ${summary}`;

  return title;
}

/**
 * Resolve display/storage title from a history or post-call record.
 * Upgrades legacy "<Type> with <Account>" titles on read.
 *
 * @param {object} record
 * @param {{ accountName?: string, callType?: string }} [opts]
 */
export function resolveCallTitleFromRecord(record, opts = {}) {
  const analysis = record?.analysis || record?.result?.analysis || {};
  const accountName =
    opts.accountName ||
    analysis?.callHeader?.company ||
    analysis?.callHeader?.account ||
    analysis?.company ||
    companyFromCallTitle(record?.title) ||
    companyFromCallTitle(analysis?.callHeader?.title) ||
    null;
  const callType =
    opts.callType ||
    record?.callType ||
    record?.analysisMeta?.callType ||
    record?.result?.analysisMeta?.callType ||
    null;

  const stored = String(record?.title || "").trim();
  if (stored && !isLegacyCallTitle(stored, accountName)) {
    const parts = stored.split(/\s·\s/);
    if (parts.length > 1) {
      return `${titleCaseDisplayName(parts[0])}${stored.slice(parts[0].length)}`;
    }
    return titleCaseDisplayName(stored) || stored;
  }

  const built = callTitleFor(callType, accountName, {
    productDiscussed: productDiscussedFromContext({
      arrCompute: record?.arrCompute || record?.result?.arrCompute,
      pass6: record?.pass6 || record?.result?.pass6,
      analysis,
    }),
    aiShortForm: aiShortFormFromAnalysis(analysis),
  });

  return built || stored || "Call";
}
