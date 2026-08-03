export function esc(v) {
  return String(v ?? "").replace(/[&<>"']/g, (c) =>
    ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
}

export const $ = (id) => document.getElementById(id);

export const show = (el, on = true) => { if (el) el.hidden = !on; };

/** Empty field placeholder in UI (plain hyphen). */
export const EMPTY_DISPLAY = "-";

/** @param {string} email */
export function normalizeUserEmail(email) {
  return String(email || "").trim().toLowerCase();
}

/** Lowercase trim for case-insensitive name/domain comparison. */
export function normalizeNameKey(s) {
  return String(s || "").trim().toLowerCase();
}

/** Case-insensitive equality for account/company names (emails stay lowercase-normalized separately). */
export function namesEqual(a, b) {
  const ka = normalizeNameKey(a);
  const kb = normalizeNameKey(b);
  return !!ka && ka === kb;
}

/** Title-case a label for display — does not rewrite stored CRM values. */
export function titleCaseDisplayName(s) {
  const raw = String(s || "").trim();
  if (!raw) return raw;
  return raw.replace(/\w+/g, (word) => word.charAt(0).toUpperCase() + word.slice(1).toLowerCase());
}
