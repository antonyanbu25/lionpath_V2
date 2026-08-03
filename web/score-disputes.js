/** Score dispute log + manager resolution → append-only ScoreOverride (spec §6). */

import { esc } from "./shared.js";
import {
  appendScoreOverride,
  loadScoreOverrides,
  resolveScoreDispute,
} from "./coach/index.js";

export const STORAGE_KEY = "se-score-disputes";

const DISPUTE_CATEGORIES = [
  { value: "score_too_high", label: "Score too high" },
  { value: "score_too_low", label: "Score too low" },
  { value: "wrong_evidence", label: "Wrong evidence cited" },
  { value: "missing_context", label: "Missing context" },
  { value: "other", label: "Other" },
];

let eventsBound = false;

export function loadDisputes() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    return raw ? JSON.parse(raw) : [];
  } catch {
    return [];
  }
}

function saveDisputes(entries) {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(entries.slice(0, 200)));
}

function disputeModalShell() {
  let modal = document.getElementById("score-dispute-modal");
  if (modal) return modal;

  const backdrop = document.createElement("div");
  backdrop.id = "score-dispute-backdrop";
  backdrop.className = "prep-dispute-backdrop";
  backdrop.hidden = true;

  modal = document.createElement("div");
  modal.id = "score-dispute-modal";
  modal.className = "prep-dispute-overlay";
  modal.hidden = true;
  modal.setAttribute("role", "dialog");
  modal.setAttribute("aria-labelledby", "score-dispute-title");
  modal.innerHTML = `
    <div class="prep-dispute-dialog">
      <header class="prep-dispute-header">
        <h2 id="score-dispute-title" class="prep-dispute-title">Dispute a score</h2>
        <button type="button" id="score-dispute-close-x" class="prep-dispute-close-x" aria-label="Close">×</button>
      </header>
      <form id="score-dispute-form" class="prep-dispute-form">
        <p id="score-dispute-context" class="muted"></p>
        <label class="prep-dispute-field" for="score-dispute-category">
          <span class="prep-dispute-label">Issue type</span>
          <select id="score-dispute-category" class="prep-dispute-select" required>
            ${DISPUTE_CATEGORIES.map((c) => `<option value="${esc(c.value)}">${esc(c.label)}</option>`).join("")}
          </select>
        </label>
        <label class="prep-dispute-field" for="score-dispute-note">
          <span class="prep-dispute-label">What should change? (required)</span>
          <textarea id="score-dispute-note" class="prep-dispute-textarea" rows="4" required
            placeholder="Describe why this score or evidence is wrong…"></textarea>
        </label>
        <div class="prep-dispute-actions">
          <button type="button" id="score-dispute-cancel" class="prep-dispute-btn prep-dispute-btn-secondary">Cancel</button>
          <button type="submit" id="score-dispute-submit" class="prep-dispute-btn prep-dispute-btn-primary">Submit dispute</button>
        </div>
        <div id="score-dispute-status" class="dew-status-host" hidden></div>
      </form>
    </div>`;

  document.body.append(backdrop, modal);
  return modal;
}

