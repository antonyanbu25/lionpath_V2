/** Pre-call wireframe. state, generate flow, interactions. */

import {
  bindActionOnce,
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
} from "./precall-render.js";
import { renderKnowTab, renderDemoPrepTab } from "./precall-brief-v9.js";
import { wirePrepV9ScrollAnimations } from "./prep-v9-animate.js";
import { computePrepInputHash, loadCachedResearch } from "./domain/account-service.js";
import { wireDisputeTriggers, registerDisputeContextResolver } from "./prep-disputes.js";
import { resolveCompanyDomainForSubmit, companyNameFromPrimaryEmail, companyNameFromDomain } from "./prep-domain.js";
import {
  linkedinProfileExportsForPayload,
  initLinkedInPdfUpload,
  clearLinkedInAttachments,
  linkedinFingerprintForHash,
} from "./prep-linkedin-pdf.js";
import {
  initContextFileUpload,
  clearContextAttachments,
  contextAttachmentsForPayload,
} from "./prep-context-files.js";
import { mergeContextAttachments } from "./prep-context-attachments.js";
import { enrichProspectsParallel, toConfirmedProspectProfiles, mergeEnrichmentsIntoPrep, applyPdfNameFallbacks } from "./prep-contact-enrich.js";
import { applySeContextToDiscovery, applySeContextToPrep } from "./prep-se-context.js";
import { canonicalizePrepSources } from "./prep-source-canon.js";
import { esc, $, show } from "./shared.js";
import { showPipelineProgress, hidePipelineProgress } from "./pipeline-progress.js";
import { getAccountEngagementContext } from "./domain/account-context.js";

const CHECKS_KEY = "lionpath_prep_checks";
const BRIEFS_KEY = "lionpath_briefs";
const MAX_BRIEFS = 12;
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/i;
const DOMAIN_RE = /^[a-z0-9]([a-z0-9-]*\.)+[a-z]{2,}$/i;

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
  contextParsing: false,
};

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
    const raw = localStorage.getItem(BRIEFS_KEY);
    if (!raw) return [];
    const list = JSON.parse(raw);
    return Array.isArray(list) ? list.slice(0, MAX_BRIEFS) : [];
  } catch {
    return [];
  }
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
  bindActionOnce($("prep-new-search"), showFormView);
}

