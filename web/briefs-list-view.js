/**
 * All briefs list — dashboard KPI drill-down (#precall/briefs).
 */

import { loadAllLocalBriefs } from "./precall.js?v=2.1.14";
import { companyMono } from "./precall-render.js?v=2.1.14";
import { esc } from "./shared.js";

function briefDedupeKey(b) {
  return `${b.company || ""}|${b.when || ""}|${b.id || ""}`;
}

export function parseBriefTimestamp(b) {
  const idMatch = /-(\d{10,})$/.exec(String(b.id || ""));
  if (idMatch) {
    const ms = Number(idMatch[1]);
    if (Number.isFinite(ms) && ms > 0) return ms;
  }
  if (b.whenTs != null) {
    const ts = Number(b.whenTs);
    if (Number.isFinite(ts) && ts > 0) return ts;
  }
  const when = String(b.when || "").trim();
  if (when) {
    const slashMatch = /^(\d{1,2})\/(\d{1,2})\/(\d{4})$/.exec(when);
    if (slashMatch) {
      const first = Number(slashMatch[1]);
      const second = Number(slashMatch[2]);
      const year = Number(slashMatch[3]);
      const dmyValid = second >= 1 && second <= 12 && first >= 1 && first <= 31;
      const mdyValid = first >= 1 && first <= 12 && second >= 1 && second <= 31;
      let day;
      let month;
      if (dmyValid && !mdyValid) {
        day = first;
        month = second;
      } else if (mdyValid && !dmyValid) {
        month = first;
        day = second;
      } else if (dmyValid && mdyValid) {
        // Ambiguous legacy locale strings — US briefs used MM/DD via toLocaleDateString.
        month = first;
        day = second;
      }
      if (month >= 1 && month <= 12 && day >= 1 && day <= 31) {
        const parsed = new Date(year, month - 1, day).getTime();
        if (Number.isFinite(parsed)) return parsed;
      }
    }
    if (/^\d{4}-\d{2}-\d{2}/.test(when)) {
      const parsed = Date.parse(when);
      if (Number.isFinite(parsed)) return parsed;
    }
  }
  return 0;
}

function formatBriefDate(ts) {
  if (!ts) return "-";
  return new Date(ts).toLocaleDateString(undefined, {
    month: "short",
    day: "numeric",
    year: "numeric",
  });
}

/**
 * Load local + remote briefs for the Activities feed (and #precall/briefs).
 * @param {{ fetchAllRemotePreps?: () => Promise<object[]> }} [opts]
 */
export async function loadMergedBriefs(opts = {}) {
  const local = loadAllLocalBriefs();
  let remote = [];
  if (typeof opts.fetchAllRemotePreps === "function") {
    try {
      remote = await opts.fetchAllRemotePreps();
    } catch (err) {
      console.warn("[briefs-list] remote preps failed:", err?.message || err);
    }
  }
  return mergeAllBriefs(local, remote);
}

/** Normalize Firestore prep doc into local brief shape. */
export function normalizeRemoteBrief(record) {
  if (!record || typeof record !== "object") return null;
  const company = record.company || record.meta?.company || "Account";
  let whenTs = record.whenTs;
  if (whenTs == null && record.createdAt != null) {
    if (typeof record.createdAt?.toDate === "function") {
      whenTs = record.createdAt.toDate().getTime();
    } else if (typeof record.createdAt === "number") {
      whenTs = record.createdAt;
    }
  }
  const idEpoch = /-(\d{10,})$/.exec(String(record.id || ""));
  if (whenTs == null && idEpoch) {
    const ms = Number(idEpoch[1]);
    if (Number.isFinite(ms) && ms > 0) whenTs = ms;
  }
  return {
    id: record.id,
    company,
    kind: record.kind || "Discovery",
    when: record.when || "",
    whenTs: whenTs ?? null,
    prep: record.prep,
    meta: record.meta || {
      company,
      domain: record.domain || record.companyDomain,
      companyDomain: record.companyDomain,
      prospectEmails: record.prospectEmail ? [record.prospectEmail] : [],
      additionalContext: record.additionalContext,
    },
    input: record.input || {
      companyName: company,
      prospectEmail: record.prospectEmail,
      companyDomain: record.meta?.domain || record.meta?.companyDomain,
    },
    lifecycleId: record.lifecycleId || null,
    remote: true,
  };
}