function managerResolveModalShell() {
  let modal = document.getElementById("score-dispute-resolve-modal");
  if (modal) return modal;

  const backdrop = document.createElement("div");
  backdrop.id = "score-dispute-resolve-backdrop";
  backdrop.className = "prep-dispute-backdrop";
  backdrop.hidden = true;

  modal = document.createElement("div");
  modal.id = "score-dispute-resolve-modal";
  modal.className = "prep-dispute-overlay";
  modal.hidden = true;
  modal.setAttribute("role", "dialog");
  modal.setAttribute("aria-labelledby", "score-dispute-resolve-title");
  modal.innerHTML = `
    <div class="prep-dispute-dialog">
      <header class="prep-dispute-header">
        <h2 id="score-dispute-resolve-title" class="prep-dispute-title">Resolve score dispute</h2>
        <button type="button" id="score-dispute-resolve-close-x" class="prep-dispute-close-x" aria-label="Close">×</button>
      </header>
      <form id="score-dispute-resolve-form" class="prep-dispute-form">
        <p id="score-dispute-resolve-context" class="muted"></p>
        <label class="prep-dispute-field" for="score-dispute-resolve-ruling">
          <span class="prep-dispute-label">Ruling</span>
          <select id="score-dispute-resolve-ruling" class="prep-dispute-select" required>
            <option value="uphold">Uphold original score</option>
            <option value="adjust">Adjust score</option>
          </select>
        </label>
        <label class="prep-dispute-field" for="score-dispute-resolve-grade">
          <span class="prep-dispute-label">Adjusted theme grade (0–10)</span>
          <input id="score-dispute-resolve-grade" class="prep-dispute-select" type="number" min="0" max="10" step="0.5" />
        </label>
        <label class="prep-dispute-field" for="score-dispute-resolve-reason">
          <span class="prep-dispute-label">Calibration reason</span>
          <textarea id="score-dispute-resolve-reason" class="prep-dispute-textarea" rows="3"
            placeholder="Why you upheld or adjusted — visible in future coaching…"></textarea>
        </label>
        <div class="prep-dispute-actions">
          <button type="button" id="score-dispute-resolve-cancel" class="prep-dispute-btn prep-dispute-btn-secondary">Cancel</button>
          <button type="submit" id="score-dispute-resolve-submit" class="prep-dispute-btn prep-dispute-btn-primary">Save ruling</button>
        </div>
        <div id="score-dispute-resolve-status" class="dew-status-host" hidden></div>
      </form>
    </div>`;

  document.body.append(backdrop, modal);
  return modal;
}

function closeModal() {
  document.getElementById("score-dispute-backdrop")?.setAttribute("hidden", "");
  document.getElementById("score-dispute-modal")?.setAttribute("hidden", "");
}

function closeResolveModal() {
  document.getElementById("score-dispute-resolve-backdrop")?.setAttribute("hidden", "");
  document.getElementById("score-dispute-resolve-modal")?.setAttribute("hidden", "");
}

/** @type {{ callId?: string, themeKey?: string, score?: number|null, grade?: number|null, company?: string, scorecardId?: string, scorecardLineId?: string, email?: string }|null} */
let pendingContext = null;

/** @type {string|null} */
let pendingResolveDisputeId = null;

/**
 * @param {{ callId?: string, themeKey?: string, score?: number|null, grade?: number|null, company?: string, scorecardId?: string, scorecardLineId?: string, email?: string }} ctx
 */
export function openScoreDisputeModal(ctx = {}) {
  pendingContext = ctx;
  disputeModalShell();
  const modal = document.getElementById("score-dispute-modal");
  const backdrop = document.getElementById("score-dispute-backdrop");
  const intro = document.getElementById("score-dispute-context");
  const note = document.getElementById("score-dispute-note");
  const cat = document.getElementById("score-dispute-category");
  const status = document.getElementById("score-dispute-status");

  const theme = ctx.themeKey ? ctx.themeKey.replace(/_/g, " ") : "call score";
  const gradeBit =
    ctx.grade != null ? ` · theme ${ctx.grade}/10` : ctx.score != null ? ` · scored ${ctx.score}/100` : "";
  const company = ctx.company ? `${ctx.company} · ` : "";
  if (intro) {
    intro.textContent = `${company}${theme}${gradeBit}. Your manager can review disputes for calibration; future coaching will reflect their ruling.`;
  }
  if (note) note.value = "";
  if (cat) cat.selectedIndex = 0;
  if (status) status.hidden = true;

  modal?.removeAttribute("hidden");
  backdrop?.removeAttribute("hidden");
  note?.focus();
}

