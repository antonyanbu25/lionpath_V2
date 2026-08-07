/**
 * Accounts list + detail (CRM-style). Lifecycle remains the internal engagement spine.
 */

import {
  listAccountsForSession,
  getAccountEngagementDetail,
  enrichAccountListRows,
  listAccountRowsFromHistory,
} from "./domain/account-service.js?v=2.1.14";
import { mergeAccountListRows } from "./domain/history-deal-enrichment.js";
import { DEAL_TYPE_LABELS } from "./domain/deal-service.js";
import { setAccountEngagementContext } from "./domain/account-context.js";
import { getStore } from "./domain/store.js";
import { safeStoreOp } from "./domain/safe-store.js";
import { sessionUserId, withEffectiveUserId } from "./domain/session.js";
import { syncSessionWithDomainStore } from "./auth.js";
import { STAGE_LABELS, CONTACT_EVENT_LABELS } from "./domain/types.js";
import { filterAccountRows } from "./search-service.js?v=2.1.14";
import { readFieldValueAsync, renderLoadingPanel } from "./crayons-ui.js";
import { esc } from "./shared.js";
import { formatCompactUsd, formatDealListMoneyBand } from "./deal-view.js";
import { displayMrrFromArr } from "./deal-arr-module.js";
import { renderAccountArrModule } from "./account-arr-module.js";
import { resolveCallType } from "./call-view.js";
import { resolveQipDisplay } from "./calls-list-view.js";

export const ACTIVITY_INITIAL_VISIBLE = 10;

function formatDate(ts) {
  if (!ts) return "-";
  return new Date(ts).toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" });
}

function formatShortDate(ts) {
  if (!ts) return "-";
  return new Date(ts).toLocaleDateString(undefined, { month: "short", day: "numeric" });
}

