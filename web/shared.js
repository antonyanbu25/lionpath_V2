export function esc(v) {
  return String(v ?? "").replace(/[&<>"']/g, (c) =>
    ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
}

export const $ = (id) => document.getElementById(id);

export const show = (el, on = true) => { if (el) el.hidden = !on; };

/** @param {string} email */
export function normalizeUserEmail(email) {
  return String(email || "").trim().toLowerCase();
}
