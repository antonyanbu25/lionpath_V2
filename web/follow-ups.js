/**
 * Aggregate open SE follow-ups from post-call history (nextSteps + se_action rows).
 */

import { listPostCallAnalyses } from "./history.js";
import { dedupeAnalysesByCallIdentity } from "./call-identity.js";
import { esc } from "./shared.js";

const SOON_DAYS = 3;
const UNKNOWN_DUE = new Set(["unknown", "-", "n/a", "tbd", ""]);

function startOfDay(d) {
  const x = new Date(d);
  x.setHours(0, 0, 0, 0);
  return x;
}

function addDays(d, n) {
  const x = new Date(d);
  x.setDate(x.getDate() + n);
  return startOfDay(x);
}

function endOfWeek(d) {
  const x = startOfDay(d);
  const day = x.getDay();
  const daysUntilFriday = day <= 5 ? 5 - day : 5 + (7 - day);
  return addDays(x, daysUntilFriday);
}

/** @param {string} dueStr */
export function parseDueDate(dueStr) {
  const s = String(dueStr ?? "").trim();
  if (!s || UNKNOWN_DUE.has(s.toLowerCase())) return null;

  const lower = s.toLowerCase();
  const today = startOfDay(new Date());

  if (/asap|today|now|immediate/i.test(lower)) return today;
  if (/next call|before next/i.test(lower)) return addDays(today, 7);
  if (/eow|end of week/i.test(lower)) return endOfWeek(today);
  if (/next week/i.test(lower)) return addDays(today, 7);
  if (/tomorrow/i.test(lower)) return addDays(today, 1);

  const parsed = Date.parse(s);
  if (!Number.isNaN(parsed)) return startOfDay(new Date(parsed));

  const m = s.match(/^([A-Za-z]{3,9})\s+(\d{1,2})(?:,?\s*(\d{4}))?$/);
  if (m) {
    const d = new Date(`${m[1]} ${m[2]}, ${m[3] || new Date().getFullYear()}`);
    if (!Number.isNaN(d.getTime())) return startOfDay(d);
  }

  const rel = s.match(/^(\d+)\s*days?$/i);
  if (rel) return addDays(today, Number(rel[1]));

  return null;
}

/** @param {Date | null} dueDate @returns {"overdue"|"soon"|"upcoming"|"unknown"} */
export function dueUrgency(dueDate) {
  if (!dueDate) return "unknown";
  const today = startOfDay(new Date());
  const diff = Math.floor((dueDate.getTime() - today.getTime()) / 86400000);
  if (diff < 0) return "overdue";
  if (diff <= SOON_DAYS) return "soon";
  return "upcoming";
}

/** @param {string} owner @param {string} [seName] */
export function isSeOwner(owner, seName) {
  const o = String(owner ?? "").trim();
  if (!o || UNKNOWN_DUE.has(o.toLowerCase())) return false;
  if (/^(se|solution engineer|solutions engineer|sales engineer)$/i.test(o)) return true;
  if (/se\b|solution engineer|sales engineer/i.test(o)) return true;
  if (seName) {
    const name = String(seName).trim().toLowerCase();
    if (name && o.toLowerCase().includes(name)) return true;
    const first = name.split(/\s+/)[0];
    if (first.length > 2 && o.toLowerCase().includes(first)) return true;
  }
  return false;
}

function companyFromRecord(record) {
  const a = record.analysis || {};
  const title = a.callHeader?.title || record.title || "Call";
  const parts = String(title).split(/[·|–—-]/);
  return (parts[0] || title).trim();
}

function normalizeSteps(record) {
  const a = record.analysis || {};
  const items = [];

  for (const step of a.nextSteps || []) {
    if (!step?.action || UNKNOWN_DUE.has(String(step.action).toLowerCase())) continue;
    items.push({
      owner: step.owner || "SE",
      action: step.action,
      due: step.due || "",
      source: "nextSteps",
    });
  }

  for (const row of a.followUpTable || []) {
    if (row.category !== "se_action") continue;
    const action = row.followUp || row.thisCall;
    if (!action || UNKNOWN_DUE.has(String(action).toLowerCase())) continue;
    items.push({
      owner: "SE",
      action,
      due: "",
      source: "followUpTable",
    });
  }

  return items;
}