function formatGeneratedSummaryMeta(generatedAt, sourceCallIds, dealCount = null) {
  const when = generatedAt ? formatDate(generatedAt) : "-";
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

function stageBadge(stage) {
  const label = STAGE_LABELS[stage] || stage;
  return `<span class="lifecycle-stage-badge stage-${esc(stage)}">${esc(label)}</span>`;
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
  return `<span class="contact-meta-abbrev contact-meta-abbrev--empty muted" title="DISC not assessed">-</span>`;
}

function influenceAbbrev(contact) {
  const level = contact?.metadata?.influence?.level;
  if (level && level !== "unknown") {
    const letter = level.charAt(0).toUpperCase();
    const full = level.charAt(0).toUpperCase() + level.slice(1);
    return `<span class="contact-meta-abbrev contact-meta-abbrev--influence contact-meta-abbrev--${esc(level)}" title="${esc(full)} influence">${esc(letter)}</span>`;
  }
  return `<span class="contact-meta-abbrev contact-meta-abbrev--empty muted" title="Influence not assessed">-</span>`;
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

function eventDayKey(ts) {
  if (!ts) return "";
  const d = new Date(ts);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
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
  if (!health?.label) return `<span class="muted">-</span>`;
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
  if (qip.label === "-" && postCall?.qualityScore != null) {
    const s = postCall.qualityScore;
    const color = s >= 70 ? "green" : s >= 50 ? "yellow" : "red";
    return `<fw-tag text="${esc(String(s))}" color="${color}"></fw-tag>`;
  }
  if (qip.label === "-") return `<span class="muted">-</span>`;
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
        `<div class="account-firmographics-row"><span class="muted">${esc(label)}</span><span>${esc(String(value ?? "-"))}</span></div>`,
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
        <p class="muted">No deals yet. Start with New prep.</p>
        ${crossSellHint}
      </section>`;
  }

  const body = dealRows
    .filter((row) => row?.deal?.id)
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
          <td>${traction ? tractionTag(traction) : `<span class="muted">-</span>`}</td>
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
        <p class="muted">No calls yet. Run post-call to add the first one.</p>
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
          <td>${meddpiccScore != null ? meddpiccListTag(meddpiccScore) : `<span class="muted">-</span>`}</td>
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
        <p class="muted">Gap clustering arrives in Phase 3. product signal roll-up across calls.</p>
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
        ${reasonText ? `<p class="account-reason-body">${esc(reasonText)}</p>` : `<p class="muted">Not captured yet; surfaces from technical commit after post-call.</p>`}
        ${reasonText ? `<p class="muted account-eval-footnote">Compelling event · from post-call analysis</p>` : ""}
      </section>
      <section class="account-record-section account-why-ai-section account-record-section--card account-record-section--tight">
        <p class="prep-form-eyebrow account-section-eyebrow">Why AI</p>
        ${whyAiText ? `<p class="account-why-ai-body">${esc(whyAiText)}</p>` : `<p class="muted">Not captured yet; AI attach narrative appears after a demo or discovery call.</p>`}
        ${whyAiText ? `<p class="muted account-eval-footnote">AI attach narrative · from post-call analysis</p>` : ""}
      </section>`;
  }

  return `
    <section class="account-record-section account-reason-section">
      <h3 class="account-record-section-title">Reason for evaluation</h3>
      ${reasonText ? `<p class="account-reason-body">${esc(reasonText)}</p>` : `<p class="muted">Not captured yet; surfaces from technical commit after post-call.</p>`}
    </section>
    <section class="account-record-section account-why-ai-section">
      <h3 class="account-record-section-title">Why AI</h3>
      ${whyAiText ? `<p class="account-why-ai-body">${esc(whyAiText)}</p>` : `<p class="muted">Not captured yet. AI attach narrative appears after a demo or discovery call.</p>`}
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
  return `<div class="account-cross-sell-hint"><p class="muted">No second deal yet. ${esc(hint)}; worth a cross-sell conversation.</p></div>`;
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
        <p class="muted account-detail-empty-contacts">No contacts yet. Add prospect emails in prep.</p>
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


function firstActiveDeal(deals) {
  const list = deals || [];
  return list.find((d) => d.status === "active") || list[0] || null;
}

function renderCommandChrome(detail) {
  const { account, lifecycle } = detail;
  const title = account?.name || lifecycle?.title || "Account";
  const firmo = detail.accountRollup?.firmographics;
  const subtitleParts = [
    account?.domain,
    firmo?.region !== "-" ? firmo?.region : null,
    firmo?.subRegion !== "-" ? firmo?.subRegion : null,
    firmo?.hq !== "-" ? firmo?.hq : null,
    firmo?.supportAgents !== "-" ? `${firmo?.supportAgents} support agents` : null,
  ].filter(Boolean);
  const domainLine = subtitleParts.length
    ? `<p class="account-command-header-domain muted">${esc(subtitleParts.join(" · "))}</p>`
    : account?.domain
      ? `<p class="account-command-header-domain muted">${esc(account.domain)}</p>`
      : "";

  return `
    <div class="account-command-chrome">
      <header class="account-record-header account-command-header account-command-header--with-arr account-command-header--overview-wire">
        <fw-button class="lifecycle-back" color="secondary" fill="clear" data-action="back">← All accounts</fw-button>
        <div class="account-header-main account-command-header-title">
          <h2>${esc(title)}</h2>
          ${domainLine}
        </div>
        ${renderAccountHeaderArr(detail)}
        <div class="account-detail-actions account-command-header-actions">
          <fw-button color="secondary" fill="outline" size="small" data-action="postcall">Post-call</fw-button>
          <fw-button color="primary" fill="solid" size="small" data-action="prep">New prep</fw-button>
        </div>
      </header>
    </div>`;
}

function renderAccountOverview(detail, viewOpts = {}) {
  const { lifecycle, account, contacts, contactEventsByContactId, accountRollup } = detail;
  const focusContactId = viewOpts.contactId || null;
  const rollup = accountRollup || {};
  const totalCalls = rollup.accountCalls?.length ?? 0;

  return `
    <div class="lifecycle-detail account-detail account-record account-record--overview">
      <div class="account-record-top account-record-top--wireframe">
        ${renderCommandChrome(detail)}
      </div>
      <div class="account-overview-layout">
        <div class="account-overview-main">
          ${renderGeneratedSummarySection(
            "Account summary",
            detail.accountSummary,
            "Generated after the first post-call on this account. spans every deal and call.",
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
            lifecycle?.primaryContactId,
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

function wireDetailEvents(container, session, opts) {
  container.querySelector('[data-action="back"]')?.addEventListener("fwClick", () => {
    opts.onBack?.();
  });

  const engage = (view) => {
    const deal = firstActiveDeal(opts.deals || []);
    const prepType =
      deal?.type === "expansion" ? "expansion"
      : deal?.type === "new_business" ? "new_business"
      : opts.engagementPrepType === "expansion" ? "expansion"
      : "new_business";
    setAccountEngagementContext({
      accountId: opts.accountId,
      dealId: deal?.id || null,
      prepType,
      lifecycleId: opts.lifecycleId || null,
    });
    if (view === "prep") opts.onPrep?.();
    else opts.onPostcall?.();
  };

  container.querySelector('[data-action="prep"]')?.addEventListener("fwClick", () => engage("prep"));
  container.querySelector('[data-action="postcall"]')?.addEventListener("fwClick", () => engage("postcall"));

  container.querySelectorAll('[data-action="select-contact"]').forEach((btn) => {
    btn.addEventListener("click", () => {
      const contactId = btn.getAttribute("data-contact-id");
      if (!contactId) return;
      opts.contactId = contactId;
      opts.onContactChange?.(contactId);
      void renderAccountView(container, session, opts);
    });
  });

  container.querySelectorAll('[data-action="open-opportunity"]').forEach((row) => {
    const run = () => {
      const dealId = row.getAttribute("data-deal-id");
      if (!dealId) return;
      opts.onOpenDeal?.(dealId, { accountId: opts.accountId });
    };
    row.addEventListener("click", run);
    row.addEventListener("keydown", (e) => {
      if (e.key === "Enter" || e.key === " ") {
        e.preventDefault();
        run();
      }
    });
  });
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
  const arrVal = metrics.totalArr != null ? formatCompactUsd(metrics.totalArr) : "-";
  const atRiskArr = metrics.atRiskArr != null ? formatCompactUsd(metrics.atRiskArr) : "-";
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
  const lastTouch = lastTouchDays != null ? `${lastTouchDays}d` : "-";
  const created = account.createdAt ? formatDate(account.createdAt) : "-";

  return `
    <button type="button" class="lifecycle-list-item account-list-item account-list-row" data-account-id="${esc(account.id)}">
      <span class="account-list-row-grid">
        <span class="account-list-col account-list-col--company">
          <span class="lifecycle-list-title account-list-row-title">${esc(title)}</span>
          ${domain ? `<span class="account-list-domain muted">${domain}</span>` : ""}
          <span class="account-list-row-mobile-meta muted">${esc(lastTouch)} · ${esc(String(dealCount ?? 0))} deals</span>
        </span>
        <span class="account-list-col account-list-col--region muted">${esc(region || "-")}</span>
        <span class="account-list-col account-list-col--deals account-list-num">${esc(String(dealCount ?? 0))}</span>
        <span class="account-list-col account-list-col--arr account-list-num">${esc(arrBand)}</span>
        <span class="account-list-col account-list-col--mrr account-list-num">${esc(mrrBand)}</span>
        <span class="account-list-col account-list-col--products muted">${esc(productsInPlay || "-")}</span>
        <span class="account-list-col account-list-col--calls account-list-num">${esc(String(callCount ?? 0))}</span>
        <span class="account-list-col account-list-col--health">${healthTag(health)}</span>
        <span class="account-list-col account-list-col--created account-list-num muted">${esc(created)}</span>
        <span class="account-list-col account-list-col--touch account-list-num muted">${esc(lastTouch)}</span>
      </span>
    </button>`;
}

/** @param {HTMLElement} container @param {object} opts @param {string} html @returns {boolean} */
function applyAccountViewHtml(container, opts, html) {
  if (opts.shouldApply && !opts.shouldApply()) return false;
  container.innerHTML = html;
  return true;
}

function renderAccountsListLoadingShell() {
  return `
    <div class="lifecycle-list-view account-list-view account-list-view--compact account-list-view--loading">
      <div class="account-list-toolbar account-list-toolbar--compact">
        <div class="account-list-title-group">
          <h1 class="account-list-heading">Accounts</h1>
          <p class="account-list-subtitle muted">Every account in the org. Deals roll up here, not the other way round.</p>
        </div>
      </div>
      ${renderLoadingPanel("Loading accounts…")}
    </div>`;
}

function renderAccountsListView(rows, opts) {
  const listQuery = opts.listSearchQuery || "";
  const filtered = filterAccountRows(rows, listQuery);
  const metrics = summarizeAccountListMetrics(rows);

  return `
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
            <span class="account-list-col account-list-col--created">Created</span>
            <span class="account-list-col account-list-col--touch">Last touch</span>
          </div>
          <div class="lifecycle-list account-list-compact">
            ${filtered.length
              ? filtered.map((row) => renderAccountListItem(row)).join("")
              : `<p class="muted account-list-no-matches">No accounts match “${esc(listQuery)}”</p>`}
          </div>
        </div>
      </div>`;
}

async function loadAccountListRows(session, onPreview) {
  try {
    const historyRows = listAccountRowsFromHistory(session);
    const store = getStore();

    const storePromise = safeStoreOp(
      "listAccountsForSession",
      () => listAccountsForSession(session),
      [],
    );

    if (historyRows.length && onPreview) {
      try {
        const previewRows = (
          await enrichAccountListRows(store, historyRows.filter((row) => row?.account?.id))
        ).filter((row) => row?.account?.id);
        onPreview(previewRows);
      } catch (err) {
        console.warn("[account-view] account list preview failed:", err?.message || err);
      }
    }

    let storeRows = [];
    try {
      storeRows = await storePromise;
    } catch (err) {
      console.warn("[account-view] listAccountsForSession failed, using history:", err?.message || err);
    }

    const baseRows = mergeAccountListRows(storeRows, historyRows);
    const rows = (await enrichAccountListRows(store, baseRows)).filter((row) => row?.account?.id);
    return rows;
  } catch (err) {
    console.warn("[account-view] loadAccountListRows failed:", err?.message || err);
    const historyRows = listAccountRowsFromHistory(session);
    return historyRows.filter((row) => row?.account?.id);
  }
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
      const detailQuery = {
        lifecycleOwnerId: opts.lifecycleOwnerId,
        dealId: null,
        ...(opts.engagementPrepType ? { engagementPrepType: opts.engagementPrepType } : {}),
      };

      const detail = await getAccountEngagementDetail(activeSession, opts.accountId, detailQuery);
      if (!detail) {
        container.innerHTML = `<p class="muted">Account not found.</p>`;
        return;
      }

      const viewOpts = {
        contactId: opts.contactId || null,
      };

      container.innerHTML = renderAccountOverview(detail, viewOpts);

      wireDetailEvents(container, activeSession, {
        ...opts,
        accountId: opts.accountId,
        lifecycleId: detail.lifecycle?.id || null,
        engagementPrepType: detail.selectedDealType,
        deals: detail.deals,
      });
      return;
    }

    const hasList = container.querySelector(".account-list-view:not(.account-list-view--loading)");
    if (!hasList) {
      applyAccountViewHtml(container, opts, renderAccountsListLoadingShell());
    }

    const rows = await loadAccountListRows(activeSession, (previewRows) => {
      if (!previewRows.length) return;
      if (opts.shouldApply && !opts.shouldApply()) return;
      try {
        applyAccountViewHtml(container, opts, renderAccountsListView(previewRows, opts));
        wireAccountListItemClicks(container, opts);
        wireListFilter(container, previewRows, opts);
      } catch (err) {
        console.warn("[account-view] account list preview render failed:", err?.message || err);
      }
    });
    if (opts.shouldApply && !opts.shouldApply()) return;

    if (!rows.length) {
      applyAccountViewHtml(
        container,
        opts,
        renderAccountsEmptyState(
          "No accounts yet. run a prep or post-call to add your first account.",
        ),
      );
      return;
    }

    if (!applyAccountViewHtml(container, opts, renderAccountsListView(rows, opts))) return;

    wireAccountListItemClicks(container, opts);
    wireListFilter(container, rows, opts);
  } catch (err) {
    console.error("[account-view] failed to render accounts:", opts.accountId, err);
    if (opts.shouldApply && !opts.shouldApply()) return;
    if (opts.accountId) {
      applyAccountViewHtml(
        container,
        opts,
        renderAccountsEmptyState(
          "Could not load this account right now. Refresh the page or try again in a moment.",
        ),
      );
      return;
    }
    try {
      const historyRows = listAccountRowsFromHistory(activeSession);
      if (historyRows.length) {
        const store = getStore();
        const fallbackRows = await enrichAccountListRows(
          store,
          historyRows.filter((row) => row?.account?.id),
        );
        const rows = fallbackRows.filter((row) => row?.account?.id);
        if (rows.length && applyAccountViewHtml(container, opts, renderAccountsListView(rows, opts))) {
          wireAccountListItemClicks(container, opts);
          wireListFilter(container, rows, opts);
          return;
        }
      }
    } catch (fallbackErr) {
      console.warn("[account-view] history fallback failed:", fallbackErr?.message || fallbackErr);
    }
    applyAccountViewHtml(
      container,
      opts,
      renderAccountsEmptyState(
        "Could not load accounts right now. Refresh the page or try again in a moment.",
      ),
    );
  }
}

