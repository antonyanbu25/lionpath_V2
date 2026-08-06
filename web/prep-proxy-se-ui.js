/**
 * "Run for SE" selector — shared by pre-call and post-call forms (managers only).
 */

import { isManagerSession, listTeamSeOptions, getStoredProxySe, setStoredProxySe } from "./domain/acting-owner.js";
import { readFieldValue } from "./crayons-ui.js";

/** @type {(() => void) | null} */
let onChangeRef = null;

function $(id) {
  return document.getElementById(id);
}

/** @param {object|null|undefined} session */
export function readProxySeUserId(session) {
  const prep = readFieldValue($("prep-proxy-se"));
  const post = readFieldValue($("postcall-proxy-se"));
  const raw = String(prep || post || getStoredProxySe(session)?.id || "").trim();
  return raw || null;
}

/** @param {object|null|undefined} session */
export function readProxySeFromForms(session) {
  const id = readProxySeUserId(session);
  const stored = getStoredProxySe(session);
  if (id && stored?.id === id) return stored;
  return id ? { id, email: stored?.email || "", name: stored?.name || "" } : null;
}

/**
 * @param {object|null|undefined} session
 * @param {{ onChange?: () => void }} [opts]
 */
export async function wireProxySeSelectors(session, opts = {}) {
  onChangeRef = opts.onChange || null;
  const isMgr = isManagerSession(session);
  const prepWrap = $("prep-proxy-se-wrap");
  const postWrap = $("postcall-proxy-se-wrap");
  if (prepWrap) prepWrap.hidden = !isMgr;
  if (postWrap) postWrap.hidden = !isMgr;
  if (!isMgr) return;

  const options = await listTeamSeOptions(session);
  const stored = getStoredProxySe(session);
  const optionHtml = options
    .map(
      (o) =>
        `<fw-select-option value="${escapeAttr(o.id)}">${escapeHtml(o.name)} (${escapeHtml(o.email)})</fw-select-option>`,
    )
    .join("");

  for (const id of ["prep-proxy-se", "postcall-proxy-se"]) {
    const el = $(id);
    if (!el) continue;
    el.innerHTML = `<fw-select-option value="">Select SE…</fw-select-option>${optionHtml}`;
    if (stored?.id) {
      el.value = stored.id;
    }
    const sync = () => {
      const selectedId = String(readFieldValue(el) || "").trim();
      const match = options.find((o) => o.id === selectedId) || null;
      setStoredProxySe(session, match);
      const otherId = id === "prep-proxy-se" ? "postcall-proxy-se" : "prep-proxy-se";
      const other = $(otherId);
      if (other && selectedId) other.value = selectedId;
      onChangeRef?.();
    };
    el.addEventListener("fwChange", sync);
    el.addEventListener("change", sync);
  }
}

/** @param {object|null|undefined} session @param {{ onChange?: () => void }} [opts] */
export async function refreshProxySeSelectors(session, opts = {}) {
  await wireProxySeSelectors(session, opts);
}

function escapeHtml(s) {
  return String(s || "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function escapeAttr(s) {
  return escapeHtml(s).replace(/'/g, "&#39;");
}
