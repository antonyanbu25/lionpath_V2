/**
 * Lifecycle list + detail/timeline views.
 */

import { listLifecyclesForUser, getLifecycleDetail, advanceStage } from "./domain/lifecycle-service.js";
import { sessionUserId } from "./domain/session.js";
import { STAGE_LABELS, EVENT_LABELS, LIFECYCLE_STAGES } from "./domain/types.js";
import { esc } from "./shared.js";

function formatDate(ts) {
  if (!ts) return "—";
  return new Date(ts).toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" });
}

function stageBadge(stage) {
  const label = STAGE_LABELS[stage] || stage;
  return `<span class="lifecycle-stage-badge stage-${esc(stage)}">${esc(label)}</span>`;
}

function renderLifecycleListItem(lc, account) {
  return `
    <fw-button class="lifecycle-list-item" color="secondary" fill="clear" data-id="${esc(lc.id)}">
      <div class="lifecycle-list-main">
        <span class="lifecycle-list-title">${esc(lc.title || account?.name || "Account")}</span>
        ${stageBadge(lc.stage)}
      </div>
      <div class="lifecycle-list-meta muted">
        <span>${esc(formatDate(lc.lastActivityAt))}</span>
        <span>${lc.prepCount || 0} preps · ${lc.postCallCount || 0} calls · ${lc.openTaskCount || 0} tasks</span>
      </div>
    </fw-button>`;
}

function renderTimeline(events) {
  if (!events?.length) return `<p class="muted">No events yet.</p>`;
  return `<ul class="lifecycle-timeline">
    ${events.map((ev) => `
      <li class="lifecycle-timeline-item">
        <span class="lifecycle-timeline-type">${esc(EVENT_LABELS[ev.type] || ev.type)}</span>
        <span class="lifecycle-timeline-when muted">${esc(formatDate(ev.timestamp))}</span>
      </li>`).join("")}
  </ul>`;
}

function renderArtifactTabs(detail) {
  const { preps, postCalls, tasks } = detail;
  const prepRows = (preps || []).map((p) =>
    `<li><span>${esc(formatDate(p.createdAt))}</span> — ${esc(p.meta?.company || "Prep")}</li>`
  ).join("") || `<li class="muted">No preps yet</li>`;

  const callRows = (postCalls || []).map((c) => {
    const score = c.qualityScore != null ? ` (${c.qualityScore}/10)` : "";
    return `<li><span>${esc(formatDate(c.createdAt))}</span> — ${esc(c.title || "Call")}${esc(score)}</li>`;
  }).join("") || `<li class="muted">No post-calls yet</li>`;

  const taskRows = (tasks || []).map((t) =>
    `<li><span class="task-status-${esc(t.status)}">${esc(t.status)}</span> — ${esc(t.title)}</li>`
  ).join("") || `<li class="muted">No tasks yet</li>`;

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

function renderLifecycleDetail(detail, session) {
  const { lifecycle, account, events } = detail;
  const stageOptions = LIFECYCLE_STAGES.map(
    (s) => `<fw-select-option value="${esc(s)}" ${s === lifecycle.stage ? "selected" : ""}>${esc(STAGE_LABELS[s])}</fw-select-option>`
  ).join("");

  return `
    <div class="lifecycle-detail">
      <div class="lifecycle-detail-head">
        <fw-button class="lifecycle-back" color="secondary" fill="clear" data-action="back">← All lifecycles</fw-button>
        <h2>${esc(lifecycle.title || account?.name || "Lifecycle")}</h2>
        ${stageBadge(lifecycle.stage)}
      </div>
      <div class="lifecycle-detail-controls">
        <fw-select id="lifecycle-stage-select" label="Stage" value="${esc(lifecycle.stage)}">
          ${stageOptions}
        </fw-select>
      </div>
      <section class="lifecycle-section">
        <h3>Timeline</h3>
        ${renderTimeline(events)}
      </section>
      <section class="lifecycle-section">
        <h3>Artifacts</h3>
        ${renderArtifactTabs(detail)}
      </section>
    </div>`;
}

/** @param {HTMLElement} container @param {object} session @param {{ onOpenPrep?: fn, onOpenCall?: fn, lifecycleId?: string }} opts */
export async function renderLifecycleView(container, session, opts = {}) {
  const userId = sessionUserId(session);
  if (!userId) {
    container.innerHTML = `<p class="muted">Sign in to view lifecycles.</p>`;
    return;
  }

  if (opts.lifecycleId) {
    const detail = await getLifecycleDetail(opts.lifecycleId);
    if (!detail) {
      container.innerHTML = `<p class="muted">Lifecycle not found.</p>`;
      return;
    }
    container.innerHTML = renderLifecycleDetail(detail, session);
    wireDetailEvents(container, session, opts);
    return;
  }

  const lifecycles = await listLifecyclesForUser(session);
  const accounts = await Promise.all(
    lifecycles.map(async (lc) => {
      const { getStore } = await import("./domain/store.js");
      return getStore().getAccount(lc.accountId);
    })
  );

  if (!lifecycles.length) {
    container.innerHTML = `
      <fw-card class="lifecycle-empty dew-empty-state">
        <fw-icon name="agent" size="24" aria-hidden="true"></fw-icon>
        <h2>Account lifecycles</h2>
        <p class="muted">Generate a prep or analyze a call to start your first account lifecycle.</p>
      </fw-card>`;
    return;
  }

  container.innerHTML = `
    <div class="lifecycle-list-view">
        <h2>Accounts</h2>
        <p class="muted lifecycle-list-sub">Engagements now live under <strong>Accounts</strong> — open an account to switch deals (new business vs expansion).</p>
      <div class="lifecycle-list">
        ${lifecycles.map((lc, i) => renderLifecycleListItem(lc, accounts[i])).join("")}
      </div>
    </div>`;

  container.querySelectorAll(".lifecycle-list-item").forEach((btn) => {
    btn.addEventListener("fwClick", () => {
      opts.onSelectLifecycle?.(btn.dataset.id);
    });
  });
}

function wireDetailEvents(container, session, opts) {
  container.querySelector('[data-action="back"]')?.addEventListener("fwClick", () => {
    opts.onBack?.();
  });

  const stageSelect = container.querySelector("#lifecycle-stage-select");
  stageSelect?.addEventListener("fwChange", async (ev) => {
    const toStage = ev.detail?.value || stageSelect.value;
    const lifecycleId = opts.lifecycleId;
    if (!lifecycleId || !toStage) return;
    await advanceStage(lifecycleId, toStage, sessionUserId(session));
    await renderLifecycleView(container, session, opts);
  });
}
