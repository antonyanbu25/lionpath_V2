/**
 * Accounts list + detail (CRM-style). Lifecycle remains the internal engagement spine.
 */

import { listAccountsForSession, getAccountEngagementDetail, updateAccountSeTeam } from "./domain/account-service.js";
import { advanceStage } from "./domain/lifecycle-service.js";
import { getStore } from "./domain/store.js";
import { sessionUserId } from "./domain/session.js";
import { STAGE_LABELS, EVENT_LABELS, CONTACT_EVENT_LABELS, MAX_SE_TEAM_SIZE } from "./domain/types.js";
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

export const ACTIVITY_INITIAL_VISIBLE = 10;

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

function renderLifecyclePipeline(currentStage, lensOptions, lensOwnerId) {
  const openSteps = OPEN_PIPELINE_STAGES.map((s) => renderOpenPipelineStep(s, currentStage)).join(
    `<span class="lifecycle-pipeline-connector" aria-hidden="true"></span>`
  );
  const terminalSteps = TERMINAL_STAGES.map((s) => renderTerminalStep(s, currentStage)).join("");

  const lensName = lensOptions.find((o) => o.value === lensOwnerId)?.label || "SE";
  const lensSelect =
    lensOptions.length > 1
      ? `<fw-select class="lifecycle-lens-select" label="Lifecycle lens" value="${esc(lensOwnerId)}" data-action="lifecycle-lens">
          ${lensOptions.map((o) => `<fw-select-option value="${esc(o.value)}">${esc(o.label)}</fw-select-option>`).join("")}
        </fw-select>`
      : "";

  return `
    <fw-card class="account-lifecycle-card account-detail-card">
      <div class="account-card-header">
        <div>
          <h3 class="account-card-title">Lifecycle</h3>
          ${lensOptions.length > 1 ? `<p class="muted lifecycle-lens-hint">Stage for <strong>${esc(lensName)}</strong></p>` : ""}
        </div>
        ${stageBadge(currentStage)}
      </div>
      ${lensSelect}
      <div class="lifecycle-pipeline-open" role="list" aria-label="Open pipeline stages">
        ${openSteps}
      </div>
      <div class="lifecycle-pipeline-terminal">
        <span class="lifecycle-terminal-label muted">Outcome</span>
        <div class="lifecycle-pipeline-terminal-steps">${terminalSteps}</div>
      </div>
    </fw-card>`;
}

