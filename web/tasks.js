/**
 * SE task management — localStorage cache + Worker sync.
 */

import { WORKER_BASE_URL } from "./firebase-config.js";
import { aggregateFollowUps, dueUrgency, parseDueDate } from "./follow-ups.js";
import { listPostCallAnalyses } from "./history.js";
import { newId } from "./domain/types.js";
import { esc, normalizeUserEmail } from "./shared.js";

export { normalizeUserEmail };

export const TASKS_STORAGE_PREFIX = "se-singha-tasks:";
const MAX_TASKS = 200;
const MAX_RECOMMENDED_VISIBLE = 6;
const COMPLETED_SHOW = 10;
const MAX_CALLS_PICKER = 50;

/** @type {(() => Promise<string | null>) | null} */
let getAuthToken = null;

/** @param {() => Promise<string | null>} fn */
export function setTasksAuthGetter(fn) {
  getAuthToken = fn;
}

export function clearTasksAuthGetter() {
  getAuthToken = null;
}

/** @param {string} email */
export function tasksStorageKey(email) {
  return `${TASKS_STORAGE_PREFIX}${normalizeUserEmail(email)}`;
}

function readLocal(email) {
  const normalized = normalizeUserEmail(email);
  if (!normalized) return [];
  try {
    const raw = localStorage.getItem(tasksStorageKey(normalized));
    if (!raw) return [];
    const list = JSON.parse(raw);
    return Array.isArray(list) ? list : [];
  } catch {
    return [];
  }
}

function writeLocal(email, list) {
  const normalized = normalizeUserEmail(email);
  if (!normalized) return false;
  try {
    localStorage.setItem(tasksStorageKey(normalized), JSON.stringify(list));
    return true;
  } catch {
    return false;
  }
}

/** @param {object[]} lists */
export function mergeTaskLists(...lists) {
  const byId = new Map();
  for (const list of lists) {
    for (const task of list || []) {
      if (task?.id) byId.set(task.id, task);
    }
  }
  return [...byId.values()]
    .sort((a, b) => (b.createdAt || 0) - (a.createdAt || 0))
    .slice(0, MAX_TASKS);
}

async function taskHeaders() {
  const headers = { "content-type": "application/json" };
  if (getAuthToken) {
    try {
      const token = await getAuthToken();
      if (token) headers["Authorization"] = `Bearer ${token}`;
    } catch {
      // demo mode
    }
  }
  return headers;
}

