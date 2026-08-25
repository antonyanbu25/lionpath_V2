/** Sidebar feedback. Optimistic local queue + worker/Freshdesk ticket sync. */

import { readFieldValueAsync, setButtonLoading, setFieldError, showInlineStatus } from "./crayons-ui.js";
import { newId } from "./domain/types.js";

const STORAGE_KEY = "lionpath_feedback";
export const PULSE_COUNT_KEY = "lionpath_feedback_pulse_count";
const MAX_ATTACHMENT_BYTES = 8 * 1024 * 1024;

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

async function fileToBase64Payload(file) {
  const buf = await file.arrayBuffer();
  const bytes = new Uint8Array(buf);
  let binary = "";
  const chunk = 0x8000;
  for (let i = 0; i < bytes.length; i += chunk) {
    binary += String.fromCharCode(...bytes.subarray(i, i + chunk));
  }
  return {
    name: file.name || "screenshot.png",
    contentType: file.type || "application/octet-stream",
    base64: btoa(binary),
  };
}

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

async function postEntry(entry, attachment = null) {
  if (!feedbackDeps.workerUrl) return null;
  const headers = { "Content-Type": "application/json" };
  const token = await feedbackDeps.getToken();
  if (token) headers.Authorization = `Bearer ${token}`;
  const email = feedbackDeps.getEmail() || entry.email || "anonymous";
  const payload = { email, entry };
  if (attachment) {
    payload.attachmentBase64 = attachment.base64;
    payload.attachmentFilename = attachment.name;
    payload.attachmentContentType = attachment.contentType;
  }
  const response = await fetch(`${feedbackDeps.workerUrl}/api/feedback`, {
    method: "POST",
    headers,
    body: JSON.stringify(payload),
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(data.error || `Server error (${response.status})`);
  return data;
}

function updateQueuedEntry(id, patch) {
  const queue = loadQueue();
  const saved = queue.find((item) => item.id === id);
  if (saved) {
    Object.assign(saved, patch);
    saveQueue(queue);
  }
}

function markSynced(id, data) {
  const ticketId = data?.ticketId ?? data?.freshdeskTicketId;
  updateQueuedEntry(id, {
    synced: true,
    ...(ticketId ? { ticketId } : {}),
  });
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

/**
 * Fire-and-forget manager dispute email via worker.
 * Soft-fails: returns { sent: false } on any error; never throws.
 *
 * @param {{
 *   workerUrl?: string,
 *   getToken?: () => Promise<string|null|undefined>,
 *   email?: string,
 *   to: string,
 *   toName?: string,
 *   seName?: string,
 *   callTitle?: string,
 *   category?: string,
 *   note?: string,
 *   link?: string,
 *   via?: string|null,
 * }} opts
 * @returns {Promise<{ sent: boolean, via: string|null }>}
 */
export async function notifyManagerOfDispute(opts = {}) {
  const workerUrl = String(opts.workerUrl || "").replace(/\/$/, "");
  if (!workerUrl || !opts.to) {
    return { sent: false, via: null };
  }

  try {
    const headers = { "Content-Type": "application/json" };
    const token = typeof opts.getToken === "function" ? await opts.getToken() : null;
    if (token) headers.Authorization = `Bearer ${token}`;

    const res = await fetch(`${workerUrl}/api/disputes/notify`, {
      method: "POST",
      headers,
      body: JSON.stringify({
        email: opts.email || "",
        to: opts.to,
        toName: opts.toName || "",
        seName: opts.seName || "",
        callTitle: opts.callTitle || "",
        category: opts.category || "",
        note: opts.note || "",
        link: opts.link || "",
        via: opts.via || null,
      }),
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) {
      console.warn("[dispute-notify] worker error:", data.error || res.status);
      return { sent: false, via: opts.via || null };
    }
    return { sent: !!data.sent, via: data.via ?? opts.via ?? null };
  } catch (err) {
    console.warn("[dispute-notify] failed:", err?.message || err);
    return { sent: false, via: opts.via || null };
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
  let inFlight = false;

  const showMsg = (text, ok = true) => {
    showInlineStatus(msg, {
      type: ok ? "success" : "error",
      message: text,
      open: !!text,
    });
  };

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
    const shot = document.getElementById("feedback-screenshot");
    if (shot) shot.value = "";
    if (textarea) {
      textarea.value = "";
      if (typeof textarea.setFocus === "function") textarea.setFocus();
    }
  };

  const submitFeedback = async (event) => {
    event?.preventDefault?.();
    event?.stopPropagation?.();
    if (inFlight) return;
    inFlight = true;

    try {
      const textEl = document.getElementById("feedback-text");
      const [categoryKeyRaw, severityKey, areaKey, priorityRaw, rawMessage] = await Promise.all([
        readFieldValueAsync(document.getElementById("feedback-category")),
        readFieldValueAsync(document.getElementById("feedback-severity")),
        readFieldValueAsync(document.getElementById("feedback-area")),
        readFieldValueAsync(document.getElementById("feedback-priority")),
        readFieldValueAsync(textEl),
      ]);
      const categoryKey = categoryKeyRaw || "idea";
      const priority = String(priorityRaw || "");
      const message = String(rawMessage || "").trim();
      if (!message) {
        setFieldError(textEl, "Please enter your feedback.");
        showMsg("Please enter your feedback.", false);
        return;
      }
      setFieldError(textEl);
      const shotEl = document.getElementById("feedback-screenshot");
      const file = shotEl?.files?.[0] || null;
      if (file && file.size > MAX_ATTACHMENT_BYTES) {
        showMsg("Screenshot is too large (max 8MB).", false);
        return;
      }
      const attachment = file && file.size > 0 ? await fileToBase64Payload(file) : null;
      setButtonLoading(submitBtn, true);
      const email = feedbackDeps.getEmail() || "anonymous";
      const context = lastPageContext || capturePageContext();
      const category = CATEGORY_MAP[categoryKey] || "Idea";
      const entry = {
        id: newId("event"),
        category,
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
      form.classList.add("feedback-submit-success");

      const ticket = await postEntry(entry, attachment);
      markSynced(entry.id, ticket);
      showMsg(ticket?.ticketId ? `Thanks. Ticket #${ticket.ticketId} was created.` : "Thanks. Your feedback was saved.");
      setTimeout(close, ticket?.ticketId ? 1400 : 1200);
    } catch (err) {
      showMsg(err?.message || "Could not create ticket. Saved locally.", false);
    } finally {
      setButtonLoading(submitBtn, false);
      inFlight = false;
    }
  };

  btn.addEventListener("fwClick", open);
  closeBtn?.addEventListener("fwClick", close);
  modal.addEventListener("fwClose", close);
  form.addEventListener("submit", (event) => void submitFeedback(event));
  submitBtn?.addEventListener("fwClick", (event) => void submitFeedback(event));
  return { CATEGORY_MAP };
}
