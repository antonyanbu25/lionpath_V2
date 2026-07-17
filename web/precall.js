/** Pre-call wireframe — state, generate flow, interactions. */

import { readFieldValueAsync, setFormFieldsDisabled } from "./crayons-ui.js";
import {
  isV8Prep,
  isV7Prep,
  isV6Prep,
  renderResultHeader,
  renderDiscoveryTab,
  renderDemoTab,
  renderSourcePopover,
  renderLegacyFallback,
  companyMono,
} from "./precall-render.js";

const CHECKS_KEY = "lionpath_prep_checks";
const BRIEFS_KEY = "lionpath_briefs";
const MAX_BRIEFS = 12;
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/i;

/** Parse comma/semicolon-separated prospect emails; dedupe; max 5. */
export function parseProspectEmails(raw) {
  const parts = String(raw || "")
    .split(/[,;]+/)
    .map((e) => e.trim().toLowerCase())
    .filter(Boolean);
  const seen = new Set();
  const out = [];
  for (const e of parts) {
    if (!EMAIL_RE.test(e)) continue;
    if (seen.has(e)) continue;
    seen.add(e);
    out.push(e);
    if (out.length >= 5) break;
  }
  return out;
}

export function getBriefById(id) {
  return loadLocalBriefs().find((b) => b.id === id) || null;
}

export function openPrepBrief(id) {
  const record = getBriefById(id);
  if (!record?.prep) return false;
  state.activeBriefId = id;
  displayPrepResult(record.prep, record.meta || { company: record.company });
  return true;
}

let deps = {};
let state = {
  view: "form",
  tab: "discovery",
  loading: false,
  srcOpen: false,
  srcPop: null,
  checks: {},
  currentPrep: null,
  currentMeta: null,
  activeBriefId: null,
};

const $ = (id) => document.getElementById(id);
const show = (el, on = true) => {
  if (el) el.hidden = !on;
};

