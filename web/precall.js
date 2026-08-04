/** Pre-call wireframe. state, generate flow, interactions. */

import {
  bindActionOnce,
  readFieldValue,
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
  renderSourcePopover,
  renderLegacyFallback,
  companyMono,
} from "./precall-render.js?v=2.0.8.1-merge";
import { renderKnowTab, renderDemoPrepTab } from "./precall-brief-v9.js?v=2.1.14";
import { wirePrepV9ScrollAnimations } from "./prep-v9-animate.js";
import { computePrepInputHash, loadCachedResearch } from "./domain/account-service.js?v=2.1";
import { wireDisputeTriggers, registerDisputeContextResolver } from "./prep-disputes.js";
import { resolveCompanyDomainForSubmit, companyNameFromPrimaryEmail, companyNameFromDomain, resetPrepDomainState } from "./prep-domain.js";
import {
  linkedinProfileExportsForPayload,
  initPrepAttendeeLinkedIn,
  renderPrepAttendeeRows,
  clearLinkedInAttachments,
  linkedinFingerprintForHash,
  emailsMissingLinkedInPdf,
} from "./prep-linkedin-pdf.js";
import {
  initContextFileUpload,
  clearContextAttachments,
  contextAttachmentsForPayload,
} from "./prep-context-files.js";
import { mergeContextAttachments } from "./prep-context-attachments.js";
import { isPrepFormReady, isPrepContextReady, prepContextRequiredMessage } from "./prep-form-validation.js";
import { enrichProspectsParallel, toConfirmedProspectProfiles, mergeEnrichmentsIntoPrep, applyPdfNameFallbacks, sanitizeIncompleteDiscHints } from "./prep-contact-enrich.js";
import { applySeContextToDiscovery, applySeContextToFacts, applySeContextToPrep } from "./prep-se-context.js";
import { canonicalizePrepSources } from "./prep-source-canon.js";
import { hydrateRecentNews } from "./recent-news.js";
import { getPrepCrmSelection } from "./prep-crm-resolve.js";
import { esc, $, show } from "./shared.js";
import { showPipelineProgress, hidePipelineProgress } from "./pipeline-progress.js";
import {
  showPrepGenOverlay,
  updatePrepGenOverlay,
  hidePrepGenOverlay,
  prepStepsToPct,
  revealPrepResultView,
} from "./prep-generation-overlay.js";
import { initPrepCrmResolve, resetPrepCrmUi } from "./prep-crm-resolve.js";
import { getAccountEngagementContext } from "./domain/account-context.js";

const CHECKS_KEY = "lionpath_prep_checks";
const BRIEFS_KEY = "lionpath_briefs";
const PREP_DEBUG_LOG_KEY = "prep:debugLog";
const PREP_DEBUG_LOG_MAX = 50;
const MAX_BRIEFS = 12;
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/i;
const DOMAIN_RE = /^[a-z0-9]([a-z0-9-]*\.)+[a-z]{2,}$/i;

/** Updated by initPrecall — re-evaluates Generate button disabled state. */
let syncGenerateGateRef = () => {};

function wireAdditionalContextMirror() {
  const field = $("additionalContext");
  if (!field || field.dataset.contextMirrorWired === "1") return;
  field.dataset.contextMirrorWired = "1";
  const mirror = (ev) => {
    const value = String(ev?.detail?.value ?? field.value ?? "").trim();
    field.dataset.liveContext = value;
  };
  field.addEventListener("fwInput", mirror);
  field.addEventListener("fwChange", mirror);
}

async function readAdditionalContextForSubmit() {
  const field = $("additionalContext");
  if (!field) return undefined;
  const live = String(field.dataset.liveContext || "").trim();
  const fromField = String((await readFieldValueAsync(field)) || "").trim();
  const shadowVal = String(field.shadowRoot?.querySelector("textarea")?.value || "").trim();
  const merged = fromField || shadowVal || live;
  return merged || undefined;
}

function readAdditionalContextLive() {
  const field = $("additionalContext");
  if (!field) return "";
  const live = String(field.dataset.liveContext || "").trim();
  const fromField = String(readFieldValue(field) || "").trim();
  const shadowVal = String(field.shadowRoot?.querySelector("textarea")?.value || "").trim();
  return fromField || shadowVal || live;
}

function clearPrepContextError() {
  const errEl = $("prep-context-error");
  if (errEl) errEl.hidden = true;
  setFieldError($("additionalContext"));
}

function showPrepContextError(message) {
  const errEl = $("prep-context-error");
  if (errEl) {
    errEl.textContent = message;
    errEl.hidden = false;
  }
  setFieldError($("additionalContext"), message);
}

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

/** Resolve brief from local cache, optionally Firestore. */
export async function resolveBriefById(id, fetchAllRemotePreps) {
  const local = getBriefById(id);
  if (local?.prep) return local;
  if (typeof fetchAllRemotePreps !== "function") return local;
  try {
    const remote = await fetchAllRemotePreps();
    return (remote || []).find((b) => b.id === id) || local;
  } catch {
    return local;
  }
}

export function openPrepBrief(id, opts = {}) {
  const record = getBriefById(id);
  if (!record?.prep) return false;
  state.activeBriefId = id;
  state.fromBriefList = !!opts.fromList;
  displayPrepResult(record.prep, record.meta || { company: record.company }, opts);
  return true;
}

export async function openPrepBriefAsync(id, fetchAllRemotePreps, opts = {}) {
  const record = await resolveBriefById(id, fetchAllRemotePreps);
  if (!record?.prep) return false;
  state.activeBriefId = id;
  state.fromBriefList = !!opts.fromList;
  displayPrepResult(record.prep, record.meta || { company: record.company }, opts);
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
  fromBriefList: false,
  pendingResearch: null,
  contactEnrichmentsByEmail: null,
  peopleProspectTab: "prospect-0",
  linkedinParsing: false,
  contextParsing: false,
};