/**
 * @param {string} email
 * @param {{ seName?: string }} [opts]
 * @returns {{ items: object[], overdue: number, soon: number, total: number }}
 */
export function aggregateFollowUps(email, opts = {}) {
  const seName = opts.seName || "";
  const seen = new Set();
  const items = [];

  const records = dedupeAnalysesByCallIdentity(listPostCallAnalyses(email));

  for (const record of records) {
    const company = companyFromRecord(record);
    for (const step of normalizeSteps(record)) {
      if (!isSeOwner(step.owner, seName)) continue;
      const key = `${record.id}:${step.action}:${step.due}`;
      if (seen.has(key)) continue;
      seen.add(key);

      const dueDate = parseDueDate(step.due);
      const urgency = dueUrgency(dueDate);
      items.push({
        callId: record.id,
        company,
        action: step.action,
        due: step.due || "-",
        dueDate,
        urgency,
        owner: step.owner,
      });
    }
  }

  const urgencyRank = { overdue: 0, soon: 1, upcoming: 2, unknown: 3 };
  items.sort((a, b) => {
    const ra = urgencyRank[a.urgency] ?? 9;
    const rb = urgencyRank[b.urgency] ?? 9;
    if (ra !== rb) return ra - rb;
    if (a.dueDate && b.dueDate) return a.dueDate - b.dueDate;
    return 0;
  });

  const overdue = items.filter((i) => i.urgency === "overdue").length;
  const soon = items.filter((i) => i.urgency === "soon").length;

  return { items, overdue, soon, total: items.length };
}

export function renderFollowUpsSection(followUps, opts = {}) {
  const { items, overdue, soon, total } = followUps;

  if (!total) {
    return `
      <section class="dash-section launch-followups" aria-labelledby="followups-heading">
        <h2 id="followups-heading" class="dash-section-title">Follow-ups owed</h2>
        <fw-card class="dash-empty launch-empty">
          <div class="dash-empty-icon" aria-hidden="true">✓</div>
          <h3>All caught up</h3>
          <p class="muted">No open SE actions from your analyzed calls.</p>
        </fw-card>
      </section>`;
  }

  const headlineParts = [`${total} follow-up${total === 1 ? "" : "s"} owed`];
  if (overdue) headlineParts.push(`${overdue} overdue`);
  else if (soon) headlineParts.push(`${soon} due soon`);

  const rows = items.slice(0, 8).map((item) => {
    const dotCls =
      item.urgency === "overdue" ? "dot-red" : item.urgency === "soon" ? "dot-amber" : "dot-green";
    const statusLabel =
      item.urgency === "overdue" ? "Overdue" : item.urgency === "soon" ? "Due soon" : "Upcoming";
    return `
      <fw-button class="launch-followup-row dash-call-link" color="secondary" fill="clear" data-call-id="${esc(item.callId)}">
        <span class="launch-followup-inner">
          <span class="launch-followup-dot ${dotCls}" title="${esc(statusLabel)}" aria-label="${esc(statusLabel)}"></span>
          <span class="launch-followup-company">${esc(item.company)}</span>
          <span class="launch-followup-action muted">${esc(item.action)}</span>
          <span class="launch-followup-due">${esc(item.due)}</span>
        </span>
      </fw-button>`;
  }).join("");

  return `
    <section class="dash-section launch-followups" aria-labelledby="followups-heading">
      <h2 id="followups-heading" class="dash-section-title">${esc(headlineParts.join(" · "))}</h2>
      <fw-card class="launch-followup-list">${rows}</fw-card>
    </section>`;
}