/** Merge local + remote briefs — same dedupe as countPrepsGenerated KPI. */
export function mergeAllBriefs(localBriefs, remoteBriefs) {
  const seen = new Set((localBriefs || []).map(briefDedupeKey));
  const merged = [...(localBriefs || [])];
  for (const raw of remoteBriefs || []) {
    const normalized = normalizeRemoteBrief(raw);
    if (!normalized?.id) continue;
    const key = briefDedupeKey(normalized);
    if (seen.has(key)) continue;
    seen.add(key);
    merged.push(normalized);
  }
  return merged.sort((a, b) => parseBriefTimestamp(b) - parseBriefTimestamp(a));
}

/** @param {object[]} briefs @param {{ query?: string }} filters */
export function filterBriefRecords(briefs, filters = {}) {
  const q = String(filters.query || "")
    .trim()
    .toLowerCase();
  if (!q) return briefs;
  return briefs.filter((b) => {
    const company = String(b.company || b.meta?.company || "").toLowerCase();
    const domain = String(b.meta?.domain || b.meta?.companyDomain || "").toLowerCase();
    const kind = String(b.kind || "").toLowerCase();
    const when = String(b.when || "").toLowerCase();
    const emails = (b.meta?.prospectEmails || b.input?.prospectEmails || [])
      .map((e) => String(e).toLowerCase())
      .join(" ");
    return (
      company.includes(q) ||
      domain.includes(q) ||
      kind.includes(q) ||
      when.includes(q) ||
      emails.includes(q)
    );
  });
}

export function buildBriefListRow(brief) {
  const company = brief.company || brief.meta?.company || "Account";
  const domain = brief.meta?.domain || brief.meta?.companyDomain || "";
  const ts = parseBriefTimestamp(brief);
  return {
    id: brief.id,
    company,
    companyMono: companyMono(company),
    kind: brief.kind || "Discovery",
    whenLabel: ts ? formatBriefDate(ts) : "-",
    domainLabel: domain || "-",
    hasPrep: !!brief.prep,
  };
}

function renderBriefListItem(row) {
  return `
    <button type="button" class="lifecycle-list-item brief-list-item brief-list-row" data-brief-id="${esc(row.id)}">
      <span class="brief-list-row-grid">
        <span class="brief-list-col brief-list-col--title">
          <span class="brief-list-mono" aria-hidden="true">${esc(row.companyMono)}</span>
          <span class="brief-list-row-title" title="${esc(row.company)}">${esc(row.company)}</span>
        </span>
        <span class="brief-list-col brief-list-col--kind">${esc(row.kind)}</span>
        <span class="brief-list-col brief-list-col--domain muted">${esc(row.domainLabel)}</span>
        <span class="brief-list-col brief-list-col--date muted">${esc(row.whenLabel)}</span>
      </span>
    </button>`;
}

function renderBriefsEmptyState(message) {
  return `
    <div class="lifecycle-empty brief-list-empty">
      <fw-card>
        <fw-icon name="file-text" size="24" aria-hidden="true"></fw-icon>
        <h2>All briefs</h2>
        <p class="muted">${esc(message)}</p>
      </fw-card>
    </div>`;
}

function wireBriefListClicks(container, opts) {
  container.querySelectorAll(".brief-list-item").forEach((row) => {
    const activate = () => {
      const id = row.getAttribute("data-brief-id");
      if (id) opts.onSelectBrief?.(id);
    };
    row.addEventListener("click", () => activate());
    row.addEventListener("keydown", (e) => {
      if (e.key === "Enter" || e.key === " ") {
        e.preventDefault();
        activate();
      }
    });
  });
}

