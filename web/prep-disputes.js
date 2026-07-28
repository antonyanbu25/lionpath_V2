/** Pre-call research disputes — local log + optional worker feedback sync. */

import {
  showInlineStatus,
} from "./crayons-ui.js";
import { newId } from "./domain/types.js";
import { esc } from "./shared.js";

export const STORAGE_KEY = "se-prep-disputes";
export const DISPUTE_UI_VERSION = "static-v11";
const MAX_DISPUTES = 100;

const FORCE_FIELD_STYLE = {
  display: "block",
  width: "100%",
  boxSizing: "border-box",
  opacity: "1",
  visibility: "visible",
  height: "auto",
  overflow: "visible",
};

const DISPUTE_CATEGORY_FIELD_HTML = `
        <label class="prep-dispute-field" for="prep-dispute-category">
          <span class="prep-dispute-label">Issue type</span>
          <select id="prep-dispute-category" class="prep-dispute-select" required>
            <option value="wrong_data">Wrong data</option>
            <option value="partial_missing">Partial / missing</option>
            <option value="outdated">Outdated</option>
            <option value="other">Other</option>
          </select>
        </label>`;

const DISPUTE_NOTE_FIELD_HTML = `
        <label class="prep-dispute-field" for="prep-dispute-note">
          <span class="prep-dispute-label">What is wrong? (required for review)</span>
          <textarea
            id="prep-dispute-note"
            class="prep-dispute-textarea"
            rows="4"
            placeholder="Describe the issue — include the correct value or what's missing…"
            required
          ></textarea>
        </label>`;

export const DISPUTE_CATEGORIES = {
  wrong_data: "Wrong data",
  partial_missing: "Partial / missing",
  outdated: "Outdated",
  other: "Other",
};

let deps = {};
let pendingContext = null;
let overlayMounted = false;
let disputeEventsBound = false;
/** @type {((btn: Element) => object) | null} */
let resolveContextFromButton = null;

export function registerDisputeContextResolver(fn) {
  resolveContextFromButton = typeof fn === "function" ? fn : null;
}

function buildMinimalContextFromButton(btn) {
  const section = btn.dataset.disputeSection || "general";
  const idxRaw = btn.dataset.disputeIdx ?? btn.dataset.factIdx;
  const idx = idxRaw != null && idxRaw !== "" ? Number(idxRaw) : NaN;
  const factKey = btn.dataset.disputeKey || "";
  const ctx = {
    step: btn.dataset.disputeStep || "brief_result",
    section,
    factKeys: factKey ? [factKey] : [],
    factIndices: Number.isFinite(idx) ? [idx] : [],
    companyName: document.querySelector(".prep-company-name")?.textContent?.trim() || "",
  };
  return ctx;
}

function resolveContext(btn) {
  try {
    return resolveContextFromButton?.(btn) || buildMinimalContextFromButton(btn);
  } catch (err) {
    console.warn("[se-prep-dispute] context resolver failed:", err.message);
    return buildMinimalContextFromButton(btn);
  }
}

function disputeOverlayValid() {
  const modal = document.getElementById("prep-dispute-modal");
  const cat = document.getElementById("prep-dispute-category");
  const note = document.getElementById("prep-dispute-note");
  return (
    modal?.classList?.contains("prep-dispute-overlay") &&
    modal.tagName === "DIV" &&
    cat?.tagName === "SELECT" &&
    note?.tagName === "TEXTAREA"
  );
}

/** Remove legacy Crayons fw-modal dispute dialogs (empty-body bug). */
export function purgeLegacyDisputeModals() {
  let removed = 0;
  document.querySelectorAll("fw-modal").forEach((modal) => {
    const id = modal.id || "";
    const title = String(modal.getAttribute("title-text") || modal.titleText || "").trim();
    if (id === "prep-dispute-modal" || /report research/i.test(title)) {
      try {
        if (modal.isOpen) modal.isOpen = false;
      } catch {
        // ignore close errors on detached nodes
      }
      modal.remove();
      removed += 1;
    }
  });
  return removed;
}

