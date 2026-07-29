/** Score dispute log. local calibration feedback (spec §6 / score_overrides precursor). */

import { esc } from "./shared.js";

export const STORAGE_KEY = "se-score-disputes";

const DISPUTE_CATEGORIES = [
  { value: "score_too_high", label: "Score too high" },
  { value: "score_too_low", label: "Score too low" },
  { value: "wrong_evidence", label: "Wrong evidence cited" },
  { value: "missing_context", label: "Missing context" },
  { value: "other", label: "Other" },
];

let eventsBound = false;

function loadDisputes() {
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

function closeModal() {
  document.getElementById("score-dispute-backdrop")?.setAttribute("hidden", "");
  document.getElementById("score-dispute-modal")?.setAttribute("hidden", "");
}

/** @type {{ callId?: string, themeKey?: string, score?: number|null, company?: string }|null} */
let pendingContext = null;

/**
 * @param {{ callId?: string, themeKey?: string, score?: number|null, company?: string }} ctx
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
  const scoreBit = ctx.score != null ? ` · scored ${ctx.score}/100` : "";
  const company = ctx.company ? `${ctx.company} · ` : "";
  if (intro) {
    intro.textContent = `${company}${theme}${scoreBit}. Your manager can review disputes for calibration; this does not change the displayed score yet.`;
  }
  if (note) note.value = "";
  if (cat) cat.selectedIndex = 0;
  if (status) status.hidden = true;

  modal?.removeAttribute("hidden");
  backdrop?.removeAttribute("hidden");
  note?.focus();
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
    ...pendingContext,
  };
  const list = loadDisputes();
  list.unshift(entry);
  saveDisputes(list);
  console.info("[se-score-dispute]", entry.id, entry.categoryLabel, entry.callId, entry.themeKey);

  if (status) {
    status.hidden = false;
    status.textContent = "Dispute logged. Thank you.";
  }
  window.setTimeout(() => {
    submitBtn && (submitBtn.disabled = false);
    closeModal();
    pendingContext = null;
  }, 900);
}

function bindGlobalEvents() {
  if (eventsBound) return;
  eventsBound = true;
  document.addEventListener("submit", (ev) => {
    if (ev.target?.id === "score-dispute-form") void submitDispute(ev);
  });
  document.addEventListener("click", (ev) => {
    const t = ev.target;
    if (!(t instanceof Element)) return;
    if (t.id === "score-dispute-cancel" || t.id === "score-dispute-close-x" || t.id === "score-dispute-backdrop") {
      closeModal();
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
        company: btn.dataset.company || "",
        email,
      });
    });
  });
}