export function getPrepViewState() {
  return { view: state.view, fromBriefList: state.fromBriefList, activeBriefId: state.activeBriefId };
}

/** True while any attachment is still being read — submitting now would drop it. */
function isParsingAttachments() {
  return state.linkedinParsing || state.contextParsing;
}

function accountId(meta) {
  return String(meta?.company || "account")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .slice(0, 48);
}

function logPrepDebug(event, data = {}) {
  try {
    const log = JSON.parse(sessionStorage.getItem(PREP_DEBUG_LOG_KEY) || "[]");
    log.push({ event, data, at: Date.now() });
    while (log.length > PREP_DEBUG_LOG_MAX) log.shift();
    sessionStorage.setItem(PREP_DEBUG_LOG_KEY, JSON.stringify(log));
  } catch {
    /* quota / private mode */
  }
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

/** All cached briefs in localStorage (no cap — used for KPI + all-briefs list). */
export function loadAllLocalBriefs() {
  try {
    const raw = localStorage.getItem(BRIEFS_KEY);
    if (!raw) return [];
    const list = JSON.parse(raw);
    return Array.isArray(list) ? list : [];
  } catch {
    return [];
  }
}

export function loadLocalBriefs() {
  return loadAllLocalBriefs().slice(0, MAX_BRIEFS);
}

function isQuotaExceededError(err) {
  if (!err) return false;
  if (err.name === "QuotaExceededError") return true;
  if (err.code === 22) return true;
  return /quota/i.test(String(err.message || err));
}

/** Drop large research payloads before localStorage persist (prep already holds the brief). */
function compactLinkedInProspectProfiles(record) {
  const matched = new Set(
    (record.meta?.linkedinMatchedEmails || record.meta?.researchMeta?.linkedinMatchedEmails || []).map((e) =>
      String(e).toLowerCase(),
    ),
  );
  if (!matched.size) return undefined;
  const emails = record.meta?.prospectEmails || record.input?.prospectEmails || [];
  const profiles = record.prep?.prospects || [];
  const out = [];
  for (let i = 0; i < emails.length; i++) {
    const email = String(emails[i] || "").toLowerCase();
    if (!matched.has(email)) continue;
    const p = profiles[i];
    if (!p) continue;
    out.push({
      email,
      profile: {
        name: p.name,
        role: p.role,
        totalExperience: p.totalExperience,
        priorEmployers: p.priorEmployers,
        summary: p.summary,
        skills: p.skills,
        languages: p.languages,
        education: p.education,
        competitorTouchpoints: p.competitorTouchpoints,
      },
      disc: p.discHint,
    });
  }
  return out.length ? out : undefined;
}

export function compactBriefForStorage(record) {
  if (!record || typeof record !== "object") return record;
  const meta = record.meta || {};
  const researchMeta = meta.researchMeta || {};
  const input = record.input || {};
  return {
    id: record.id,
    company: record.company,
    kind: record.kind,
    when: record.when,
    lifecycleId: record.lifecycleId || null,
    prep: record.prep,
    meta: {
      company: meta.company,
      domain: meta.domain,
      companyDomain: meta.companyDomain,
      emailDomain: meta.emailDomain,
      additionalContext: meta.additionalContext,
      kaiaFetched: !!(meta.kaiaFetched || researchMeta.kaiaFetched),
      linkedinMatchedEmails: meta.linkedinMatchedEmails || researchMeta.linkedinMatchedEmails,
      dealId: meta.dealId,
      accountId: meta.accountId,
      ownerId: meta.ownerId,
      prospectEmails: meta.prospectEmails,
      linkedinProspectProfiles: compactLinkedInProspectProfiles(record),
    },
    input: {
      companyName: input.companyName,
      companyDomain: input.companyDomain,
      prospectEmail: input.prospectEmail,
      prospectEmails: input.prospectEmails,
      prepType: input.prepType,
      dealId: input.dealId,
      lifecycleId: input.lifecycleId,
      additionalContext: input.additionalContext,
      meetingZoomUrl: input.meetingZoomUrl,
      kaiaMeetingUrl: input.kaiaMeetingUrl,
    },
  };
}

/** Count preps from localStorage + optional Firestore (same merge as all-briefs list). */
export async function countPrepsGenerated(fetchAllRemotePreps) {
  const { mergeAllBriefs } = await import("./briefs-list-view.js");
  const local = loadAllLocalBriefs();
  let remote = [];
  if (typeof fetchAllRemotePreps === "function") {
    try {
      remote = await fetchAllRemotePreps();
    } catch {
      // demo / offline — local count only
    }
  }
  return mergeAllBriefs(local, remote).length;
}

function saveLocalBriefs(list) {
  let trimmed = list.slice(0, MAX_BRIEFS).map(compactBriefForStorage);
  while (trimmed.length > 0) {
    try {
      localStorage.setItem(BRIEFS_KEY, JSON.stringify(trimmed));
      return true;
    } catch (err) {
      if (!isQuotaExceededError(err)) {
        console.warn("[precall] could not persist briefs:", err?.message || err);
        return false;
      }
      if (trimmed.length <= 1) {
        console.warn("[precall] localStorage quota exceeded; brief not cached locally");
        return false;
      }
      trimmed = trimmed.slice(0, -1);
      console.warn("[precall] localStorage quota exceeded; evicting oldest brief and retrying");
    }
  }
  return false;
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
    disc.innerHTML = renderKnowTab(prep, state.srcOpen, {
      domain: meta?.domain,
      linkedinMatchedEmails: meta?.linkedinMatchedEmails || meta?.researchMeta?.linkedinMatchedEmails,
      kaiaFetched: !!(meta?.kaiaFetched || meta?.researchMeta?.kaiaFetched),
      additionalContext: meta?.additionalContext || meta?.seAdditionalContext,
      peopleProspectTab: state.peopleProspectTab,
      prospectEmails: meta?.prospectEmails || meta?.researchMeta?.prospectEmails,
    });
  }
  if (demo) demo.innerHTML = renderDemoPrepTab(prep, state.checks, accountId(meta));

  wireTabInteractions();
}