function applyForceFieldStyles(el, minHeight) {
  if (!el) return;
  Object.assign(el.style, FORCE_FIELD_STYLE);
  el.style.minHeight = `${minHeight}px`;
}

function insertDisputeFieldsBeforeActions(form) {
  const actions = form.querySelector(".prep-dispute-actions");
  if (!actions) return;
  const catWrap = document.createElement("div");
  catWrap.innerHTML = DISPUTE_CATEGORY_FIELD_HTML.trim();
  const noteWrap = document.createElement("div");
  noteWrap.innerHTML = DISPUTE_NOTE_FIELD_HTML.trim();
  form.insertBefore(noteWrap.firstElementChild, actions);
  form.insertBefore(catWrap.firstElementChild, actions);
}

/** Runtime self-heal: ensure select/textarea exist and are visible. */
export function ensureDisputeFieldsVisible() {
  const form = document.getElementById("prep-dispute-form");
  let cat = document.getElementById("prep-dispute-category");
  let note = document.getElementById("prep-dispute-note");
  let healed = false;
  let rebuilt = false;

  const catBroken = !cat || cat.tagName !== "SELECT";
  const noteBroken = !note || note.tagName !== "TEXTAREA";

  if (form && (catBroken || noteBroken)) {
    if (cat && cat.tagName !== "SELECT") cat.closest(".prep-dispute-field")?.remove();
    if (note && note.tagName !== "TEXTAREA") note.closest(".prep-dispute-field")?.remove();
    document.getElementById("prep-dispute-category")?.closest(".prep-dispute-field")?.remove();
    document.getElementById("prep-dispute-note")?.closest(".prep-dispute-field")?.remove();
    insertDisputeFieldsBeforeActions(form);
    cat = document.getElementById("prep-dispute-category");
    note = document.getElementById("prep-dispute-note");
    rebuilt = true;
    healed = true;
  }

  applyForceFieldStyles(cat, 42);
  applyForceFieldStyles(note, 96);

  form?.querySelectorAll(".prep-dispute-field").forEach((field) => {
    field.style.display = "flex";
    field.style.flexDirection = "column";
    field.style.gap = "6px";
    field.style.minHeight = "0";
    field.style.opacity = "1";
    field.style.visibility = "visible";
  });

  if (form) {
    form.style.display = "flex";
    form.style.flexDirection = "column";
    form.style.gap = "12px";
  }

  const categoryHeight = cat?.offsetHeight || 0;
  const noteHeight = note?.offsetHeight || 0;

  if (categoryHeight === 0 || noteHeight === 0) {
    applyForceFieldStyles(cat, 42);
    applyForceFieldStyles(note, 96);
    if (cat) cat.style.height = "42px";
    if (note) note.style.height = "96px";
    healed = true;
  }

  const metrics = {
    categoryHeight: cat?.offsetHeight || 0,
    noteHeight: note?.offsetHeight || 0,
    categoryTag: cat?.tagName || "missing",
    noteTag: note?.tagName || "missing",
    categoryDisplay: cat ? getComputedStyle(cat).display : "",
    noteDisplay: note ? getComputedStyle(note).display : "",
    healed,
    rebuilt,
  };

  return metrics;
}

