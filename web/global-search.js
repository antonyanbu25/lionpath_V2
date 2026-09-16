/**
 * Global search — Freshdesk Omni Search inspired palette with RAG rerank.
 */

import { readFieldValueAsync, fillShadowField } from "./crayons-ui.js";
import { withEffectiveUserId } from "./domain/session.js";
import {
  buildSearchIndex,
  getCachedSearchIndex,
  getSearchIndexStats,
  searchIndex,
  rerankWithRag,
  recentFromIndex,
  invalidateSearchIndex,
  SEARCH_TYPES,
} from "./search-service.js?v=2.1.14";
import { esc } from "./shared.js";

export { invalidateSearchIndex };

/** Prefetch index after login or data change — fire-and-forget. */
export function warmSearchIndex(getSessionFn) {
  const session = withEffectiveUserId(getSessionFn?.());
  if (!session?.email) return;
  void buildSearchIndex(session);
}

const TYPE_LABELS = {
  account: "Accounts",
  contact: "Contacts",
  deal: "Deals",
  brief: "Briefs",
  call: "Calls",
  task: "Tasks",
};

const TYPE_ICONS = {
  account: `<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true"><path d="M3 21h18M5 21V7l7-4 7 4v14"/><path d="M9 21v-6h6v6"/></svg>`,
  contact: `<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true"><circle cx="12" cy="8" r="4"/><path d="M4 20c0-4 4-6 8-6s8 2 8 6"/></svg>`,
  deal: `<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true"><path d="M12 2v20M17 5H9.5a3.5 3.5 0 0 0 0 7h5a3.5 3.5 0 0 1 0 7H6"/></svg>`,
  brief: `<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><path d="M14 2v6h6M8 13h8M8 17h5"/></svg>`,
  call: `<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true"><path d="M22 16.92v3a2 2 0 0 1-2.18 2 19.79 19.79 0 0 1-8.63-3.07 19.5 19.5 0 0 1-6-6 19.79 19.79 0 0 1-3.07-8.67A2 2 0 0 1 4.11 2h3a2 2 0 0 1 2 1.72c.127.96.361 1.903.7 2.81a2 2 0 0 1-.45 2.11L8.09 9.91a16 16 0 0 0 6 6l1.27-1.27a2 2 0 0 1 2.11-.45c.907.339 1.85.573 2.81.7A2 2 0 0 1 22 16.92z"/></svg>`,
  task: `<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true"><path d="M9 11l3 3L22 4"/><path d="M21 12v7a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11"/></svg>`,
  search: `<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true"><circle cx="11" cy="11" r="8"/><path d="m21 21-4.35-4.35"/></svg>`,
};

const FILTER_CHIPS = [
  { id: "all", label: "All" },
  { id: "account", label: "Accounts" },
  { id: "deal", label: "Deals" },
  { id: "contact", label: "Contacts" },
  { id: "brief", label: "Briefs" },
  { id: "call", label: "Calls" },
  { id: "task", label: "Tasks" },
];

const SEARCH_DEBOUNCE_MS = 200;

function isEditableTarget(el) {
  if (!el) return false;
  const tag = el.tagName?.toLowerCase();
  if (tag === "input" || tag === "textarea" || tag === "select") return true;
  return el.isContentEditable;
}

function storageKey(session, suffix) {
  const email = session?.email ? String(session.email).trim().toLowerCase() : "anon";
  return `lionpath-search-${suffix}:${email}`;
}

function loadRecentList(session, suffix) {
  try {
    const raw = localStorage.getItem(storageKey(session, suffix));
    return raw ? JSON.parse(raw) : [];
  } catch {
    return [];
  }
}

function saveRecentList(session, suffix, list) {
  try {
    localStorage.setItem(storageKey(session, suffix), JSON.stringify(list.slice(0, 8)));
  } catch {
    /* ignore */
  }
}

function pushRecentSearch(session, query) {
  const q = String(query || "").trim();
  if (!q) return;
  const list = loadRecentList(session, "queries").filter((x) => x !== q);
  list.unshift(q);
  saveRecentList(session, "queries", list);
}