function wireBriefSearch(container, allBriefs, opts, render) {
  const input = container.querySelector("#briefs-filter-search");
  if (!input) return;
  let timer = null;
  const run = () => {
    const query = String(input.value || "").trim();
    opts.onFiltersChange?.({ query });
    render({ query });
  };
  input.addEventListener("input", () => {
    window.clearTimeout(timer);
    timer = window.setTimeout(run, 150);
  });
  input.addEventListener("fwInput", () => {
    window.clearTimeout(timer);
    timer = window.setTimeout(run, 150);
  });
}

/** @param {HTMLElement} container @param {object} session @param {object} opts */
export async function renderBriefsListView(container, session, opts = {}) {
  if (!session?.email) {
    container.innerHTML = `<p class="muted">Sign in to view briefs.</p>`;
    return;
  }

  try {
    const allBriefs = await loadMergedBriefs(opts);
    if (!allBriefs.length) {
      container.innerHTML = renderBriefsEmptyState(
        "No briefs yet. Generate one from Pre-call to populate this list.",
      );
      return;
    }

    const filters = { query: opts.query || "" };
    const filtered = filterBriefRecords(allBriefs, filters);

    const paint = (activeFilters) => {
      const rows = filterBriefRecords(allBriefs, activeFilters).map((b) => buildBriefListRow(b));
      const listEl = container.querySelector(".brief-list-compact");
      const countEl = container.querySelector(".brief-list-count");
      if (countEl) {
        countEl.textContent =
          rows.length === allBriefs.length
            ? `${allBriefs.length} brief${allBriefs.length === 1 ? "" : "s"}`
            : `${rows.length} of ${allBriefs.length} briefs`;
      }
      if (listEl) {
        listEl.innerHTML = rows.length
          ? rows.map((row) => renderBriefListItem(row)).join("")
          : `<p class="muted brief-list-no-matches">No briefs match this search.</p>`;
        wireBriefListClicks(listEl, opts);
      }
    };

    container.innerHTML = `
      <div class="lifecycle-list-view brief-list-view">
        <div class="brief-list-toolbar">
          <div class="brief-list-title-group">
            <h1 class="brief-list-heading">All briefs</h1>
            <p class="brief-list-subtitle muted">Every pre-call brief you've generated. Open one to review account research and demo prep.</p>
          </div>
          <div class="brief-list-filters">
            <fw-input id="briefs-filter-search" label="Search" placeholder="Account, domain, email…" value="${esc(filters.query)}" clear-input></fw-input>
          </div>
        </div>
        <p class="brief-list-count muted">${filtered.length === allBriefs.length ? `${allBriefs.length} brief${allBriefs.length === 1 ? "" : "s"}` : `${filtered.length} of ${allBriefs.length} briefs`}</p>
        <div class="brief-list-table-card card-wire">
          <div class="brief-list-grid-header" aria-hidden="true">
            <span class="brief-list-col brief-list-col--title">Account</span>
            <span class="brief-list-col brief-list-col--kind">Type</span>
            <span class="brief-list-col brief-list-col--domain">Domain</span>
            <span class="brief-list-col brief-list-col--date">Date</span>
          </div>
          <div class="lifecycle-list brief-list-compact">
            ${filtered.map((b) => renderBriefListItem(buildBriefListRow(b))).join("")}
          </div>
        </div>
      </div>`;

    wireBriefListClicks(container, opts);
    wireBriefSearch(container, allBriefs, opts, paint);
  } catch (err) {
    console.error("[briefs-list-view] failed to render:", err);
    container.innerHTML = renderBriefsEmptyState(
      "Could not load briefs right now. Refresh the page or try again in a moment.",
    );
  }
}