function esc(v) {
  return String(v ?? "").replace(/[&<>"']/g, (c) =>
    ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
}

function accountId(meta) {
  return String(meta?.company || "account")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .slice(0, 48);
}

function loadChecks() {
  try {
    state.checks = JSON.parse(localStorage.getItem(CHECKS_KEY) || "{}");
  } catch {
    state.checks = {};
  }
}

function saveChecks() {
  localStorage.setItem(CHECKS_KEY, JSON.stringify(state.checks));
}

export function loadLocalBriefs() {
  try {
    return JSON.parse(localStorage.getItem(BRIEFS_KEY) || "[]");
  } catch {
    return [];
  }
}

/** Count preps from localStorage; optionally merge Firestore preps for signed-in users. */
export async function countPrepsGenerated(fetchRemotePreps) {
  const local = loadLocalBriefs();
  const seen = new Set(local.map((b) => `${b.company || ""}|${b.when || ""}|${b.id || ""}`));
  let count = local.length;
  if (typeof fetchRemotePreps === "function") {
    try {
      const remote = await fetchRemotePreps();
      for (const r of remote || []) {
        const key = `${r.company || ""}|${r.when || ""}|${r.id || ""}`;
        if (!seen.has(key)) {
          seen.add(key);
          count++;
        }
      }
    } catch {
      // demo / offline — local count only
    }
  }
  return count;
}

function saveLocalBriefs(list) {
  localStorage.setItem(BRIEFS_KEY, JSON.stringify(list.slice(0, MAX_BRIEFS)));
}

function prefersReducedMotion() {
  return window.matchMedia("(prefers-reduced-motion: reduce)").matches;
}

function closePopover() {
  state.srcPop = null;
  const pop = $("prep-source-popover");
  if (pop) {
    pop.hidden = true;
    pop.innerHTML = "";
  }
}

function renderActiveTab() {
  const prep = state.currentPrep;
  const meta = state.currentMeta;
  if (!prep || !isV8Prep(prep)) return;

  const disc = $("prep-tab-discovery");
  const demo = $("prep-tab-demo");
  if (disc) disc.innerHTML = renderDiscoveryTab(prep, state.srcOpen);
  if (demo) demo.innerHTML = renderDemoTab(prep, state.checks, accountId(meta));

  wireTabInteractions();
}

function showFormView() {
  state.view = "form";
  state.tab = "discovery";
  closePopover();
  show($("prep-form-view"), true);
  show($("prep-result-view"), false);
  show($("prep-status"), false);
}

function showResultView(prep, meta) {
  if (!isV8Prep(prep)) {
    const legacy = $("prep-legacy-fallback");
    if (legacy) {
      legacy.innerHTML = isV7Prep(prep) || isV6Prep(prep) ? renderLegacyFallback() : renderLegacyFallback();
      show(legacy, true);
    }
    show($("prep-form-view"), false);
    show($("prep-result-view"), false);
    return;
  }

  show($("prep-legacy-fallback"), false);
  state.currentPrep = prep;
  state.currentMeta = meta;
  state.view = "result";
  closePopover();

  const header = $("prep-result-header");
  if (header) header.innerHTML = renderResultHeader(prep, meta);

  show($("prep-form-view"), false);
  show($("prep-result-view"), true);

  const tabs = $("prep-tabs");
  if (tabs) tabs.activeTabName = state.tab;

  renderActiveTab();
  $("prep-new-search")?.addEventListener("fwClick", showFormView);
  $("prep-new-search")?.addEventListener("click", showFormView);
}

export function displayPrepResult(prep, meta = {}) {
  showResultView(prep, meta);
}

function openSourcePopover(label, ev) {
  const prep = state.currentPrep;
  if (!prep?.sources) return;
  const idx = prep.sources.findIndex((s) => s.label === label);
  const source = idx >= 0 ? prep.sources[idx] : prep.sources[Number(label)] || prep.sources[0];
  if (!source) return;

  const pop = $("prep-source-popover");
  if (!pop) return;

  const margin = 12;
  let x = (ev?.clientX ?? 120) + margin;
  let y = (ev?.clientY ?? 120) + margin;
  x = Math.min(x, window.innerWidth - 292);
  y = Math.min(y, window.innerHeight - 170);

  pop.innerHTML = renderSourcePopover(source, x, y);
  pop.hidden = false;

  pop.querySelector(".prep-popover-backdrop")?.addEventListener("click", closePopover);
  state.srcPop = source;
}

function wireTabInteractions() {
  const root = $("prep-result-view");
  if (!root) return;

  root.querySelectorAll(".prep-src-badge").forEach((btn) => {
    const handler = (ev) => {
      const idx = Number(btn.dataset.srcIdx);
      const src = state.currentPrep?.sources?.[idx];
      openSourcePopover(src?.label || btn.textContent.trim(), ev);
    };
    btn.addEventListener("click", handler);
  });

  root.querySelectorAll("fw-checkbox[data-check-idx]").forEach((cb) => {
    cb.addEventListener("fwChange", () => {
      const idx = Number(cb.dataset.checkIdx);
      const id = accountId(state.currentMeta);
      if (!state.checks[id]) state.checks[id] = {};
      state.checks[id][idx] = cb.checked;
      saveChecks();
      renderActiveTab();
    });
  });

  root.querySelector(".prep-sources-card")?.addEventListener("toggle", (ev) => {
    state.srcOpen = ev.target.open;
  });
}

function pushBriefRecord(record) {
  const list = loadLocalBriefs().filter((b) => b.id !== record.id);
  list.unshift(record);
  saveLocalBriefs(list);
}

export function saveBriefToSidebar(input, prep, meta) {
  if (!isV8Prep(prep)) return;
  const id = `${accountId(meta)}-${Date.now()}`;
  pushBriefRecord({
    id,
    company: meta.company || input.companyName,
    kind: "Discovery",
    when: new Date().toLocaleDateString(),
    prep,
    meta,
    input,
  });
  state.activeBriefId = id;
}

export async function generatePrep(e) {
  e?.preventDefault?.();
  if (state.loading) return;

  const btn = $("generate");
  const status = $("prep-status");
  const rawEmails = await readFieldValueAsync($("prospectEmail"));
  const emails = parseProspectEmails(rawEmails);
  if (!emails.length) {
    if (status) {
      status.className = "status err";
      status.textContent = "Enter at least one valid prospect email (comma-separated for multiple).";
      show(status, true);
    }
    return;
  }

  const payload = {
    companyName: await readFieldValueAsync($("companyName")),
    prospectEmail: emails[0],
    prospectEmails: emails,
    additionalContext: (await readFieldValueAsync($("additionalContext"))) || undefined,
  };
  const meta = {
    company: payload.companyName,
    domain: emailDomain(emails[0]),
    additionalContext: payload.additionalContext,
  };

  state.loading = true;
  if (btn) btn.disabled = true;
  if (btn) btn.loading = true;
  if (status) {
    status.className = "status";
    status.textContent = "Researching account…";
    show(status, true);
  }
  show($("prep-result-view"), false);
  setFormFieldsDisabled($("prep-form"), true);

  try {
    const headers = { "content-type": "application/json" };
    if (deps.authEnabled && deps.getToken) {
      headers.Authorization = `Bearer ${await deps.getToken()}`;
    }
    const res = await fetch(deps.prepUrl, { method: "POST", headers, body: JSON.stringify(payload) });
    const raw = await res.text();
    let data;
    try {
      data = JSON.parse(raw);
    } catch {
      throw new Error(raw.slice(0, 300) || `Request failed (${res.status}).`);
    }
    if (!res.ok) throw new Error(data.error || `Request failed (${res.status}).`);

    displayPrepResult(data.prep, meta);
    show(status, false);
    saveBriefToSidebar(payload, data.prep, meta);
    await deps.onGenerated?.(payload, data.prep, meta);
  } catch (err) {
    if (status) {
      status.className = "status err";
      const msg = err.message || "Something went wrong.";
      status.textContent =
        msg === "Failed to fetch" || /network|fetch/i.test(msg) ? deps.workerDownMsg : msg;
      show(status, true);
    }
  } finally {
    state.loading = false;
    if (btn) btn.disabled = false;
    if (btn) btn.loading = false;
    setFormFieldsDisabled($("prep-form"), false);
  }
}

function emailDomain(email) {
  const at = String(email || "").lastIndexOf("@");
  return at >= 0 ? email.slice(at + 1).trim().toLowerCase() : "";
}

export function initPrecall(options) {
  deps = options;
  loadChecks();

  $("prep-tabs")?.addEventListener("fwChange", (ev) => {
    const tab = ev.detail?.activeTabName || "discovery";
    state.tab = tab === "demo" ? "demo" : "discovery";
    closePopover();
    renderActiveTab();
  });

  $("prep-form")?.addEventListener("submit", (e) => {
    void generatePrep(e);
  });
  $("generate")?.addEventListener("fwClick", (e) => {
    void generatePrep(e);
  });
}

export function resetPrecallOnView() {
  if (state.view === "form") return;
}

export { isV8Prep, isV7Prep, isV6Prep, companyMono };
