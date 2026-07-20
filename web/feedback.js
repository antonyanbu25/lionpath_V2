/** Sidebar feedback — local queue + worker POST /api/feedback. */

import {
  readFieldValueAsync,
  setButtonLoading,
  setFieldError,
  showInlineStatus,
} from "./crayons-ui.js";
import { newId } from "./domain/types.js";

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
    const rawCat = await readFieldValueAsync(catEl);
    const message = (await readFieldValueAsync(textEl)).trim();
    const categoryKey = rawCat || "idea";
    const category = CATEGORY_MAP[categoryKey] || "Idea";

    if (!message) {
      setFieldError(textEl, "Please enter your feedback.");
      showMsg("Please enter your feedback.", false);
      return;
    }
    setFieldError(textEl);
    setButtonLoading(submitBtn, true);

    const email = getEmail() || "anonymous";
    const entry = {
      id: newId("event"),
      category,
      message: message.slice(0, 4000),
      page: location.hash || location.pathname,
      createdAt: Date.now(),
    };

    const queue = loadQueue();
    queue.unshift({ ...entry, email });
    saveQueue(queue);

    if (workerUrl) {
      try {
        const headers = { "Content-Type": "application/json" };
        const token = await getToken();
        if (token) headers.Authorization = `Bearer ${token}`;
        const res = await fetch(`${workerUrl}/api/feedback`, {
          method: "POST",
          headers,
          body: JSON.stringify({ email, entry }),
        });
        const data = await res.json().catch(() => ({}));
        if (!res.ok) throw new Error(data.error || `Server error (${res.status})`);
      } catch (err) {
        showMsg(
          `Saved locally. Server sync failed: ${err.message || "offline"}.`,
          false,
        );
        setTimeout(close, 2500);
        setButtonLoading(submitBtn, false);
        return;
      }
    }

    showMsg("Thanks — your feedback was saved.");
    setButtonLoading(submitBtn, false);
    setTimeout(close, 1200);
  };

  btn.addEventListener("fwClick", open);
  closeBtn?.addEventListener("fwClick", close);
  modal.addEventListener("fwClose", close);
  form.addEventListener("submit", (e) => void submitFeedback(e));
  submitBtn?.addEventListener("fwClick", (e) => void submitFeedback(e));

  return { CATEGORY_MAP };
}