/** Use static HTML from index when valid; otherwise create overlay in JS. */
export function mountDisputeOverlay() {
  purgeLegacyDisputeModals();

  if (disputeOverlayValid()) {
    overlayMounted = true;
    ensureDisputeFieldsVisible();
    return true;
  }

  document.getElementById("prep-dispute-backdrop")?.remove();
  document.getElementById("prep-dispute-modal")?.remove();
  purgeLegacyDisputeModals();

  const backdrop = document.createElement("div");
  backdrop.id = "prep-dispute-backdrop";
  backdrop.className = "prep-dispute-backdrop";
  backdrop.hidden = true;

  const modal = document.createElement("div");
  modal.id = "prep-dispute-modal";
  modal.className = "prep-dispute-overlay";
  modal.hidden = true;
  modal.setAttribute("role", "dialog");
  modal.setAttribute("aria-labelledby", "prep-dispute-title");
  modal.innerHTML = `
    <div class="prep-dispute-dialog">
      <header class="prep-dispute-header">
        <h2 id="prep-dispute-title" class="prep-dispute-title">Report research issue</h2>
        <button type="button" id="prep-dispute-close-x" class="prep-dispute-close-x" aria-label="Close">×</button>
      </header>
      <form id="prep-dispute-form" class="prep-dispute-form">
        <p id="prep-dispute-context" class="muted"></p>
        <div id="prep-dispute-target" class="prep-dispute-target" hidden></div>
        ${DISPUTE_CATEGORY_FIELD_HTML}
        ${DISPUTE_NOTE_FIELD_HTML}
        <div class="prep-dispute-actions">
          <button type="button" id="prep-dispute-cancel" class="prep-dispute-btn prep-dispute-btn-secondary">Cancel</button>
          <button type="submit" id="prep-dispute-submit" class="prep-dispute-btn prep-dispute-btn-primary">Submit report</button>
        </div>
        <div id="prep-dispute-status" class="dew-status-host" hidden></div>
      </form>
    </div>`;

  document.body.append(backdrop, modal);
  overlayMounted = true;
  ensureDisputeFieldsVisible();
  return true;
}

function closeOpenFwModals() {
  document.querySelectorAll("fw-modal").forEach((modal) => {
    if (modal.isOpen) modal.isOpen = false;
  });
}

function showDisputeOverlay() {
  const modal = document.getElementById("prep-dispute-modal");
  const backdrop = document.getElementById("prep-dispute-backdrop");
  modal?.removeAttribute("hidden");
  backdrop?.removeAttribute("hidden");
  if (modal) modal.hidden = false;
  if (backdrop) backdrop.hidden = false;
}

function hideDisputeOverlay() {
  const modal = document.getElementById("prep-dispute-modal");
  const backdrop = document.getElementById("prep-dispute-backdrop");
  if (modal) modal.hidden = true;
  if (backdrop) backdrop.hidden = true;
}

function loadDisputes() {
  try {
    return JSON.parse(localStorage.getItem(STORAGE_KEY) || "[]");
  } catch {
    return [];
  }
}

function saveDisputes(list) {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(list.slice(0, MAX_DISPUTES)));
}

export function summarizeFactsSnapshot(facts, indices = null) {
  const list = Array.isArray(facts) ? facts : [];
  const pick = indices == null ? list : indices.map((i) => list[i]).filter(Boolean);
  return pick.slice(0, 12).map((f) => ({
    key: String(f?.key || ""),
    value: String(f?.value || "").slice(0, 200),
    sourceLabel: String(f?.sourceLabel || ""),
  }));
}

export function buildDisputeEntry(context, categoryKey, note) {
  const category = DISPUTE_CATEGORIES[categoryKey] || DISPUTE_CATEGORIES.other;
  const factIndices = context?.factIndices || [];
  const facts = context?.facts || [];
  const factKeys = factIndices.length
    ? factIndices.map((i) => facts[i]?.key).filter(Boolean)
    : context?.factKeys || [];

  return {
    id: newId("dispute"),
    timestamp: Date.now(),
    userEmail: context?.userEmail || "anonymous",
    companyName: context?.companyName || "",
    companyDomain: context?.companyDomain || "",
    step: context?.step || "brief_result",
    section: context?.section || "general",
    factIndices,
    factKeys,
    briefId: context?.briefId || null,
    category: categoryKey,
    categoryLabel: category,
    note: String(note || "").slice(0, 2000),
    researchInputHash: context?.researchInputHash || null,
    factsSnapshot: summarizeFactsSnapshot(facts, factIndices.length ? factIndices : null),
  };
}

