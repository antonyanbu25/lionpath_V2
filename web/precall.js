/** Pre-call wireframe — state, generate flow, interactions. */

import {
  readFieldValueAsync,
  setButtonLoading,
  setFieldError,
  setFormFieldsDisabled,
  showInlineStatus,
} from "./crayons-ui.js";
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
import { computePrepInputHash, loadCachedResearch } from "./domain/account-service.js";
import { wireDisputeTriggers, registerDisputeContextResolver } from "./prep-disputes.js?v=dispute-static-v11";

const CHECKS_KEY = "lionpath_prep_checks";
const BRIEFS_KEY = "lionpath_briefs";
const MAX_BRIEFS = 12;
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/i;
const DOMAIN_RE = /^[a-z0-9]([a-z0-9-]*\.)+[a-z]{2,}$/i;

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

function normalizeCompanyDomain(raw) {
  return String(raw || "")
    .trim()
    .toLowerCase()
    .replace(/^https?:\/\//, "")
    .replace(/^www\./, "")
    .split("/")[0];
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

/** Active prep brief context for sidebar account panel. */
export function getActivePrepContext() {
  if (!state.activeBriefId) return null;
  const brief = getBriefById(state.activeBriefId);
  if (!brief) return null;
  return {
    lifecycleId: brief.lifecycleId || null,
    company: brief.company || brief.meta?.company || null,
    domain: brief.meta?.domain || brief.meta?.companyDomain || null,
  };
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
  pendingResearch: null,
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

function resolveDisputeContextFromButton(btn) {
  const section = btn.dataset.disputeSection || "general";
  const idxRaw = btn.dataset.disputeIdx ?? btn.dataset.factIdx;
  const idx = idxRaw != null && idxRaw !== "" ? Number(idxRaw) : NaN;
  const factKey = btn.dataset.disputeKey || "";
  const ctx = buildDisputeContext({
    step: btn.dataset.disputeStep || "brief_result",
    section,
  });

  if (section === "facts" && Number.isFinite(idx)) {
    const fact = state.pendingResearch?.research?.facts?.[idx] || state.currentPrep?.facts?.[idx];
    ctx.factIndices = [idx];
    ctx.factKeys = [fact?.key || factKey].filter(Boolean);
  } else if (section === "signals" && Number.isFinite(idx)) {
    const signal = state.currentPrep?.signals?.[idx];
    ctx.factKeys = [signal?.label || factKey].filter(Boolean);
    ctx.factIndices = [];
  } else if (section === "prospect" && Number.isFinite(idx)) {
    const prospect = state.currentPrep?.prospects?.[idx];
    ctx.factKeys = [prospect?.name || factKey].filter(Boolean);
    ctx.factIndices = [];
  } else if (factKey) {
    ctx.factKeys = [factKey];
  }

  return ctx;
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

  wireDisputeTriggers(root);
}

function pushBriefRecord(record) {
  const list = loadLocalBriefs().filter((b) => b.id !== record.id);
  list.unshift(record);
  saveLocalBriefs(list);
}

export function saveBriefToSidebar(input, prep, meta, lifecycleId) {
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
    lifecycleId: lifecycleId || null,
  });
  state.activeBriefId = id;
}

async function buildPayload() {
  const prospectField = $("prospectEmail");
  const domainField = $("companyDomain");
  const rawEmails = await readFieldValueAsync($("prospectEmail"));
  const emails = parseProspectEmails(rawEmails);
  if (!emails.length) {
    const message = "Enter at least one valid prospect email (comma-separated for multiple).";
    setFieldError(prospectField, message);
    throw new Error(message);
  }
  setFieldError(prospectField);

  const companyDomain = normalizeCompanyDomain(await readFieldValueAsync($("companyDomain")));
  if (!companyDomain || !DOMAIN_RE.test(companyDomain)) {
    const message = "Enter a valid company domain (e.g. acme.com).";
    setFieldError(domainField, message);
    throw new Error(message);
  }
  setFieldError(domainField);

  const companyName = await readFieldValueAsync($("companyName"));
  if (!String(companyName || "").trim()) {
    throw new Error("Company name is required.");
  }

  const inputHash = computePrepInputHash(companyName, companyDomain, emails);
  let cachedResearch = null;
  try {
    cachedResearch = await loadCachedResearch(companyName, companyDomain, inputHash);
  } catch {
    cachedResearch = null;
  }

  return {
    payload: {
      companyName,
      companyDomain,
      prospectEmail: emails[0],
      prospectEmails: emails,
      additionalContext: (await readFieldValueAsync($("additionalContext"))) || undefined,
      prepType: "new_business",
      cachedResearch: cachedResearch || undefined,
    },
    meta: {
      company: companyName,
      companyDomain,
      domain: companyDomain,
      emailDomain: emailDomain(emails[0]),
      additionalContext: (await readFieldValueAsync($("additionalContext"))) || undefined,
    },
    emails,
  };
}

async function postJson(url, body) {
  const headers = { "content-type": "application/json" };
  if (deps.authEnabled && deps.getToken) {
    headers.Authorization = `Bearer ${await deps.getToken()}`;
  }
  const res = await fetch(url, { method: "POST", headers, body: JSON.stringify(body) });
  const raw = await res.text();
  let data;
  try {
    data = JSON.parse(raw);
  } catch {
    throw new Error(raw.slice(0, 300) || `Request failed (${res.status}).`);
  }
  if (!res.ok) throw new Error(data.error || `Request failed (${res.status}).`);
  return data;
}

function setLoading(on, message) {
  const btn = $("generate");
  const status = $("prep-status");
  state.loading = on;
  setButtonLoading(btn, on);
  setFormFieldsDisabled($("prep-form"), on);
  show($("prep-loading"), on);
  if (on) {
    showInlineStatus(status, { type: "info", message, loading: true });
    show($("prep-result-view"), false);
  }
}

function clearLoading() {
  const btn = $("generate");
  state.loading = false;
  setButtonLoading(btn, false);
  setFormFieldsDisabled($("prep-form"), false);
  show($("prep-loading"), false);
}

function isUnknownValue(v) {
  const s = String(v ?? "").trim().toLowerCase();
  return !s || s === "unknown" || s === "-";
}

function sourceForFact(fact, sources) {
  return (sources || []).find((s) => s.label === fact.sourceLabel);
}

function factIsUnverified(fact, sources, lowConfidenceSet) {
  if (isUnknownValue(fact.value)) return true;
  if (lowConfidenceSet.has(fact.key)) return true;
  const src = sourceForFact(fact, sources);
  const conf = fact.confidence ?? src?.confidence ?? 0;
  if (conf < 55) return true;
  const url = String(fact.sourceUrl || src?.url || "").trim().toLowerCase();
  if (!url || url === "unknown") return true;
  return false;
}

function factCheckedByDefault(fact, sources, lowConfidenceSet) {
  return !factIsUnverified(fact, sources, lowConfidenceSet);
}

function buildDisputeContext(overrides = {}) {
  const pending = state.pendingResearch;
  const meta = pending?.meta || state.currentMeta || {};
  const payload = pending?.payload || {};
  const facts = pending?.research?.facts || state.currentPrep?.facts || [];
  const emails = payload.prospectEmails || (payload.prospectEmail ? [payload.prospectEmail] : []);
  const inputHash = payload.companyName
    ? computePrepInputHash(payload.companyName, payload.companyDomain || meta.companyDomain, emails)
    : null;

  return {
    companyName: meta.company || payload.companyName || "",
    companyDomain: meta.companyDomain || meta.domain || payload.companyDomain || "",
    researchInputHash: inputHash,
    facts,
    briefId: state.activeBriefId,
    ...overrides,
  };
}

function renderFactRow(fact, idx, sources, lowConfidenceSet) {
  const src = sourceForFact(fact, sources);
  const conf = fact.confidence ?? src?.confidence ?? 50;
  const unverified = factIsUnverified(fact, sources, lowConfidenceSet);
  const checked = factCheckedByDefault(fact, sources, lowConfidenceSet);
  const valueHtml = unverified
    ? `<span class="prep-unverified">${esc(fact.value)} <span class="prep-unverified-tag">Unverified</span></span>`
    : esc(fact.value);

  return `<div class="prep-facts-row${unverified ? " prep-kv-unverified" : ""}" data-fact-idx="${idx}">
    <fw-checkbox class="prep-facts-check" data-fact-idx="${idx}" ${checked ? "checked" : ""}></fw-checkbox>
    <span class="prep-facts-key">${esc(fact.key)}</span>
    <span class="prep-facts-val">${valueHtml}</span>
    <span class="prep-facts-src muted">${esc(fact.sourceLabel || src?.label || "—")} · ${conf}%</span>
    <button type="button" class="prep-dispute-trigger prep-dispute-btn-inline prep-facts-report" data-fact-idx="${idx}" data-dispute-step="facts_review" data-dispute-section="facts">Report</button>
  </div>`;
}

function showFactsReviewModal(researchData, payload) {
  const modal = $("prep-facts-modal");
  const intro = $("prep-facts-intro");
  const list = $("prep-facts-list");
  const empty = $("prep-facts-empty");
  const errEl = $("prep-facts-error");
  if (!modal || !list) return;

  if (errEl) {
    errEl.textContent = "";
    errEl.hidden = true;
  }

  const facts = researchData.facts || [];
  const sources = researchData.sources || [];
  const lowSet = new Set(researchData.lowConfidence || []);

  if (intro) {
    intro.textContent = `Review facts found for ${payload.companyName} (${payload.companyDomain}). Uncheck anything you don't trust.`;
  }

  const hasFacts = facts.length > 0;
  show(empty, !hasFacts);
  list.innerHTML = hasFacts
    ? facts.map((f, i) => renderFactRow(f, i, sources, lowSet)).join("")
    : "";

  wireDisputeTriggers(list);

  modal.hideFooterButton = !hasFacts;
  modal.isOpen = true;
}

function closeFactsModal() {
  const modal = $("prep-facts-modal");
  if (modal) modal.isOpen = false;
  state.pendingResearch = null;
}

function collectConfirmedFacts() {
  const pending = state.pendingResearch;
  if (!pending?.research?.facts?.length) return [];

  const list = $("prep-facts-list");
  if (!list) return [];

  const checked = new Set();
  list.querySelectorAll("fw-checkbox.prep-facts-check").forEach((cb) => {
    const idx = Number(cb.dataset.factIdx);
    if (cb.checked) checked.add(idx);
  });

  return pending.research.facts.filter((_, i) => checked.has(i));
}

async function executeResearch(payload, meta) {
  const status = $("prep-status");
  const cacheHit = payload.cachedResearch || meta.researchMeta?.cacheHit;
  setLoading(true, cacheHit ? "Loading cached research…" : "Researching account and prospects…");

  try {
    const data = await postJson(deps.researchUrl, payload);
    state.pendingResearch = { payload, meta, research: data };
    showInlineStatus(status, { open: false });
    clearLoading();
    showFactsReviewModal(data, payload);
  } catch (err) {
    const msg = err.message || "Something went wrong.";
    showInlineStatus(status, {
      type: "error",
      message: msg === "Failed to fetch" || /network|fetch/i.test(msg) ? deps.workerDownMsg : msg,
    });
    clearLoading();
  }
}

async function executeSynthesize(confirmedFacts) {
  const pending = state.pendingResearch;
  if (!pending) return;

  const { payload, meta, research } = pending;
  const status = $("prep-status");
  const factsModal = $("prep-facts-modal");
  if (factsModal) factsModal.isOpen = false;

  setLoading(true, "Generating brief from confirmed facts…");

  try {
    const data = await postJson(deps.synthesizeUrl, {
      ...payload,
      confirmedFacts,
      researchBundle: research.researchBundle,
    });

    const enrichedMeta = {
      ...meta,
      researchMeta: data.researchMeta,
      researchBundle: data.researchBundle,
    };

    displayPrepResult(data.prep, enrichedMeta);
    showInlineStatus(status, { open: false });
    const lifecycleId = await deps.onGenerated?.(payload, data.prep, enrichedMeta);
    saveBriefToSidebar(payload, data.prep, enrichedMeta, lifecycleId);
    state.pendingResearch = null;
  } catch (err) {
    const msg = err.message || "Something went wrong.";
    showInlineStatus(status, {
      type: "error",
      message: msg === "Failed to fetch" || /network|fetch/i.test(msg) ? deps.workerDownMsg : msg,
    });
  } finally {
    clearLoading();
  }
}


function showConfirmModal(companyName, companyDomain) {
  return new Promise((resolve) => {
    const modal = $("prep-confirm-modal");
    const text = $("prep-confirm-text");
    if (!modal) {
      resolve(true);
      return;
    }
    if (text) {
      text.textContent = `Research ${companyName} (${companyDomain})?`;
    }

    let settled = false;
    const finish = (confirmed) => {
      if (settled) return;
      settled = true;
      cleanup();
      modal.isOpen = false;
      resolve(confirmed);
    };

    const onSubmit = () => finish(true);
    const onClose = () => finish(false);

    const cleanup = () => {
      modal.removeEventListener("fwSubmit", onSubmit);
      modal.removeEventListener("fwClose", onClose);
    };

    modal.isOpen = true;
    modal.addEventListener("fwSubmit", onSubmit);
    modal.addEventListener("fwClose", onClose);
  });
}

function onFactsModalSubmit(ev) {
  const facts = collectConfirmedFacts();
  const errEl = $("prep-facts-error");
  if (!facts.length) {
    if (errEl) {
      errEl.textContent = "Select at least one fact to include in the brief.";
      errEl.hidden = false;
    }
    ev?.preventDefault?.();
    ev?.stopPropagation?.();
    return;
  }
  if (errEl) errEl.hidden = true;
  void executeSynthesize(facts);
}

function onFactsModalClose() {
  closeFactsModal();
}

export async function generatePrep(e) {
  e?.preventDefault?.();
  if (state.loading) return;

  const status = $("prep-status");
  try {
    const { payload, meta } = await buildPayload();
    const confirmed = await showConfirmModal(payload.companyName, payload.companyDomain);
    if (!confirmed) return;
    await executeResearch(payload, meta);
  } catch (err) {
    showInlineStatus(status, { type: "error", message: err.message || "Validation failed." });
  }
}

function emailDomain(email) {
  const at = String(email || "").lastIndexOf("@");
  return at >= 0 ? email.slice(at + 1).trim().toLowerCase() : "";
}

export function initPrecall(options) {
  deps = options;
  loadChecks();
  registerDisputeContextResolver(resolveDisputeContextFromButton);

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

  const factsModal = $("prep-facts-modal");
  factsModal?.addEventListener("fwSubmit", onFactsModalSubmit);
  factsModal?.addEventListener("fwClose", onFactsModalClose);
}

export function resetPrecallOnView() {
  if (state.view === "form") return;
}

export { isV8Prep, isV7Prep, isV6Prep, companyMono };
