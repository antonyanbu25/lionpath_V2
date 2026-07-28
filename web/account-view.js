/**
 * Accounts list + detail (CRM-style). Lifecycle remains the internal engagement spine.
 */

import {
  listAccountsForSession,
  getAccountEngagementDetail,
  updateAccountSeTeam,
  enrichAccountListRow,
} from "./domain/account-service.js";
import { advanceStage } from "./domain/lifecycle-service.js";
import { DEAL_TYPE_LABELS } from "./domain/deal-service.js";
import { setAccountEngagementContext } from "./domain/account-context.js";
import { getStore } from "./domain/store.js";
import { sessionUserId, withEffectiveUserId } from "./domain/session.js";
import { syncSessionWithDomainStore } from "./auth.js";
import { STAGE_LABELS, EVENT_LABELS, CONTACT_EVENT_LABELS, MAX_SE_TEAM_SIZE } from "./domain/types.js";
import { MEDDPICC_FIELD_KEYS, MEDDPICC_FIELD_LABELS, resolveDealMeddpicc } from "./domain/contact-service.js";
import { filterAccountRows } from "./search-service.js";
import { readFieldValueAsync } from "./crayons-ui.js";
import { esc } from "./shared.js";
import { formatCompactUsd, formatDealListMoneyBand } from "./deal-view.js";
import { displayMrrFromArr } from "./deal-arr-module.js";
import { renderAccountArrModule } from "./account-arr-module.js";
import { resolveCallType } from "./call-view.js";
import { resolveQipDisplay } from "./calls-list-view.js";

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

function formatDate(ts) {
  if (!ts) return "—";
  return new Date(ts).toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" });
}

function formatShortDate(ts) {
  if (!ts) return "—";
  return new Date(ts).toLocaleDateString(undefined, { month: "short", day: "numeric" });
}

function formatGeneratedSummaryMeta(generatedAt, sourceCallIds, dealCount = null) {
  const when = generatedAt ? formatDate(generatedAt) : "—";
  const count = Array.isArray(sourceCallIds) ? sourceCallIds.length : 0;
  const callLabel = count === 1 ? "1 call" : `${count} calls`;
  if (dealCount != null) {
    const dealLabel = dealCount === 1 ? "1 deal" : `${dealCount} deals`;
    return `Generated from ${callLabel} across ${dealLabel} · ${when}`;
  }
  return `Updated ${when} · from ${callLabel}`;
}

function renderGeneratedSummarySection(title, summaryDoc, emptyHint, metaOpts = {}) {
  const wireframe = metaOpts.wireframe === true;
  const cardClass = wireframe ? " account-record-section--card" : "";
  const summary = summaryDoc?.summary?.trim();
  if (!summary) {
    return `
      <section class="account-record-section account-generated-summary account-generated-summary--empty${cardClass}">
        ${
          wireframe
            ? `<p class="prep-form-eyebrow account-section-eyebrow">${esc(title)}</p>`
            : `<h3 class="account-record-section-title">${esc(title)}</h3>`
        }
        <p class="muted">${esc(emptyHint)}</p>
      </section>`;
  }
  const meta = formatGeneratedSummaryMeta(
    summaryDoc.generatedAt,
    summaryDoc.sourceCallIds,
    metaOpts.dealCount ?? null,
  );
  const firmographics = metaOpts.firmographics
    ? `<div class="account-firmographics-grid">${metaOpts.firmographics}</div>`
    : "";
  if (wireframe) {
    return `
      <section class="account-record-section account-generated-summary account-record-section--card">
        <p class="prep-form-eyebrow account-section-eyebrow">${esc(title)} · ${esc(meta)}</p>
        <p class="account-generated-summary-body">${esc(summary)}</p>
        ${firmographics}
      </section>`;
  }
  return `
    <section class="account-record-section account-generated-summary">
      <div class="account-record-section-head">
        <h3 class="account-record-section-title">${esc(title)}</h3>
        <span class="muted account-generated-summary-meta">${esc(meta)}</span>
      </div>
      <p class="account-generated-summary-body">${esc(summary)}</p>
      ${firmographics}
    </section>`;
}

export const ACTIVITY_INITIAL_VISIBLE = 10;

function stageBadge(stage) {
  const label = STAGE_LABELS[stage] || stage;
  return `<span class="lifecycle-stage-badge stage-${esc(stage)}">${esc(label)}</span>`;
}

function dealTypeTag(type) {
  const label = DEAL_TYPE_LABELS[type] || type || "Deal";
  const color = type === "expansion" ? "yellow" : "blue";
  return `<fw-tag class="account-deal-type-tag" text="${esc(label)}" color="${color}"></fw-tag>`;
}

