/**
 * Accounts list + detail (CRM-style). Lifecycle remains the internal engagement spine.
 */

import { listAccountsForUser, getAccountEngagementDetail } from "./domain/account-service.js";
import { advanceStage } from "./domain/lifecycle-service.js";
import { getStore } from "./domain/store.js";
import { sessionUserId } from "./domain/session.js";
import { STAGE_LABELS, EVENT_LABELS, LIFECYCLE_STAGES } from "./domain/types.js";
import { filterAccountRows } from "./search-service.js";
import { readFieldValueAsync } from "./crayons-ui.js";

function esc(v) {
  return String(v ?? "").replace(/[&<>"']/g, (c) =>
    ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
}

function formatDate(ts) {
  if (!ts) return "—";
  return new Date(ts).toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" });
}

function stageBadge(stage) {
  const label = STAGE_LABELS[stage] || stage;
  return `<span class="lifecycle-stage-badge stage-${esc(stage)}">${esc(label)}</span>`;
}

function renderAccountListItem({ account, lifecycle }) {
  const score = lifecycle.latestQualityScore != null ? `${lifecycle.latestQualityScore}/10` : "—";
  const title = account.name || lifecycle.title || "Account";
  const domain = account.domain ? `<span class="account-list-domain muted">${esc(account.domain)}</span>` : "";
  return `
    <fw-button class="lifecycle-list-item account-list-item" color="secondary" fill="clear" data-account-id="${esc(account.id)}">
      <div class="lifecycle-list-main">
        <span class="lifecycle-list-title">${esc(title)}</span>
        ${stageBadge(lifecycle.stage)}
      </div>
      ${domain}
      <div class="lifecycle-list-meta muted">
        <span>${esc(formatDate(lifecycle.lastActivityAt))}</span>
        <span>${lifecycle.prepCount || 0} preps · ${lifecycle.postCallCount || 0} calls · ${lifecycle.openTaskCount || 0} tasks</span>
        <span>Score: ${esc(score)}</span>
      </div>
    </fw-button>`;
}

function renderTimeline(events) {
  if (!events?.length) return `<p class="muted account-detail-empty-timeline">No activity yet.</p>`;
  return `<ul class="lifecycle-timeline">
    ${events.map((ev) => {
      const typeLabel = EVENT_LABELS[ev.type] || ev.type;
      const searchText = `${typeLabel} ${formatDate(ev.timestamp)}`;
      return `
      <li class="lifecycle-timeline-item" data-search-text="${esc(searchText.toLowerCase())}">
        <span class="lifecycle-timeline-type">${esc(typeLabel)}</span>
        <span class="lifecycle-timeline-when muted">${esc(formatDate(ev.timestamp))}</span>
      </li>`;
    }).join("")}
  </ul>`;
}

function renderContacts(contacts) {
  if (!contacts?.length) {
    return `<p class="muted account-detail-empty-contacts">No contacts yet — add prospect emails in prep.</p>`;
  }
  return `<ul class="account-detail-contacts">
    ${contacts.map((c) => {
      const searchText = [c.name, c.email, c.title].filter(Boolean).join(" ");
      return `<li data-search-text="${esc(searchText.toLowerCase())}">
        <span class="account-detail-contact-name">${esc(c.name || c.email)}</span>
        ${c.title ? `<span class="muted">${esc(c.title)}</span>` : ""}
        ${c.email && c.name ? `<span class="muted account-detail-contact-email">${esc(c.email)}</span>` : ""}
      </li>`;
    }).join("")}
  </ul>`;
}

function artifactRow(label, display) {
  const searchText = String(label || "").toLowerCase();
  return `<li data-search-text="${esc(searchText)}">${display ?? esc(label)}</li>`;
}

function renderArtifactTabs(detail) {
  const { preps, postCalls, tasks } = detail;
  const prepRows = (preps || []).map((p) => {
    const label = `${formatDate(p.createdAt)} — ${p.meta?.company || "Prep"}`;
    return artifactRow(label);
  }).join("") || `<li class="muted account-detail-empty-artifacts" data-search-text="">No preps yet</li>`;

  const callRows = (postCalls || []).map((c) => {
    const score = c.qualityScore != null ? ` (${c.qualityScore}/10)` : "";
    const label = `${formatDate(c.createdAt)} — ${c.title || "Call"}${score}`;
    return artifactRow(label);
  }).join("") || `<li class="muted account-detail-empty-artifacts" data-search-text="">No post-calls yet</li>`;

  const taskRows = (tasks || []).map((t) => {
    const label = `${t.status} — ${t.title}`;
    return artifactRow(label);
  }).join("") || `<li class="muted account-detail-empty-artifacts" data-search-text="">No tasks yet</li>`;

  return `
    <fw-tabs class="lifecycle-artifact-tabs" active-tab-name="preps">
      <fw-tab slot="tab" panel="preps">Preps (${preps?.length || 0})</fw-tab>
      <fw-tab slot="tab" panel="postcalls">Post-calls (${postCalls?.length || 0})</fw-tab>
      <fw-tab slot="tab" panel="tasks">Tasks (${tasks?.length || 0})</fw-tab>
      <fw-tab-panel name="preps"><ul class="lifecycle-artifact-list">${prepRows}</ul></fw-tab-panel>
      <fw-tab-panel name="postcalls"><ul class="lifecycle-artifact-list">${callRows}</ul></fw-tab-panel>
      <fw-tab-panel name="tasks"><ul class="lifecycle-artifact-list">${taskRows}</ul></fw-tab-panel>
    </fw-tabs>`;
}

function renderAccountDetail(detail, detailSearchQuery = "") {
  const { lifecycle, account, events, contacts } = detail;
  const stageOptions = LIFECYCLE_STAGES.map(
    (s) => `<fw-select-option value="${esc(s)}" ${s === lifecycle.stage ? "selected" : ""}>${esc(STAGE_LABELS[s])}</fw-select-option>`
  ).join("");

  const firmo = account?.metadata?.firmographics?.suggestedProduct;
  const subtitle = [account?.domain, firmo ? `${firmo} ICP fit` : null].filter(Boolean).join(" · ");

  return `
    <div class="lifecycle-detail account-detail">
      <div class="lifecycle-detail-head">
        <fw-button class="lifecycle-back" color="secondary" fill="clear" data-action="back">← All accounts</fw-button>
        <h2>${esc(account?.name || lifecycle.title || "Account")}</h2>
        ${stageBadge(lifecycle.stage)}
      </div>
      ${subtitle ? `<p class="muted account-detail-sub">${esc(subtitle)}</p>` : ""}
      <div class="account-detail-actions">
        <fw-button color="secondary" fill="outline" data-action="prep">New prep</fw-button>
        <fw-button color="secondary" fill="outline" data-action="postcall">Post-call</fw-button>
      </div>
      <div class="lifecycle-detail-controls">
        <fw-select id="account-stage-select" label="Stage" value="${esc(lifecycle.stage)}">
          ${stageOptions}
        </fw-select>
      </div>
      <fw-input id="account-detail-search" class="account-detail-search" placeholder="Filter contacts, activity, artifacts…" value="${esc(detailSearchQuery)}" clear-input></fw-input>
      <p id="account-detail-no-matches" class="muted account-detail-no-matches" hidden>No matches for this filter.</p>
      <section class="lifecycle-section account-detail-section-contacts">
        <h3>Contacts</h3>
        ${renderContacts(contacts)}
      </section>
      <section class="lifecycle-section account-detail-section-activity">
        <h3>Activity</h3>
        ${renderTimeline(events)}
      </section>
      <section class="lifecycle-section account-detail-section-artifacts">
        <h3>Artifacts</h3>
        ${renderArtifactTabs(detail)}
      </section>
    </div>`;
}

function applyDetailFilter(container, query) {
  const q = String(query || "").trim().toLowerCase();
  const noMatches = container.querySelector("#account-detail-no-matches");
  let visibleCount = 0;

  container.querySelectorAll("[data-search-text]").forEach((el) => {
    const text = el.getAttribute("data-search-text") || "";
    const show = !q || text.includes(q);
    el.hidden = !show;
    if (show && el.matches("li")) visibleCount++;
  });

  if (noMatches) {
    noMatches.hidden = !q || visibleCount > 0;
  }
}

function wireDetailSearch(container) {
  const input = container.querySelector("#account-detail-search");
  if (!input) return;

  const run = () => {
    void readFieldValueAsync(input).then((v) => {
      opts.detailSearchQuery = v;
      opts.onDetailSearchQueryChange?.(v);
      applyDetailFilter(container, v);
    });
  };

  input.addEventListener("fwInput", run);
  input.addEventListener("input", run);
  run();
}

function wireListFilter(container, allRows, opts) {
  const input = container.querySelector("#account-list-search");
  const listEl = container.querySelector(".lifecycle-list");
  if (!input || !listEl) return;

  const renderFiltered = (query) => {
    const filtered = filterAccountRows(allRows, query);
    listEl.innerHTML = filtered.length
      ? filtered.map((row) => renderAccountListItem(row)).join("")
      : `<p class="muted account-list-no-matches">No accounts match “${esc(query)}”</p>`;

    listEl.querySelectorAll(".account-list-item").forEach((btn) => {
      btn.addEventListener("fwClick", () => {
        opts.onSelectAccount?.(btn.dataset.accountId);
      });
    });
  };

  const run = () => {
    void readFieldValueAsync(input).then((v) => {
      opts.listSearchQuery = v;
      opts.onListSearchQueryChange?.(v);
      renderFiltered(v);
    });
  };

  input.addEventListener("fwInput", run);
  input.addEventListener("input", run);

  if (opts.listSearchQuery) {
    renderFiltered(opts.listSearchQuery);
  }
}

function wireDetailEvents(container, session, opts) {
  container.querySelector('[data-action="back"]')?.addEventListener("fwClick", () => {
    opts.onBack?.();
  });

  container.querySelector('[data-action="prep"]')?.addEventListener("fwClick", () => {
    opts.onPrep?.();
  });

  container.querySelector('[data-action="postcall"]')?.addEventListener("fwClick", () => {
    opts.onPostcall?.();
  });

  const stageSelect = container.querySelector("#account-stage-select");
  stageSelect?.addEventListener("fwChange", async (ev) => {
    const toStage = ev.detail?.value || stageSelect.value;
    const lifecycleId = opts.lifecycleId;
    if (!lifecycleId || !toStage) return;
    await advanceStage(lifecycleId, toStage, sessionUserId(session));
    await renderAccountView(container, session, opts);
  });

  wireDetailSearch(container);
}

async function enrichRowsWithContacts(rows) {
  const store = getStore();
  return Promise.all(
    rows.map(async (row) => ({
      ...row,
      contacts: await store.listContactsByAccount(row.account.id),
    })),
  );
}

/** @param {HTMLElement} container @param {object} session @param {object} opts */
export async function renderAccountView(container, session, opts = {}) {
  const userId = sessionUserId(session);
  if (!userId) {
    container.innerHTML = `<p class="muted">Sign in to view accounts.</p>`;
    return;
  }

  if (opts.accountId) {
    const detail = await getAccountEngagementDetail(session, opts.accountId);
    if (!detail) {
      container.innerHTML = `<p class="muted">Account not found.</p>`;
      return;
    }
    container.innerHTML = renderAccountDetail(detail, opts.detailSearchQuery || "");
    wireDetailEvents(container, session, {
      ...opts,
      lifecycleId: detail.lifecycle.id,
    });
    return;
  }

  const rows = await enrichRowsWithContacts(await listAccountsForUser(session));

  if (!rows.length) {
    container.innerHTML = `
      <fw-card class="lifecycle-empty dew-empty-state">
        <fw-icon name="agent" size="24" aria-hidden="true"></fw-icon>
        <h2>Accounts</h2>
        <p class="muted">Run a prep or post-call to add your first account.</p>
      </fw-card>`;
    return;
  }

  const listQuery = opts.listSearchQuery || "";
  const filtered = filterAccountRows(rows, listQuery);

  container.innerHTML = `
    <div class="lifecycle-list-view account-list-view">
      <h2>Accounts</h2>
      <p class="muted lifecycle-list-sub">Companies you are working — preps, calls, and contacts in one place.</p>
      <fw-input id="account-list-search" class="account-list-search" label="Filter accounts" placeholder="Company, domain, contact, stage…" value="${esc(listQuery)}" clear-input></fw-input>
      <div class="lifecycle-list">
        ${filtered.length
          ? filtered.map((row) => renderAccountListItem(row)).join("")
          : `<p class="muted account-list-no-matches">No accounts match “${esc(listQuery)}”</p>`}
      </div>
    </div>`;

  container.querySelectorAll(".account-list-item").forEach((btn) => {
    btn.addEventListener("fwClick", () => {
      opts.onSelectAccount?.(btn.dataset.accountId);
    });
  });

  wireListFilter(container, rows, opts);
}
