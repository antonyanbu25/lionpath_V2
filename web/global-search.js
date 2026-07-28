/**
 * Global search — topbar input + Cmd/Ctrl+K palette.
 */

import { readFieldValueAsync } from "./crayons-ui.js";
import {
  buildSearchIndex,
  searchIndex,
  recentFromIndex,
  invalidateSearchIndex,
} from "./search-service.js";
import { esc } from "./shared.js";

export { invalidateSearchIndex };

const TYPE_LABELS = {
  account: "Accounts",
  brief: "Discovery briefs",
  call: "Call reviews",
};

const TYPE_ORDER = ["account", "brief", "call"];

function isEditableTarget(el) {
  if (!el) return false;
  const tag = el.tagName?.toLowerCase();
  if (tag === "input" || tag === "textarea" || tag === "select") return true;
  return el.isContentEditable;
}

/** @param {object} deps */
export function initGlobalSearch(deps) {
  const topbarInput = document.getElementById("global-search-input");
  const modal = document.getElementById("global-search-modal");
  const paletteInput = document.getElementById("global-search-palette-input");
  const resultsEl = document.getElementById("global-search-results");
  const backdrop = document.getElementById("global-search-backdrop");

  if (!topbarInput || !modal || !paletteInput || !resultsEl) return;

  let highlightIdx = -1;
  let currentResults = [];
  let debounceTimer = null;

  function hidePalette() {
    modal.hidden = true;
    if (backdrop) backdrop.hidden = true;
    highlightIdx = -1;
    currentResults = [];
  }

  function showPalette() {
    modal.hidden = false;
    if (backdrop) backdrop.hidden = false;
    paletteInput.focus?.();
  }

  function selectResult(item) {
    if (!item) return;
    hidePalette();
    topbarInput.value = "";
    paletteInput.value = "";

    if (item.type === "account") {
      deps.switchView?.("accounts", { accountId: item.accountId || item.id });
    } else if (item.type === "brief") {
      deps.openPrepBriefItem?.(item.id);
    } else if (item.type === "call") {
      deps.openHistoryItem?.(item.id);
    }
  }

  function renderResults(results, query) {
    highlightIdx = results.length ? 0 : -1;
    currentResults = results;

    if (!results.length) {
      resultsEl.innerHTML = query
        ? `<p class="global-search-empty muted">No results for “${esc(query)}”</p>`
        : `<p class="global-search-empty muted">Type to search accounts, briefs, and calls</p>`;
      return;
    }

    const grouped = { account: [], brief: [], call: [] };
    for (const item of results) grouped[item.type]?.push(item);

    let idx = 0;
    const sections = TYPE_ORDER.map((type) => {
      const items = grouped[type];
      if (!items?.length) return "";
      const rows = items
        .map((item) => {
          const i = idx++;
          const active = i === highlightIdx ? " global-search-result-active" : "";
          return `<button type="button" class="global-search-result${active}" data-idx="${i}">
            <span class="global-search-result-label">${esc(item.label)}</span>
            <span class="global-search-result-sub muted">${esc(item.subtitle)}</span>
          </button>`;
        })
        .join("");
      return `<div class="global-search-group">
        <h4 class="global-search-group-title">${TYPE_LABELS[type]}</h4>
        ${rows}
      </div>`;
    }).join("");

    resultsEl.innerHTML = sections;

    resultsEl.querySelectorAll(".global-search-result").forEach((btn) => {
      btn.addEventListener("click", () => {
        const i = Number(btn.dataset.idx);
        selectResult(currentResults[i]);
      });
    });
  }

  function updateHighlight() {
    resultsEl.querySelectorAll(".global-search-result").forEach((btn, i) => {
      btn.classList.toggle("global-search-result-active", i === highlightIdx);
    });
    const active = resultsEl.querySelector(".global-search-result-active");
    active?.scrollIntoView({ block: "nearest" });
  }

  async function runSearch(query, { openIfEmpty = false } = {}) {
    const session = deps.getSession?.();
    if (!session) {
      renderResults([], query);
      return;
    }

    const index = await buildSearchIndex(session);
    const trimmed = String(query || "").trim();
    const results = trimmed
      ? searchIndex(index, trimmed, { limit: 12 })
      : recentFromIndex(index, 5);

    renderResults(results, trimmed);
    if (openIfEmpty || trimmed) showPalette();
  }

  function scheduleSearch(query) {
    clearTimeout(debounceTimer);
    debounceTimer = setTimeout(() => {
      void runSearch(query);
    }, 200);
  }

  topbarInput.addEventListener("fwInput", () => {
    void readFieldValueAsync(topbarInput).then((v) => {
      paletteInput.value = v;
      scheduleSearch(v);
    });
  });

  topbarInput.addEventListener("focus", () => {
    void readFieldValueAsync(topbarInput).then((v) => {
      paletteInput.value = v;
      void runSearch(v, { openIfEmpty: true });
    });
  });

  paletteInput.addEventListener("fwInput", () => {
    void readFieldValueAsync(paletteInput).then((v) => {
      topbarInput.value = v;
      scheduleSearch(v);
    });
  });

  paletteInput.addEventListener("input", () => {
    scheduleSearch(paletteInput.value);
  });

  modal.addEventListener("keydown", (ev) => {
    if (ev.key === "ArrowDown") {
      ev.preventDefault();
      if (currentResults.length) {
        highlightIdx = Math.min(highlightIdx + 1, currentResults.length - 1);
        updateHighlight();
      }
    } else if (ev.key === "ArrowUp") {
      ev.preventDefault();
      if (currentResults.length) {
        highlightIdx = Math.max(highlightIdx - 1, 0);
        updateHighlight();
      }
    } else if (ev.key === "Enter") {
      ev.preventDefault();
      if (highlightIdx >= 0 && currentResults[highlightIdx]) {
        selectResult(currentResults[highlightIdx]);
      }
    } else if (ev.key === "Escape") {
      ev.preventDefault();
      hidePalette();
      topbarInput.blur?.();
    }
  });

  backdrop?.addEventListener("click", hidePalette);

  document.addEventListener("keydown", (ev) => {
    if ((ev.metaKey || ev.ctrlKey) && ev.key.toLowerCase() === "k") {
      const active = document.activeElement;
      const inSearch =
        active?.closest?.("#global-search-modal") ||
        active?.id === "global-search-input" ||
        active?.closest?.("fw-input.global-search-input");
      if (isEditableTarget(active) && !inSearch) return;
      ev.preventDefault();
      void readFieldValueAsync(topbarInput).then((v) => {
        paletteInput.value = v;
        void runSearch(v, { openIfEmpty: true });
        showPalette();
        paletteInput.focus?.();
      });
    }
  });

}