export function appendDispute(entry) {
  const list = loadDisputes();
  list.unshift(entry);
  saveDisputes(list);
  console.info("[se-prep-dispute]", entry.id, entry.categoryLabel, entry.companyName, entry.factKeys);
  return entry;
}

function formatFeedbackMessage(entry) {
  const lines = [
    `[Pre-call dispute · ${entry.categoryLabel}]`,
    `Company: ${entry.companyName} (${entry.companyDomain})`,
    `Step: ${entry.step}${entry.section ? ` · ${entry.section}` : ""}`,
  ];
  if (entry.factKeys?.length) lines.push(`Facts: ${entry.factKeys.join(", ")}`);
  if (entry.briefId) lines.push(`Brief: ${entry.briefId}`);
  if (entry.researchInputHash) lines.push(`Input hash: ${entry.researchInputHash}`);
  if (entry.note) lines.push(`Note: ${entry.note}`);
  if (entry.factsSnapshot?.length) {
    lines.push(
      "Snapshot:",
      ...entry.factsSnapshot.map((f) => `- ${f.key}: ${f.value} (${f.sourceLabel || "—"})`),
    );
  }
  return lines.join("\n").slice(0, 4000);
}

async function syncDisputeToWorker(entry) {
  const workerUrl = deps.workerUrl || "";
  if (!workerUrl) return;

  const email = entry.userEmail || "anonymous";
  const payload = {
    email,
    entry: {
      id: entry.id,
      category: "Data quality",
      message: formatFeedbackMessage(entry),
      page: `prep-dispute:${entry.step}`,
      createdAt: entry.timestamp,
    },
  };

  const headers = { "Content-Type": "application/json" };
  const token = typeof deps.getToken === "function" ? await deps.getToken() : null;
  if (token) headers.Authorization = `Bearer ${token}`;

  const res = await fetch(`${workerUrl}/api/feedback`, {
    method: "POST",
    headers,
    body: JSON.stringify(payload),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || `Server error (${res.status})`);
}

function renderTargetDetails(ctx) {
  const facts = ctx?.facts || [];
  const indices = ctx?.factIndices || [];
  const rows = indices.map((i) => facts[i]).filter(Boolean);

  if (rows.length) {
    return `<ul class="prep-dispute-target-list">${rows
      .map(
        (f) => `<li><span class="prep-dispute-target-key">${esc(f.key)}</span> — ${esc(String(f.value || "").slice(0, 240))}</li>`,
      )
      .join("")}</ul>`;
  }

  if (ctx?.factKeys?.length) {
    return `<ul class="prep-dispute-target-list">${ctx.factKeys
      .map((k) => `<li><span class="prep-dispute-target-key">${esc(k)}</span></li>`)
      .join("")}</ul>`;
  }

  return "";
}

function describeContext(ctx) {
  if (!ctx) return "Report an issue with this research step.";
  const company = ctx.companyName || "this account";
  if (ctx.factKeys?.length === 1) {
    return `Reporting issue with “${ctx.factKeys[0]}” for ${company}.`;
  }
  if (ctx.factKeys?.length > 1) {
    return `Reporting ${ctx.factKeys.length} findings for ${company}.`;
  }
  if (ctx.section && ctx.section !== "general") {
    return `Reporting a ${ctx.section.replace(/_/g, " ")} issue for ${company}.`;
  }
  return `Report incorrect or incomplete research for ${company}.`;
}

export function openDisputeModal(context = {}) {
  mountDisputeOverlay();
  purgeLegacyDisputeModals();

  const modal = document.getElementById("prep-dispute-modal");
  const backdrop = document.getElementById("prep-dispute-backdrop");
  const intro = document.getElementById("prep-dispute-context");
  const target = document.getElementById("prep-dispute-target");
  let noteEl = document.getElementById("prep-dispute-note");
  let catEl = document.getElementById("prep-dispute-category");
  const status = document.getElementById("prep-dispute-status");
  if (!modal) return;

  pendingContext = {
    ...context,
    userEmail: typeof deps.getEmail === "function" ? deps.getEmail() : context.userEmail || "",
  };

  const targetHtml = renderTargetDetails(pendingContext);
  if (intro) intro.textContent = describeContext(pendingContext);
  if (target) {
    if (targetHtml) {
      target.innerHTML = `<p class="prep-dispute-target-label">Reporting:</p>${targetHtml}`;
      target.hidden = false;
    } else {
      target.innerHTML = "";
      target.hidden = true;
    }
  }
  if (noteEl) noteEl.value = "";
  if (catEl) catEl.value = "wrong_data";
  showInlineStatus(status, { open: false });

  const factsModal = document.getElementById("prep-facts-modal");
  if (factsModal?.isOpen) factsModal.isOpen = false;
  closeOpenFwModals();

  showDisputeOverlay();

  ensureDisputeFieldsVisible();
  noteEl = document.getElementById("prep-dispute-note");
  catEl = document.getElementById("prep-dispute-category");

  requestAnimationFrame(() => {
    ensureDisputeFieldsVisible();
    noteEl?.focus?.();
  });
}

function closeDisputeModal() {
  hideDisputeOverlay();
  pendingContext = null;
}

async function submitDispute(ev) {
  ev?.preventDefault?.();
  ev?.stopPropagation?.();

  if (!pendingContext) return;

  const noteEl = document.getElementById("prep-dispute-note");
  const catEl = document.getElementById("prep-dispute-category");
  const status = document.getElementById("prep-dispute-status");
  const submitBtn = document.getElementById("prep-dispute-submit");

  const categoryKey = catEl?.value || "wrong_data";
  const note = (noteEl?.value || "").trim();
  if (!note) {
    showInlineStatus(status, { type: "error", message: "Add details so reviewers know what to fix.", open: true });
    if (submitBtn) submitBtn.disabled = false;
    return;
  }

  if (submitBtn) submitBtn.disabled = true;

  const entry = buildDisputeEntry(pendingContext, categoryKey, note);
  appendDispute(entry);

  try {
    await syncDisputeToWorker(entry);
    showInlineStatus(status, { type: "success", message: "Issue logged — thanks for the feedback.", open: true });
  } catch (err) {
    showInlineStatus(status, {
      type: "success",
      message: "Saved locally for review. Server sync unavailable.",
      open: true,
    });
    console.info("[se-prep-dispute] worker sync skipped:", err.message);
  }

  if (submitBtn) submitBtn.disabled = false;
  setTimeout(closeDisputeModal, 900);
}

export function bindDisputeEvents() {
  if (disputeEventsBound) return;
  disputeEventsBound = true;

  document.addEventListener("submit", (ev) => {
    if (ev.target?.id === "prep-dispute-form") void submitDispute(ev);
  });

  document.addEventListener("click", (ev) => {
    const t = ev.target;
    if (t?.id === "prep-dispute-backdrop" || t?.id === "prep-dispute-cancel" || t?.id === "prep-dispute-close-x") {
      ev.preventDefault();
      closeDisputeModal();
    }
  });
}

export function initDisputeUiEarly() {
  purgeLegacyDisputeModals();
  mountDisputeOverlay();
  bindDisputeEvents();
  if (typeof window !== "undefined") {
    window.__SE_DISPUTE_VERSION = DISPUTE_UI_VERSION;
    window.openSeDisputeModal = openDisputeModal;
    window.ensureDisputeFieldsVisible = ensureDisputeFieldsVisible;
    window.purgeLegacyDisputeModals = purgeLegacyDisputeModals;
  }
}

export function initPrepDisputes(options = {}) {
  deps = options;
  initDisputeUiEarly();
}

/** Kept for call-site compatibility. Clicks handled by inline script in index.html. */
export function wireDisputeTriggers(_root) {}

/** Kept for API compatibility; inline script handles trigger clicks. */
export function bindGlobalDisputeTriggers() {}