export function displayPrepResult(prep, meta = {}) {
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
    prep?.prospects?.map((p) => p.email).filter(Boolean) ||
    [];
  if (enrichByEmail && prep?.prospects?.length && emails.length) {
    merged = mergeEnrichmentsIntoPrep(prep, emails, Object.values(enrichByEmail));
  } else if (storedProfiles?.length && prep?.prospects?.length && emails.length) {
    merged = mergeEnrichmentsIntoPrep(prep, emails, storedProfiles);
  }
  merged = applyPdfNameFallbacks(merged, emails, meta.linkedinProfileExports || meta.input?.linkedinProfileExports || []);
  const withContext = applySeContextToDiscovery(applySeContextToPrep(merged, context), context);
  showResultView(canonicalizePrepSources(withContext).prep, meta);
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

  function appendDiscoveryQuestion(question) {
    const q = String(question || "").trim();
    if (!q || !state.currentPrep) return;
    if (!Array.isArray(state.currentPrep.discoveryKit)) state.currentPrep.discoveryKit = [];
    const exists = state.currentPrep.discoveryKit.some((k) => String(k.question || "").trim() === q);
    if (exists) return;
    state.currentPrep.discoveryKit.push({ question: q, because: "Gap from brief research — ask on the call." });
    renderActiveTab();
  }

  root.querySelector(".prep-v9-unknown-add-all")?.addEventListener("click", () => {
    root.querySelectorAll(".prep-v9-unknown-add").forEach((btn) => {
      appendDiscoveryQuestion(btn.dataset.unknownQuestion);
    });
  });

  root.querySelectorAll(".prep-v9-unknown-add").forEach((btn) => {
    btn.addEventListener("click", () => appendDiscoveryQuestion(btn.dataset.unknownQuestion));
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
  if (normalizeCompanyDomain(await readFieldValueAsync($("companyDomain"))) !== companyDomain) {
    const field = $("companyDomain");
    if (field) {
      field.value = companyDomain;
      field.dispatchEvent?.(new CustomEvent("fwInput", { bubbles: true, detail: { value: companyDomain } }));
    }
  }

  const companyName =
    companyNameFromPrimaryEmail(rawEmails) || companyNameFromDomain(companyDomain);
  if (!companyName) {
    throw new Error(
      "Enter a corporate prospect email (not Gmail/Outlook) or a company domain we can derive a name from.",
    );
  }

  const additionalContext = await readAdditionalContextForSubmit();
  const kaiaMeetingUrl = (await readFieldValueAsync($("kaiaMeetingUrl")))?.trim() || undefined;
  const contextAttachments = contextAttachmentsForPayload();

  const inputHash = computePrepInputHash(companyName, companyDomain, emails, linkedinFingerprintForHash(), {
    additionalContext: mergeContextAttachments(additionalContext, contextAttachments),
    kaiaMeetingUrl,
  });
  let cachedResearch = null;
  try {
    cachedResearch = await loadCachedResearch(companyName, companyDomain, inputHash);
  } catch {
    cachedResearch = null;
  }

  const linkedinProfileExports = linkedinProfileExportsForPayload();
  const meetingZoomUrl = (await readFieldValueAsync($("meetingZoomUrl")))?.trim() || undefined;
  const meetingZoomPasscode = (await readFieldValueAsync($("meetingZoomPasscode")))?.trim() || undefined;

  const engagementCtx = getAccountEngagementContext();

  let prepType = engagementCtx.prepType || "new_business";
  const motionSelect = $("prep-meeting-motion");
  const fromAccount = $("prep-motion-from-account");
  if (fromAccount && !fromAccount.hidden) {
    prepType = engagementCtx.prepType || prepType;
  } else if (motionSelect && !$("prep-motion-row")?.hidden) {
    prepType = (await readFieldValueAsync(motionSelect)) || prepType;
  }

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
      dealId: engagementCtx.dealId || undefined,
      lifecycleId: engagementCtx.lifecycleId || undefined,
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
  const addContextBtn = $("prep-context-add-btn");
  if (addContextBtn) addContextBtn.disabled = on || state.contextParsing;
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

  setLoading(true, "Fetching Kaia meeting summary…");
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

  const render = () => showPipelineProgress(hostId, steps, { title: "Brief pipeline", meta: detail });

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

async function runPrepEndToEnd(payload, meta, emails) {
  const status = $("prep-status");
  const pdfs = payload.linkedinProfileExports || [];

  const willFetchKaia = !!payload.kaiaMeetingUrl?.trim() && !payload.kaiaSummary?.trim();
  const willEnrich = !!deps.enrichUrl && shouldRunProspectEnrich(payload, pdfs.length);
  const progress = createPrepProgress([
    ...(willFetchKaia ? ["kaia"] : []),
    ...(willEnrich ? ["enrich"] : []),
    "research",
    "synthesize",
  ]);

  if (willFetchKaia) progress.set("kaia", "active");
  await hydrateKaiaSummary(payload, status);
  if (willFetchKaia) progress.set("kaia", payload.kaiaSummary?.trim() ? "done" : "skipped");
  let kaiaFetched = !!payload.kaiaSummary?.trim();

  let confirmedProspectProfiles = [];

  if (willEnrich) {
    setLoading(true, "Enriching prospects…");
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
      confirmedProspectProfiles = toConfirmedProspectProfiles(enrichResponses);
      state.contactEnrichmentsByEmail = Object.fromEntries(
        enrichResponses.map((r) => [r.email.toLowerCase(), r]),
      );
    } catch (err) {
      progress.set("enrich", "error");
      showInlineStatus(status, {
        type: "warn",
        message: `Some prospect enrichments failed: ${err.message || "error"}. Continuing with available data…`,
      });
    }
    if (progress.steps.find((s) => s.id === "enrich")?.status === "active") {
      progress.set("enrich", "done");
    }
    progress.clearDetail();
  }

  const enrichPayload = {
    ...payload,
    confirmedProspectProfiles: confirmedProspectProfiles.length ? confirmedProspectProfiles : undefined,
  };

  const cacheHit = payload.cachedResearch || meta.researchMeta?.cacheHit;
  setLoading(true, cacheHit ? "Loading cached research…" : "Researching account and prospects…");
  progress.set("research", "active");
  if (cacheHit) progress.setDetail("Using cached research");

  let research;
  try {
    research = await postJson(deps.researchUrl, enrichPayload);
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
  progress.set("research", "done");
  progress.setDetail(`${factCount} facts · ${sourceCount} sources`);

  setLoading(true, "Generating brief from research…");
  progress.set("synthesize", "active");

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
    displayPrepResult(data.prep, enrichedMeta);
    showInlineStatus(status, { open: false });
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
  $("generate")?.addEventListener("fwClick", (e) => {
    void generatePrep(e);
  });

  const syncParsingGate = () => {
    const busy = isParsingAttachments() || state.loading;
    const btn = $("generate");
    if (btn) btn.disabled = busy;
    const addPdfBtn = $("prep-linkedin-add-btn");
    if (addPdfBtn) addPdfBtn.disabled = busy;
    const addContextBtn = $("prep-context-add-btn");
    if (addContextBtn) addContextBtn.disabled = busy;
  };

  initLinkedInPdfUpload({
    setParsing: (on) => {
      state.linkedinParsing = on;
      syncParsingGate();
    },
  });

  initContextFileUpload({
    setParsing: (on) => {
      state.contextParsing = on;
      syncParsingGate();
    },
  });
}

export function resetPrecallOnView() {
  if (state.view === "form") return;
}

/** Show meeting motion controls based on account engagement context. */
export function syncPrepEngagementMotion() {
  const row = $("prep-motion-row");
  const fromAccount = $("prep-motion-from-account");
  const select = $("prep-meeting-motion");
  const chip = $("prep-motion-chip");
  if (!row) return;

  const ctx = getAccountEngagementContext();
  const hasAccount = Boolean(ctx.accountId);

  row.hidden = false;
  if (hasAccount) {
    if (fromAccount) fromAccount.hidden = false;
    if (select) select.hidden = true;
    const label = ctx.prepType === "expansion" ? "Expansion" : "New business";
    if (chip) chip.text = `Meeting motion: ${label}`;
  } else {
    if (fromAccount) fromAccount.hidden = true;
    if (select) {
      select.hidden = false;
      select.value = ctx.prepType === "expansion" ? "expansion" : "new_business";
    }
  }
}

export { isV8Prep, isV7Prep, isV6Prep, companyMono };
