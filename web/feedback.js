/** Sidebar feedback. Creates a Freshdesk ticket (type Feedback) + local queue mirror. */

import {
  readFieldValueAsync,
  setButtonLoading,
  setFieldError,
  showInlineStatus,
} from "./crayons-ui.js";
import { newId } from "./domain/types.js";
import { createSupportTicket } from "./support-tickets.js";

const STORAGE_KEY = "lionpath_feedback";

const CATEGORY_MAP = {
  bug: "Bug",
  idea: "Idea",
  data: "Data quality",
};

function loadQueue() {
  try {
    return JSON.parse(localStorage.getItem(STORAGE_KEY) || "[]");
  } catch {
    return [];
  }
}

function saveQueue(list) {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(list.slice(0, 50)));
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
  const btn = document.getElementById("sidebar-feedback") || document.getElementById("sidebar-feedback-btn");
  const modal = document.getElementById("feedback-modal");
  const form = document.getElementById("feedback-form");
  const msg = document.getElementById("feedback-status");
  const closeBtn = document.getElementById("feedback-close");
  const submitBtn = document.getElementById("feedback-submit");
  const workerUrl = deps.workerUrl || "";
  const getEmail = typeof deps.getEmail === "function" ? deps.getEmail : () => "";
  const getToken = typeof deps.getToken === "function" ? deps.getToken : async () => null;

  if (!btn || !modal || !form) return;

  const showMsg = (text, ok = true) => {
    showInlineStatus(msg, {
      type: ok ? "success" : "error",
      message: text,
      open: !!text,
    });
  };

  const open = () => {
    modal.isOpen = true;
    showMsg("");
    const ta = document.getElementById("feedback-text");
    const shot = document.getElementById("feedback-screenshot");
    if (shot) shot.value = "";
    if (ta) {
      ta.value = "";
      if (typeof ta.setFocus === "function") ta.setFocus();
    }
  };

  const close = () => {
    modal.isOpen = false;
    showMsg("");
  };

  const submitFeedback = async (e) => {
    e?.preventDefault?.();
    e?.stopPropagation?.();

    const textEl = document.getElementById("feedback-text");
    const catEl = document.getElementById("feedback-category");
    const shotEl = document.getElementById("feedback-screenshot");
    const rawCat = await readFieldValueAsync(catEl);
    const message = (await readFieldValueAsync(textEl)).trim();
    const categoryKey = rawCat || "idea";
    const category = CATEGORY_MAP[categoryKey] || "Idea";
    const file = shotEl?.files?.[0] || null;

    if (!message) {
      setFieldError(textEl, "Please enter your feedback.");
      showMsg("Please enter your feedback.", false);
      return;
    }
    setFieldError(textEl);
    setButtonLoading(submitBtn, true);

    const email = getEmail() || "";
    const entry = {
      id: newId("event"),
      category,
      message: message.slice(0, 4000),
      page: location.hash || location.pathname,
      createdAt: Date.now(),
    };

    if (!workerUrl) {
      showMsg("Feedback service is not configured.", false);
      setButtonLoading(submitBtn, false);
      return;
    }

    try {
      const ticket = await createSupportTicket({
        workerUrl,
        getToken,
        email,
        kind: "feedback",
        description: message,
        category,
        page: entry.page,
        link: location.href,
        attachment: file,
      });

      const queue = loadQueue();
      queue.unshift({ ...entry, email, freshdeskTicketId: ticket.ticketId });
      saveQueue(queue);

      showMsg(`Thanks. Ticket #${ticket.ticketId} was created.`);
      setButtonLoading(submitBtn, false);
      setTimeout(close, 1400);
    } catch (err) {
      // Soft fallback: keep local queue when Freshdesk is down.
      const queue = loadQueue();
      queue.unshift({ ...entry, email: email || "anonymous" });
      saveQueue(queue);
      showMsg(err?.message || "Could not create ticket. Saved locally.", false);
      setButtonLoading(submitBtn, false);
    }
  };

  btn.addEventListener("fwClick", open);
  closeBtn?.addEventListener("fwClick", close);
  modal.addEventListener("fwClose", close);
  form.addEventListener("submit", (e) => void submitFeedback(e));
  submitBtn?.addEventListener("fwClick", (e) => void submitFeedback(e));

  return { CATEGORY_MAP };
}
