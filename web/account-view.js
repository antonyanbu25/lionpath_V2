/**
 * Accounts list + detail (CRM-style). Lifecycle remains the internal engagement spine.
 */

import { listAccountsForUser, getAccountEngagementDetail } from "./domain/account-service.js";
import { advanceStage } from "./domain/lifecycle-service.js";
import { getStore } from "./domain/store.js";
import { sessionUserId } from "./domain/session.js";
import { STAGE_LABELS, EVENT_LABELS, CONTACT_EVENT_LABELS } from "./domain/types.js";
import { MEDDPICC_FIELD_KEYS, MEDDPICC_FIELD_LABELS } from "./domain/contact-service.js";
import { filterAccountRows } from "./search-service.js";
import { readFieldValueAsync } from "./crayons-ui.js";

const OPEN_PIPELINE_STAGES = ["research", "discovery", "demo", "evaluation", "business_case"];
const TERMINAL_STAGES = ["closed_won", "closed_lost", "nurture"];

const MEDDPICC_LETTERS = {
  metrics: "M",
  economicBuyer: "E",
  decisionCriteria: "D",
  decisionProcess: "D",
  paperProcess: "P",
  identifyPain: "I",
  champion: "C",
  competition: "C",
};

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

function isTerminalStage(stage) {
  return TERMINAL_STAGES.includes(stage);
}

function openPipelineIndex(stage) {
  return OPEN_PIPELINE_STAGES.indexOf(stage);
}

function pipelineOpenStepState(currentStage, stepStage) {
  const curIdx = openPipelineIndex(currentStage);
  const stepIdx = openPipelineIndex(stepStage);
  if (isTerminalStage(currentStage)) return "completed";
  if (curIdx < 0) return "upcoming";
  if (stepIdx < curIdx) return "completed";
  if (stepIdx === curIdx) return "current";
  return "upcoming";
}

function renderOpenPipelineStep(stage, currentStage) {
  const state = pipelineOpenStepState(currentStage, stage);
  const label = STAGE_LABELS[stage] || stage;
  const isCurrent = state === "current";
  const isCompleted = state === "completed";
  return `
    <div class="lifecycle-pipeline-step lifecycle-pipeline-step--${esc(state)}" data-search-text="${esc(label.toLowerCase())}">
      <fw-button
        class="lifecycle-pipeline-stage"
        data-lifecycle-stage="${esc(stage)}"
        color="${isCurrent ? "primary" : "secondary"}"
        fill="${isCurrent ? "solid" : "outline"}"
        size="small"
      >
        ${isCompleted ? `<fw-icon slot="before-label" name="check" size="12"></fw-icon>` : ""}
        ${esc(label)}
      </fw-button>
    </div>`;
}

function renderTerminalStep(stage, currentStage) {
  const isCurrent = currentStage === stage;
  const color =
    stage === "closed_won" ? "success" : stage === "closed_lost" ? "danger" : "warning";
  const label = STAGE_LABELS[stage] || stage;
  return `
    <fw-button
      class="lifecycle-terminal-stage"
      data-lifecycle-stage="${esc(stage)}"
      color="${isCurrent ? color : "secondary"}"
      fill="${isCurrent ? "solid" : "outline"}"
      size="small"
    >${esc(label)}</fw-button>`;
}

function renderLifecyclePipeline(currentStage) {
  const openSteps = OPEN_PIPELINE_STAGES.map((s) => renderOpenPipelineStep(s, currentStage)).join(
    `<span class="lifecycle-pipeline-connector" aria-hidden="true"></span>`
  );
  const terminalSteps = TERMINAL_STAGES.map((s) => renderTerminalStep(s, currentStage)).join("");

  return `
    <fw-card class="account-lifecycle-card account-detail-card">
      <div class="account-card-header">
        <h3 class="account-card-title">Lifecycle</h3>
        ${stageBadge(currentStage)}
      </div>
      <div class="lifecycle-pipeline-open" role="list" aria-label="Open pipeline stages">
        ${openSteps}
      </div>
      <div class="lifecycle-pipeline-terminal">
        <span class="lifecycle-terminal-label muted">Outcome</span>
        <div class="lifecycle-pipeline-terminal-steps">${terminalSteps}</div>
      </div>
    </fw-card>`;
}

