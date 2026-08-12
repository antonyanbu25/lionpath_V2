/**
 * Blocking sync modal — neutral user-facing copy ("Update now").
 */

import { needsSyncUpdate, runLocalSync } from "./local-recovery.js";

let overlayEl = null;
let resolveWait = null;

function ensureOverlay() {
  if (overlayEl) return overlayEl;

  overlayEl = document.createElement("div");
  overlayEl.id = "local-sync-overlay";
  overlayEl.className = "local-sync-overlay";
  overlayEl.hidden = true;
  overlayEl.innerHTML = `
    <div class="local-sync-backdrop" aria-hidden="true"></div>
    <div class="local-sync-panel" role="dialog" aria-modal="true" aria-labelledby="local-sync-title">
      <p class="local-sync-eyebrow muted">Portal update</p>
      <h2 id="local-sync-title" class="local-sync-title">Update your call summaries</h2>
      <p id="local-sync-body" class="local-sync-body muted">
        We have recent work on this device to sync with your account. Click update — keep this tab open (~30 seconds).
      </p>
      <p id="local-sync-progress" class="local-sync-progress muted" hidden></p>
      <div class="local-sync-actions">
        <fw-button id="local-sync-primary" color="primary">Update now</fw-button>
      </div>
      <p id="local-sync-done" class="local-sync-done" hidden></p>
    </div>`;

  document.body.appendChild(overlayEl);
  return overlayEl;
}

function setProgress(msg) {
  const el = document.getElementById("local-sync-progress");
  if (!el) return;
  if (msg) {
    el.textContent = msg;
    el.hidden = false;
  } else {
    el.hidden = true;
  }
}

/**
 * @param {object} session
 * @param {{ autoStart?: boolean, force?: boolean }} [opts]
 */
export function showSyncModal(session, opts = {}) {
  const el = ensureOverlay();
  el.hidden = false;
  el.classList.add("local-sync-overlay-active");
  document.body.classList.add("local-sync-lock");

  const primary = document.getElementById("local-sync-primary");
  const done = document.getElementById("local-sync-done");
  const body = document.getElementById("local-sync-body");

  if (done) {
    done.hidden = true;
    done.textContent = "";
  }
  if (body) body.hidden = false;
  setProgress("");

  return new Promise((resolve) => {
    resolveWait = resolve;

    const finish = (result) => {
      document.body.classList.remove("local-sync-lock");
      el.classList.remove("local-sync-overlay-active");
      el.hidden = true;
      resolveWait = null;
      resolve(result);
    };

    const runUpdate = async () => {
      if (primary) {
        primary.setAttribute("loading", "");
        primary.disabled = true;
      }
      if (body) body.hidden = true;

      const result = await runLocalSync(session, {
        force: opts.force === true,
        onProgress: setProgress,
      });

      if (primary) {
        primary.removeAttribute("loading");
        primary.disabled = false;
      }

      if (result.ok) {
        setProgress("");
        if (done) {
          done.hidden = false;
          done.textContent = "You're all set.";
        }
        if (primary) primary.textContent = "Continue";
        primary?.addEventListener(
          "fwClick",
          () => finish(result),
          { once: true },
        );
      } else {
        setProgress("Update didn't finish — try again.");
        if (primary) {
          primary.textContent = "Try again";
          primary.disabled = false;
        }
        primary?.addEventListener(
          "fwClick",
          () => runUpdate(),
          { once: true },
        );
      }
    };

    if (opts.autoStart) {
      void runUpdate();
    } else {
      primary?.addEventListener(
        "fwClick",
        () => runUpdate(),
        { once: true },
      );
    }
  });
}

/**
 * @param {object} session
 * @param {{ force?: boolean }} [opts]
 */
export async function maybeShowSyncOnLogin(session, opts = {}) {
  if (!session?.email) return null;
  try {
    const needed = await needsSyncUpdate(session.email, { force: opts.force });
    if (!needed) return null;
    return showSyncModal(session, { autoStart: false, force: opts.force });
  } catch (err) {
    console.warn("[local-sync] needsSyncUpdate check failed:", err?.message || err);
    return null;
  }
}

/**
 * Manual trigger from Settings.
 * @param {object} session
 */
export async function runManualSync(session) {
  return showSyncModal(session, { autoStart: true, force: true });
}