/** @param {string} disputeId @param {string} [managerEmail] */
export function openManagerDisputeResolveModal(disputeId, managerEmail = "manager") {
  const dispute = loadDisputes().find((d) => d.id === disputeId);
  if (!dispute) return;
  pendingResolveDisputeId = disputeId;
  managerResolveModalShell();

  const modal = document.getElementById("score-dispute-resolve-modal");
  const backdrop = document.getElementById("score-dispute-resolve-backdrop");
  const intro = document.getElementById("score-dispute-resolve-context");
  const ruling = document.getElementById("score-dispute-resolve-ruling");
  const grade = document.getElementById("score-dispute-resolve-grade");
  const reason = document.getElementById("score-dispute-resolve-reason");
  const status = document.getElementById("score-dispute-resolve-status");

  const theme = dispute.themeKey ? dispute.themeKey.replace(/_/g, " ") : "call score";
  const gradeVal = dispute.grade ?? dispute.score ?? "";
  if (intro) {
    intro.textContent = `${dispute.company ? `${dispute.company} · ` : ""}${theme}${gradeVal !== "" ? ` · ${gradeVal}/10` : ""}. SE note: ${dispute.note}`;
  }
  if (ruling) ruling.value = "uphold";
  if (grade) {
    grade.value = gradeVal !== "" ? String(gradeVal) : "";
    grade.disabled = true;
  }
  if (reason) reason.value = dispute.note || "";
  if (status) status.hidden = true;

  if (modal) modal.dataset.managerEmail = managerEmail;
  modal?.removeAttribute("hidden");
  backdrop?.removeAttribute("hidden");
  ruling?.focus();
}

/**
 * Manager resolves a pending dispute — append-only ScoreOverride when adjusted.
 * @param {string} disputeId
 * @param {{ ruling: 'uphold'|'adjust', managerId?: string, overrideGrade?: number, reason?: string }} opts
 */
export function managerResolveDispute(disputeId, opts) {
  const list = loadDisputes();
  const idx = list.findIndex((d) => d.id === disputeId);
  if (idx < 0) throw new Error(`Dispute not found: ${disputeId}`);
  const dispute = list[idx];
  if (dispute.status && dispute.status !== "pending") {
    throw new Error(`Dispute already resolved: ${dispute.status}`);
  }

  const result = resolveScoreDispute({
    dispute,
    ruling: opts.ruling,
    managerId: opts.managerId || "manager",
    overrideGrade: opts.overrideGrade,
    reason: opts.reason,
  });

  list[idx] = result.dispute;
  saveDisputes(list);

  if (result.override) {
    appendScoreOverride(result.override);
    console.info("[score-override]", result.override.id, result.override.callId, result.override.scorecardLineId);
  }

  return result;
}

export function listPendingDisputes() {
  return loadDisputes().filter((d) => !d.status || d.status === "pending");
}

async function submitDispute(ev) {
  ev.preventDefault();
  const noteEl = document.getElementById("score-dispute-note");
  const catEl = document.getElementById("score-dispute-category");
  const status = document.getElementById("score-dispute-status");
  const submitBtn = document.getElementById("score-dispute-submit");
  const note = String(noteEl?.value || "").trim();
  const category = catEl?.value || "other";
  if (!note) return;

  submitBtn && (submitBtn.disabled = true);
  const entry = {
    id: `sd_${Date.now()}`,
    createdAt: new Date().toISOString(),
    category,
    categoryLabel: DISPUTE_CATEGORIES.find((c) => c.value === category)?.label || category,
    note,
    status: "pending",
    grade: pendingContext?.grade ?? null,
    scorecardId: pendingContext?.scorecardId || "",
    scorecardLineId: pendingContext?.scorecardLineId || "",
    ...pendingContext,
  };
  const list = loadDisputes();
  list.unshift(entry);
  saveDisputes(list);
  console.info("[se-score-dispute]", entry.id, entry.categoryLabel, entry.callId, entry.themeKey);

  if (status) {
    status.hidden = false;
    status.textContent = "Dispute logged. Thank you — your manager can review it for calibration.";
  }
  window.setTimeout(() => {
    submitBtn && (submitBtn.disabled = false);
    closeModal();
    pendingContext = null;
  }, 900);
}