function eventIcon(type) {
  switch (type) {
    case "prep_generated":
      return "add-note";
    case "postcall_analyzed":
      return "phone";
    case "contact_updated":
      return "agent";
    case "task_created":
    case "task_completed":
      return "tasks";
    case "stage_changed":
      return "arrow-right";
    default:
      return "calendar-time";
  }
}

function renderTimeline(events) {
  if (!events?.length) return `<p class="muted account-detail-empty-timeline">No activity yet.</p>`;
  return `<ul class="lifecycle-timeline">
    ${events.map((ev) => {
      let typeLabel = EVENT_LABELS[ev.type] || ev.type;
      if (ev.type === "contact_updated" && ev.payload?.contactName) {
        const fields = (ev.payload.fields || []).join(", ");
        typeLabel = `Contact updated — ${ev.payload.contactName}${fields ? `: ${fields}` : ""}`;
      }
      const searchText = `${typeLabel} ${formatDate(ev.timestamp)}`;
      return `
      <li class="lifecycle-timeline-item" data-search-text="${esc(searchText.toLowerCase())}">
        <fw-icon class="lifecycle-timeline-icon" name="${esc(eventIcon(ev.type))}" size="16" aria-hidden="true"></fw-icon>
        <span class="lifecycle-timeline-type">${esc(typeLabel)}</span>
        <span class="lifecycle-timeline-when muted">${esc(formatDate(ev.timestamp))}</span>
      </li>`;
    }).join("")}
  </ul>`;
}

function contactInitials(contact) {
  const n = String(contact?.name || contact?.email || "").trim();
  if (!n) return "?";
  const parts = n.split(/\s+/).filter(Boolean);
  if (parts.length >= 2) return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
  return n.slice(0, 2).toUpperCase();
}

function discTag(contact) {
  const primary = contact?.metadata?.disc?.primary;
  if (primary && primary !== "unknown") {
    return `<fw-tag text="DISC ${esc(primary)}" color="blue"></fw-tag>`;
  }
  return `<fw-tag text="DISC not assessed" color="grey"></fw-tag>`;
}

function influenceTag(contact) {
  const level = contact?.metadata?.influence?.level;
  if (level && level !== "unknown") {
    const label = level.charAt(0).toUpperCase() + level.slice(1);
    return `<fw-tag text="${esc(label)} influence" color="blue"></fw-tag>`;
  }
  return `<fw-tag text="Influence not assessed" color="grey"></fw-tag>`;
}

function meddpiccStatusTag(status) {
  const s = status || "unknown";
  if (s === "confirmed") return `<fw-tag text="Confirmed" color="green"></fw-tag>`;
  if (s === "partial") return `<fw-tag text="Partial" color="yellow"></fw-tag>`;
  return `<fw-tag text="Not captured" color="grey"></fw-tag>`;
}

function formatContactEvent(ev) {
  const label = CONTACT_EVENT_LABELS[ev.type] || ev.type;
  const source = ev.payload?.source ? ` · ${ev.payload.source}` : "";
  return `${label}${source}`;
}

function renderLabelValue(label, value) {
  return `
    <div class="account-label-value">
      <span class="account-label-value-label">${esc(label)}</span>
      <span class="account-label-value-text">${value}</span>
    </div>`;
}

