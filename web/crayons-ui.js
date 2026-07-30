/** Shared Freshworks Crayons helpers for the SE portal. */

/** @param {HTMLElement | null | undefined} el */
export function readFieldValue(el) {
  if (!el) return "";
  const host = el.value;
  if (host != null && host !== "") return String(host).trim();
  const inner = el.shadowRoot?.querySelector("input, textarea");
  if (inner?.value != null && inner.value !== "") return String(inner.value).trim();
  return host != null ? String(host).trim() : "";
}

/** @param {HTMLElement | null | undefined} el */
export async function readFieldValueAsync(el) {
  if (!el) return "";
  const tag = String(el.tagName || "").toLowerCase();
  const isTextarea = tag === "fw-textarea";
  const getValueTimeoutMs = isTextarea ? 800 : 300;

  async function readViaGetValue() {
    if (typeof el.getValue !== "function") return "";
    try {
      const v = await Promise.race([
        el.getValue(),
        new Promise((_, reject) => setTimeout(() => reject(new Error("getValue timeout")), getValueTimeoutMs)),
      ]);
      return v != null ? String(v).trim() : "";
    } catch {
      return "";
    }
  }

  // fw-textarea keeps typed text in component state until blur — prefer getValue() first.
  if (isTextarea) {
    const fromGet = await readViaGetValue();
    if (fromGet) return fromGet;
    const sync = readFieldValue(el);
    if (sync) return sync;
    return fromGet;
  }

  const sync = readFieldValue(el);
  if (sync) return sync;
  const fromGet = await readViaGetValue();
  if (fromGet) return fromGet;
  return readFieldValue(el);
}

/** @param {ParentNode | null | undefined} form @param {boolean} disabled */
export function setFormFieldsDisabled(form, disabled) {
  form?.querySelectorAll("fw-input, fw-textarea, fw-button, fw-select").forEach((el) => {
    el.disabled = disabled;
  });
}

/** @param {HTMLElement | null | undefined} host */
export function showInlineStatus(host, options = {}) {
  if (!host) return;
  const { type = "info", message = "", open = true, loading = false } = options;
  host.replaceChildren();
  host.hidden = !open || !message;
  if (host.hidden) return;

  const notice = document.createElement("fw-inline-message");
  notice.type = type;
  notice.open = true;
  notice.closable = false;

  if (loading) {
    const spinner = document.createElement("fw-spinner");
    spinner.size = "small";
    spinner.setAttribute("aria-hidden", "true");
    notice.append(spinner);
  }
  notice.append(document.createTextNode(message));
  host.append(notice);
}

/** @param {HTMLElement | null | undefined} button @param {boolean} loading */
export function setButtonLoading(button, loading) {
  if (!button) return;
  button.loading = loading;
  button.disabled = loading;
}

/**
 * Crayons buttons emit both `fwClick` and a bubbled native `click` for one physical gesture.
 * Binding a handler to both (for compatibility) makes it run twice per click unless deduped.
 * @param {HTMLElement | null | undefined} el
 * @param {(ev: Event) => void} handler
 */
export function bindActionOnce(el, handler) {
  if (!el) return;
  let pending = false;
  const wrapped = (ev) => {
    if (pending) return;
    pending = true;
    queueMicrotask(() => {
      pending = false;
    });
    handler(ev);
  };
  el.addEventListener("fwClick", wrapped);
  el.addEventListener("click", wrapped);
}

/** @param {HTMLElement | null | undefined} field @param {string} message */
export function setFieldError(field, message = "") {
  if (!field) return;
  field.state = message ? "error" : "normal";
  field.errorText = message;
}

/** @param {string} message */
export function renderLoadingPanel(message = "Loading…") {
  const safe = String(message).replace(/[&<>"']/g, (char) =>
    ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[char]);
  return `<div class="dew-loading-panel" role="status" aria-live="polite">
    <fw-spinner size="medium"></fw-spinner>
    <span class="muted">${safe}</span>
  </div>`;
}

/**
 * @param {ParentNode} root
 * @param {(id: string) => void} onOpen
 * @param {string} [selector]
 */
export function wireCallLinks(root, onOpen, selector = ".dash-call-link, [data-open-call]") {
  root.querySelectorAll(selector).forEach((btn) => {
    const id = btn.dataset.callId || btn.dataset.openCall || btn.dataset.id;
    if (!id) return;
    const handler = () => {
      onOpen?.(id, {
        tab: btn.dataset.callTab || undefined,
        expandTheme: btn.dataset.expandTheme || undefined,
        ownerEmail: btn.dataset.callOwner || undefined,
      });
    };
    btn.addEventListener("click", handler);
    btn.addEventListener("fwClick", handler);
  });
}

/**
 * @param {ParentNode} root
 * @param {Record<string, () => void>} handlers keyed by element id
 */
export function wireToolbarById(root, handlers) {
  Object.entries(handlers).forEach(([id, fn]) => {
    root.querySelector(`#${CSS.escape(id)}`)?.addEventListener("fwClick", fn);
  });
}

/** @param {ParentNode} root */
export function wirePrintToolbar(root) {
  root.querySelector("#toolbar-print, [data-toolbar-print]")?.addEventListener("fwClick", () => {
    window.print();
  });
}