function renderDealTeamCard(detail) {
  const { seTeamDisplay, canManageTeam, assignableSeOptions } = detail;
  const teamCount = seTeamDisplay?.length || 0;
  const canAddSe =
    canManageTeam && teamCount < MAX_SE_TEAM_SIZE && assignableSeOptions && assignableSeOptions.length > 0;

  if (!seTeamDisplay?.length) {
    return `
      <fw-card class="account-deal-team-card account-detail-card">
        <div class="account-card-header"><h3 class="account-card-title">Deal team</h3></div>
        <p class="muted">No SEs assigned yet — run prep to claim primary.</p>
      </fw-card>`;
  }

  const rows = seTeamDisplay
    .map((m) => {
      const initials = contactInitials({ name: m.user.displayName, email: m.user.displayName });
      return `
        <div class="account-deal-team-row" data-se-user-id="${esc(m.seUserId)}">
          <span class="account-contact-avatar" aria-hidden="true">${esc(initials)}</span>
          <div class="account-deal-team-info">
            <span class="account-detail-contact-name">${esc(m.user.displayName)}</span>
            ${m.user.jobTitle ? `<span class="muted account-contact-title">${esc(m.user.jobTitle)}</span>` : ""}
          </div>
          <div class="account-deal-team-trailing">
            <span class="account-deal-team-tags">
              ${m.role === "primary" ? `<fw-tag text="Primary" color="blue"></fw-tag>` : `<fw-tag text="Secondary" color="grey"></fw-tag>`}
            </span>
            ${canManageTeam ? `
              <span class="account-deal-team-actions">
                ${m.role !== "primary" ? `<fw-button color="secondary" fill="clear" size="small" data-action="set-primary" data-se-user-id="${esc(m.seUserId)}">Make primary</fw-button>` : ""}
                ${m.role !== "primary" ? `<fw-button color="danger" fill="clear" size="small" data-action="remove-se" data-se-user-id="${esc(m.seUserId)}">Remove</fw-button>` : ""}
              </span>` : ""}
          </div>
        </div>`;
    })
    .join("");

  const addSeBlock = canAddSe
    ? `<div class="account-deal-team-add">
        <fw-select
          class="account-deal-team-add-select"
          label="Add SE"
          placeholder="Select SE"
          data-action="add-se-select">
          <fw-select-option value="">Select SE</fw-select-option>
          ${assignableSeOptions
            .map(
              (o) =>
                `<fw-select-option value="${esc(o.seUserId)}">${esc(o.user.displayName)}</fw-select-option>`
            )
            .join("")}
        </fw-select>
        <fw-button color="primary" size="small" data-action="add-se">Add</fw-button>
      </div>`
    : "";

  return `
    <fw-card class="account-deal-team-card account-detail-card">
      <div class="account-card-header">
        <h3 class="account-card-title">Deal team</h3>
        <fw-tag text="${seTeamDisplay.length}" color="grey"></fw-tag>
      </div>
      <div class="account-deal-team-list">${rows}</div>
      ${addSeBlock}
      ${canManageTeam && teamCount < MAX_SE_TEAM_SIZE ? `<p class="muted account-deal-team-hint">Add SEs from your org (max 4).</p>` : ""}
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
    case "se_added":
    case "se_removed":
    case "primary_se_changed":
      return "agent";
    default:
      return "calendar-time";
  }
}

function eventCategoryPill(type) {
  const map = {
    stage_changed: ["Stage", "stage"],
    prep_generated: ["Engagement", "engagement"],
    postcall_analyzed: ["Engagement", "engagement"],
    se_added: ["Team", "team"],
    se_removed: ["Team", "team"],
    primary_se_changed: ["Team", "team"],
    task_created: ["Tasks", "tasks"],
    task_completed: ["Tasks", "tasks"],
    contact_updated: ["Contact", "contact"],
  };
  const [label, mod] = map[type] || ["Activity", "activity"];
  return `<span class="lifecycle-category-pill lifecycle-category-pill--${mod}">${esc(label)}</span>`;
}

function eventTitleSubtitle(ev, seNameById = {}) {
  const p = ev.payload || {};
  switch (ev.type) {
    case "stage_changed":
      return {
        title: "Stage updated",
        subtitle: `${STAGE_LABELS[p.fromStage] || p.fromStage || "—"} → ${STAGE_LABELS[p.toStage] || p.toStage || "—"}`,
      };
    case "prep_generated":
      return { title: "Prep generated", subtitle: p.company ? String(p.company) : "Prep brief" };
    case "postcall_analyzed":
      return {
        title: "Post-call analyzed",
        subtitle: p.qualityScore != null ? `Quality ${p.qualityScore}/10` : "Call analysis",
      };
    case "task_created":
      return { title: "Task created", subtitle: p.title ? String(p.title) : "New task" };
    case "task_completed":
      return { title: "Task completed", subtitle: p.title ? String(p.title) : "Task" };
    case "se_added": {
      const name = p.seUserId ? seNameById[p.seUserId] : "";
      return {
        title: "SE added to deal team",
        subtitle: name || (p.seUserId ? "New team member" : "New team member"),
      };
    }
    case "se_removed": {
      const name = p.seUserId ? seNameById[p.seUserId] : "";
      return { title: "SE removed from deal team", subtitle: name || "Removed" };
    }
    case "primary_se_changed":
      return { title: "Primary SE changed", subtitle: "Deal team lead updated" };
    case "contact_updated":
      if (p.contactName) {
        const fields = (p.fields || []).join(", ");
        return {
          title: "Contact updated",
          subtitle: `${p.contactName}${fields ? `: ${fields}` : ""}`,
        };
      }
      return { title: EVENT_LABELS.contact_updated || "Contact updated", subtitle: "" };
    default:
      return { title: EVENT_LABELS[ev.type] || ev.type, subtitle: "" };
  }
}

function eventDayKey(ts) {
  if (!ts) return "";
  const d = new Date(ts);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

function formatTimelineMeta(ev, seNameById = {}, options = {}) {
  const actorName = ev.actorId && seNameById[ev.actorId] ? seNameById[ev.actorId] : "";
  const ownerName = ev.lifecycleOwnerName ? String(ev.lifecycleOwnerName).trim() : "";
  const ownerSuffix =
    ownerName && actorName && ownerName.toLowerCase() !== actorName.toLowerCase() ? ownerName : "";
  const parts = [actorName ? `by ${actorName}` : "", ownerSuffix];
  if (!options.omitDate) parts.push(formatDate(ev.timestamp));
  return parts.filter(Boolean).join(" · ");
}

function groupTimelineByDay(events) {
  const sections = [];
  const indexByDay = new Map();
  for (const ev of events || []) {
    const day = eventDayKey(ev.timestamp);
    let section = indexByDay.get(day);
    if (!section) {
      section = { day, label: formatDate(ev.timestamp), events: [] };
      indexByDay.set(day, section);
      sections.push(section);
    }
    section.events.push(ev);
  }
  return sections;
}

function renderTimelineEventItem(ev, seNameById, options = {}) {
  const { title, subtitle } = eventTitleSubtitle(ev, seNameById);
  const meta = formatTimelineMeta(ev, seNameById, { omitDate: options.omitDate });
  const actorName = ev.actorId && seNameById[ev.actorId] ? seNameById[ev.actorId] : "";
  const ownerName = ev.lifecycleOwnerName ? String(ev.lifecycleOwnerName).trim() : "";
  const showOwnerSpine =
    ownerName && (!actorName || ownerName.toLowerCase() !== actorName.toLowerCase());
  const searchText = `${title} ${subtitle} ${meta}`.toLowerCase();
  const subtitleBlock =
    subtitle ?
      `<p class="lifecycle-timeline-sub muted">${esc(subtitle)}${showOwnerSpine ? ` <span class="lifecycle-timeline-spine">(${esc(ownerName)})</span>` : ""}</p>`
    : "";
  return `
        <li class="lifecycle-timeline-item lifecycle-timeline-item-rich lifecycle-timeline-item-compact" data-search-text="${esc(searchText)}">
          <fw-icon class="lifecycle-timeline-icon" name="${esc(eventIcon(ev.type))}" size="16" aria-hidden="true"></fw-icon>
          <div class="lifecycle-timeline-body">
            <div class="lifecycle-timeline-head">
              <span class="lifecycle-timeline-type">${esc(title)}</span>
              ${eventCategoryPill(ev.type)}
              ${meta ? `<span class="lifecycle-timeline-when muted">${esc(meta)}</span>` : ""}
            </div>
            ${subtitleBlock}
          </div>
        </li>`;
}

function renderTimeline(events, seNameById = {}, options = {}) {
  if (!events?.length) return `<p class="muted account-detail-empty-timeline">No activity yet.</p>`;
  const showAll = options.activityShowAll === true;
  const sorted = events || [];
  const visible = showAll ? sorted : sorted.slice(0, ACTIVITY_INITIAL_VISIBLE);
  const hiddenCount = showAll ? 0 : Math.max(0, sorted.length - visible.length);
  const daySections = groupTimelineByDay(visible);

  const body = daySections
    .map(
      (section) => `
    <li class="lifecycle-timeline-day">
      <div class="lifecycle-timeline-day-label">${esc(section.label)}</div>
      <ul class="lifecycle-timeline lifecycle-timeline-rich lifecycle-timeline-day-items">
        ${section.events.map((ev) => renderTimelineEventItem(ev, seNameById, { omitDate: true })).join("")}
      </ul>
    </li>`,
    )
    .join("");

  const showAllBtn =
    hiddenCount > 0 ?
      `<div class="account-activity-show-more-wrap">
        <fw-button id="account-activity-show-all" class="account-activity-show-all" color="secondary" fill="clear" size="small">
          Show all activities (${hiddenCount} more)
        </fw-button>
      </div>`
    : "";

  return `<ul class="lifecycle-timeline-days">${body}</ul>${showAllBtn}`;
}

/** @deprecated use eventCategoryPill in timeline */
function eventCategoryTag(type) {
  return eventCategoryPill(type);
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
  return "";
}

function influenceTag(contact) {
  const level = contact?.metadata?.influence?.level;
  if (level && level !== "unknown") {
    const label = level.charAt(0).toUpperCase() + level.slice(1);
    return `<fw-tag text="${esc(label)} influence" color="blue"></fw-tag>`;
  }
  return "";
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

/** Group contact events by type, source, and calendar day for display. */
export function summarizeContactEvents(events) {
  const groups = [];
  const indexByKey = new Map();
  for (const ev of events || []) {
    const label = formatContactEvent(ev);
    const day = eventDayKey(ev.timestamp);
    const key = `${ev.type}|${ev.payload?.source || ""}|${day}|${label}`;
    let g = indexByKey.get(key);
    if (!g) {
      g = { label, day, count: 0, timestamp: ev.timestamp };
      indexByKey.set(key, g);
      groups.push(g);
    }
    g.count += 1;
    g.timestamp = ev.timestamp;
  }
  return groups;
}

function renderLabelValue(label, value) {
  return `
    <div class="account-label-value">
      <span class="account-label-value-label">${esc(label)}</span>
      <span class="account-label-value-text">${value}</span>
    </div>`;
}

function renderContactActivityList(events) {
  const allGroups = summarizeContactEvents(events);
  const groups = allGroups.slice(0, 5);
  const restCount = allGroups.length - groups.length;
  if (!groups.length) return `<p class="muted">No contact activity yet.</p>`;
  const rows = groups
    .map(
      (g) =>
        `<li><span>${esc(g.label)}${g.count > 1 ? ` · ${g.count}×` : ""}</span><span class="muted">${esc(formatDate(g.timestamp))}</span></li>`,
    )
    .join("");
  const more =
    restCount > 0 ?
      `<details class="account-contact-activity-more"><summary>${restCount} more grouped entries</summary><ul class="account-contact-activity">${allGroups
        .slice(5)
        .map(
          (g) =>
            `<li><span>${esc(g.label)} · ${g.count}×</span><span class="muted">${esc(formatDate(g.timestamp))}</span></li>`,
        )
        .join("")}</ul></details>`
    : "";
  return `<ul class="account-contact-activity">${rows}</ul>${more}`;
}

function renderContactAccordionBody(contact, events) {
  const disc = contact.metadata?.disc;
  const influence = contact.metadata?.influence;
  const hasDisc = disc?.primary && disc.primary !== "unknown";
  const hasInfluence = influence?.level && influence.level !== "unknown";
  const evidence = disc?.evidence || [];
  const evidencePreview = evidence.slice(0, 3);
  const evidenceExtra = evidence.length - evidencePreview.length;

  const discValue = hasDisc
    ? `<strong>${esc(disc.primary)}</strong>${disc.secondary ? ` / ${esc(disc.secondary)}` : ""}
         <span class="muted"> · ${esc(disc.confidence || "low")} confidence</span>`
    : `<span class="muted">Not assessed yet</span>`;

  const influenceValue = hasInfluence
    ? `<strong>${esc(influence.level)}</strong>${influence.decisionRole && influence.decisionRole !== "unknown" ? ` · ${esc(influence.decisionRole.replace(/_/g, " "))}` : ""}`
    : `<span class="muted">Not assessed yet</span>`;

  const evidenceBlock =
    evidencePreview.length ?
      `<ul class="account-contact-evidence">${evidencePreview.map((e) => `<li>${esc(e)}</li>`).join("")}</ul>${evidenceExtra > 0 ? `<details class="account-contact-evidence-more"><summary>+${evidenceExtra} more evidence</summary><ul class="account-contact-evidence">${evidence.slice(3).map((e) => `<li>${esc(e)}</li>`).join("")}</ul></details>` : ""}`
    : "";

  return `
    <div class="account-contact-body">
      ${renderLabelValue("DISC", discValue)}
      ${hasDisc && disc?.assessedAt ? `<p class="muted account-contact-source">Updated ${esc(formatDate(disc.assessedAt))}${disc.source ? ` · ${esc(disc.source)}` : ""}</p>` : ""}
      ${evidenceBlock}
      ${renderLabelValue("Influence", influenceValue)}
      ${hasInfluence && influence?.updatedAt ? `<p class="muted account-contact-source">Updated ${esc(formatDate(influence.updatedAt))}${influence.source ? ` · ${esc(influence.source)}` : ""}</p>` : ""}
      ${!hasDisc && !hasInfluence
        ? `<fw-inline-message type="info" closable="false">Will populate from prep or post-call when evidence is available.</fw-inline-message>`
        : ""}
      <h4 class="account-contact-activity-heading">Contact activity</h4>
      ${renderContactActivityList(events)}
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

function meddpiccValueContainsName(value, name) {
  if (!value || !name) return false;
  return String(value).toLowerCase().includes(String(name).toLowerCase());
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
      let text = String(slot.value);
      if (slot.contactId && contactById.has(slot.contactId)) {
        const linked = contactById.get(slot.contactId);
        const linkedName = linked.name || linked.email || "";
        if (linkedName && !meddpiccValueContainsName(text, linkedName)) {
          text = `${slot.value} (${linkedName})`;
        }
      }
      valueHtml = `<span class="meddpicc-field-value-text" title="${esc(text)}">${esc(text)}</span>`;
    }
    return `
      <div class="meddpicc-field" data-search-text="${esc(label.toLowerCase())} ${esc(String(slot?.value || "").toLowerCase())}">
        <span class="meddpicc-letter" aria-hidden="true">${esc(letter)}</span>
        <div class="meddpicc-field-body">
          <span class="meddpicc-field-label">${esc(label)}</span>
          <span class="meddpicc-field-value">${valueHtml}</span>
          <span class="meddpicc-field-status">${meddpiccStatusTag(slot?.status)}</span>
        </div>
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

function summarizePrepArtifactRows(preps) {
  const groups = [];
  const indexByKey = new Map();
  for (const p of preps || []) {
    const company = String(p.meta?.company || "Prep").trim();
    const day = eventDayKey(p.createdAt);
    const key = `${day}|${company.toLowerCase()}`;
    let g = indexByKey.get(key);
    if (!g) {
      g = { company, createdAt: p.createdAt, count: 0 };
      indexByKey.set(key, g);
      groups.push(g);
    }
    g.count += 1;
    g.createdAt = p.createdAt;
  }
  return groups;
}

function renderArtifactTabs(detail) {
  const { preps, postCalls, tasks } = detail;
  const prepGroups = summarizePrepArtifactRows(preps);
  const prepExtra = prepGroups.length > 5 ? prepGroups.length - 5 : 0;
  const prepRows =
    prepGroups.length ?
      prepGroups
        .slice(0, 5)
        .map((g) => {
          const suffix = g.count > 1 ? ` (${g.count} preps)` : "";
          const label = `${formatDate(g.createdAt)} — ${g.company}${suffix}`;
          return artifactRow(label);
        })
        .join("") +
        (prepExtra > 0 ?
          `<li class="muted account-detail-artifact-more" data-search-text="">+${prepExtra} more prep days</li>`
        : "")
    : `<li class="muted account-detail-empty-artifacts" data-search-text="">No preps yet</li>`;

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

function renderAccountDetail(detail, detailSearchQuery = "", viewOpts = {}) {
  const { lifecycle, account, events, contacts, contactEventsByContactId, seTeamDisplay, lifecycleOwnerId } =
    detail;
  const firmo = account?.metadata?.firmographics?.suggestedProduct;

  const lensOptions = (seTeamDisplay || []).map((m) => ({
    value: m.seUserId,
    label: m.user.displayName,
  }));
  const seNameById = Object.fromEntries(
    (seTeamDisplay || []).map((m) => [m.seUserId, m.user.displayName])
  );

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

      ${renderDealTeamCard(detail)}
      ${renderLifecyclePipeline(lifecycle.stage, lensOptions, lifecycleOwnerId || lifecycle.ownerId)}

      <fw-input id="account-detail-search" class="account-detail-search" placeholder="Filter contacts, activity, artifacts…" value="${esc(detailSearchQuery)}" clear-input></fw-input>
      <p id="account-detail-no-matches" class="muted account-detail-no-matches" hidden>No matches for this filter.</p>

      <div class="account-detail-grid">
        ${renderContactsCard(contacts, lifecycle.primaryContactId, contactEventsByContactId || {})}
        ${renderMeddpiccCard(account, contacts)}
      </div>

      <fw-card class="account-activity-card account-detail-card">
        <div class="account-card-header">
          <h3 class="account-card-title">Activity</h3>
          <fw-tag text="Merged" color="grey"></fw-tag>
        </div>
        ${renderTimeline(events, seNameById, {
          activityShowAll: viewOpts.activityShowAll === true,
        })}
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

  container.querySelector("#account-activity-show-all")?.addEventListener("fwClick", async () => {
    opts.activityShowAll = true;
    opts.onActivityShowAllChange?.(true);
    await renderAccountView(container, session, opts);
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

  const lensSelect = container.querySelector('[data-action="lifecycle-lens"]');
  if (lensSelect) {
    lensSelect.addEventListener("fwChange", async () => {
      const val = await readFieldValueAsync(lensSelect);
      opts.lifecycleOwnerId = val;
      opts.onLifecycleLensChange?.(val);
      await renderAccountView(container, session, opts);
    });
  }

  container.querySelectorAll('[data-action="set-primary"]').forEach((btn) => {
    btn.addEventListener("fwClick", async () => {
      const seUserId = btn.getAttribute("data-se-user-id");
      if (!seUserId || !opts.accountId) return;
      await updateAccountSeTeam(session, opts.accountId, "set_primary", { seUserId });
      opts.onSeTeamChange?.();
      await renderAccountView(container, session, opts);
    });
  });

  container.querySelectorAll('[data-action="remove-se"]').forEach((btn) => {
    btn.addEventListener("fwClick", async () => {
      const seUserId = btn.getAttribute("data-se-user-id");
      if (!seUserId || !opts.accountId) return;
      await updateAccountSeTeam(session, opts.accountId, "remove", { seUserId });
      opts.onSeTeamChange?.();
      await renderAccountView(container, session, opts);
    });
  });

  const addSeBtn = container.querySelector('[data-action="add-se"]');
  if (addSeBtn) {
    addSeBtn.addEventListener("fwClick", async () => {
      const select = container.querySelector('[data-action="add-se-select"]');
      const seUserId = select ? await readFieldValueAsync(select) : "";
      if (!seUserId || !opts.accountId) return;
      await updateAccountSeTeam(session, opts.accountId, "add_secondary", { seUserId });
      opts.onSeTeamChange?.();
      await renderAccountView(container, session, opts);
    });
  }

  wireDetailSearch(container, opts);
}

function renderAccountListItem(row) {
  const { account, lifecycle, seTeamDisplay, secondaryCount } = row;
  const score = lifecycle.latestQualityScore != null ? `${lifecycle.latestQualityScore}/10` : "—";
  const title = account.name || lifecycle.title || "Account";
  const domain = account.domain ? `<span class="account-list-domain muted">${esc(account.domain)}</span>` : "";
  const primary = (seTeamDisplay || []).find((m) => m.role === "primary") || seTeamDisplay?.[0];
  const primaryLabel = primary?.user?.displayName
    ? `<span class="account-list-primary-se">${esc(primary.user.displayName)}</span>`
    : "";
  const secondaryTag =
    secondaryCount > 0
      ? `<fw-tag text="+${secondaryCount} SE${secondaryCount > 1 ? "s" : ""}" color="grey"></fw-tag>`
      : "";
  return `
    <fw-button class="lifecycle-list-item account-list-item" color="secondary" fill="clear" data-account-id="${esc(account.id)}">
      <div class="lifecycle-list-main">
        <span class="lifecycle-list-title">${esc(title)}</span>
        ${stageBadge(lifecycle.stage)}
        ${secondaryTag}
      </div>
      ${domain}
      <div class="lifecycle-list-meta muted">
        ${primaryLabel ? `<span>${primaryLabel}</span>` : ""}
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
    const detail = await getAccountEngagementDetail(session, opts.accountId, {
      lifecycleOwnerId: opts.lifecycleOwnerId,
    });
    if (!detail) {
      container.innerHTML = `<p class="muted">Account not found.</p>`;
      return;
    }
    container.innerHTML = renderAccountDetail(detail, opts.detailSearchQuery || "", {
      activityShowAll: opts.activityShowAll,
    });
    wireDetailEvents(container, session, {
      ...opts,
      accountId: opts.accountId,
      lifecycleId: detail.lifecycle.id,
    });
    return;
  }

  const rows = await enrichRowsWithContacts(await listAccountsForSession(session));

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