function renderContactAccordionBody(contact, events) {
  const disc = contact.metadata?.disc;
  const influence = contact.metadata?.influence;
  const evidence = disc?.evidence || [];
  const activity = (events || []).slice(0, 10);

  const discValue =
    disc?.primary && disc.primary !== "unknown"
      ? `<strong>${esc(disc.primary)}</strong>${disc.secondary ? ` / ${esc(disc.secondary)}` : ""}
         <span class="muted"> · ${esc(disc.confidence || "low")} confidence</span>`
      : `<span class="muted">Not assessed yet</span>`;

  const influenceValue =
    influence?.level && influence.level !== "unknown"
      ? `<strong>${esc(influence.level)}</strong>${influence.decisionRole && influence.decisionRole !== "unknown" ? ` · ${esc(influence.decisionRole.replace(/_/g, " "))}` : ""}`
      : `<span class="muted">Not assessed yet</span>`;

  return `
    <div class="account-contact-body">
      ${renderLabelValue("DISC", discValue)}
      ${disc?.assessedAt ? `<p class="muted account-contact-source">Updated ${esc(formatDate(disc.assessedAt))}${disc.source ? ` · ${esc(disc.source)}` : ""}</p>` : ""}
      ${evidence.length ? `<ul class="account-contact-evidence">${evidence.map((e) => `<li>${esc(e)}</li>`).join("")}</ul>` : ""}
      ${renderLabelValue("Influence", influenceValue)}
      ${influence?.updatedAt ? `<p class="muted account-contact-source">Updated ${esc(formatDate(influence.updatedAt))}${influence.source ? ` · ${esc(influence.source)}` : ""}</p>` : ""}
      ${!disc?.primary && !influence?.level
        ? `<fw-inline-message type="info" closable="false">Will populate from prep or post-call when evidence is available.</fw-inline-message>`
        : ""}
      <h4 class="account-contact-activity-heading">Contact activity</h4>
      ${activity.length
        ? `<ul class="account-contact-activity">${activity.map((ev) => `
            <li><span>${esc(formatContactEvent(ev))}</span><span class="muted">${esc(formatDate(ev.timestamp))}</span></li>`).join("")}</ul>`
        : `<p class="muted">No contact activity yet.</p>`}
    </div>`;
}

function renderContactsCard(contacts, primaryContactId, contactEventsByContactId = {}) {
  if (!contacts?.length) {
    return `
      <fw-card class="account-contacts-card account-detail-card">
        <div class="account-card-header">
          <h3 class="account-card-title">Contacts</h3>
        </div>
        <p class="muted account-detail-empty-contacts">No contacts yet — add prospect emails in prep.</p>
      </fw-card>`;
  }

  const accordions = contacts
    .map((c) => {
      const searchText = [c.name, c.email, c.title, c.metadata?.disc?.primary, c.metadata?.influence?.level]
        .filter(Boolean)
        .join(" ");
      const isPrimary = primaryContactId && c.id === primaryContactId;
      const events = contactEventsByContactId[c.id] || [];
      return `
        <fw-accordion
          class="account-contact-accordion"
          data-search-text="${esc(searchText.toLowerCase())}"
          ${isPrimary ? "expanded" : ""}
          type="no_bounding_box"
        >
          <fw-accordion-title>
            <div class="account-accordion-title-inner">
              <span class="account-contact-avatar" aria-hidden="true">${esc(contactInitials(c))}</span>
              <span class="account-accordion-title-text">
                <span class="account-detail-contact-name">${esc(c.name || c.email)}</span>
                ${c.title ? `<span class="muted account-contact-title">${esc(c.title)}</span>` : ""}
                ${c.email && c.name ? `<span class="muted account-detail-contact-email">${esc(c.email)}</span>` : ""}
              </span>
              <span class="account-accordion-tags">
                ${isPrimary ? `<fw-tag text="Primary" color="blue"></fw-tag>` : ""}
                ${discTag(c)}
                ${influenceTag(c)}
              </span>
            </div>
          </fw-accordion-title>
          <fw-accordion-body>
            ${renderContactAccordionBody(c, events)}
          </fw-accordion-body>
        </fw-accordion>`;
    })
    .join("");

  return `
    <fw-card class="account-contacts-card account-detail-card">
      <div class="account-card-header">
        <h3 class="account-card-title">Contacts</h3>
        <fw-tag text="${contacts.length}" color="grey"></fw-tag>
      </div>
      <div class="account-contacts-accordions">${accordions}</div>
    </fw-card>`;
}