async function submitManagerResolve(ev) {
  ev.preventDefault();
  if (!pendingResolveDisputeId) return;

  const rulingEl = document.getElementById("score-dispute-resolve-ruling");
  const gradeEl = document.getElementById("score-dispute-resolve-grade");
  const reasonEl = document.getElementById("score-dispute-resolve-reason");
  const status = document.getElementById("score-dispute-resolve-status");
  const submitBtn = document.getElementById("score-dispute-resolve-submit");
  const modal = document.getElementById("score-dispute-resolve-modal");

  const ruling = rulingEl?.value === "adjust" ? "adjust" : "uphold";
  const overrideGrade =
    ruling === "adjust" && gradeEl?.value !== "" ? Number(gradeEl.value) : undefined;
  const reason = String(reasonEl?.value || "").trim();

  submitBtn && (submitBtn.disabled = true);
  try {
    managerResolveDispute(pendingResolveDisputeId, {
      ruling,
      managerId: modal?.dataset.managerEmail || "manager",
      overrideGrade,
      reason,
    });
    if (status) {
      status.hidden = false;
      status.textContent =
        ruling === "adjust"
          ? "Score adjusted — ScoreOverride logged; future coaching will reflect this."
          : "Dispute upheld — original score stands.";
    }
    window.setTimeout(() => {
      submitBtn && (submitBtn.disabled = false);
      closeResolveModal();
      pendingResolveDisputeId = null;
    }, 900);
  } catch (err) {
    submitBtn && (submitBtn.disabled = false);
    if (status) {
      status.hidden = false;
      status.textContent = err?.message || "Could not save ruling.";
    }
  }
}

function bindGlobalEvents() {
  if (eventsBound) return;
  eventsBound = true;

  document.addEventListener("submit", (ev) => {
    if (ev.target?.id === "score-dispute-form") void submitDispute(ev);
    if (ev.target?.id === "score-dispute-resolve-form") void submitManagerResolve(ev);
  });

  document.addEventListener("change", (ev) => {
    const t = ev.target;
    if (!(t instanceof Element)) return;
    if (t.id === "score-dispute-resolve-ruling") {
      const grade = document.getElementById("score-dispute-resolve-grade");
      if (grade) grade.disabled = t.value !== "adjust";
    }
  });

  document.addEventListener("click", (ev) => {
    const t = ev.target;
    if (!(t instanceof Element)) return;
    if (t.id === "score-dispute-cancel" || t.id === "score-dispute-close-x" || t.id === "score-dispute-backdrop") {
      closeModal();
    }
    if (
      t.id === "score-dispute-resolve-cancel" ||
      t.id === "score-dispute-resolve-close-x" ||
      t.id === "score-dispute-resolve-backdrop"
    ) {
      closeResolveModal();
    }
  });
}

/**
 * @param {ParentNode} root
 * @param {string} [email]
 */
export function wireScoreDisputes(root, email = "") {
  bindGlobalEvents();
  root.querySelectorAll(".score-dispute-trigger").forEach((btn) => {
    btn.addEventListener("click", (ev) => {
      ev.preventDefault();
      ev.stopPropagation();
      openScoreDisputeModal({
        callId: btn.dataset.callId || btn.dataset.disputeCallId || "",
        themeKey: btn.dataset.themeKey || btn.dataset.disputeTheme || "",
        score: btn.dataset.score != null && btn.dataset.score !== "" ? Number(btn.dataset.score) : null,
        grade:
          btn.dataset.grade != null && btn.dataset.grade !== ""
            ? Number(btn.dataset.grade)
            : btn.dataset.score != null && btn.dataset.score !== "" && Number(btn.dataset.score) <= 10
              ? Number(btn.dataset.score)
              : null,
        company: btn.dataset.company || "",
        scorecardId: btn.dataset.scorecardId || "",
        scorecardLineId: btn.dataset.scorecardLineId || "",
        email,
      });
    });
  });

  root.querySelectorAll(".score-dispute-resolve-trigger").forEach((btn) => {
    btn.addEventListener("click", (ev) => {
      ev.preventDefault();
      ev.stopPropagation();
      openManagerDisputeResolveModal(btn.dataset.disputeId || "", email || btn.dataset.managerEmail || "manager");
    });
  });
}

export { loadScoreOverrides };