function pushRecentView(session, item) {
  if (!item?.type || !item?.id) return;
  const key = `${item.type}:${item.id}`;
  const list = loadRecentList(session, "views").filter((x) => x.key !== key);
  list.unshift({
    key,
    type: item.type,
    id: item.id,
    label: item.label,
    subtitle: item.subtitle || "",
    accountId: item.accountId || null,
    dealId: item.dealId || null,
    contactId: item.contactId || null,
    lifecycleId: item.lifecycleId || null,
  });
  saveRecentList(session, "views", list);
}

/** @param {object} deps */
export function initGlobalSearch(deps) {
  const topbarInput = document.getElementById("global-search-input");
  const modal = document.getElementById("global-search-modal");
  const paletteInput = document.getElementById("global-search-palette-input");
  const resultsEl = document.getElementById("global-search-results");
  const filtersEl = document.getElementById("global-search-filters");
  const backdrop = document.getElementById("global-search-backdrop");

  if (!topbarInput || !modal || !paletteInput || !resultsEl) return;

  fillShadowField(topbarInput);

  let highlightIdx = -1;
  let currentResults = [];
  let debounceTimer = null;
  let activeFilter = "all";
  let searchGeneration = 0;

  const PANEL_GAP = 6;
  const VIEWPORT_MARGIN = 8;

  function resolveSession() {
    return withEffectiveUserId(deps.getSession?.());
  }

  /** Anchor the omni-search panel to the topbar search input. */
  function positionSearchPanel() {
    if (modal.hidden || topbarInput.hidden) return;
    const rect = topbarInput.getBoundingClientRect();
    if (!rect.width && !rect.height) return;

    let width = rect.width;
    let left = rect.left;

    if (left + width > window.innerWidth - VIEWPORT_MARGIN) {
      left = Math.max(VIEWPORT_MARGIN, window.innerWidth - VIEWPORT_MARGIN - width);
    }
    if (left < VIEWPORT_MARGIN) {
      left = VIEWPORT_MARGIN;
      width = Math.min(width, window.innerWidth - VIEWPORT_MARGIN * 2);
    }

    modal.style.top = `${Math.round(rect.bottom + PANEL_GAP)}px`;
    modal.style.left = `${Math.round(left)}px`;
    modal.style.width = `${Math.round(width)}px`;
  }

  function hidePalette() {
    modal.hidden = true;
    if (backdrop) backdrop.hidden = true;
    highlightIdx = -1;
    currentResults = [];
  }

  function showPalette() {
    modal.hidden = false;
    if (backdrop) backdrop.hidden = false;
    positionSearchPanel();
    paletteInput.focus?.();
  }

  window.addEventListener("resize", positionSearchPanel);
  window.addEventListener("scroll", positionSearchPanel, true);
  if (typeof ResizeObserver !== "undefined") {
    new ResizeObserver(positionSearchPanel).observe(topbarInput);
  }

  function renderFilterChips() {
    if (!filtersEl) return;
    filtersEl.innerHTML = FILTER_CHIPS.map(
      (chip) =>
        `<button type="button" class="omni-filter-chip${activeFilter === chip.id ? " is-active" : ""}" data-filter="${chip.id}">${esc(chip.label)}</button>`,
    ).join("");
    filtersEl.querySelectorAll(".omni-filter-chip").forEach((btn) => {
      btn.addEventListener("click", () => {
        activeFilter = btn.dataset.filter || "all";
        renderFilterChips();
        void readFieldValueAsync(paletteInput).then((v) => runSearch(v));
      });
    });
  }

  function selectResult(item) {
    if (!item) return;
    const session = deps.getSession?.();
    if (session) pushRecentView(session, item);
    hidePalette();
    topbarInput.value = "";
    paletteInput.value = "";

    const accountId = item.accountId || (item.type === "account" ? item.id : null);
    if (item.type === "account") {
      deps.switchView?.("accounts", { accountId, dealId: null, drillDown: true });
    } else if (item.type === "contact") {
      if (!accountId) return;
      deps.switchView?.("accounts", {
        accountId,
        contactId: item.contactId || item.id,
        dealId: null,
        drillDown: true,
      });
    } else if (item.type === "deal") {
      deps.switchView?.("deals", {
        dealId: item.dealId || item.id,
        accountId,
        drillDown: true,
      });
    } else if (item.type === "brief") {
      deps.openPrepBriefItem?.(item.id);
    } else if (item.type === "call") {
      deps.openHistoryItem?.(item.id);
    } else if (item.type === "task") {
      if (!accountId) return;
      deps.switchView?.("accounts", { accountId, dealId: null, drillDown: true });
    }
  }

  function resultRowHtml(item, idx, active) {
    const icon = TYPE_ICONS[item.type] || TYPE_ICONS.search;
    return `<button type="button" class="omni-result${active ? " omni-result-active" : ""}" data-idx="${idx}">
      <span class="omni-result-icon omni-result-icon--${esc(item.type)}">${icon}</span>
      <span class="omni-result-body">
        <span class="omni-result-label">${esc(item.label)}</span>
        <span class="omni-result-sub muted">${esc(item.subtitle || TYPE_LABELS[item.type] || "")}</span>
      </span>
      <span class="omni-result-type muted">${esc(TYPE_LABELS[item.type] || item.type)}</span>
    </button>`;
  }

  function renderRecentSection(title, clearLabel, items, onSelect, clearAction) {
    if (!items.length) return "";
    const rows = items
      .map((item, i) => {
        if (typeof item === "string") {
          return `<button type="button" class="omni-recent-item" data-recent-query="${esc(item)}">
            <span class="omni-recent-icon">${TYPE_ICONS.search}</span>
            <span>${esc(item)}</span>
          </button>`;
        }
        return resultRowHtml(item, `recent-${i}`, false);
      })
      .join("");
    return `<div class="omni-section">
      <div class="omni-section-head">
        <span class="omni-section-title">${esc(title)}</span>
        <button type="button" class="omni-clear-btn" data-clear="${clearAction}">${esc(clearLabel)}</button>
      </div>
      <div class="omni-section-list">${rows}</div>
    </div>`;
  }

  function wireResultButtons() {
    const session = resolveSession();
    const recentViews = session ? loadRecentList(session, "views") : [];

    resultsEl.querySelectorAll(".omni-result").forEach((btn) => {
      btn.addEventListener("click", () => {
        const idxRaw = btn.dataset.idx || "";
        if (idxRaw.startsWith("recent-")) {
          const i = Number(idxRaw.slice("recent-".length));
          if (!Number.isNaN(i) && recentViews[i]) selectResult(recentViews[i]);
          return;
        }
        const i = Number(idxRaw);
        if (!Number.isNaN(i)) selectResult(currentResults[i]);
      });
    });
    resultsEl.querySelectorAll("[data-recent-query]").forEach((btn) => {
      btn.addEventListener("click", () => {
        const q = btn.dataset.recentQuery || "";
        paletteInput.value = q;
        topbarInput.value = q;
        void runSearch(q);
      });
    });
    resultsEl.querySelectorAll("[data-clear]").forEach((btn) => {
      btn.addEventListener("click", () => {
        const session = deps.getSession?.();
        if (!session) return;
        saveRecentList(session, btn.dataset.clear, []);
        void runSearch("");
      });
    });
  }

  function renderResults(results, query) {
    highlightIdx = results.length ? 0 : -1;
    currentResults = results;

    const session = deps.getSession?.();
    const trimmed = String(query || "").trim();

    if (!trimmed && session) {
      const recentQueries = loadRecentList(session, "queries");
      const recentViews = loadRecentList(session, "views");
      let html = "";
      if (recentQueries.length) {
        html += renderRecentSection("Recently searched", "Clear", recentQueries, null, "queries");
      }
      if (recentViews.length) {
        html += renderRecentSection("Recently viewed", "Clear", recentViews, null, "views");
      }
      if (!html) {
        html = `<p class="global-search-empty muted">Search accounts, deals, contacts, briefs, calls, and tasks</p>`;
      }
      resultsEl.innerHTML = html;
      wireResultButtons();
      return;
    }

    if (!results.length) {
      resultsEl.innerHTML = trimmed
        ? `<p class="global-search-empty muted">No results for “${esc(trimmed)}”</p>`
        : `<p class="global-search-empty muted">Type to search</p>`;
      return;
    }

    resultsEl.innerHTML = `<div class="omni-section"><div class="omni-section-list">${results
      .map((item, i) => resultRowHtml(item, i, i === highlightIdx))
      .join("")}</div></div>`;
    wireResultButtons();
  }

  function updateHighlight() {
    resultsEl.querySelectorAll(".omni-result").forEach((btn, i) => {
      btn.classList.toggle("omni-result-active", i === highlightIdx);
    });
    const active = resultsEl.querySelector(".omni-result-active");
    active?.scrollIntoView({ block: "nearest" });
  }

  function filterTypes() {
    return activeFilter === "all" ? undefined : [activeFilter];
  }

  function tokenSearch(index, query) {
    const trimmed = String(query || "").trim();
    const types = filterTypes();
    if (!trimmed) {
      const pool = activeFilter === "all" ? index : index.filter((i) => i.type === activeFilter);
      return recentFromIndex(pool, 5);
    }
    return searchIndex(index, trimmed, { types, limit: 12 });
  }

  async function runSearch(query, { openIfEmpty = false } = {}) {
    const gen = ++searchGeneration;
    const session = resolveSession();
    if (!session?.email) {
      renderResults([], query);
      return;
    }

    const trimmed = String(query || "").trim();
    const types = filterTypes();

    if (!trimmed) {
      renderResults([], "");
      if (openIfEmpty) showPalette();
      const cached = getCachedSearchIndex(session);
      if (!cached) {
        void buildSearchIndex(session).catch(() => {});
      }
      return;
    }

    if (openIfEmpty || trimmed) showPalette();

    const cached = getCachedSearchIndex(session);
    if (cached?.length) {
      const instant = tokenSearch(cached, trimmed);
      renderResults(instant, trimmed);
      if (instant.length >= 2) {
        void rerankWithRag(
          searchIndex(cached, trimmed, { types, limit: Math.max(36, 12) }),
          trimmed,
          12,
        ).then((reranked) => {
          if (gen !== searchGeneration) return;
          renderResults(reranked, trimmed);
          pushRecentSearch(session, trimmed);
        });
      } else if (instant.length) {
        pushRecentSearch(session, trimmed);
      }
    }

    try {
      if (cached?.length) {
        return;
      }
      const index = await buildSearchIndex(session);
      if (gen !== searchGeneration) return;

      const results = tokenSearch(index, trimmed);
      renderResults(results, trimmed);

      if (results.length >= 2) {
        void rerankWithRag(
          searchIndex(index, trimmed, { types, limit: Math.max(36, 12) }),
          trimmed,
          12,
        ).then((reranked) => {
          if (gen !== searchGeneration) return;
          renderResults(reranked, trimmed);
        });
      }

      if (results.length) pushRecentSearch(session, trimmed);
      else if (!cached?.length) {
        console.warn("[global-search] no hits", getSearchIndexStats(session));
      }
    } catch (err) {
      console.warn("[global-search] search failed:", err?.message || err);
      if (gen === searchGeneration) renderResults([], query);
    }
  }

  function scheduleSearch(query) {
    clearTimeout(debounceTimer);
    debounceTimer = setTimeout(() => {
      void runSearch(query);
    }, SEARCH_DEBOUNCE_MS);
  }

  renderFilterChips();

  topbarInput.addEventListener("fwInput", () => {
    void readFieldValueAsync(topbarInput).then((v) => {
      paletteInput.value = v;
      scheduleSearch(v);
    });
  });

  topbarInput.addEventListener("focus", () => {
    void readFieldValueAsync(topbarInput).then((v) => {
      paletteInput.value = v;
      renderResults([], v);
      showPalette();
      scheduleSearch(v);
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
        renderResults([], v);
        showPalette();
        scheduleSearch(v);
        paletteInput.focus?.();
      });
    }
  });
}