function listMotionBadge(type) {
  const label = DEAL_TYPE_LABELS[type] || type || "—";
  const mod = type === "expansion" ? "expansion" : "new-business";
  return `<span class="account-list-motion-badge account-list-motion-badge--${mod}">${esc(label)}</span>`;
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

function renderOpenPipelineStep(stage, currentStage, stepNumber = null) {
  const state = pipelineOpenStepState(currentStage, stage);
  const label = STAGE_LABELS[stage] || stage;
  const isCurrent = state === "current";
  const isCompleted = state === "completed";
  const stepMark =
    stepNumber != null ?
      `<span class="lifecycle-pipeline-step-num" aria-hidden="true">${stepNumber}</span>`
    : "";
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
        ${stepMark}${esc(label)}
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

function renderLifecyclePipeline(currentStage, lensOptions, lensOwnerId, compact = false) {
  const openSteps = OPEN_PIPELINE_STAGES.map((s, i) =>
    renderOpenPipelineStep(s, currentStage, compact ? i + 1 : null),
  ).join(`<span class="lifecycle-pipeline-connector" aria-hidden="true"></span>`);
  const terminalSteps = TERMINAL_STAGES.map((s) => renderTerminalStep(s, currentStage)).join("");

  const lensName = lensOptions.find((o) => o.value === lensOwnerId)?.label || "SE";
  const lensSelect =
    lensOptions.length > 1 && !compact
      ? `<fw-select class="lifecycle-lens-select" label="Lifecycle lens" value="${esc(lensOwnerId)}" data-action="lifecycle-lens">
          ${lensOptions.map((o) => `<fw-select-option value="${esc(o.value)}">${esc(o.label)}</fw-select-option>`).join("")}
        </fw-select>`
      : lensOptions.length > 1 && compact
        ? `<fw-select class="lifecycle-lens-select lifecycle-lens-select--compact" label="Lens" value="${esc(lensOwnerId)}" data-action="lifecycle-lens">
          ${lensOptions.map((o) => `<fw-select-option value="${esc(o.value)}">${esc(o.label)}</fw-select-option>`).join("")}
        </fw-select>`
        : "";

  if (compact) {
    return `
      <div class="account-record-pipeline account-record-pipeline--compact account-record-pipeline--inline">
        ${lensSelect}
        <div class="lifecycle-pipeline-track lifecycle-pipeline-track--inline" role="list" aria-label="Pipeline stages">
          <div class="lifecycle-pipeline-open lifecycle-pipeline-open--compact">${openSteps}</div>
          <span class="lifecycle-pipeline-connector lifecycle-pipeline-connector--inline" aria-hidden="true"></span>
          <div class="lifecycle-pipeline-terminal lifecycle-pipeline-terminal--compact">
            <div class="lifecycle-pipeline-terminal-steps">${terminalSteps}</div>
          </div>
        </div>
      </div>`;
  }

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
      <section class="account-record-section account-deal-team-section">
        <h3 class="account-record-section-title">Deal team</h3>
        <p class="muted">No SEs assigned yet — run prep to claim primary.</p>
      </section>`;
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
    <section class="account-record-section account-deal-team-section">
      <div class="account-record-section-head">
        <h3 class="account-record-section-title">Deal team</h3>
        <fw-tag text="${seTeamDisplay.length}" color="grey"></fw-tag>
      </div>
      <div class="account-deal-team-list">${rows}</div>
      ${addSeBlock}
      ${canManageTeam && teamCount < MAX_SE_TEAM_SIZE ? `<p class="muted account-deal-team-hint">Add SEs from your org (max 4).</p>` : ""}
    </section>`;
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

function discAbbrev(contact) {
  const primary = contact?.metadata?.disc?.primary;
  if (primary && primary !== "unknown") {
    return `<span class="contact-meta-abbrev contact-meta-abbrev--disc" title="DISC ${esc(primary)}">${esc(primary)}</span>`;
  }
  return `<span class="contact-meta-abbrev contact-meta-abbrev--empty muted" title="DISC not assessed">—</span>`;
}

function influenceAbbrev(contact) {
  const level = contact?.metadata?.influence?.level;
  if (level && level !== "unknown") {
    const letter = level.charAt(0).toUpperCase();
    const full = level.charAt(0).toUpperCase() + level.slice(1);
    return `<span class="contact-meta-abbrev contact-meta-abbrev--influence contact-meta-abbrev--${esc(level)}" title="${esc(full)} influence">${esc(letter)}</span>`;
  }
  return `<span class="contact-meta-abbrev contact-meta-abbrev--empty muted" title="Influence not assessed">—</span>`;
}

function primaryContactMark(isPrimary) {
  if (!isPrimary) return "";
  return `<span class="contact-meta-abbrev contact-meta-abbrev--primary" title="Primary contact" aria-label="Primary contact">★</span>`;
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

function renderContactAccordionBody(contact, events, options = {}) {
  const { evidenceHeading = "Evidence", compactProfile = false, omitContactActivity = false } = options;
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
      `<div class="account-contact-evidence-block">
        <h4 class="account-contact-evidence-heading">${esc(evidenceHeading)}</h4>
        <ul class="account-contact-evidence">${evidencePreview.map((e) => `<li>${esc(e)}</li>`).join("")}</ul>
        ${evidenceExtra > 0 ? `<details class="account-contact-evidence-more"><summary>+${evidenceExtra} more evidence</summary><ul class="account-contact-evidence">${evidence.slice(3).map((e) => `<li>${esc(e)}</li>`).join("")}</ul></details>` : ""}
      </div>`
    : "";

  if (compactProfile) {
    return `
    <div class="account-contact-body account-contact-body--compact">
      ${evidenceBlock}
      ${!hasDisc && !hasInfluence && !evidence.length
        ? `<fw-inline-message type="info" closable="false">Will populate from prep or post-call when evidence is available.</fw-inline-message>`
        : ""}
      ${omitContactActivity ? "" : `<h4 class="account-contact-activity-heading">Contact activity</h4>${renderContactActivityList(events)}`}
    </div>`;
  }

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
      ${omitContactActivity ? "" : `<h4 class="account-contact-activity-heading">Contact activity</h4>${renderContactActivityList(events)}`}
    </div>`;
}

function resolveSelectedContactId(contacts, primaryContactId, selectedContactId) {
  if (selectedContactId && contacts?.some((c) => c.id === selectedContactId)) return selectedContactId;
  if (primaryContactId && contacts?.some((c) => c.id === primaryContactId)) return primaryContactId;
  return contacts?.[0]?.id || null;
}

function renderContactSelectedDetail(contact, events, isPrimary) {
  if (!contact) return "";
  const influence = contact.metadata?.influence;
  const roleLabel =
    influence?.decisionRole && influence.decisionRole !== "unknown"
      ? influence.decisionRole.replace(/_/g, " ")
      : "";
  const roleTag =
    roleLabel ?
      `<fw-tag class="account-contact-role-tag" text="${esc(roleLabel)}" color="blue"></fw-tag>`
    : "";

  return `
    <div class="account-contact-selected-panel" data-contact-id="${esc(contact.id)}">
      <div class="account-contact-detail-hero account-contact-detail-hero--inline">
        <span class="account-contact-avatar account-contact-detail-avatar" aria-hidden="true">${esc(contactInitials(contact))}</span>
        <div class="account-contact-selected-main">
          <h4 class="account-contact-detail-name">${esc(contact.name || contact.email)}</h4>
          ${contact.title ? `<p class="muted account-contact-selected-title">${esc(contact.title)}</p>` : ""}
          ${contact.email ? `<p><a class="account-contact-detail-email" href="mailto:${esc(contact.email)}">${esc(contact.email)}</a></p>` : ""}
          <div class="account-contact-detail-badges">
            ${discAbbrev(contact)}
            ${influenceAbbrev(contact)}
            ${primaryContactMark(isPrimary)}
            ${roleTag}
          </div>
        </div>
      </div>
      ${renderContactAccordionBody(contact, events, { compactProfile: true, evidenceHeading: "Evidence" })}
    </div>`;
}

function healthTag(health) {
  if (!health?.label) return `<span class="muted">—</span>`;
  const color = health.tone === "green" ? "green" : health.tone === "red" ? "red" : "yellow";
  return `<fw-tag text="${esc(health.label)}" color="${color}"></fw-tag>`;
}

function tractionTag(traction) {
  const t = traction || "warm";
  const color = t === "hot" ? "green" : t === "cold" ? "red" : "yellow";
  const label = t.charAt(0).toUpperCase() + t.slice(1);
  return `<fw-tag text="${esc(label)}" color="${color}"></fw-tag>`;
}

function meddpiccListTag(score) {
  const s = score ?? 0;
  const color = s >= 70 ? "green" : s >= 50 ? "yellow" : "red";
  return `<fw-tag text="${esc(String(s))}" color="${color}"></fw-tag>`;
}

function qipListTag(postCall, scorecard) {
  const record = { scorecard, analysis: postCall?.analysis, qualityScore: postCall?.qualityScore };
  const qip = resolveQipDisplay(record);
  if (qip.label === "—" && postCall?.qualityScore != null) {
    const s = postCall.qualityScore;
    const color = s >= 70 ? "green" : s >= 50 ? "yellow" : "red";
    return `<fw-tag text="${esc(String(s))}" color="${color}"></fw-tag>`;
  }
  if (qip.label === "—") return `<span class="muted">—</span>`;
  const num = parseInt(String(qip.label).replace(/[^\d]/g, ""), 10);
  const color = num >= 70 ? "green" : num >= 50 ? "yellow" : "red";
  return `<fw-tag text="${esc(qip.label)}" color="${color}"></fw-tag>`;
}

function callTypeTag(callType) {
  const labels = {
    demo: "Demo",
    discovery: "Discovery",
    qa: "Q&A",
    technical_deep_dive: "Technical",
    reverse_demo: "Reverse demo",
    trial_setup: "Trial setup",
    troubleshooting: "Troubleshooting",
  };
  const label = labels[callType] || callType || "Call";
  return `<fw-tag text="${esc(label)}" color="blue"></fw-tag>`;
}

function renderFirmographicsGrid(firmographics) {
  if (!firmographics) return "";
  const rows = [
    ["Industry", firmographics.industry],
    ["Region", firmographics.region],
    ["Sub-region", firmographics.subRegion],
    ["HQ", firmographics.hq],
    ["Support agents", firmographics.supportAgents],
    ["Incumbent", firmographics.incumbent],
    ["Competitor", firmographics.competitor],
  ];
  return rows
    .map(
      ([label, value]) =>
        `<div class="account-firmographics-row"><span class="muted">${esc(label)}</span><span>${esc(String(value ?? "—"))}</span></div>`,
    )
    .join("");
}

function renderAccountDealsTable(dealRows, tableOpts = {}) {
  const wireframe = tableOpts.wireframe === true;
  const crossSellHint = tableOpts.crossSellHint || "";
  const cardClass = wireframe ? " account-record-section--card" : "";

  if (!dealRows?.length) {
    return `
      <section class="account-record-section account-deals-on-account${cardClass}">
        ${
          wireframe
            ? `<p class="prep-form-eyebrow account-section-eyebrow">Deals on this account</p>`
            : `<h3 class="account-record-section-title">Deals on this account</h3>`
        }
        <p class="muted">No deals yet — start with New prep.</p>
        ${crossSellHint}
      </section>`;
  }

  const body = dealRows
    .map(({ deal, arrLow, arrHigh, arrPoint, productLabel, traction, primarySeName }) => {
      const title = deal.title || DEAL_TYPE_LABELS[deal.type] || "Deal";
      const arrCell = formatDealListMoneyBand(arrLow, arrHigh, arrPoint);
      const mrrCell = formatDealListMoneyBand(
        arrLow != null ? displayMrrFromArr(arrLow) : null,
        arrHigh != null ? displayMrrFromArr(arrHigh) : null,
        arrPoint != null ? displayMrrFromArr(arrPoint) : null,
      );
      return `
        <tr class="account-deals-on-account-row" data-action="open-opportunity" data-deal-id="${esc(deal.id)}" tabindex="0" role="button">
          <td class="account-deals-on-account-name">${esc(title)}</td>
          <td>${esc(productLabel)}</td>
          <td>${stageBadge(deal.stage)}</td>
          <td class="account-list-num">${esc(arrCell)}</td>
          <td class="account-list-num">${esc(mrrCell)}</td>
          <td class="muted">${esc(primarySeName)}</td>
          <td>${traction ? tractionTag(traction) : `<span class="muted">—</span>`}</td>
        </tr>`;
    })
    .join("");

  return `
    <section class="account-record-section account-deals-on-account${cardClass}">
      ${
        wireframe
          ? `<p class="prep-form-eyebrow account-section-eyebrow account-deals-eyebrow">Deals on this account</p>`
          : `<div class="account-record-section-head">
        <h3 class="account-record-section-title">Deals on this account</h3>
        <fw-tag text="${dealRows.length}" color="grey"></fw-tag>
      </div>`
      }
      <div class="account-deals-on-account-wrap">
        <table class="account-deals-on-account-table">
          <thead>
            <tr>
              <th scope="col">Deal</th>
              <th scope="col">Product</th>
              <th scope="col">Stage</th>
              <th scope="col">ARR</th>
              <th scope="col">MRR</th>
              <th scope="col">SE</th>
              <th scope="col">Traction</th>
            </tr>
          </thead>
          <tbody>${body}</tbody>
        </table>
      </div>
      ${crossSellHint}
    </section>`;
}

function renderAccountCallsTable(accountCalls, tableOpts = {}) {
  const wireframe = tableOpts.wireframe === true;
  const cardClass = wireframe ? " account-record-section--card" : "";

  if (!accountCalls?.length) {
    return `
      <section class="account-record-section account-calls-on-account${cardClass}">
        ${
          wireframe
            ? `<p class="prep-form-eyebrow account-section-eyebrow">All calls on this account</p>`
            : `<h3 class="account-record-section-title">All calls on this account</h3>`
        }
        <p class="muted">No calls yet — run post-call to add the first one.</p>
      </section>`;
  }

  const rows = accountCalls
    .map(({ postCall, dealLabel, ownerName, meddpiccScore, scorecard }) => {
      const title =
        postCall.title ||
        postCall.analysis?.callHeader?.title ||
        postCall.analysis?.company ||
        "Call";
      const callType = resolveCallType({ scorecard, analysis: postCall.analysis });
      return `
        <tr class="account-calls-on-account-row" data-call-id="${esc(postCall.id)}" tabindex="0" role="button">
          <td class="account-calls-on-account-title">${esc(title)}</td>
          <td>${callTypeTag(callType)}</td>
          <td class="muted${wireframe ? " account-calls-date-short" : ""}">${esc(wireframe ? formatShortDate(postCall.createdAt) : formatDate(postCall.createdAt))}</td>
          <td class="muted">${esc(dealLabel)}</td>
          <td class="muted">${esc(ownerName)}</td>
          <td>${qipListTag(postCall, scorecard)}</td>
          <td>${meddpiccScore != null ? meddpiccListTag(meddpiccScore) : `<span class="muted">—</span>`}</td>
        </tr>`;
    })
    .join("");

  return `
    <section class="account-record-section account-calls-on-account${cardClass}">
      ${
        wireframe
          ? `<p class="prep-form-eyebrow account-section-eyebrow account-calls-eyebrow">All calls on this account</p>`
          : `<div class="account-record-section-head">
        <h3 class="account-record-section-title">All calls on this account</h3>
        <fw-tag text="${accountCalls.length}" color="grey"></fw-tag>
      </div>`
      }
      <div class="account-calls-on-account-wrap">
        <table class="account-calls-on-account-table">
          <thead>
            <tr>
              <th scope="col">Call</th>
              <th scope="col">Type</th>
              <th scope="col">Date</th>
              <th scope="col">Deal</th>
              <th scope="col">SE</th>
              <th scope="col">QIP</th>
              <th scope="col">MEDPICC</th>
            </tr>
          </thead>
          <tbody>${rows}</tbody>
        </table>
      </div>
    </section>`;
}

function renderAccountGapsPlaceholder(sectionOpts = {}) {
  const wireframe = sectionOpts.wireframe === true;
  const cardClass = wireframe ? " account-record-section--card" : "";
  return `
    <section class="account-record-section account-gaps-section${cardClass}">
      ${
        wireframe
          ? `<p class="prep-form-eyebrow account-section-eyebrow">Product gaps raised by this account</p>`
          : `<h3 class="account-record-section-title">Product gaps raised by this account</h3>`
      }
      <div class="account-gaps-placeholder">
        <p class="muted">Gap clustering arrives in Phase 3 — product signal roll-up across calls.</p>
      </div>
    </section>`;
}

function renderEvaluationPanels(rollup, panelOpts = {}) {
  const wireframe = panelOpts.wireframe === true;
  const reason = rollup?.reasonForEvaluation;
  const whyAi = rollup?.whyAi;
  const reasonText =
    typeof reason === "object" && reason?.value ? String(reason.value) : reason ? String(reason) : "";
  const whyAiText =
    typeof whyAi === "object" && whyAi?.value ? String(whyAi.value) : whyAi ? String(whyAi) : "";

  if (wireframe) {
    return `
      <section class="account-record-section account-reason-section account-record-section--card account-record-section--tight">
        <p class="prep-form-eyebrow account-section-eyebrow">Reason for evaluation</p>
        ${reasonText ? `<p class="account-reason-body">${esc(reasonText)}</p>` : `<p class="muted">Not captured yet — surfaces from technical commit after post-call.</p>`}
        ${reasonText ? `<p class="muted account-eval-footnote">Compelling event · from post-call analysis</p>` : ""}
      </section>
      <section class="account-record-section account-why-ai-section account-record-section--card account-record-section--tight">
        <p class="prep-form-eyebrow account-section-eyebrow">Why AI</p>
        ${whyAiText ? `<p class="account-why-ai-body">${esc(whyAiText)}</p>` : `<p class="muted">Not captured yet — AI attach narrative appears after a demo or discovery call.</p>`}
        ${whyAiText ? `<p class="muted account-eval-footnote">AI attach narrative · from post-call analysis</p>` : ""}
      </section>`;
  }

  return `
    <section class="account-record-section account-reason-section">
      <h3 class="account-record-section-title">Reason for evaluation</h3>
      ${reasonText ? `<p class="account-reason-body">${esc(reasonText)}</p>` : `<p class="muted">Not captured yet — surfaces from technical commit after post-call.</p>`}
    </section>
    <section class="account-record-section account-why-ai-section">
      <h3 class="account-record-section-title">Why AI</h3>
      ${whyAiText ? `<p class="account-why-ai-body">${esc(whyAiText)}</p>` : `<p class="muted">Not captured yet — AI attach narrative appears after a demo or discovery call.</p>`}
    </section>`;
}

function renderCrossSellEmptyHint(detail, wireframe = false) {
  const { deals, accountRollup } = detail;
  const active = (deals || []).filter((d) => d.status === "active");
  if (active.length !== 1) return "";
  const unquant = accountRollup?.arrRollup?.discussedUnquantified || [];
  const gaps = accountRollup?.arrRollup?.crossSellGaps || [];
  if (!unquant.length && !gaps.length) return "";
  const hint =
    unquant[0]?.evidence ||
    (gaps[0] ? `${gaps[0].label} attached on one deal but not the other` : "");
  if (!hint) return "";
  if (wireframe) {
    return `<div class="account-cross-sell-hint account-cross-sell-hint--wire"><p class="muted">No second deal yet. ${esc(hint)}</p></div>`;
  }
  return `<div class="account-cross-sell-hint"><p class="muted">No second deal yet. ${esc(hint)} — worth a cross-sell conversation.</p></div>`;
}

function renderAccountHeaderArr(detail) {
  const band = detail.accountRollup?.arrRollup?.estimateBand;
  if (!band) return "";
  const label = formatDealListMoneyBand(band.low, band.high, band.point);
  return `
    <div class="account-header-arr">
      <div class="account-header-arr-value">${esc(label)}</div>
      <div class="account-header-arr-label muted">total account ARR · estimate</div>
    </div>`;
}

function renderContactsPanel(
  contacts,
  primaryContactId,
  contactEventsByContactId,
  accountId,
  selectedContactId,
  hasEconomicBuyer = true,
  panelOpts = {},
) {
  void accountId;
  const sidebarCompact = panelOpts.sidebarCompact === true;
  const totalCalls = panelOpts.totalCalls ?? null;
  if (!contacts?.length) {
    return `
      <section class="account-record-section account-contacts-section${sidebarCompact ? " account-record-section--card account-record-section--tight" : ""}">
        ${
          sidebarCompact
            ? `<p class="prep-form-eyebrow account-section-eyebrow">Contacts</p>`
            : `<h3 class="account-record-section-title">Contacts</h3>`
        }
        <p class="muted account-detail-empty-contacts">No contacts yet — add prospect emails in prep.</p>
      </section>`;
  }

  const activeId = resolveSelectedContactId(contacts, primaryContactId, selectedContactId);
  const selected = contacts.find((c) => c.id === activeId) || contacts[0];
  const isPrimarySelected = primaryContactId && selected?.id === primaryContactId;
  const showSelectedPanel = Boolean(selectedContactId) || !sidebarCompact;

  const rows = contacts
    .map((c) => {
      const searchText = [c.name, c.email, c.title, c.metadata?.disc?.primary, c.metadata?.influence?.level]
        .filter(Boolean)
        .join(" ");
      const isPrimary = primaryContactId && c.id === primaryContactId;
      const isSelected = c.id === selected?.id;
      const events = contactEventsByContactId[c.id] || [];
      const touchCount = events.length;
      const callMeta =
        totalCalls != null && totalCalls > 0
          ? `${touchCount} of ${totalCalls} calls`
          : touchCount
            ? `${touchCount} touchpoint${touchCount === 1 ? "" : "s"}`
            : "";
      const subLine = [c.title, callMeta].filter(Boolean).join(" · ");

      if (sidebarCompact) {
        return `
          <button
            type="button"
            class="account-contact-row account-contact-row--selectable account-contact-row--sidebar-compact${isSelected ? " account-contact-row--selected" : ""}"
            data-action="select-contact"
            data-contact-id="${esc(c.id)}"
            data-search-text="${esc(searchText.toLowerCase())}"
            aria-pressed="${isSelected ? "true" : "false"}"
          >
            <span class="account-contact-avatar account-contact-row-avatar" aria-hidden="true">${esc(contactInitials(c))}</span>
            <span class="account-contact-row-main">
              <span class="account-detail-contact-name account-contact-row-name-text">${esc(c.name || c.email)}</span>
              ${subLine ? `<span class="muted account-contact-row-sub">${esc(subLine)}</span>` : ""}
            </span>
          </button>`;
      }

      return `
        <button
          type="button"
          class="account-contact-row account-contact-row--selectable${isSelected ? " account-contact-row--selected" : ""}"
          data-action="select-contact"
          data-contact-id="${esc(c.id)}"
          data-search-text="${esc(searchText.toLowerCase())}"
          aria-pressed="${isSelected ? "true" : "false"}"
        >
          <span class="account-contact-avatar account-contact-row-avatar" aria-hidden="true">${esc(contactInitials(c))}</span>
          <span class="account-contact-row-main">
            <span class="account-detail-contact-name account-contact-row-name-text">${esc(c.name || c.email)}</span>
            ${c.title ? `<span class="muted account-contact-row-title">${esc(c.title)}</span>` : ""}
            <span class="account-contact-row-badges">
              ${discAbbrev(c)}
              ${influenceAbbrev(c)}
              ${primaryContactMark(isPrimary)}
            </span>
          </span>
        </button>`;
    })
    .join("");

  const listClass = sidebarCompact
    ? "account-contacts-sidebar-list"
    : "account-contacts-list-scroll account-contacts-row-list";

  return `
    <section class="account-record-section account-contacts-section account-contacts-split${sidebarCompact ? " account-contacts-section--sidebar-compact account-record-section--card account-record-section--tight" : ""}">
      ${
        sidebarCompact
          ? `<p class="prep-form-eyebrow account-section-eyebrow">Contacts</p>`
          : `<div class="account-record-section-head">
        <h3 class="account-record-section-title">Contacts</h3>
        <fw-tag text="${contacts.length}" color="grey"></fw-tag>
      </div>`
      }
      <div class="${listClass}">${rows}</div>
      ${
        !hasEconomicBuyer
          ? `<div class="account-economic-buyer-empty">No economic buyer identified</div>`
          : ""
      }
      ${
        showSelectedPanel
          ? renderContactSelectedDetail(selected, contactEventsByContactId[selected.id] || [], isPrimarySelected)
          : ""
      }
    </section>`;
}

function renderDealTeamSection(detail) {
  return renderDealTeamCard(detail);
}

function renderMeddpiccSection(detail) {
  const { account, contacts, selectedDeal } = detail;
  return renderMeddpiccCard(selectedDeal, account, contacts);
}

function primaryContactForDetail(detail) {
  const { contacts, lifecycle } = detail;
  const id = lifecycle?.primaryContactId;
  if (!id || !contacts?.length) return null;
  return contacts.find((c) => c.id === id) || null;
}

function metaRailCell(label, valueHtml, extraClass = "") {
  if (!valueHtml) return "";
  const cls = extraClass ? ` ${extraClass}` : "";
  return `
    <div class="account-meta-rail__cell${cls}">
      <span class="account-meta-rail__label">${esc(label)}</span>
      <span class="account-meta-rail__value">${valueHtml}</span>
    </div>`;
}

function resolveDealTypeValue(detail) {
  const { deals, selectedDealId, selectedDeal, selectedDealType, account } = detail;
  const actives = activeDeals(deals);
  const selected =
    selectedDeal || deals?.find((d) => d.id === selectedDealId) || actives[0] || deals?.[0];
  return (
    selected?.type ||
    selectedDealType ||
    account?.metadata?.engagementOverride?.dealType ||
    "new_business"
  );
}

function renderDealTypeSelect(detail) {
  const typeValue = resolveDealTypeValue(detail);
  return `
    <fw-select
      class="account-deal-type-select account-meta-rail-type-select"
      label="Type"
      data-action="deal-type-select"
      value="${esc(typeValue)}">
      <fw-select-option value="new_business">${esc(DEAL_TYPE_LABELS.new_business)}</fw-select-option>
      <fw-select-option value="expansion">${esc(DEAL_TYPE_LABELS.expansion)}</fw-select-option>
    </fw-select>`;
}

function renderMetaRail(detail, railOpts = {}) {
  const { lifecycle, seTeamDisplay, events } = detail;
  const primary = primaryContactForDetail(detail);
  const primarySe = (seTeamDisplay || []).find((m) => m.role === "primary") || seTeamDisplay?.[0];
  const lastActivityTs =
    lifecycle?.lastActivityAt ||
    (events?.length ? events[0]?.timestamp : null);

  const primaryContactHtml = primary
    ? `<span class="account-summary-primary-contact"><strong>${esc(primary.name || primary.email)}</strong></span>`
    : "";

  const cells = [
    metaRailCell("Primary contact", primaryContactHtml, "account-meta-rail__cell--contact"),
    metaRailCell(
      "Primary SE",
      primarySe?.user?.displayName ? esc(primarySe.user.displayName) : "",
    ),
    metaRailCell("Last activity", lastActivityTs ? esc(formatDate(lastActivityTs)) : ""),
  ].filter(Boolean);

  if (railOpts.showDealType) {
    cells.push(
      metaRailCell(
        "Type",
        renderDealTypeSelect(detail),
        "account-meta-rail__cell--type",
      ),
    );
  }

  if (!cells.length) return "";

  return `
    <div class="account-meta-rail" aria-label="Account summary">
      ${cells.join("")}
    </div>`;
}

function shouldShowDealsSection(deals) {
  const list = deals || [];
  if (!list.length) return false;
  const hasNonActive = list.some((d) => d.status === "archived" || d.status === "paused");
  return list.length > 2 || hasNonActive;
}

function renderAccountOpportunitiesSection(detail) {
  const { deals } = detail;
  const sorted = [...(deals || [])].sort((a, b) => {
    const aActive = a.status === "active" ? 0 : 1;
    const bActive = b.status === "active" ? 0 : 1;
    if (aActive !== bActive) return aActive - bActive;
    return (b.updatedAt || 0) - (a.updatedAt || 0);
  });

  if (!sorted.length) {
    return `
      <section class="account-record-section account-opportunities-section">
        <h3 class="account-record-section-title">Opportunities</h3>
        <p class="muted">No deals yet — start with New prep on an active pursuit.</p>
      </section>`;
  }

  const rows = sorted
    .map((d) => {
      const typeLabel = DEAL_TYPE_LABELS[d.type] || d.type || "Deal";
      const stageLabel = STAGE_LABELS[d.stage] || d.stage || "—";
      const statusLabel = d.status === "archived" ? "Archived" : d.status === "paused" ? "Paused" : "Active";
      const title = d.title ? esc(d.title) : typeLabel;
      const searchText = `${title} ${typeLabel} ${stageLabel} ${statusLabel}`.toLowerCase();
      return `
        <tr
          class="account-deals-row account-opportunities-row"
          data-action="open-opportunity"
          data-deal-id="${esc(d.id)}"
          data-search-text="${esc(searchText)}"
          tabindex="0"
          role="button"
        >
          <td><span class="account-opportunities-name">${title}</span></td>
          <td>${dealTypeTag(d.type)}</td>
          <td>${stageBadge(d.stage)}</td>
          <td><span class="muted">${esc(statusLabel)}</span></td>
          <td class="account-opportunities-open-col"><span class="account-opportunities-open muted">Open →</span></td>
        </tr>`;
    })
    .join("");

  return `
    <section class="account-record-section account-opportunities-section">
      <div class="account-record-section-head">
        <h3 class="account-record-section-title">Opportunities</h3>
        <fw-tag text="${sorted.length}" color="grey"></fw-tag>
      </div>
      <p class="muted account-opportunities-hint">Open an opportunity to run pipeline, qualification, and activity.</p>
      <table class="account-deals-table account-opportunities-table">
        <thead>
          <tr>
            <th scope="col">Name</th>
            <th scope="col">Motion</th>
            <th scope="col">Stage</th>
            <th scope="col">Status</th>
            <th scope="col"><span class="visually-hidden">Action</span></th>
          </tr>
        </thead>
        <tbody>${rows}</tbody>
      </table>
    </section>`;
}

function renderDealsListSection(detail) {
  const { deals, selectedDealId } = detail;
  if (!shouldShowDealsSection(deals)) return "";

  const sorted = [...(deals || [])].sort((a, b) => {
    const aActive = a.status === "active" ? 0 : 1;
    const bActive = b.status === "active" ? 0 : 1;
    if (aActive !== bActive) return aActive - bActive;
    return (b.updatedAt || 0) - (a.updatedAt || 0);
  });

  const rows = sorted
    .map((d) => {
      const typeLabel = DEAL_TYPE_LABELS[d.type] || d.type || "Deal";
      const stageLabel = STAGE_LABELS[d.stage] || d.stage || "—";
      const statusLabel = d.status === "archived" ? "Archived" : d.status === "paused" ? "Paused" : "Active";
      const selected = d.id === selectedDealId;
      const searchText = `${typeLabel} ${stageLabel} ${statusLabel}`.toLowerCase();
      return `
        <tr
          class="account-deals-row${selected ? " account-deals-row--selected" : ""}"
          data-action="select-deal"
          data-deal-id="${esc(d.id)}"
          data-search-text="${esc(searchText)}"
          tabindex="0"
          role="button"
          aria-pressed="${selected ? "true" : "false"}"
        >
          <td>${dealTypeTag(d.type)}</td>
          <td>${stageBadge(d.stage)}</td>
          <td><span class="muted">${esc(statusLabel)}</span></td>
        </tr>`;
    })
    .join("");

  return `
    <details class="account-deals-details account-record-section">
      <summary class="account-deals-summary">
        <span class="account-deals-summary-title">Deals</span>
        <fw-tag text="${sorted.length}" color="grey"></fw-tag>
      </summary>
      <div class="account-deals-body">
        <table class="account-deals-table">
          <thead>
            <tr>
              <th scope="col">Type</th>
              <th scope="col">Stage</th>
              <th scope="col">Status</th>
            </tr>
          </thead>
          <tbody>${rows}</tbody>
        </table>
      </div>
    </details>`;
}

function meddpiccValueContainsName(value, name) {
  if (!value || !name) return false;
  return String(value).toLowerCase().includes(String(name).toLowerCase());
}

function meddpiccFilledCount(med) {
  if (!med) return 0;
  return MEDDPICC_FIELD_KEYS.filter((key) => {
    const slot = med[key];
    return slot?.value && slot.status !== "unknown";
  }).length;
}

function renderMeddpiccCard(deal, account, contacts) {
  if (!deal) {
    return `
      <section class="account-record-section account-meddpicc-empty">
        <p class="muted">Select a deal type with an active opportunity to view qualification.</p>
      </section>`;
  }
  const med = resolveDealMeddpicc(deal, account);
  const typeLabel = DEAL_TYPE_LABELS[deal.type] || deal.type || "Deal";
  const score = med?.completionScore ?? 0;
  const filled = meddpiccFilledCount(med);
  const total = MEDDPICC_FIELD_KEYS.length;
  const contactById = new Map((contacts || []).map((c) => [c.id, c]));

  const fields = MEDDPICC_FIELD_KEYS.map((key) => {
    const slot = med?.[key];
    const label = MEDDPICC_FIELD_LABELS[key] || key;
    const letter = MEDDPICC_LETTERS[key] || label.charAt(0);
    let tooltip = "";
    if (slot?.value) {
      let text = String(slot.value);
      if (slot.contactId && contactById.has(slot.contactId)) {
        const linked = contactById.get(slot.contactId);
        const linkedName = linked.name || linked.email || "";
        if (linkedName && !meddpiccValueContainsName(text, linkedName)) {
          text = `${slot.value} (${linkedName})`;
        }
      }
      tooltip = text;
    }
    return `
      <div class="meddpicc-field meddpicc-field--compact" data-search-text="${esc(label.toLowerCase())} ${esc(String(slot?.value || "").toLowerCase())}"${tooltip ? ` title="${esc(tooltip)}"` : ""}>
        <span class="meddpicc-letter" aria-hidden="true">${esc(letter)}</span>
        <div class="meddpicc-field-body">
          <span class="meddpicc-field-label">${esc(label)}</span>
          <span class="meddpicc-field-status">${meddpiccStatusTag(slot?.status)}</span>
        </div>
      </div>`;
  }).join("");

  return `
    <details class="account-meddpicc-details account-meddpicc-details--expanded account-record-section" open>
      <summary class="account-meddpicc-summary">
        <span class="account-meddpicc-summary-title">Deal qualification (MEDDPICC)</span>
        <fw-tag text="${score}% · ${filled}/${total}" color="grey"></fw-tag>
      </summary>
      <div class="account-meddpicc-body">
        <p class="muted account-meddpicc-deal-type">For: ${esc(typeLabel)}</p>
        <div class="meddpicc-progress" role="progressbar" aria-valuenow="${score}" aria-valuemin="0" aria-valuemax="100">
          <div class="meddpicc-progress-bar" style="width: ${Math.max(0, Math.min(100, score))}%"></div>
        </div>
        <div class="meddpicc-field-grid meddpicc-field-grid--sidebar">${fields}</div>
        ${med?.lastUpdatedAt ? `<p class="muted meddpicc-updated">Last updated ${esc(formatDate(med.lastUpdatedAt))}</p>` : ""}
      </div>
    </details>`;
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

  return { prepRows, callRows, taskRows, preps, postCalls, tasks };
}

/** @param {import("./types.js").Deal[] | undefined} deals */
function activeDeals(deals) {
  return (deals || []).filter((d) => d.status === "active");
}

function renderPursuitBar(detail, lensOptions, lifecycleOwnerId) {
  const { deals, selectedDealId, selectedDeal, lifecycle } = detail;
  const actives = activeDeals(deals);
  const typeValue = resolveDealTypeValue(detail);
  const activeForType = actives.find((d) => d.type === typeValue);
  const selected =
    selectedDeal || deals?.find((d) => d.id === selectedDealId) || actives[0] || deals?.[0];

  const typeHint =
    !activeForType ?
      `<p class="muted account-deal-type-empty-hint">No active ${esc(DEAL_TYPE_LABELS[typeValue] || typeValue)} deal — run New prep to create one.</p>`
    : "";

  const lensSelect =
    lensOptions.length > 1
      ? `<fw-select class="lifecycle-lens-select lifecycle-lens-select--compact" label="Lens" value="${esc(lifecycleOwnerId || lifecycle.ownerId)}" data-action="lifecycle-lens">
          ${lensOptions.map((o) => `<fw-select-option value="${esc(o.value)}">${esc(o.label)}</fw-select-option>`).join("")}
        </fw-select>`
      : "";

  const pipelineHtml =
    selected || activeForType ?
      renderLifecyclePipeline(lifecycle.stage, [], lifecycleOwnerId || lifecycle.ownerId, true)
    : `<p class="muted account-deal-type-empty-hint account-deal-type-empty-hint--pipeline">No active deal for this type — stage updates apply after a deal exists.</p>`;

  return `
    <div class="account-pursuit-band account-pursuit-bar account-pursuit-bar--pipeline-only" aria-label="Pipeline">
      <div class="account-pursuit-command account-pursuit-command--pipeline-only">
        ${typeHint}
        <div class="account-pursuit-command__stage">
          <div class="account-pursuit-command__stage-head">
            <span class="account-pursuit-command__eyebrow">Sales stage</span>
            ${lensSelect}
          </div>
          <div class="account-pursuit-command__pipeline">${pipelineHtml}</div>
        </div>
      </div>
    </div>`;
}

function isOpportunityRecordView(opts = {}) {
  return typeof opts.dealId === "string" && opts.dealId.length > 0;
}

function renderCommandChrome(detail, chromeOpts = {}) {
  const { account, lifecycle } = detail;
  const title = account?.name || lifecycle?.title || "Account";
  const firmo = detail.accountRollup?.firmographics;
  const subtitleParts = [
    account?.domain,
    firmo?.region !== "—" ? firmo?.region : null,
    firmo?.subRegion !== "—" ? firmo?.subRegion : null,
    firmo?.hq !== "—" ? firmo?.hq : null,
    firmo?.supportAgents !== "—" ? `${firmo?.supportAgents} support agents` : null,
  ].filter(Boolean);
  const domainLine = subtitleParts.length
    ? `<p class="account-command-header-domain muted">${esc(subtitleParts.join(" · "))}</p>`
    : account?.domain
      ? `<p class="account-command-header-domain muted">${esc(account.domain)}</p>`
      : "";
  const backAction = chromeOpts.backAction || "back";
  const backLabel = chromeOpts.backLabel || "← All accounts";
  const headerArr = chromeOpts.showAccountArr ? renderAccountHeaderArr(detail) : "";
  const overviewWireframe = chromeOpts.overviewWireframe === true;
  const headerWireClass = overviewWireframe ? " account-command-header--overview-wire" : "";

  return `
    <div class="account-command-chrome">
      <header class="account-record-header account-command-header account-command-header--with-arr${headerWireClass}">
        <fw-button class="lifecycle-back" color="secondary" fill="clear" data-action="${esc(backAction)}">${esc(backLabel)}</fw-button>
        <div class="account-header-main account-command-header-title">
          <h2>${esc(title)}</h2>
          ${domainLine}
        </div>
        ${headerArr}
        <div class="account-detail-actions account-command-header-actions">
          <fw-button color="secondary" fill="outline" size="small" data-action="postcall">Post-call</fw-button>
          <fw-button color="primary" fill="solid" size="small" data-action="prep">New prep</fw-button>
        </div>
      </header>
      ${overviewWireframe ? "" : renderMetaRail(detail, { showDealType: chromeOpts.showDealTypeInRail === true })}
    </div>`;
}

function renderRightTabs(detail, events, seNameById, viewOpts, detailSearchQuery = "") {
  const { prepRows, callRows, taskRows, preps, postCalls, tasks } = renderArtifactTabs(detail);
  const activityHtml = renderTimeline(events, seNameById, {
    activityShowAll: viewOpts.activityShowAll === true,
  });

  return `
    <section class="account-record-section account-record-tabs-section">
      <div class="account-record-tabs-head">
        <fw-input id="account-detail-search" class="account-detail-search" placeholder="Filter activity & artifacts…" value="${esc(detailSearchQuery)}" clear-input></fw-input>
      </div>
      <p id="account-detail-no-matches" class="muted account-detail-no-matches" hidden>No matches for this filter.</p>
      <fw-tabs class="account-record-tabs lifecycle-artifact-tabs" active-tab-name="activity">
        <fw-tab slot="tab" panel="activity">Activity (${events?.length || 0})</fw-tab>
        <fw-tab slot="tab" panel="preps">Preps (${preps?.length || 0})</fw-tab>
        <fw-tab slot="tab" panel="postcalls">Post-calls (${postCalls?.length || 0})</fw-tab>
        <fw-tab slot="tab" panel="tasks">Tasks (${tasks?.length || 0})</fw-tab>
        <fw-tab-panel name="activity">
          <div class="account-activity-panel" data-search-text="activity timeline">${activityHtml}</div>
        </fw-tab-panel>
        <fw-tab-panel name="preps"><ul class="lifecycle-artifact-list">${prepRows}</ul></fw-tab-panel>
        <fw-tab-panel name="postcalls"><ul class="lifecycle-artifact-list">${callRows}</ul></fw-tab-panel>
        <fw-tab-panel name="tasks"><ul class="lifecycle-artifact-list">${taskRows}</ul></fw-tab-panel>
      </fw-tabs>
    </section>`;
}

function renderAccountOverview(detail, viewOpts = {}) {
  const { lifecycle, account, contacts, contactEventsByContactId, accountRollup } = detail;
  const focusContactId = viewOpts.contactId || null;
  const rollup = accountRollup || {};
  const totalCalls = rollup.accountCalls?.length ?? 0;

  return `
    <div class="lifecycle-detail account-detail account-record account-record--overview">
      <div class="account-record-top account-record-top--wireframe">
        ${renderCommandChrome(detail, { showAccountArr: true, overviewWireframe: true })}
      </div>
      <div class="account-overview-layout">
        <div class="account-overview-main">
          ${renderGeneratedSummarySection(
            "Account summary",
            detail.accountSummary,
            "Generated after the first post-call on this account — spans every deal and call.",
            {
              wireframe: true,
              dealCount: rollup.dealCount ?? (detail.deals || []).length,
              firmographics: renderFirmographicsGrid(rollup.firmographics),
            },
          )}
          ${renderAccountDealsTable(rollup.dealRows, {
            wireframe: true,
            crossSellHint: renderCrossSellEmptyHint(detail, true),
          })}
          ${renderAccountCallsTable(rollup.accountCalls, { wireframe: true })}
          ${renderAccountGapsPlaceholder({ wireframe: true })}
        </div>
        <aside class="account-overview-aside">
          ${renderAccountArrModule(rollup.arrRollup, { wireframeSidebar: true })}
          ${renderContactsPanel(
            contacts,
            lifecycle.primaryContactId,
            contactEventsByContactId || {},
            account?.id,
            focusContactId,
            rollup.hasEconomicBuyer !== false,
            { sidebarCompact: true, totalCalls },
          )}
          ${renderEvaluationPanels(rollup, { wireframe: true })}
        </aside>
      </div>
    </div>`;
}

function opportunityChromeOpts(surface) {
  if (surface === "deals") {
    return {
      backAction: "back-to-deal-list",
      backLabel: "← All deals",
      showDealTypeInRail: true,
    };
  }
  return {
    backAction: "back-to-account",
    backLabel: "← Account",
    showDealTypeInRail: true,
  };
}

function renderOpportunityRecord(detail, detailSearchQuery = "", viewOpts = {}) {
  const {
    lifecycle,
    account,
    events,
    contacts,
    contactEventsByContactId,
    seTeamDisplay,
    lifecycleOwnerId,
  } = detail;
  const focusContactId = viewOpts.contactId || null;

  const lensOptions = (seTeamDisplay || []).map((m) => ({
    value: m.seUserId,
    label: m.user.displayName,
  }));
  const seNameById = Object.fromEntries(
    (seTeamDisplay || []).map((m) => [m.seUserId, m.user.displayName])
  );
  const surface = viewOpts.surface === "deals" ? "deals" : "accounts";

  return `
    <div class="lifecycle-detail account-detail account-record account-record--opportunity">
      <div class="account-record-top">
        ${renderCommandChrome(detail, opportunityChromeOpts(surface))}
        ${renderPursuitBar(detail, lensOptions, lifecycleOwnerId || lifecycle.ownerId)}
      </div>

      <div class="account-command-deck">
        <aside class="account-command-panel account-command-panel--contacts">
          <div class="account-command-panel-scroll">
            ${renderContactsPanel(
              contacts,
              lifecycle.primaryContactId,
              contactEventsByContactId || {},
              account?.id,
              focusContactId,
              detail.accountRollup?.hasEconomicBuyer !== false,
            )}
          </div>
        </aside>
        <main class="account-command-panel account-command-panel--activity">
          <div class="account-command-panel-scroll">
            ${renderGeneratedSummarySection(
              "Deal summary",
              detail.dealSummary,
              "Generated after the first post-call on this deal — rewritten after every call.",
            )}
            ${renderRightTabs(detail, events, seNameById, viewOpts, detailSearchQuery)}
          </div>
        </main>
        <aside class="account-command-panel account-command-panel--reference">
          <div class="account-command-panel-scroll">
            ${renderDealTeamSection(detail)}
            ${renderMeddpiccSection(detail)}
            ${renderDealsListSection(detail)}
          </div>
        </aside>
      </div>
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

    wireAccountListItemClicks(listEl, opts);
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

function preservePanelScroll(container, selector, renderFn) {
  const scrollEl = container.querySelector(selector);
  const scrollTop = scrollEl?.scrollTop ?? 0;
  return Promise.resolve(renderFn()).then(() => {
    const next = container.querySelector(selector);
    if (next) next.scrollTop = scrollTop;
  });
}

function wireDetailEvents(container, session, opts) {
  container.querySelector('[data-action="back"]')?.addEventListener("fwClick", () => {
    opts.onBack?.();
  });

  container.querySelector('[data-action="back-to-account"]')?.addEventListener("fwClick", async () => {
    opts.dealId = null;
    opts.onBackToAccount?.();
    await renderAccountView(container, session, { ...opts, dealId: null });
  });

  container.querySelector('[data-action="back-to-deal-list"]')?.addEventListener("fwClick", () => {
    opts.onBackToDealList?.();
  });

  container.querySelector("#account-activity-show-all")?.addEventListener("fwClick", async () => {
    opts.activityShowAll = true;
    opts.onActivityShowAllChange?.(true);
    await preservePanelScroll(container, ".account-command-panel--activity .account-command-panel-scroll", () =>
      renderAccountView(container, session, opts),
    );
  });

  container.querySelector('[data-action="prep"]')?.addEventListener("fwClick", () => {
    const deal = (opts.deals || []).find((d) => d.id === opts.dealId) || opts.selectedDeal;
    const prepType =
      deal?.type === "expansion" ? "expansion"
      : deal?.type === "new_business" ? "new_business"
      : opts.engagementPrepType === "expansion" ? "expansion"
      : "new_business";
    setAccountEngagementContext({
      accountId: opts.accountId,
      dealId: opts.dealId || deal?.id || null,
      prepType,
      lifecycleId: opts.lifecycleId || null,
    });
    opts.onPrep?.();
  });

  container.querySelector('[data-action="postcall"]')?.addEventListener("fwClick", () => {
    const deal = (opts.deals || []).find((d) => d.id === opts.dealId) || opts.selectedDeal;
    const prepType =
      deal?.type === "expansion" ? "expansion"
      : deal?.type === "new_business" ? "new_business"
      : opts.engagementPrepType === "expansion" ? "expansion"
      : "new_business";
    setAccountEngagementContext({
      accountId: opts.accountId,
      dealId: opts.dealId || deal?.id || null,
      prepType,
      lifecycleId: opts.lifecycleId || null,
    });
    opts.onPostcall?.();
  });

  container.querySelectorAll('[data-action="select-contact"]').forEach((btn) => {
    btn.addEventListener("click", () => {
      const contactId = btn.getAttribute("data-contact-id");
      if (!contactId) return;
      opts.contactId = contactId;
      opts.onContactChange?.(contactId);
      void preservePanelScroll(container, ".account-command-panel--contacts .account-command-panel-scroll", () =>
        renderAccountView(container, session, opts),
      );
    });
  });

  async function activateDeal(dealId) {
    if (!dealId) return;
    const deal = (opts.deals || []).find((d) => d.id === dealId);
    opts.dealId = dealId;
    opts.engagementPrepType = deal?.type || opts.engagementPrepType;
    opts.contactId = null;
    opts.onContactChange?.(null);
    opts.onDealChange?.(dealId, deal?.type);
    await renderAccountView(container, session, opts);
  }

  function wireDealRowActivation(row, useClick) {
    const run = () => void activateDeal(row.getAttribute("data-deal-id"));
    if (useClick) row.addEventListener("click", run);
    else row.addEventListener("fwClick", run);
    row.addEventListener("keydown", (e) => {
      if (e.key === "Enter" || e.key === " ") {
        e.preventDefault();
        run();
      }
    });
  }

  container.querySelectorAll('[data-action="select-deal"]').forEach((row) => wireDealRowActivation(row, false));
  container.querySelectorAll('[data-action="open-opportunity"]').forEach((row) => wireDealRowActivation(row, true));

  async function applyDealTypeFromUi(prepType) {
    const deal = activeDeals(opts.deals || []).find((d) => d.type === prepType);
    const dealId = deal?.id || null;
    if (!opts.accountId) return;
    opts.dealId = dealId;
    opts.engagementPrepType = prepType;
    opts.onDealChange?.(dealId, prepType);
    setAccountEngagementContext({
      accountId: opts.accountId,
      dealId,
      prepType,
      lifecycleId: opts.lifecycleId || null,
    });
  }

  const typeControl = container.querySelector('[data-action="deal-type-select"]');
  if (typeControl) {
    typeControl.addEventListener("fwChange", async () => {
      const prepType = await readFieldValueAsync(typeControl);
      await applyDealTypeFromUi(prepType);
      await renderAccountView(container, session, opts);
    });
  }

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

function wireAccountListItemClicks(container, opts) {
  container.querySelectorAll(".account-list-item").forEach((row) => {
    const activate = () => {
      const id = row.getAttribute("data-account-id");
      if (id) opts.onSelectAccount?.(id);
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

/** @param {object[]} rows */
function summarizeAccountListMetrics(rows) {
  let totalArr = 0;
  let hasArr = false;
  let withOpenDeals = 0;
  let multiDeal = 0;
  let atRiskCount = 0;
  let atRiskArr = 0;

  for (const row of rows) {
    const deals = row.dealCount ?? 0;
    if (deals > 0) withOpenDeals += 1;
    if (deals > 1) multiDeal += 1;
    if (row.totalArrPoint != null) {
      hasArr = true;
      totalArr += row.totalArrPoint;
    }
    if (row.health?.tone === "red" || row.health?.label === "At risk") {
      atRiskCount += 1;
      if (row.totalArrPoint != null) atRiskArr += row.totalArrPoint;
    }
  }

  return {
    accountCount: rows.length,
    withOpenDeals,
    totalArr: hasArr ? totalArr : null,
    multiDeal,
    atRiskCount,
    atRiskArr: atRiskCount > 0 && atRiskArr > 0 ? atRiskArr : null,
  };
}

function renderAccountListMetricCard(label, value, sub = "", valueClass = "") {
  return `
    <div class="dash-stat prep-action-block account-list-stat">
      <span class="dash-stat-label">${esc(label)}</span>
      <span class="dash-stat-value${valueClass ? ` ${valueClass}` : ""}">${esc(String(value))}</span>
      ${sub ? `<span class="dash-stat-sub muted">${esc(sub)}</span>` : ""}
    </div>`;
}

/** @param {ReturnType<typeof summarizeAccountListMetrics>} metrics */
function renderAccountListMetrics(metrics) {
  const arrVal = metrics.totalArr != null ? formatCompactUsd(metrics.totalArr) : "—";
  const atRiskArr = metrics.atRiskArr != null ? formatCompactUsd(metrics.atRiskArr) : "—";
  const openHint =
    metrics.withOpenDeals === 1 ? "1 with open deals" : `${metrics.withOpenDeals} with open deals`;

  return `
    <div class="account-list-metrics dash-stats prep-action-grid" aria-label="Account metrics">
      ${renderAccountListMetricCard("Accounts", metrics.accountCount, openHint)}
      ${renderAccountListMetricCard("Total ARR", arrVal, "closed + pipeline")}
      ${renderAccountListMetricCard("Multi-deal accounts", metrics.multiDeal, "cross-sell live")}
      ${renderAccountListMetricCard(
        "At risk",
        metrics.atRiskCount,
        atRiskArr,
        metrics.atRiskCount ? "weak" : "",
      )}
    </div>`;
}

function renderAccountListItem(row) {
  const { account, lifecycle, region, dealCount, totalArrLow, totalArrHigh, totalArrPoint, productsInPlay, callCount, health, lastTouchDays } = row;
  const title = account.name || lifecycle.title || account.domain || "Account";
  const domain =
    account.domain && account.domain !== account.name ? esc(account.domain) : "";
  const arrBand = formatDealListMoneyBand(totalArrLow, totalArrHigh, totalArrPoint);
  const mrrBand = formatDealListMoneyBand(
    totalArrLow != null ? displayMrrFromArr(totalArrLow) : null,
    totalArrHigh != null ? displayMrrFromArr(totalArrHigh) : null,
    totalArrPoint != null ? displayMrrFromArr(totalArrPoint) : null,
  );
  const lastTouch = lastTouchDays != null ? `${lastTouchDays}d` : "—";

  return `
    <button type="button" class="lifecycle-list-item account-list-item account-list-row" data-account-id="${esc(account.id)}">
      <span class="account-list-row-grid">
        <span class="account-list-col account-list-col--company">
          <span class="lifecycle-list-title account-list-row-title">${esc(title)}</span>
          ${domain ? `<span class="account-list-domain muted">${domain}</span>` : ""}
          <span class="account-list-row-mobile-meta muted">${esc(lastTouch)} · ${esc(String(dealCount ?? 0))} deals</span>
        </span>
        <span class="account-list-col account-list-col--region muted">${esc(region || "—")}</span>
        <span class="account-list-col account-list-col--deals account-list-num">${esc(String(dealCount ?? 0))}</span>
        <span class="account-list-col account-list-col--arr account-list-num">${esc(arrBand)}</span>
        <span class="account-list-col account-list-col--mrr account-list-num">${esc(mrrBand)}</span>
        <span class="account-list-col account-list-col--products muted">${esc(productsInPlay || "—")}</span>
        <span class="account-list-col account-list-col--calls account-list-num">${esc(String(callCount ?? 0))}</span>
        <span class="account-list-col account-list-col--health">${healthTag(health)}</span>
        <span class="account-list-col account-list-col--touch account-list-num muted">${esc(lastTouch)}</span>
      </span>
    </button>`;
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

function renderAccountsEmptyState(message) {
  return `
    <div class="lifecycle-list-view account-list-view">
      <fw-card class="lifecycle-empty dew-empty-state">
        <fw-icon name="agent" size="24" aria-hidden="true"></fw-icon>
        <h2>Accounts</h2>
        <p class="muted">${esc(message)}</p>
      </fw-card>
    </div>`;
}

/** @param {HTMLElement} container @param {object} session @param {object} opts */
export async function renderAccountView(container, session, opts = {}) {
  let activeSession = session;
  if (!sessionUserId(activeSession)) {
    try {
      activeSession = (await syncSessionWithDomainStore(activeSession)) || activeSession;
    } catch (err) {
      console.warn("[account-view] session sync failed:", err);
    }
  }
  activeSession = withEffectiveUserId(activeSession);
  const userId = sessionUserId(activeSession);
  if (!userId) {
    if (activeSession?.email) {
      container.innerHTML = renderAccountsEmptyState(
        "We could not load your profile yet. Refresh the page or sign out and back in.",
      );
    } else {
      container.innerHTML = `<p class="muted">Sign in to view accounts.</p>`;
    }
    return;
  }

  try {
    if (opts.accountId) {
      const opportunityView = isOpportunityRecordView(opts);
      const detailQuery = {
        lifecycleOwnerId: opts.lifecycleOwnerId,
        ...(opts.engagementPrepType ? { engagementPrepType: opts.engagementPrepType } : {}),
      };
      if (opportunityView) {
        detailQuery.dealId = opts.dealId;
      } else {
        detailQuery.dealId = null;
      }

      const detail = await getAccountEngagementDetail(activeSession, opts.accountId, detailQuery);
      if (!detail) {
        container.innerHTML = `<p class="muted">Account not found.</p>`;
        return;
      }

      const viewOpts = {
        activityShowAll: opts.activityShowAll,
        contactId: opts.contactId || null,
      };

      container.innerHTML = opportunityView
        ? renderOpportunityRecord(detail, opts.detailSearchQuery || "", {
            ...viewOpts,
            surface: opts.surface === "deals" ? "deals" : "accounts",
          })
        : renderAccountOverview(detail, viewOpts);

      wireDetailEvents(container, activeSession, {
        ...opts,
        accountId: opts.accountId,
        lifecycleId: detail.lifecycle.id,
        dealId: opportunityView ? detail.selectedDealId : null,
        engagementPrepType: detail.selectedDealType,
        selectedDeal: detail.selectedDeal,
        deals: detail.deals,
      });
      return;
    }

    const store = getStore();
    const baseRows = await enrichRowsWithContacts(await listAccountsForSession(activeSession));
    const rows = await Promise.all(baseRows.map((row) => enrichAccountListRow(store, row)));

    if (!rows.length) {
      container.innerHTML = renderAccountsEmptyState(
        "No accounts yet — run a prep or post-call to add your first account.",
      );
      return;
    }

    const listQuery = opts.listSearchQuery || "";
    const filtered = filterAccountRows(rows, listQuery);
    const metrics = summarizeAccountListMetrics(rows);

    container.innerHTML = `
      <div class="lifecycle-list-view account-list-view account-list-view--compact">
        <div class="account-list-toolbar account-list-toolbar--compact">
          <div class="account-list-title-group">
            <h1 class="account-list-heading">Accounts</h1>
            <p class="account-list-subtitle muted">Every account in the org. Deals roll up here, not the other way round.</p>
          </div>
          <fw-input id="account-list-search" class="account-list-search" placeholder="Search accounts" value="${esc(listQuery)}" clear-input></fw-input>
        </div>
        ${renderAccountListMetrics(metrics)}
        <div class="account-list-table-card card-wire">
          <div class="account-list-grid-header" aria-hidden="true">
            <span class="account-list-col account-list-col--company">Account</span>
            <span class="account-list-col account-list-col--region">Region</span>
            <span class="account-list-col account-list-col--deals">Deals</span>
            <span class="account-list-col account-list-col--arr">Total ARR</span>
            <span class="account-list-col account-list-col--mrr">Total MRR</span>
            <span class="account-list-col account-list-col--products">Products</span>
            <span class="account-list-col account-list-col--calls">Calls</span>
            <span class="account-list-col account-list-col--health">Health</span>
            <span class="account-list-col account-list-col--touch">Last touch</span>
          </div>
          <div class="lifecycle-list account-list-compact">
            ${filtered.length
              ? filtered.map((row) => renderAccountListItem(row)).join("")
              : `<p class="muted account-list-no-matches">No accounts match “${esc(listQuery)}”</p>`}
          </div>
        </div>
      </div>`;

    wireAccountListItemClicks(container, opts);
    wireListFilter(container, rows, opts);
  } catch (err) {
    console.error("[account-view] failed to render accounts:", err);
    container.innerHTML = renderAccountsEmptyState(
      "Could not load accounts right now. Refresh the page or try again in a moment.",
    );
  }
}

/**
 * Opportunity workspace for a known account + deal (Accounts or Deals nav entry).
 * @param {HTMLElement} container
 * @param {object} session
 * @param {object} opts
 */
export async function renderOpportunityForAccount(container, session, opts = {}) {
  if (!opts.accountId || !opts.dealId) {
    container.innerHTML = `<p class="muted">Deal not found.</p>`;
    return;
  }
  await renderAccountView(container, session, {
    ...opts,
    surface: opts.surface === "deals" ? "deals" : "accounts",
  });
}