function clearFwInput(id) {
  const field = $(id);
  if (!field) return;
  field.value = "";
  field.dispatchEvent(new CustomEvent("fwInput", { bubbles: true, detail: { value: "" } }));
}

/** Reset pre-call form to empty state (New brief). */
export function resetPrecallForm() {
  if (state.loading) return;
  state.view = "form";
  state.tab = "discovery";
  state.currentPrep = null;
  state.currentMeta = null;
  state.activeBriefId = null;
  state.fromBriefList = false;
  state.pendingResearch = null;
  state.contactEnrichmentsByEmail = null;
  state.peopleProspectTab = "prospect-0";
  closePopover();
  show($("prep-form-view"), true);
  show($("prep-briefs-list-view"), false);
  show($("prep-result-view"), false);
  show($("prep-result-back"), false);
  show($("prep-status"), false);
  show($("prep-loading"), false);
  show($("prep-legacy-fallback"), false);
  hidePipelineProgress("prep-progress");
  clearFwInput("prospectEmail");
  clearFwInput("companyDomain");
  clearFwInput("additionalContext");
  clearFwInput("meetingZoomUrl");
  clearFwInput("meetingZoomPasscode");
  clearFwInput("kaiaMeetingUrl");
  const domainHint = $("domain-hint");
  if (domainHint) domainHint.hidden = true;
  clearLinkedInAttachments();
  renderPrepAttendeeRows([], {});
  clearContextAttachments();
  clearPrepContextError();
  const contextListEl = $("prep-context-file-list");
  if (contextListEl) contextListEl.innerHTML = "";
  const preview = $("prep-account-deal-preview");
  if (preview) preview.hidden = true;
  renderPrepRecentBriefs();
  resetPrepCrmUi();
  resetPrepDomainState();
  syncGenerateGateRef();
  syncPrepEngagementMotion();
}

function dedupeBriefsForRecent(briefs) {
  const seen = new Set();
  const out = [];
  for (const b of briefs || []) {
    const domain = String(b.meta?.domain || b.meta?.companyDomain || "").toLowerCase();
    const key = domain || String(b.company || "").toLowerCase();
    if (!key || seen.has(key)) continue;
    seen.add(key);
    out.push(b);
  }
  return out;
}

/** Recent briefs list below the new-brief form (SE Labs design). */
export function renderPrepRecentBriefs() {
  if (typeof document === "undefined") return;
  const host = $("prep-recent-briefs");
  if (!host) return;
  const briefs = dedupeBriefsForRecent(loadLocalBriefs()).slice(0, 4);
  if (!briefs.length) {
    host.innerHTML = "";
    return;
  }
  const monoTints = [
    { bg: "#f6e7e1", color: "#c2603f" },
    { bg: "#e7eef7", color: "#4a6fa5" },
    { bg: "#eeeaf6", color: "#6b5b95" },
    { bg: "#e9f1e9", color: "#4a7a5c" },
  ];
  host.innerHTML = `<div class="nb-recent-label">Recent briefs</div>
    <ul class="nb-recent-list">${briefs
      .map((b, i) => {
        const name = b.company || b.meta?.company || "Account";
        const tint = monoTints[i % monoTints.length];
        const meta = [b.kind || "Discovery", b.when].filter(Boolean).join(" · ");
        return `<li><button type="button" class="nb-recent-item" data-prep-recent-id="${esc(b.id)}">
          <span class="nb-recent-mono" style="background:${tint.bg};color:${tint.color}">${esc(companyMono(name))}</span>
          <span class="nb-recent-body">
            <span class="nb-recent-account">${esc(name)}</span>
            <span class="nb-recent-meta">${esc(meta)}</span>
          </span>
          <span class="nb-recent-ext" aria-hidden="true"><svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6"/><polyline points="15 3 21 3 21 9"/><line x1="10" x2="21" y1="14" y2="3"/></svg></span>
        </button></li>`;
      })
      .join("")}</ul>`;
  host.querySelectorAll("[data-prep-recent-id]").forEach((btn) => {
    btn.addEventListener("click", () => {
      const id = btn.getAttribute("data-prep-recent-id");
      if (id) openPrepBrief(id);
    });
  });
}

function showFormView() {
  state.view = "form";
  state.tab = "discovery";
  state.fromBriefList = false;
  closePopover();
  show($("prep-form-view"), true);
  show($("prep-briefs-list-view"), false);
  show($("prep-result-view"), false);
  show($("prep-result-back"), false);
  show($("prep-status"), false);
}

/** Show all-briefs list (#precall/briefs). */
export function showPrepBriefsListView() {
  if (state.loading) return;
  state.view = "list";
  state.fromBriefList = false;
  state.activeBriefId = null;
  state.currentPrep = null;
  state.currentMeta = null;
  closePopover();
  show($("prep-form-view"), false);
  show($("prep-briefs-list-view"), true);
  show($("prep-result-view"), false);
  show($("prep-result-back"), false);
  show($("prep-status"), false);
  show($("prep-loading"), false);
  show($("prep-legacy-fallback"), false);
}