/** @param {string} email */
export async function fetchTasksFromWorker(email) {
  const normalized = normalizeUserEmail(email);
  if (!normalized) return [];
  const url = `${WORKER_BASE_URL}/api/tasks?email=${encodeURIComponent(normalized)}`;
  const res = await fetch(url, {
    method: "GET",
    headers: await taskHeaders(),
    signal: AbortSignal.timeout(12000),
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(err.error || `Tasks fetch failed (${res.status})`);
  }
  const data = await res.json();
  return Array.isArray(data.tasks) ? data.tasks : [];
}

/** @param {string} email @param {object[]} tasks */
async function pushRemoteTasks(email, tasks) {
  const normalized = normalizeUserEmail(email);
  if (!normalized) return false;
  const res = await fetch(`${WORKER_BASE_URL}/api/tasks`, {
    method: "POST",
    headers: await taskHeaders(),
    body: JSON.stringify({ email: normalized, tasks }),
    signal: AbortSignal.timeout(15000),
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(err.error || `Tasks sync failed (${res.status})`);
  }
  return true;
}

/** @param {string} email @param {string} id @param {object} patch */
async function patchRemoteTask(email, id, patch) {
  const normalized = normalizeUserEmail(email);
  if (!normalized) return null;
  const res = await fetch(`${WORKER_BASE_URL}/api/tasks/${encodeURIComponent(id)}`, {
    method: "PATCH",
    headers: await taskHeaders(),
    body: JSON.stringify({ email: normalized, ...patch }),
    signal: AbortSignal.timeout(12000),
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(err.error || `Task update failed (${res.status})`);
  }
  const data = await res.json();
  return data.task || null;
}

/** @param {string} email */
export function listTasks(email) {
  return readLocal(email);
}

/** @param {string} email @param {object[]} tasks */
export function saveTasksLocal(email, tasks) {
  writeLocal(email, tasks.slice(0, MAX_TASKS));
  return tasks;
}

/** @param {string} email */
export async function syncTasksOnLogin(email) {
  const normalized = normalizeUserEmail(email);
  if (!normalized) return [];

  const local = readLocal(normalized);
  let remote = [];
  try {
    remote = await fetchTasksFromWorker(normalized);
  } catch (err) {
    console.warn("[tasks] could not load remote tasks:", err.message || err);
    return local;
  }

  const merged = mergeTaskLists(remote, local);
  writeLocal(normalized, merged);

  const remoteIds = new Set(remote.map((t) => t.id));
  const needsPush = merged.some((t) => !remoteIds.has(t.id)) || merged.length !== remote.length;
  if (needsPush) {
    try {
      await pushRemoteTasks(normalized, merged);
      console.info(`[tasks] synced ${merged.length} task(s) to server for ${normalized}`);
    } catch (err) {
      console.warn("[tasks] remote merge sync failed:", err.message || err);
    }
  }

  return merged;
}

/** @param {string} email @param {object[]} tasks */
async function persistTasks(email, tasks) {
  const trimmed = tasks.slice(0, MAX_TASKS);
  writeLocal(email, trimmed);
  try {
    await pushRemoteTasks(email, trimmed);
  } catch (err) {
    console.warn("[tasks] remote save failed (local kept):", err.message || err);
  }
  return trimmed;
}

/**
 * @param {string} email
 * @param {{ seName?: string, prepResult?: object, company?: string, lifecycleId?: string, session?: object }} [opts]
 */
export function importRecommendedTasks(email, opts = {}) {
  const existing = readLocal(email);
  const existingKeys = new Set(
    existing.filter((t) => t.sourceKey).map((t) => t.sourceKey),
  );
  const nonRecommended = existing.filter((t) => t.status !== "recommended");
  const keptRecommended = existing.filter((t) => t.status === "recommended");
  const newTasks = [];

  const followUps = aggregateFollowUps(email, { seName: opts.seName });
  for (const item of followUps.items) {
    const sourceKey = `${item.callId}:${item.action}:${item.due || ""}`;
    if (existingKeys.has(sourceKey)) continue;
    existingKeys.add(sourceKey);
    newTasks.push({
      id: newId("task"),
      title: item.action,
      status: "recommended",
      source: "postcall",
      sourceKey,
      callId: item.callId,
      company: item.company,
      callTitle: item.company ? `${item.company} · call` : undefined,
      due: item.due !== "-" ? item.due : "",
      dueDate: item.dueDate ? item.dueDate.getTime() : null,
      createdAt: Date.now(),
    });
  }

  if (opts.prepResult && opts.company) {
    for (const rec of extractPrepRecommendations(opts.prepResult, opts.company)) {
      if (existingKeys.has(rec.sourceKey)) continue;
      existingKeys.add(rec.sourceKey);
      newTasks.push({
        id: newId("task"),
        title: rec.title,
        status: "recommended",
        source: "prep",
        sourceKey: rec.sourceKey,
        company: rec.company,
        createdAt: Date.now(),
      });
    }
  }

  const mergedRecommended = [...newTasks, ...keptRecommended];
  const all = [...mergedRecommended, ...nonRecommended]
    .sort((a, b) => (b.createdAt || 0) - (a.createdAt || 0))
    .slice(0, MAX_TASKS);

  writeLocal(email, all);

  if (opts.lifecycleId && newTasks.length) {
    void dualWriteTasks(opts, newTasks);
  }

  return { added: newTasks.length, tasks: all };
}

async function dualWriteTasks(opts, newTasks) {
  try {
    const { linkTaskToLifecycle } = await import("./domain/dual-write.js");
    const session = opts.session || { uid: opts.ownerId, teamId: opts.teamId };
    for (const task of newTasks) {
      await linkTaskToLifecycle(session, { ...task, accountId: opts.accountId }, opts.lifecycleId);
    }
  } catch (err) {
    console.warn("[tasks] lifecycle dual-write failed:", err);
  }
}

/** @param {object} prep @param {string} company */
export function extractPrepRecommendations(prep, company) {
  const rows = (prep?.painCapabilityValue || []).slice(0, 3);
  return rows.map((row, i) => {
    const capability = String(row.capability || row.demoFocus || "demo").trim();
    const pain = String(row.pain || row.customerPain || "prep focus").trim();
    return {
      title: `Configure ${capability}. ${pain}`,
      sourceKey: `prep:${company}:${capability}:${i}`,
      company,
    };
  });
}

function urgencyDot(task) {
  if (!task.dueDate) return `<span class="task-urgency-dot task-urgency-spacer" aria-hidden="true"></span>`;
  const urgency = dueUrgency(new Date(task.dueDate));
  const dotCls =
    urgency === "overdue" ? "dot-red" : urgency === "soon" ? "dot-amber" : "dot-green";
  const label =
    urgency === "overdue" ? "Overdue" : urgency === "soon" ? "Due soon" : "Upcoming";
  return `<span class="task-urgency-dot ${dotCls}" title="${esc(label)}" aria-label="${esc(label)}"></span>`;
}

/**
 * @param {string} email
 * @param {{ title: string, due?: string, callId?: string, company?: string, callTitle?: string }} input
 */
export async function createManualTask(email, input) {
  const title = String(input.title || "").trim();
  if (!title) throw new Error("Task title is required.");

  const dueDate = input.due ? parseDueDate(input.due) : null;
  const task = {
    id: newId("task"),
    title,
    status: "pending",
    source: "manual",
    callId: input.callId || undefined,
    company: input.company || undefined,
    callTitle: input.callTitle || undefined,
    due: input.due || "",
    dueDate: dueDate ? dueDate.getTime() : null,
    createdAt: Date.now(),
  };

  const list = [task, ...readLocal(email)].slice(0, MAX_TASKS);
  await persistTasks(email, list);
  return task;
}

/** @param {string} email @param {string} id @param {"pending"|"completed"|"dismissed"} status */
export async function updateTaskStatus(email, id, status) {
  const list = readLocal(email);
  const idx = list.findIndex((t) => t.id === id);
  if (idx === -1) return null;

  const patch = { status };
  if (status === "completed") patch.completedAt = Date.now();

  const updated = { ...list[idx], ...patch };
  list[idx] = updated;
  writeLocal(email, list);

  try {
    await patchRemoteTask(email, id, patch);
  } catch (err) {
    console.warn("[tasks] remote patch failed:", err.message || err);
  }
  return updated;
}

/** @param {object} record */
export function callLabelFromRecord(record) {
  const title = record.title || record.analysis?.callHeader?.title || "Call";
  const company = String(title).split(/[·|–—-]/)[0]?.trim() || title;
  const when = record.timestamp
    ? new Date(record.timestamp).toLocaleDateString(undefined, { month: "short", day: "numeric" })
    : "";
  return when ? `${company} · ${when}` : company;
}

/** @param {object[]} calls */
export function buildCallPickerOptions(calls) {
  return calls.slice(0, MAX_CALLS_PICKER).map((r) => ({
    value: r.id,
    text: callLabelFromRecord(r),
  }));
}

const URGENCY_RANK = { overdue: 0, soon: 1, upcoming: 2, unknown: 3 };

/** @param {object[]} tasks */
export function sortTasksByUrgency(tasks) {
  return [...tasks].sort((a, b) => {
    const ua = a.dueDate ? dueUrgency(new Date(a.dueDate)) : "unknown";
    const ub = b.dueDate ? dueUrgency(new Date(b.dueDate)) : "unknown";
    const ra = URGENCY_RANK[ua] ?? 9;
    const rb = URGENCY_RANK[ub] ?? 9;
    if (ra !== rb) return ra - rb;
    if (a.dueDate && b.dueDate) return a.dueDate - b.dueDate;
    return (b.createdAt || 0) - (a.createdAt || 0);
  });
}

function statusPill(task) {
  if (task.status === "recommended") {
    return `<span class="task-status-pill task-pill-recommended">Recommended</span>`;
  }
  if (task.status === "completed") {
    return `<span class="task-status-pill task-pill-done">Done</span>`;
  }
  return `<span class="task-status-pill task-pill-active">Active</span>`;
}

function sourceLabel(source) {
  if (source === "postcall") return "Post-call";
  if (source === "prep") return "Prep";
  return "Manual";
}

function formatDueLabel(task) {
  if (task.due) return task.due;
  if (task.dueDate) {
    return new Date(task.dueDate).toLocaleDateString(undefined, { month: "short", day: "numeric" });
  }
  return "";
}

function renderCallChip(task, opts) {
  if (!task.callId) return "";
  const label = task.callTitle || task.company || "View call";
  return `<fw-button class="task-call-chip" size="small" color="secondary" fill="outline" data-open-call="${esc(task.callId)}">${esc(label)}</fw-button>`;
}

/**
 * @param {object} task
 * @param {{ onOpenCall?: (id: string) => void }} opts
 */
function renderTaskRow(task, opts = {}) {
  const isActive = task.status === "pending";
  const isRecommended = task.status === "recommended";
  const isDone = task.status === "completed";

  const metaParts = [
    task.company,
    formatDueLabel(task),
    sourceLabel(task.source),
  ].filter(Boolean);

  const actions = isRecommended
    ? `<fw-button size="small" color="primary" data-task-action="accept" data-task-id="${esc(task.id)}">Accept</fw-button>
       <fw-button size="small" color="secondary" fill="outline" data-task-action="dismiss" data-task-id="${esc(task.id)}">Dismiss</fw-button>`
    : isActive
      ? `<fw-button size="small" color="primary" data-task-action="complete" data-task-id="${esc(task.id)}">Done</fw-button>`
      : "";

  const rowCls = [
    "task-row",
    isDone ? "task-row-done" : "",
    isRecommended ? "task-row-recommended" : "",
    task.callId ? "task-row-has-call" : "",
  ].filter(Boolean).join(" ");

  return `
    <div class="${rowCls}" data-task-id="${esc(task.id)}">
      ${urgencyDot(task)}
      <div class="task-row-body">
        <div class="task-row-title-row">
          ${statusPill(task)}
          <span class="task-row-title${isDone ? " task-row-title-done" : ""}">${esc(task.title)}</span>
        </div>
        <div class="task-row-meta-row">
          ${metaParts.length ? `<span class="task-row-meta muted">${esc(metaParts.join(" · "))}</span>` : ""}
          ${renderCallChip(task, opts)}
        </div>
      </div>
      ${actions ? `<div class="task-row-actions">${actions}</div>` : ""}
    </div>`;
}

function renderRecommendedSection(recommended, opts, expanded) {
  const showToggle = recommended.length > MAX_RECOMMENDED_VISIBLE;
  const visible = showToggle && !expanded
    ? recommended.slice(0, MAX_RECOMMENDED_VISIBLE)
    : recommended;
  const rowsHtml = visible.map((t) => renderTaskRow(t, opts)).join("");
  const body = rowsHtml || `<div class="task-empty dew-empty-copy muted"><fw-icon name="add-note" size="16" aria-hidden="true"></fw-icon><span>No recommendations. Analyze a call or run prep.</span></div>`;
  const toggle = showToggle
    ? `<div class="task-show-more-wrap">
         <fw-button class="task-show-more" color="link" size="small" data-toggle-recommended>
           ${expanded ? "Show less" : `Show all ${recommended.length} recommendations`}
         </fw-button>
       </div>`
    : "";

  return `
    <div class="task-section task-section-recommended">
      <h3 class="task-section-header">Recommended <span class="task-section-count">(${recommended.length})</span></h3>
      <div class="task-list">${body}</div>
      ${toggle}
    </div>`;
}

function renderSection(title, count, rowsHtml, emptyMessage) {
  const body = rowsHtml || `<div class="task-empty dew-empty-copy muted"><fw-icon name="add-note" size="16" aria-hidden="true"></fw-icon><span>${esc(emptyMessage)}</span></div>`;
  return `
    <div class="task-section">
      <h3 class="task-section-header">${esc(title)} <span class="task-section-count">(${count})</span></h3>
      <div class="task-list">${body}</div>
    </div>`;
}

function renderQuickAddRow(calls) {
  const callOptions = buildCallPickerOptions(calls);
  const callSelect = callOptions.length
    ? `<fw-select
         id="quick-add-call"
         class="task-quick-call"
         placeholder="Link to call"
         allow-deselect
         hoist
         same-width="false"
       >
         <fw-select-option value="">No call</fw-select-option>
         ${callOptions.map((o) => `<fw-select-option value="${esc(o.value)}">${esc(o.text)}</fw-select-option>`).join("")}
       </fw-select>`
    : "";

  return `
    <div class="task-quick-add" role="group" aria-label="Add a task">
      <fw-input
        id="quick-add-title"
        class="task-quick-title"
        placeholder="Add a task…"
        clear-input
      ></fw-input>
      <fw-input
        id="quick-add-due"
        class="task-quick-due"
        type="date"
        hint-text="Due"
      ></fw-input>
      ${callSelect}
      <fw-button id="quick-add-btn" color="primary" class="task-quick-btn">Add</fw-button>
    </div>`;
}

function renderEmptyBoard() {
  return `<div class="task-empty muted task-board-empty dew-empty-copy"><fw-icon name="add-note" size="18" aria-hidden="true"></fw-icon><span>No tasks yet. Add one above or analyze a call for recommendations.</span></div>`;
}

async function readSelectValue(el) {
  if (!el) return "";
  try {
    if (typeof el.getSelectedItem === "function") {
      const item = await el.getSelectedItem();
      if (Array.isArray(item) && item[0]?.value != null) return String(item[0].value);
      if (item?.value != null) return String(item.value);
    }
  } catch {
    // fall through
  }
  return el.value != null ? String(el.value) : "";
}

function startOfWeek(d) {
  const x = new Date(d);
  const day = x.getDay();
  const diff = day === 0 ? 6 : day - 1;
  x.setDate(x.getDate() - diff);
  x.setHours(0, 0, 0, 0);
  return x;
}

/** @param {object[]} tasks */
export function aggregateTaskMetrics(tasks) {
  const recommended = tasks.filter((t) => t.status === "recommended").length;
  const active = tasks.filter((t) => t.status === "pending").length;
  const openTasks = tasks.filter((t) => t.status === "recommended" || t.status === "pending");
  const overdueOpen = openTasks.filter(
    (t) => t.dueDate && dueUrgency(new Date(t.dueDate)) === "overdue",
  ).length;
  const openTotal = recommended + active;

  const thisWeekStart = startOfWeek(new Date());
  const weekLabels = ["W-3", "W-2", "W-1", "This week"];
  const completedByWeek = weekLabels.map((label, i) => {
    const weeksAgo = 3 - i;
    const start = new Date(thisWeekStart);
    start.setDate(start.getDate() - weeksAgo * 7);
    const end = new Date(start);
    end.setDate(end.getDate() + 7);
    const count = tasks.filter((t) => {
      if (t.status !== "completed" || !t.completedAt) return false;
      return t.completedAt >= start.getTime() && t.completedAt < end.getTime();
    }).length;
    return { label, count, start: start.getTime() };
  });

  const completedThisWeek = completedByWeek[3]?.count ?? 0;

  return {
    recommended,
    active,
    overdueOpen,
    openTotal,
    completedByWeek,
    completedThisWeek,
    completedTotal: tasks.filter((t) => t.status === "completed").length,
  };
}

function renderColumnChart(title, bars, opts = {}) {
  const w = opts.width ?? 280;
  const h = opts.height ?? 140;
  const padL = 28;
  const padR = 12;
  const padT = 12;
  const padB = 36;
  const chartW = w - padL - padR;
  const chartH = h - padT - padB;
  const n = bars.length || 1;
  const maxVal = Math.max(...bars.map((b) => b.count), 1);
  const barGap = n > 1 ? Math.min(10, chartW / (n * 4)) : 0;
  const barW = (chartW - barGap * (n - 1)) / n;

  const svgBars = bars
    .map((b, i) => {
      const barH = maxVal ? (b.count / maxVal) * chartH : 0;
      const x = padL + i * (barW + barGap);
      const y = padT + chartH - barH;
      const cls = b.cls || "ok";
      return `
        <g class="task-chart-bar-group">
          <rect class="dash-trend-bar task-chart-bar ${cls}" x="${x}" y="${y}" width="${barW}" height="${barH}" rx="3"
            aria-label="${esc(b.label)}: ${b.count}" />
          <text class="dash-trend-label task-chart-label" x="${x + barW / 2}" y="${h - 8}" text-anchor="middle">${esc(b.label)}</text>
          <text class="dash-trend-value task-chart-value ${cls}" x="${x + barW / 2}" y="${y - 4}" text-anchor="middle">${b.count}</text>
        </g>`;
    })
    .join("");

  return `
    <fw-card class="task-chart-card">
      <p class="task-chart-title">${esc(title)}</p>
      <svg class="task-chart-svg" viewBox="0 0 ${w} ${h}" role="img" aria-label="${esc(title)}">
        ${svgBars}
      </svg>
    </fw-card>`;
}

/**
 * @param {HTMLElement} container
 * @param {object[]} tasks
 */
export function renderTaskCharts(container, tasks) {
  const m = aggregateTaskMetrics(tasks);
  const openBars = [
    { label: "Recommended", count: m.recommended, cls: "ok" },
    { label: "Active", count: m.active, cls: "good" },
  ];
  const doneBars = m.completedByWeek.map((w) => ({
    label: w.label,
    count: w.count,
    cls: "good",
  }));

  container.innerHTML = `
    <div class="task-charts-row">
      ${renderColumnChart("Open tasks", openBars)}
      ${renderColumnChart("Completed", doneBars)}
    </div>`;
}

function refreshAfterTaskChange(container, email, tasks, calls, opts) {
  opts.onTasksChanged?.(email, opts);
  renderTaskBoard(container, email, opts);
}

function wireTaskBoardEvents(container, email, tasks, calls, opts) {
  async function submitQuickAdd() {
    const titleEl = container.querySelector("#quick-add-title");
    const dueEl = container.querySelector("#quick-add-due");
    const callEl = container.querySelector("#quick-add-call");
    const title = titleEl?.value?.trim() || "";
    if (!title) return;

    const callId = await readSelectValue(callEl);
    const linked = callId ? calls.find((r) => r.id === callId) : null;
    await createManualTask(email, {
      title,
      due: dueEl?.value || "",
      callId: callId || undefined,
      company: linked ? callLabelFromRecord(linked).split(" · ")[0] : undefined,
      callTitle: linked ? callLabelFromRecord(linked) : undefined,
    });

    if (titleEl) titleEl.value = "";
    if (dueEl) dueEl.value = "";
    if (callEl) callEl.value = "";

    refreshAfterTaskChange(container, email, listTasks(email), calls, opts);
  }

  container.querySelector("#quick-add-btn")?.addEventListener("fwClick", () => {
    void submitQuickAdd();
  });

  container.querySelector("#quick-add-title")?.addEventListener("fwInputEnter", () => {
    void submitQuickAdd();
  });

  container.querySelectorAll("[data-task-action]").forEach((btn) => {
    btn.addEventListener("fwClick", async () => {
      const id = btn.dataset.taskId;
      const action = btn.dataset.taskAction;
      if (!id || !action) return;
      if (action === "accept") await updateTaskStatus(email, id, "pending");
      else if (action === "dismiss") await updateTaskStatus(email, id, "dismissed");
      else if (action === "complete") await updateTaskStatus(email, id, "completed");
      refreshAfterTaskChange(container, email, listTasks(email), calls, opts);
    });
  });

  container.querySelector("[data-toggle-recommended]")?.addEventListener("fwClick", () => {
    container.dataset.recommendedExpanded = container.dataset.recommendedExpanded === "1" ? "" : "1";
    renderTaskBoard(container, email, opts);
  });

  container.querySelectorAll("[data-open-call]").forEach((btn) => {
    btn.addEventListener("fwClick", (e) => {
      e.stopPropagation();
      opts.onOpenCall?.(btn.dataset.openCall);
    });
  });
}

/**
 * @param {HTMLElement} container
 * @param {string} email
 * @param {{ onOpenCall?: (id: string) => void, onPrep?: () => void, onAnalyze?: () => void }} opts
 */
export function renderTaskBoard(container, email, opts = {}) {
  const tasks = listTasks(email);
  const recommended = sortTasksByUrgency(tasks.filter((t) => t.status === "recommended"));
  const active = sortTasksByUrgency(tasks.filter((t) => t.status === "pending"));
  const completed = sortTasksByUrgency(tasks.filter((t) => t.status === "completed")).slice(0, COMPLETED_SHOW);
  const calls = listPostCallAnalyses(email).slice(0, MAX_CALLS_PICKER);
  const recommendedExpanded = container.dataset.recommendedExpanded === "1";

  const activeRows = active.map((t) => renderTaskRow(t, opts)).join("");
  const doneRows = completed.map((t) => renderTaskRow(t, opts)).join("");

  const hasAnyTasks = recommended.length + active.length + completed.length > 0;

  container.innerHTML = `
    <section class="dash-section task-board-section" aria-labelledby="tasks-heading">
      <h2 id="tasks-heading" class="dash-section-title">What should I do now?</h2>
      <fw-card class="task-board-card">
        ${renderQuickAddRow(calls)}
        <div class="task-board-sections">
          ${
            hasAnyTasks
              ? `${renderRecommendedSection(recommended, opts, recommendedExpanded)}
                 ${renderSection("Active", active.length, activeRows, "Nothing active. Accept a recommendation or add a task.")}
                 ${
                   completed.length
                     ? `<details class="task-completed-accordion">
                          <summary class="task-section-header task-completed-summary">
                            Completed <span class="task-section-count">(${completed.length})</span>
                          </summary>
                          <div class="task-list">${doneRows}</div>
                        </details>`
                     : ""
                 }`
              : renderEmptyBoard()
          }
        </div>
      </fw-card>
    </section>`;

  wireTaskBoardEvents(container, email, tasks, calls, opts);
}

/** @param {string} email @param {{ seName?: string, prepResult?: object, company?: string, lifecycleId?: string, session?: object, accountId?: string }} [opts] */
export async function syncTasksAfterActivity(email, opts = {}) {
  const { added, tasks } = importRecommendedTasks(email, opts);
  if (added > 0) {
    try {
      await pushRemoteTasks(email, tasks);
    } catch (err) {
      console.warn("[tasks] sync after activity failed:", err.message || err);
    }
  }
  return tasks;
}
