/** Shared Freshworks Crayons helpers for the SE portal. */

import { createThinkingOrb, renderLoadingPanel as renderOrbLoadingPanel } from "./thinking-orb.js";

export { renderOrbLoadingPanel as renderLoadingPanel };

/**
 * fw-input/fw-textarea's internal .field-control is display:block sized to
 * its own intrinsic content — it doesn't stretch to fill a host that's been
 * resized via CSS (host width/height changes, .field-control doesn't
 * follow). This shows up as a narrow, short input box floating inside a
 * much larger invisible host. This version's Crayons build also doesn't
 * expose a `part="input"` for `::part(input)` overrides to land on, so the
 * only way in is a shadow-root style injection.
 * @param {HTMLElement} el
 */
export function fillShadowField(el) {
  const apply = () => {
    const root = el.shadowRoot;
    if (!root || root.querySelector("style[data-fill-field]")) return;
    const style = document.createElement("style");
    style.setAttribute("data-fill-field", "");
    style.textContent = ".field-control{width:100%!important;height:100%!important;box-sizing:border-box!important;}";
    root.appendChild(style);
  };
  const tryApply = () => {
    if (el.shadowRoot) apply();
  };
  tryApply();
  if (typeof el.componentOnReady === "function") el.componentOnReady().then(tryApply);
  // Crayons can re-render the shadow tree (e.g. a later hydration pass)
  // after componentOnReady() has already resolved, silently discarding the
  // injected <style> along with everything else. Keep re-applying it for
  // as long as the element exists, so a slow/late re-render can't leave the
  // field visibly unsized.
  const observer = new MutationObserver(tryApply);
  const observeRoot = () => {
    if (el.shadowRoot) {
      observer.observe(el.shadowRoot, { childList: true });
    } else {
      requestAnimationFrame(observeRoot);
    }
  };
  observeRoot();
}

/**
 * fw-tabs's shadow .tabs div doesn't constrain its height (no overflow/min-height),
 * so panels overflow the container and the scrollbar appears/disappears.
 * Inject style into the shadow root to constrain .tabs and make the default slot
 * fill remaining space.
 * @param {HTMLElement} el the <fw-tabs> element
 */
export function fillShadowTabs(el) {
  const CSS = ".tabs{overflow:hidden!important;min-height:0!important;}" +
    ".tabs>slot:not([name]){flex:1!important;min-height:0!important;display:flex!important;flex-direction:column!important;}" +
    ".tabs>slot:not([name])::slotted(*){flex:1!important;min-height:0!important;}";
  const apply = () => {
    const root = el.shadowRoot;
    if (!root || root.querySelector("style[data-fill-tabs]")) return;
    const style = document.createElement("style");
    style.setAttribute("data-fill-tabs", "");
    style.textContent = CSS;
    root.appendChild(style);
  };
  const tryApply = () => {
    if (el.shadowRoot) apply();
  };
  tryApply();
  if (typeof el.componentOnReady === "function") el.componentOnReady().then(tryApply);
  const observer = new MutationObserver(tryApply);
  const observeRoot = () => {
    if (el.shadowRoot) {
      observer.observe(el.shadowRoot, { childList: true });
    } else {
      requestAnimationFrame(observeRoot);
    }
  };
  observeRoot();
}

/**
 * Crayons fw-input can show text in the shadow native control while `el.value`
 * is still empty (autofill, readOnly anti-autofill, or a re-render race). Sync
 * shadow → host before reading so submit and gating see the same value as CRM.
 * @param {HTMLElement | null | undefined} el
 */
export function syncFieldValueFromShadow(el) {
  if (!el?.shadowRoot) return;
  const tag = String(el.tagName || "").toLowerCase();
  if (tag !== "fw-input" && tag !== "fw-textarea") return;
  const inner = el.shadowRoot.querySelector("input, textarea");
  if (!inner) return;
  const innerVal = String(inner.value ?? "");
  const hostVal = el.value != null ? String(el.value) : "";
  if (innerVal !== hostVal) {
    try {
      el.value = innerVal;
    } catch {
      /* crayons guard */
    }
  }
}

/** @param {HTMLElement | null | undefined} el */
export function readFieldValue(el) {
  if (!el) return "";
  syncFieldValueFromShadow(el);
  const host = el.value;
  if (host != null && host !== "") return String(host).trim();
  const inner = el.shadowRoot?.querySelector("input, textarea");
  if (inner?.value != null && inner.value !== "") return String(inner.value).trim();
  return host != null ? String(host).trim() : "";
}

/** @param {HTMLElement | null | undefined} el @param {string} value */
export async function setFieldValue(el, value) {
  if (!el) return;
  const str = value != null ? String(value) : "";
  if (typeof el.setValue === "function") {
    try {
      await el.setValue(str);
      return;
    } catch {
      /* fall through */
    }
  }
  el.value = str;
  const inner = el.shadowRoot?.querySelector("input, textarea");
  if (inner) inner.value = str;
}

/** @param {HTMLElement | null | undefined} el */
export async function readFieldValueAsync(el) {
  if (!el) return "";
  syncFieldValueFromShadow(el);
  const tag = String(el.tagName || "").toLowerCase();
  const isTextarea = tag === "fw-textarea";
  const isInput = tag === "fw-input";
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

  if (isInput) {
    const sync = readFieldValue(el);
    if (sync) return sync;
    const fromGet = await readViaGetValue();
    if (fromGet) return fromGet;
    syncFieldValueFromShadow(el);
    return readFieldValue(el);
  }

  const sync = readFieldValue(el);
  if (sync) return sync;
  const fromGet = await readViaGetValue();
  if (fromGet) return fromGet;
  syncFieldValueFromShadow(el);
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
    notice.append(createThinkingOrb({ state: "working", size: 20 }));
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
    // fwClick and native click can arrive in separate tasks; microtask-only dedupe
    // let the second event through (e.g. SSO button needing multiple clicks).
    setTimeout(() => {
      pending = false;
    }, 400);
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

/**
 * @param {ParentNode} root
 * @param {(id: string) => void} onOpen
 * @param {string} [selector]
 */
export function wireCallLinks(
  root,
  onOpen,
  selector = '.dash-call-link:not([data-call-wired="1"]), [data-open-call]:not([data-call-wired="1"])',
) {
  root.querySelectorAll(selector).forEach((btn) => {
    if (btn.getAttribute("data-call-wired") === "1") return;
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
    btn.setAttribute("data-call-wired", "1");
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