function wireBriefResultBack() {
  const back = $("prep-result-back");
  if (!back || back.dataset.wired === "1") return;
  back.dataset.wired = "1";
  const goBack = () => deps.onBackToBriefsList?.();
  back.querySelector('[data-action="back-to-briefs"]')?.addEventListener("click", goBack);
  back.querySelector('[data-action="back-to-briefs"]')?.addEventListener("fwClick", goBack);
}

function showResultView(prep, meta, opts = {}) {
  if (!isV8Prep(prep)) {
    const legacy = $("prep-legacy-fallback");
    if (legacy) {
      legacy.innerHTML = isV7Prep(prep) || isV6Prep(prep) ? renderLegacyFallback() : renderLegacyFallback();
      show(legacy, true);
    }
    show($("prep-form-view"), false);
    show($("prep-briefs-list-view"), false);
    show($("prep-result-view"), false);
    show($("prep-result-back"), false);
    return;
  }

  show($("prep-legacy-fallback"), false);
  state.currentPrep = prep;
  state.currentMeta = meta;
  state.view = "result";
  state.fromBriefList = !!(opts.fromList ?? state.fromBriefList);
  closePopover();

  const header = $("prep-result-header");
  if (header) header.innerHTML = renderResultHeader(prep, meta);

  show($("prep-form-view"), false);
  show($("prep-briefs-list-view"), false);
  const resultView = $("prep-result-view");
  if (resultView) {
    resultView.classList.remove("prep-result-enter", "prep-result-enter-active");
  }
  show(resultView, !opts.deferReveal);
  show($("prep-result-back"), state.fromBriefList && !opts.deferReveal);

  wireBriefResultBack();

  const tabs = $("prep-tabs");
  if (tabs) tabs.activeTabName = state.tab;

  renderActiveTab();
}

export function displayPrepResult(prep, meta = {}, opts = {}) {
  const context = mergeContextAttachments(
    meta.additionalContext || meta.seAdditionalContext,
    meta.contextAttachments || meta.input?.contextAttachments,
  );
  let merged = prep;
  const enrichByEmail = meta.contactEnrichmentsByEmail;
  const storedProfiles = meta.linkedinProspectProfiles;
  const emails =
    meta.prospectEmails ||
    meta.researchMeta?.prospectEmails ||
    meta.input?.prospectEmails ||
    (enrichByEmail ? Object.keys(enrichByEmail) : []) ||
    prep?.prospects?.map((p) => p.email).filter(Boolean) ||
    [];
  if (enrichByEmail && prep?.prospects?.length && emails.length) {
    merged = mergeEnrichmentsIntoPrep(prep, emails, Object.values(enrichByEmail));
  } else if (storedProfiles?.length && prep?.prospects?.length && emails.length) {
    merged = mergeEnrichmentsIntoPrep(prep, emails, storedProfiles);
  }
  merged = applyPdfNameFallbacks(merged, emails, meta.linkedinProfileExports || meta.input?.linkedinProfileExports || []);
  merged = sanitizeIncompleteDiscHints(merged);
  merged = hydrateRecentNews(merged, meta);
  const withContext = applySeContextToDiscovery(
    applySeContextToFacts(applySeContextToPrep(merged, context), context),
    context,
  );
  showResultView(canonicalizePrepSources(withContext).prep, meta, opts);
}