function renderMeddpiccCard(account, contacts) {
  const med = account?.metadata?.meddpicc;
  const score = med?.completionScore ?? 0;
  const contactById = new Map((contacts || []).map((c) => [c.id, c]));

  const fields = MEDDPICC_FIELD_KEYS.map((key) => {
    const slot = med?.[key];
    const label = MEDDPICC_FIELD_LABELS[key] || key;
    const letter = MEDDPICC_LETTERS[key] || label.charAt(0);
    let valueHtml = `<span class="muted">—</span>`;
    if (slot?.value) {
      let text = slot.value;
      if (slot.contactId && contactById.has(slot.contactId)) {
        const linked = contactById.get(slot.contactId);
        text = `${slot.value} (${linked.name || linked.email})`;
      }
      valueHtml = `<span>${esc(text)}</span>`;
    }
    return `
      <div class="meddpicc-field" data-search-text="${esc(label.toLowerCase())} ${esc(String(slot?.value || "").toLowerCase())}">
        <span class="meddpicc-letter" aria-hidden="true">${esc(letter)}</span>
        <div class="meddpicc-field-body">
          <span class="meddpicc-field-label">${esc(label)}</span>
          <span class="meddpicc-field-value">${valueHtml}</span>
        </div>
        ${meddpiccStatusTag(slot?.status)}
      </div>`;
  }).join("");

  return `
    <fw-card class="account-meddpicc-card account-detail-card">
      <div class="account-card-header">
        <h3 class="account-card-title">Deal qualification (MEDDPICC)</h3>
        <fw-tag text="${score}% complete" color="grey"></fw-tag>
      </div>
      <div class="meddpicc-progress" role="progressbar" aria-valuenow="${score}" aria-valuemin="0" aria-valuemax="100">
        <div class="meddpicc-progress-bar" style="width: ${Math.max(0, Math.min(100, score))}%"></div>
      </div>
      <div class="meddpicc-field-grid">${fields}</div>
      <fw-inline-message type="info" closable="false">
        Populated incrementally from prep and post-call.
      </fw-inline-message>
      ${med?.lastUpdatedAt ? `<p class="muted meddpicc-updated">Last updated ${esc(formatDate(med.lastUpdatedAt))}</p>` : ""}
    </fw-card>`;
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
  const { lifecycle, account, events, contacts, contactEventsByContactId } = detail;
  const firmo = account?.metadata?.firmographics?.suggestedProduct;

  return `
    <div class="lifecycle-detail account-detail">
      <fw-card class="account-header-card account-detail-card">
        <div class="lifecycle-detail-head">
          <fw-button class="lifecycle-back" color="secondary" fill="clear" data-action="back">← All accounts</fw-button>
          <div class="account-header-main">
            <h2>${esc(account?.name || lifecycle.title || "Account")}</h2>
            <div class="account-header-tags">
              ${account?.domain ? `<fw-tag text="${esc(account.domain)}" color="grey"></fw-tag>` : ""}
              ${firmo ? `<fw-tag text="${esc(firmo)} ICP fit" color="blue"></fw-tag>` : ""}
            </div>
          </div>
        </div>
        <div class="account-detail-actions">
          <fw-button color="secondary" fill="outline" data-action="prep">New prep</fw-button>
          <fw-button color="secondary" fill="outline" data-action="postcall">Post-call</fw-button>
        </div>
      </fw-card>

      ${renderLifecyclePipeline(lifecycle.stage)}

      <fw-input id="account-detail-search" class="account-detail-search" placeholder="Filter contacts, activity, artifacts…" value="${esc(detailSearchQuery)}" clear-input></fw-input>
      <p id="account-detail-no-matches" class="muted account-detail-no-matches" hidden>No matches for this filter.</p>

      <div class="account-detail-grid">
        ${renderContactsCard(contacts, lifecycle.primaryContactId, contactEventsByContactId || {})}
        ${renderMeddpiccCard(account, contacts)}
      </div>

      <fw-card class="account-activity-card account-detail-card">
        <div class="account-card-header">
          <h3 class="account-card-title">Activity</h3>
        </div>
        ${renderTimeline(events)}
      </fw-card>

      <fw-card class="account-artifacts-card account-detail-card">
        <div class="account-card-header">
          <h3 class="account-card-title">Artifacts</h3>
        </div>
        ${renderArtifactTabs(detail)}
      </fw-card>
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
    if (show) visibleCount++;
  });

  if (noMatches) {
    noMatches.hidden = !q || visibleCount > 0;
  }
}

function wireDetailSearch(container, opts) {
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

  container.querySelectorAll("[data-lifecycle-stage]").forEach((btn) => {
    btn.addEventListener("fwClick", async () => {
      const toStage = btn.getAttribute("data-lifecycle-stage");
      const lifecycleId = opts.lifecycleId;
      if (!lifecycleId || !toStage) return;
      await advanceStage(lifecycleId, toStage, sessionUserId(session));
      await renderAccountView(container, session, opts);
    });
  });

  wireDetailSearch(container, opts);
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
