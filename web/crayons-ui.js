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
  const sync = readFieldValue(el);
  if (sync) return sync;
  if (typeof el.getValue === "function") {
    try {
      const v = await Promise.race([
        el.getValue(),
        new Promise((_, reject) => setTimeout(() => reject(new Error("getValue timeout")), 300)),
      ]);
      if (v != null && v !== "") return String(v).trim();
    } catch {
      // fall through to sync read
    }
  }
  return readFieldValue(el);
}

/** @param {HTMLElement | null | undefined} el @param {string} value */
export function setFieldValue(el, value) {
  if (!el) return;
  const v = String(value ?? "");
  if ("value" in el) el.value = v;
  const inner = el.shadowRoot?.querySelector("input, textarea");
  if (inner) inner.value = v;
}

/** @param {HTMLElement | null | undefined} el @param {string} value */
export async function setFieldValueAsync(el, value) {
  setFieldValue(el, value);
  if (typeof el?.setValue === "function") {
    try {
      await el.setValue(String(value ?? ""));
    } catch {
      // fall back to property set above
    }
  }
}

/** @param {ParentNode | null | undefined} form @param {boolean} disabled */
export function setFormFieldsDisabled(form, disabled) {
  form?.querySelectorAll("fw-input, fw-textarea, fw-button, fw-select").forEach((el) => {
    el.disabled = disabled;
  });
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
    btn.addEventListener("fwClick", () => onOpen?.(id));
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
