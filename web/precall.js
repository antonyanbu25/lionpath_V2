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
import { resolveCompanyDomainForSubmit } from "./prep-domain.js";
import {
  linkedinProfileExportsForPayload,
  linkedinProfileExportsForStorage,
  initLinkedInPdfUpload,
  clearLinkedInAttachments,
  linkedinFingerprintForHash,
} from "./prep-linkedin-pdf.js";
import { enrichProspectsParallel, toConfirmedProspectProfiles } from "./prep-contact-enrich.js";

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
  contactEnrichmentsByEmail: null,
  peopleProspectTab: "prospect-0",
  linkedinParsing: false,
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
  if (disc) {
    disc.innerHTML = renderDiscoveryTab(prep, state.srcOpen, {
      linkedinMatchedEmails: meta?.linkedinMatchedEmails || meta?.researchMeta?.linkedinMatchedEmails,
      kaiaFetched: !!(meta?.kaiaFetched || meta?.researchMeta?.kaiaFetched),
      peopleProspectTab: state.peopleProspectTab,
    });
  }
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

  const peopleTabs = root.querySelector("#prep-people-tabs");
  if (peopleTabs) {
    peopleTabs.addEventListener("fwChange", (ev) => {
      if (ev.target?.id !== "prep-people-tabs") return;
      ev.stopPropagation();
      const name = ev.detail?.activeTabName;
      if (name) state.peopleProspectTab = name;
    });
  }

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
  const storedInput = {
    ...input,
    linkedinProfileExports: linkedinProfileExportsForStorage() || input.linkedinProfileExports,
  };
  pushBriefRecord({
    id,
    company: meta.company || input.companyName,
    kind: "Discovery",
    when: new Date().toLocaleDateString(),
    prep,
    meta,
    input: storedInput,
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

  const companyDomain = resolveCompanyDomainForSubmit(
    await readFieldValueAsync($("companyDomain")),
    rawEmails
  );
  if (!companyDomain || !DOMAIN_RE.test(companyDomain)) {
    const message =
      "Enter a valid company domain (e.g. acme.com). We auto-fill from corporate prospect emails — not from Gmail or Outlook.";
    setFieldError(domainField, message);
    throw new Error(message);
  }
  setFieldError(domainField);
  if (normalizeCompanyDomain(await readFieldValueAsync($("companyDomain"))) !== companyDomain) {
    const field = $("companyDomain");
    if (field) {
      field.value = companyDomain;
      field.dispatchEvent?.(new CustomEvent("fwInput", { bubbles: true, detail: { value: companyDomain } }));
    }
  }

  const companyName = await readFieldValueAsync($("companyName"));
  if (!String(companyName || "").trim()) {
    throw new Error("Company name is required.");
  }

  const inputHash = computePrepInputHash(companyName, companyDomain, emails, linkedinFingerprintForHash());
  let cachedResearch = null;
  try {
    cachedResearch = await loadCachedResearch(companyName, companyDomain, inputHash);
  } catch {
    cachedResearch = null;
  }

  const linkedinProfileExports = linkedinProfileExportsForPayload();
  const meetingZoomUrl = (await readFieldValueAsync($("meetingZoomUrl")))?.trim() || undefined;
  const meetingZoomPasscode = (await readFieldValueAsync($("meetingZoomPasscode")))?.trim() || undefined;
  const kaiaMeetingUrl = (await readFieldValueAsync($("kaiaMeetingUrl")))?.trim() || undefined;

  return {
    payload: {
      companyName,
      companyDomain,
      prospectEmail: emails[0],
      prospectEmails: emails,
      additionalContext: (await readFieldValueAsync($("additionalContext"))) || undefined,
      prepType: "new_business",
      cachedResearch: cachedResearch || undefined,
      linkedinProfileExports,
      meetingZoomUrl,
      meetingZoomPasscode,
      kaiaMeetingUrl,
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
  const addPdfBtn = $("prep-linkedin-add-btn");
  if (addPdfBtn) addPdfBtn.disabled = on || state.linkedinParsing;
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

function selectDefaultConfirmedFacts(researchData) {
  const facts = researchData?.facts || [];
  const sources = researchData?.sources || [];
  const lowSet = new Set(researchData?.lowConfidence || []);
  return facts.filter((f) => factCheckedByDefault(f, sources, lowSet));
}

async function runPrepEndToEnd(payload, meta, emails) {
  const status = $("prep-status");
  const pdfs = payload.linkedinProfileExports || [];
  let confirmedProspectProfiles = [];

  let kaiaFetched = false;

  if (payload.kaiaMeetingUrl?.trim() && deps.fetchKaiaUrl) {
    setLoading(true, "Fetching Kaia meeting summary…");
    try {
      const kaia = await postJson(deps.fetchKaiaUrl, { kaiaUrl: payload.kaiaMeetingUrl.trim() });
      if (kaia.summary?.trim()) {
        payload.kaiaSummary = kaia.summary.trim();
        kaiaFetched = true;
        const kaiaField = $("kaiaMeetingUrl");
        if (kaiaField) {
          kaiaField.placeholder = kaia.title
            ? `Fetched · ${kaia.title}`
            : "Fetched · Kaia summary loaded";
        }
      }
    } catch (err) {
      showInlineStatus(status, {
        type: "warn",
        message: `Kaia summary not fetched: ${err.message || "error"}. Continuing without it…`,
      });
    }
  }

  const hasEnrichSources =
    pdfs.length || payload.additionalContext?.trim() || payload.kaiaSummary?.trim();

  if (deps.enrichUrl && hasEnrichSources) {
    setLoading(true, "Enriching prospects…");
    try {
      const enrichResponses = await enrichProspectsParallel(
        {
          enrichUrl: deps.enrichUrl,
          authEnabled: deps.authEnabled,
          getToken: deps.getToken,
        },
        {
          emails,
          pdfs,
          payload,
          onProgress: (n, total) => {
            setLoading(true, `Enriching prospects (${n}/${total})…`);
          },
        },
      );
      confirmedProspectProfiles = toConfirmedProspectProfiles(enrichResponses);
      state.contactEnrichmentsByEmail = Object.fromEntries(
        enrichResponses.map((r) => [r.email.toLowerCase(), r]),
      );
    } catch (err) {
      showInlineStatus(status, {
        type: "warn",
        message: `Prospect enrichment skipped: ${err.message || "error"}. Continuing with research…`,
      });
    }
  }

  const enrichPayload = {
    ...payload,
    confirmedProspectProfiles: confirmedProspectProfiles.length ? confirmedProspectProfiles : undefined,
  };

  const cacheHit = payload.cachedResearch || meta.researchMeta?.cacheHit;
  setLoading(true, cacheHit ? "Loading cached research…" : "Researching account and prospects…");

  let research;
  try {
    research = await postJson(deps.researchUrl, enrichPayload);
  } catch (err) {
    const msg = err.message || "Something went wrong.";
    showInlineStatus(status, {
      type: "error",
      message: msg === "Failed to fetch" || /network|fetch/i.test(msg) ? deps.workerDownMsg : msg,
    });
    clearLoading();
    return;
  }

  const confirmedFacts = selectDefaultConfirmedFacts(research);
  if (!confirmedFacts.length) {
    showInlineStatus(status, {
      type: "error",
      message: "No verified research facts found — check company domain and emails, then try again.",
    });
    clearLoading();
    return;
  }

  state.pendingResearch = { payload, meta, research };
  setLoading(true, "Generating brief from research…");

  try {
    const data = await postJson(deps.synthesizeUrl, {
      ...enrichPayload,
      confirmedFacts,
      researchBundle: research.researchBundle,
    });

    const enrichedMeta = {
      ...meta,
      kaiaFetched,
      researchMeta: data.researchMeta,
      researchBundle: data.researchBundle,
      linkedinMatchedEmails: data.researchMeta?.linkedinMatchedEmails,
      contactEnrichmentsByEmail: state.contactEnrichmentsByEmail,
    };

    displayPrepResult(data.prep, enrichedMeta);
    showInlineStatus(status, { open: false });
    const lifecycleId = await deps.onGenerated?.(payload, data.prep, enrichedMeta);
    saveBriefToSidebar(payload, data.prep, enrichedMeta, lifecycleId);
    state.pendingResearch = null;
    clearLinkedInAttachments();
    const listEl = $("prep-linkedin-file-list");
    if (listEl) listEl.innerHTML = "";
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

export async function generatePrep(e) {
  e?.preventDefault?.();
  if (state.loading || state.linkedinParsing) return;

  const status = $("prep-status");
  try {
    const { payload, meta, emails } = await buildPayload();
    await runPrepEndToEnd(payload, meta, emails);
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
    const outer = $("prep-tabs");
    if (ev.target !== outer && ev.target?.id !== "prep-tabs") return;
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

  initLinkedInPdfUpload({
    setParsing: (on) => {
      state.linkedinParsing = on;
      const btn = $("generate");
      if (btn) btn.disabled = on || state.loading;
      const addBtn = $("prep-linkedin-add-btn");
      if (addBtn) addBtn.disabled = on || state.loading;
    },
  });
}

export function resetPrecallOnView() {
  if (state.view === "form") return;
}

export { isV8Prep, isV7Prep, isV6Prep, companyMono };