function openSourcePopover(label, ev) {
  const prep = state.currentPrep;
  if (!prep?.sources) return;
  const source = prep.sources.find((s) => s.label === label);
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

  root.querySelector(".prep-research-extras")?.addEventListener("toggle", (ev) => {
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
  wirePrepV9ScrollAnimations(root);
}

function pushBriefRecord(record) {
  const list = loadLocalBriefs().filter((b) => b.id !== record.id);
  list.unshift(compactBriefForStorage(record));
  if (!saveLocalBriefs(list)) {
    console.warn("[precall] brief kept in session only (local cache unavailable)");
  }
}

export function saveBriefToSidebar(input, prep, meta, lifecycleId) {
  if (!isV8Prep(prep)) return;
  const id = `${accountId(meta)}-${Date.now()}`;
  const storedInput = {
    companyName: input.companyName,
    companyDomain: input.companyDomain,
    prospectEmail: input.prospectEmail,
    prospectEmails: input.prospectEmails,
    prepType: input.prepType,
    dealId: input.dealId,
    lifecycleId: input.lifecycleId,
    additionalContext: input.additionalContext,
    meetingZoomUrl: input.meetingZoomUrl,
    kaiaMeetingUrl: input.kaiaMeetingUrl,
    linkedinProfileExports: meta.linkedinProfileExports || input.linkedinProfileExports,
    // Attached-file text is deliberately NOT stored: up to 40k chars per brief would
    // crowd the localStorage quota, and the signals it produced are already baked into
    // `prep` by the server. Re-rendering a saved brief therefore uses the typed note
    // only — the same trade compactBriefForStorage already makes for LinkedIn exports.
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
  renderPrepRecentBriefs();
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
      "Enter a valid company domain (e.g. acme.com). We auto-fill from corporate prospect emails, not from Gmail or Outlook.";
    setFieldError(domainField, message);
    throw new Error(message);
  }
  setFieldError(domainField);

  const missingLinkedIn = emailsMissingLinkedInPdf(emails);
  if (missingLinkedIn.length) {
    const errEl = $("prep-linkedin-error");
    const message =
      missingLinkedIn.length === 1
        ? `Attach a LinkedIn PDF for ${missingLinkedIn[0]}.`
        : `Attach a LinkedIn PDF for each prospect: ${missingLinkedIn.join(", ")}.`;
    if (errEl) {
      errEl.textContent = message;
      errEl.hidden = false;
    }
    document.querySelectorAll(".nb-linkedin-row").forEach((row) => {
      const email = row.getAttribute("data-email")?.toLowerCase();
      row.classList.toggle(
        "nb-linkedin-row-missing",
        !!email && missingLinkedIn.some((e) => e.toLowerCase() === email),
      );
    });
    const firstMissing = document.querySelector(".nb-linkedin-row-missing");
    firstMissing?.scrollIntoView?.({ behavior: "smooth", block: "nearest" });
    throw new Error(message);
  }
  const linkedInErrEl = $("prep-linkedin-error");
  if (linkedInErrEl) linkedInErrEl.hidden = true;
  document.querySelectorAll(".nb-linkedin-row-missing").forEach((row) => {
    row.classList.remove("nb-linkedin-row-missing");
  });

  const additionalContext = await readAdditionalContextForSubmit();
  const contextAttachments = contextAttachmentsForPayload();
  const mergedContext = mergeContextAttachments(additionalContext, contextAttachments);
  if (!isPrepContextReady(additionalContext, contextAttachments)) {
    const message = prepContextRequiredMessage();
    showPrepContextError(message);
    $("additionalContext")?.scrollIntoView?.({ behavior: "smooth", block: "nearest" });
    throw new Error(message);
  }
  clearPrepContextError();

  if (normalizeCompanyDomain(await readFieldValueAsync($("companyDomain"))) !== companyDomain) {
    const field = $("companyDomain");
    if (field) {
      field.value = companyDomain;
      field.dispatchEvent?.(new CustomEvent("fwInput", { bubbles: true, detail: { value: companyDomain } }));
    }
  }

  const crmForName = getPrepCrmSelection();
  const companyName =
    crmForName.accountName?.trim() ||
    companyNameFromPrimaryEmail(rawEmails) ||
    companyNameFromDomain(companyDomain);
  if (!companyName) {
    throw new Error(
      "Enter a corporate prospect email (not Gmail/Outlook) or a company domain we can derive a name from.",
    );
  }

  const kaiaMeetingUrl = (await readFieldValueAsync($("kaiaMeetingUrl")))?.trim() || undefined;

  const inputHash = computePrepInputHash(companyName, companyDomain, emails, linkedinFingerprintForHash(), {
    additionalContext: mergedContext,
    kaiaMeetingUrl,
  });
  let cachedResearch = null;
  let cacheMode = null;
  try {
    cachedResearch = await loadCachedResearch(companyName, companyDomain, inputHash);
    if (cachedResearch) {
      cacheMode = cachedResearch.inputHash === inputHash ? "exact" : "soft";
    }
  } catch {
    cachedResearch = null;
    cacheMode = null;
  }
  logPrepDebug("buildPayload-cache", {
    cacheMode,
    inputHash,
    factCount: cachedResearch?.facts?.length ?? 0,
    domain: companyDomain,
  });

  const linkedinProfileExports = linkedinProfileExportsForPayload();
  const meetingZoomUrl = (await readFieldValueAsync($("meetingZoomUrl")))?.trim() || undefined;
  const meetingZoomPasscode = (await readFieldValueAsync($("meetingZoomPasscode")))?.trim() || undefined;

  const engagementCtx = getAccountEngagementContext();
  const crm = getPrepCrmSelection();

  const prepType = engagementCtx.prepType || "new_business";

  return {
    payload: {
      companyName,
      companyDomain,
      prospectEmail: emails[0],
      prospectEmails: emails,
      additionalContext,
      seAdditionalContext: additionalContext,
      contextAttachments,
      prepType,
      // "+ New deal" must not inherit a dealId from the session context the SE arrived with —
      // that context still names the deal they navigated from, and letting it through here is
      // what made the choice a no-op. createNewDeal and dealId are mutually exclusive.
      dealId: crm.createNewDeal ? undefined : crm.dealId || engagementCtx.dealId || undefined,
      createNewDeal: crm.createNewDeal || undefined,
      newDealTitle: crm.createNewDeal ? crm.newDealTitle || undefined : undefined,
      newDealType: crm.createNewDeal ? crm.newDealType || undefined : undefined,
      accountId: crm.accountId || engagementCtx.accountId || undefined,
      lifecycleId: crm.createNewDeal ? undefined : engagementCtx.lifecycleId || undefined,
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
      additionalContext,
      contextAttachments,
      accountId: crm.accountId || engagementCtx.accountId || undefined,
      // Same exclusion as the payload above: getOrCreateLifecycle falls back to meta.dealId,
      // so leaving it populated here would defeat the flag by the back door.
      dealId: crm.createNewDeal ? undefined : crm.dealId || engagementCtx.dealId || undefined,
      inputHash,
      cacheMode,
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
  const addContextBtn = $("prep-context-add-btn");
  if (addContextBtn) addContextBtn.disabled = on || state.contextParsing;
  document.querySelectorAll(".nb-linkedin-upload-btn").forEach((el) => {
    el.disabled = on || state.linkedinParsing;
  });
  show($("prep-loading"), false);
  if (on) {
    showPrepGenOverlay({ message: message || "Building your brief…", pct: 8 });
    showInlineStatus(status, { type: "info", message, loading: true });
    show($("prep-result-view"), false);
  } else {
    void hidePrepGenOverlay();
  }
  syncGenerateGateRef();
}

function clearLoading() {
  const btn = $("generate");
  state.loading = false;
  setButtonLoading(btn, false);
  setFormFieldsDisabled($("prep-form"), false);
  show($("prep-loading"), false);
  void hidePrepGenOverlay();
  syncGenerateGateRef();
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
    sources: pending?.research?.sources || state.currentPrep?.sources || [],
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

/** Whether per-contact enrich should run (exported for tests). */
export function shouldRunProspectEnrich(payload, pdfCount = 0) {
  return !!(
    pdfCount ||
    String(payload?.additionalContext || "").trim() ||
    String(payload?.kaiaMeetingUrl || "").trim() ||
    String(payload?.kaiaSummary || "").trim() ||
    String(payload?.meetingZoomUrl || "").trim()
  );
}

async function hydrateKaiaSummary(payload, statusEl) {
  const url = payload.kaiaMeetingUrl?.trim();
  if (!url || payload.kaiaSummary?.trim()) return false;
  const endpoint = deps.kaiaShareUrl || deps.fetchKaiaUrl;
  if (!endpoint) return false;

  try {
    const data = deps.kaiaShareUrl
      ? await postJson(deps.kaiaShareUrl, { url })
      : await postJson(deps.fetchKaiaUrl, { kaiaUrl: url });
    const summary = String(data.summary || "").trim();
    if (!summary) return false;
    payload.kaiaContent = data.bundle || {
      summary,
      title: data.title,
      startTime: data.startTime,
      participants: data.participants,
      summaryJson: data.summaryJson,
    };
    payload.kaiaSummary = summary;
    payload.kaiaMeetingUrl = undefined;
    const kaiaField = $("kaiaMeetingUrl");
    if (kaiaField) {
      kaiaField.placeholder = data.title
        ? `Fetched · ${data.title}`
        : "Fetched · Kaia summary loaded";
    }
    return true;
  } catch (err) {
    showInlineStatus(statusEl, {
      type: "warn",
      message: `Kaia fetch skipped: ${err.message || "error"}. Continuing without Kaia text…`,
    });
    return false;
  }
}

const PREP_STAGE_LABELS = {
  kaia: "Fetch Kaia meeting summary",
  enrich: "Read LinkedIn exports and notes",
  research: "Research account and prospects",
  synthesize: "Write the brief",
};

/** @param {string[]} stageIds */
export function createPrepProgress(stageIds, hostId = "prep-progress") {
  const steps = stageIds.map((id) => ({
    id,
    label: PREP_STAGE_LABELS[id] || id,
    status: "pending",
  }));
  let detail;

  const render = () => {
    showPipelineProgress(hostId, steps, { title: "Brief pipeline", meta: detail });
    const active = steps.find((s) => s.status === "active");
    updatePrepGenOverlay({
      message: detail || active?.label || "Building your brief…",
      pct: prepStepsToPct(steps),
    });
  };

  return {
    steps,
    set(id, status) {
      const step = steps.find((s) => s.id === id);
      if (step) step.status = status;
      render();
    },
    advance(id, nextId) {
      if (id) this.set(id, "done");
      if (nextId) this.set(nextId, "active");
    },
    setDetail(text) {
      detail = text;
      render();
    },
    clearDetail() {
      detail = undefined;
      render();
    },
    hide() {
      hidePipelineProgress(hostId);
    },
  };
}

function formatResearchStepDetail(steps, factCount, sourceCount, cacheHit, softCache) {
  if (cacheHit) {
    if (steps?.clientCache) {
      const label = softCache || steps?.softCacheHit ? "Saved account research (domain)" : "Saved account research";
      return `${label} · ${factCount} facts · ${sourceCount} sources`;
    }
    const label = softCache || steps?.softCacheHit ? "Domain cache hit" : "Cache hit";
    return `${label} · ${factCount} facts · ${sourceCount} sources`;
  }
  if (!steps || typeof steps !== "object") return `${factCount} facts · ${sourceCount} sources`;
  const parts = [];
  if (steps.parallelIo) parts.push(`io ${Math.round(steps.parallelIo / 1000)}s`);
  if (steps.playbook) parts.push(`playbook ${Math.round(steps.playbook / 1000)}s`);
  if (steps.extract) parts.push(`extract ${Math.round(steps.extract / 1000)}s`);
  if (steps.gap) parts.push(`gap ${Math.round(steps.gap / 1000)}s`);
  if (steps.news) parts.push(`news ${Math.round(steps.news / 1000)}s`);
  const timing = parts.length ? parts.join(" · ") : null;
  try {
    sessionStorage.setItem("prep:lastTimings", JSON.stringify({ steps, factCount, sourceCount, at: Date.now() }));
  } catch {
    /* quota */
  }
  return timing ? `${timing} · ${factCount} facts` : `${factCount} facts · ${sourceCount} sources`;
}

async function runPrepEndToEnd(payload, meta, emails) {
  const status = $("prep-status");
  const pdfs = payload.linkedinProfileExports || [];
  const prepT0 = Date.now();

  const willFetchKaia = !!payload.kaiaMeetingUrl?.trim() && !payload.kaiaSummary?.trim();
  const willEnrich = !!deps.enrichUrl && shouldRunProspectEnrich(payload, pdfs.length);
  const progress = createPrepProgress([
    ...(willFetchKaia ? ["kaia"] : []),
    ...(willEnrich ? ["enrich"] : []),
    "research",
    "synthesize",
  ]);

  if (willFetchKaia) progress.set("kaia", "active");
  setLoading(true, willFetchKaia ? "Fetching Kaia meeting summary…" : "Preparing brief pipeline…");

  let confirmedProspectProfiles = [];
  let contactEnrichmentsByEmail = null;

  const cacheHit = !!payload.cachedResearch;
  const cachedFactCount = payload.cachedResearch?.facts?.length ?? 0;
  const skipResearchApi = cachedFactCount >= 8;

  const researchPayload = { ...payload };
  delete researchPayload.confirmedProspectProfiles;

  const runResearchStep = async () => {
    updatePrepGenOverlay({
      message: skipResearchApi
        ? "Using saved account research…"
        : cacheHit
          ? "Loading cached research…"
          : "Researching account and prospects…",
    });
    progress.set("research", "active");
    const tResearch = Date.now();

    if (skipResearchApi) {
      progress.setDetail("Using saved account research");
      const cachedResearch = payload.cachedResearch;
      const data = {
        facts: cachedResearch.facts,
        sources: cachedResearch.sources || [],
        snippets: cachedResearch.snippets || [],
        researchBundle: cachedResearch,
        researchMeta: {
          cacheHit: true,
          playbookSkipped: true,
          steps: {
            clientCache: 1,
            softCacheHit: meta.cacheMode === "soft" ? 1 : 0,
          },
        },
      };
      logPrepDebug("research-skipped", {
        cacheMode: meta.cacheMode,
        factCount: cachedFactCount,
        ms: Date.now() - tResearch,
      });
      return data;
    }

    if (cacheHit) progress.setDetail("Using cached research");
    logPrepDebug("research-api-call", { cacheMode: meta.cacheMode, factCount: cachedFactCount });
    const data = await postJson(deps.researchUrl, researchPayload);
    logPrepDebug("research-api-done", {
      ms: Date.now() - tResearch,
      cacheHit: data.researchMeta?.cacheHit ?? cacheHit,
      steps: data.researchMeta?.steps || null,
    });
    return data;
  };

  const runEnrichStep = async () => {
    if (!willEnrich) return [];
    progress.set("enrich", "active");
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
            progress.setDetail(`Prospects read: ${n} of ${total}`);
          },
        },
      );
      contactEnrichmentsByEmail = Object.fromEntries(
        enrichResponses.map((r) => [r.email.toLowerCase(), r]),
      );
      const profiles = toConfirmedProspectProfiles(enrichResponses);
      progress.set("enrich", "done");
      return profiles;
    } catch (err) {
      progress.set("enrich", "error");
      showInlineStatus(status, {
        type: "warn",
        message: `Some prospect enrichments failed: ${err.message || "error"}. Continuing with available data…`,
      });
      progress.set("enrich", "skipped");
      return [];
    }
  };

  // Kaia must finish before research (payload), but enrich can overlap Kaia fetches.
  const kaiaPromise = willFetchKaia ? hydrateKaiaSummary(payload, status) : Promise.resolve(false);
  const enrichPromise = runEnrichStep();

  await kaiaPromise;
  if (willFetchKaia) progress.set("kaia", payload.kaiaSummary?.trim() ? "done" : "skipped");
  let kaiaFetched = !!payload.kaiaSummary?.trim();

  let research;
  try {
    const [researchResult, enrichProfiles] = await Promise.all([runResearchStep(), enrichPromise]);
    research = researchResult;
    confirmedProspectProfiles = enrichProfiles;
    state.contactEnrichmentsByEmail = contactEnrichmentsByEmail;
  } catch (err) {
    progress.set("research", "error");
    const msg = err.message || "Something went wrong.";
    showInlineStatus(status, {
      type: "error",
      message: msg === "Failed to fetch" || /network|fetch/i.test(msg) ? deps.workerDownMsg : msg,
    });
    clearLoading();
    progress.hide();
    return;
  }

  const confirmedFacts = selectDefaultConfirmedFacts(research);
  if (!confirmedFacts.length) {
    progress.set("research", "error");
    showInlineStatus(status, {
      type: "error",
      message: "No verified research facts found. Check company domain and emails, then try again.",
    });
    clearLoading();
    progress.hide();
    return;
  }

  state.pendingResearch = { payload, meta, research };

  const factCount = research.facts?.length ?? confirmedFacts.length;
  const sourceCount = research.sources?.length ?? 0;
  const researchCacheHit = research.researchMeta?.cacheHit ?? cacheHit;
  const clientCache = research.researchMeta?.steps?.clientCache === 1;
  const softCache = research.researchMeta?.steps?.softCacheHit === 1;
  progress.set("research", "done");
  progress.setDetail(
    formatResearchStepDetail(research.researchMeta?.steps, factCount, sourceCount, researchCacheHit, softCache),
  );

  const enrichPayload = {
    ...payload,
    confirmedProspectProfiles: confirmedProspectProfiles.length ? confirmedProspectProfiles : undefined,
  };

  setLoading(true, "Generating brief from research…");
  progress.set("synthesize", "active");
  updatePrepGenOverlay({ message: "Writing the brief…", pct: prepStepsToPct(progress.steps) });
  const tSynth = Date.now();

  try {
    const data = await postJson(deps.synthesizeUrl, {
      ...enrichPayload,
      confirmedFacts,
      researchBundle: research.researchBundle,
    });

    const enrichedMeta = {
      ...meta,
      additionalContext: payload.additionalContext || meta.additionalContext,
      contextAttachments: payload.contextAttachments || meta.contextAttachments,
      kaiaFetched,
      researchMeta: data.researchMeta,
      researchBundle: data.researchBundle,
      linkedinMatchedEmails: data.researchMeta?.linkedinMatchedEmails,
      prospectEmails: emails,
      contactEnrichmentsByEmail: state.contactEnrichmentsByEmail,
      linkedinProfileExports: pdfs,
    };

    progress.set("synthesize", "done");
    updatePrepGenOverlay({ message: "Brief ready", pct: 100 });
    const totalMs = Date.now() - prepT0;
    const synthMs = Date.now() - tSynth;
    logPrepDebug("pipeline-complete", {
      totalMs,
      synthMs,
      researchSkipped: skipResearchApi,
      cacheMode: meta.cacheMode,
      clientCache,
      cacheHit: researchCacheHit,
      steps: research.researchMeta?.steps || null,
    });
    displayPrepResult(data.prep, enrichedMeta, { deferReveal: true });
    await hidePrepGenOverlay(() => {
      show($("prep-result-view"), true);
      show($("prep-result-back"), state.fromBriefList);
      revealPrepResultView();
      wirePrepV9ScrollAnimations($("prep-tab-discovery"));
      wirePrepV9ScrollAnimations($("prep-tab-demo"));
    });
    const lifecycleId = await deps.onGenerated?.(payload, data.prep, enrichedMeta);
    saveBriefToSidebar(payload, data.prep, enrichedMeta, lifecycleId);
    state.pendingResearch = null;
    clearLinkedInAttachments();
    const listEl = $("prep-linkedin-file-list");
    if (listEl) listEl.innerHTML = "";
    clearContextAttachments();
    const contextListEl = $("prep-context-file-list");
    if (contextListEl) contextListEl.innerHTML = "";
    progress.hide();
    const totalSec = Math.round((Date.now() - prepT0) / 1000);
    const cacheLabel = clientCache
      ? softCache
        ? " (saved research, domain)"
        : " (saved research)"
      : researchCacheHit
        ? softCache
          ? " (domain cache)"
          : " (cache hit)"
        : "";
    showInlineStatus(status, {
      type: "info",
      message: `Brief ready in ${totalSec}s${cacheLabel}.`,
    });
    window.setTimeout(() => showInlineStatus(status, { open: false }), 4000);
  } catch (err) {
    progress.set("synthesize", "error");
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
  if (state.loading || isParsingAttachments()) return;

  const status = $("prep-status");
  try {
    $("additionalContext")?.blur?.();
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
  if (typeof window !== "undefined") {
    window.__prepDebugLog = () => JSON.parse(sessionStorage.getItem(PREP_DEBUG_LOG_KEY) || "[]");
  }
  loadChecks();
  wireAdditionalContextMirror();
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

  const syncGenerateGate = () => {
    const busy = isParsingAttachments() || state.loading;
    const rawEmails = readFieldValue($("prospectEmail"));
    const emails = parseProspectEmails(rawEmails);
    const missingLinkedIn = emailsMissingLinkedInPdf(emails);
    const contextAttachments = contextAttachmentsForPayload();
    const additionalContext = readAdditionalContextLive();
    const formReady = isPrepFormReady(emails, missingLinkedIn, additionalContext, contextAttachments);
    const btn = $("generate");
    if (btn) btn.disabled = busy || !formReady;
    document.querySelectorAll(".nb-linkedin-upload-btn").forEach((el) => {
      el.disabled = busy;
    });
    const addContextBtn = $("prep-context-add-btn");
    if (addContextBtn) addContextBtn.disabled = busy;
  };

  initPrepAttendeeLinkedIn({
    setParsing: (on) => {
      state.linkedinParsing = on;
      syncGenerateGate();
    },
    onListChange: syncGenerateGate,
  });

  initContextFileUpload({
    setParsing: (on) => {
      state.contextParsing = on;
      syncGenerateGate();
    },
    onListChange: () => {
      clearPrepContextError();
      syncGenerateGate();
    },
  });

  const onContextInput = () => {
    clearPrepContextError();
    syncGenerateGate();
  };
  $("additionalContext")?.addEventListener("fwInput", onContextInput);
  $("additionalContext")?.addEventListener("input", onContextInput);
  $("prospectEmail")?.addEventListener("fwInput", syncGenerateGate);
  $("prospectEmail")?.addEventListener("input", syncGenerateGate);

  syncGenerateGateRef = syncGenerateGate;
  syncGenerateGate();

  initPrepCrmResolve();
  wireBriefResultBack();
  renderPrepRecentBriefs();
  if (typeof window !== "undefined") {
    window.__logPrecallDeploy = () => logPrecallDeployFingerprint("crm");
  }
  logPrecallDeployFingerprint("init");
  const stamp = document.getElementById("prep-ui-build-stamp");
  if (stamp) {
    stamp.textContent = document.querySelector('meta[name="portal-build"]')?.getAttribute("content") || "";
  }
}

/** Debug: verify which precall build/styles the browser actually loaded. */
function logPrecallDeployFingerprint(trigger) {
  if (typeof window === "undefined" || typeof document === "undefined") return;
  const portalBuild = document.querySelector('meta[name="portal-build"]')?.getAttribute("content") || "";
  const precallCssHref =
    document.querySelector('link[href*="precall.css"]')?.getAttribute("href") || "";
  const h1 = document.querySelector("#view-precall .prep-form-heading h1");
  const h1Style = h1 && window.getComputedStyle ? window.getComputedStyle(h1) : null;
  const hasLabelTight = !!document.querySelector("#view-precall .nb-label-tight");
  const prospectIcon = document.querySelector("#prospectEmail")?.closest(".nb-input-shell")?.querySelector(".nb-field-icon svg path")?.getAttribute("d") || "";
  const hasPersonIcon = prospectIcon.includes("M20 21");
  const accountPreview = $("prep-account-deal-preview");
  const payload = {
    trigger,
    portalBuild,
    precallCssHref,
    h1FontSize: h1Style?.fontSize || null,
    h1FontWeight: h1Style?.fontWeight || null,
    hasLabelTight,
    hasPersonIcon,
    accountGridHidden: accountPreview?.hidden ?? null,
    prospectEmailValue: ($("prospectEmail")?.value || "").length,
  };
  console.info("[precall-deploy]", payload);
}

export function resetPrecallOnView() {
  resetPrecallForm();
  logPrecallDeployFingerprint("view");
}

/** Meeting motion UI removed — prepType comes from account engagement context only. */
export function syncPrepEngagementMotion() {}

export { isV8Prep, isV7Prep, isV6Prep, companyMono };
