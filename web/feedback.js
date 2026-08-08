/** Sidebar feedback. Optimistic local queue + worker POST /api/feedback. */

import { readFieldValueAsync, setButtonLoading, setFieldError, showInlineStatus } from "./crayons-ui.js";
import { newId } from "./domain/types.js";

const STORAGE_KEY = "lionpath_feedback";
export const PULSE_COUNT_KEY = "lionpath_feedback_pulse_count";

const CATEGORY_MAP = { bug: "Bug", idea: "Idea", data: "Data quality", other: "Other" };
export const SEVERITY_MAP = {
  critical: "Critical — blocking work",
  high: "High — workable but painful",
  general: "General — improvement",
  minor: "Minor — nice to have",
};
export const AREA_MAP = {
  "pre-call-prep": "Pre-call prep",
  "post-call-analysis": "Post-call analysis",
  dashboard: "Dashboard",
  "accounts-deals": "Accounts & deals",
  "coaching-scorecards": "Coaching / scorecards",
  search: "Search",
  "ui-visual": "UI / visual",
  "performance-speed": "Performance / speed",
  other: "Other",
};

let feedbackDeps = { workerUrl: "", getEmail: () => "", getToken: async () => null };
let lastPageContext = null;

function loadQueue() {
  try {
    const value = JSON.parse(localStorage.getItem(STORAGE_KEY) || "[]");
    return Array.isArray(value) ? value : [];
  } catch {
    return [];
  }
}

function saveQueue(list) {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(list.slice(0, 50)));
}

export function capturePageContext() {
  const hash = location.hash || "";
  const path = hash.replace(/^#\/?/, "").split(/[?&]/)[0];
  const parts = path.split("/").filter(Boolean).map(decodeURIComponent);
  const context = { hash, callId: "", dealId: "", accountId: "", view: parts[0] || "dashboard" };
  if (parts[0] === "calls" && parts[1]) context.callId = parts[1];
  if (parts[0] === "deals" && parts[1]) context.dealId = parts[1];
  if (parts[0] === "accounts" && parts[1]) {
    context.accountId = parts[1];
    if (parts[2] === "deals" && parts[3]) context.dealId = parts[3];
  }
  return context;
}

export function bumpFeedbackPulse() {
  const next = (Number.parseInt(localStorage.getItem(PULSE_COUNT_KEY) || "0", 10) || 0) + 1;
  localStorage.setItem(PULSE_COUNT_KEY, String(next));
  if (next >= 3) document.getElementById("sidebar-feedback")?.classList.add("sidebar-feedback-pulse");
}

async function postEntry(entry) {
  if (!feedbackDeps.workerUrl) return null;
  const headers = { "Content-Type": "application/json" };
  const token = await feedbackDeps.getToken();
  if (token) headers.Authorization = `Bearer ${token}`;
  const email = feedbackDeps.getEmail() || entry.email || "anonymous";
  const response = await fetch(`${feedbackDeps.workerUrl}/api/feedback`, {
    method: "POST",
    headers,
    body: JSON.stringify({ email, entry }),
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(data.error || `Server error (${response.status})`);
  return data;
}

function markSynced(id, data) {
  const queue = loadQueue();
  const saved = queue.find((item) => item.id === id);
  if (saved) {
    saved.synced = true;
    saved.ticketId = data?.ticketId ?? null;
    saveQueue(queue);
  }
}

export async function syncPendingFeedback() {
  if (!feedbackDeps.workerUrl) return;
  for (const entry of loadQueue().filter((item) => !item.synced)) {
    try {
      markSynced(entry.id, await postEntry(entry));
    } catch (err) {
      console.warn("[feedback] pending sync failed:", err?.message || err);
    }
  }
}

export function initFeedback(deps = {}) {
  feedbackDeps = {
    workerUrl: deps.workerUrl || "",
    getEmail: typeof deps.getEmail === "function" ? deps.getEmail : () => "",
    getToken: typeof deps.getToken === "function" ? deps.getToken : async () => null,
  };
  const btn = document.getElementById("sidebar-feedback") || document.getElementById("sidebar-feedback-btn");
  const modal = document.getElementById("feedback-modal");
  const form = document.getElementById("feedback-form");
  const msg = document.getElementById("feedback-status");
  const closeBtn = document.getElementById("feedback-close");
  const submitBtn = document.getElementById("feedback-submit");
  if (!btn || !modal || !form) return;

  const showMsg = (text, ok = true) => showInlineStatus(msg, {
    type: ok ? "success" : "error", message: text, open: !!text,
  });
  const close = () => {
    modal.classList.remove("feedback-open");
    modal.isOpen = false;
    showMsg("");
  };
  const open = () => {
    lastPageContext = capturePageContext();
    localStorage.setItem(PULSE_COUNT_KEY, "0");
    btn.classList.remove("sidebar-feedback-pulse");
    modal.isOpen = true;
    modal.classList.add("feedback-open");
    form.classList.remove("feedback-submit-success");
    showMsg("");
    const textarea = document.getElementById("feedback-text");
    if (textarea) {
      textarea.value = "";
      if (typeof textarea.setFocus === "function") textarea.setFocus();
    }
  };

  const submitFeedback = async (event) => {
    event?.preventDefault?.();
    event?.stopPropagation?.();
    const textEl = document.getElementById("feedback-text");
    const [categoryKey, severityKey, areaKey, priority, rawMessage] = await Promise.all([
      readFieldValueAsync(document.getElementById("feedback-category")),
      readFieldValueAsync(document.getElementById("feedback-severity")),
      readFieldValueAsync(document.getElementById("feedback-area")),
      readFieldValueAsync(document.getElementById("feedback-priority")),
      readFieldValueAsync(textEl),
    ]);
    const message = rawMessage.trim();
    if (!message) {
      setFieldError(textEl, "Please enter your feedback.");
      showMsg("Please enter your feedback.", false);
      return;
    }
    setFieldError(textEl);
    setButtonLoading(submitBtn, true);
    const email = feedbackDeps.getEmail() || "anonymous";
    const context = lastPageContext || capturePageContext();
    const entry = {
      id: newId("event"),
      category: CATEGORY_MAP[categoryKey] || "Idea",
      severity: SEVERITY_MAP[severityKey] || SEVERITY_MAP.general,
      area: AREA_MAP[areaKey] || AREA_MAP.other,
      priority: ["1", "2", "3", "4"].includes(priority) ? priority : "2",
      message: message.slice(0, 4000),
      page: context.hash || location.pathname,
      context,
      email,
      createdAt: Date.now(),
      synced: false,
    };
    saveQueue([entry, ...loadQueue().filter((item) => item.id !== entry.id)]);
    showMsg("Thanks. Your feedback was saved.");
    form.classList.add("feedback-submit-success");
    setButtonLoading(submitBtn, false);
    setTimeout(close, 1200);
    void postEntry(entry).then((data) => markSynced(entry.id, data)).catch((err) => {
      console.warn("[feedback] server sync failed:", err?.message || err);
    });
  };

  btn.addEventListener("fwClick", open);
  closeBtn?.addEventListener("fwClick", close);
  modal.addEventListener("fwClose", close);
  form.addEventListener("submit", (event) => void submitFeedback(event));
  submitBtn?.addEventListener("fwClick", (event) => void submitFeedback(event));
  return { CATEGORY_MAP };
}
