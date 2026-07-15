import { playRoar, triggerSignInPulse } from "./lion-roar.js";
import { initSidebar } from "./sidebar.js";
import { firebaseConfig, WORKER_BASE_URL, ALLOWED_EMAIL_DOMAIN } from "./firebase-config.js";
import {
  authMode,
  getSession,
  loginDummy,
  logout,
  onSessionChange,
  persistFirebaseSession,
  isManagerRole,
} from "./auth.js";
import { listPostCallAnalyses, getPostCallAnalysis, syncHistoryOnLogin, setHistoryAuthGetter, clearHistoryAuthGetter } from "./history.js";
import { normalizeQualityCoach } from "./quality-score.js";
import { renderDashboard, renderManagerDashboard } from "./dashboard.js";
import { renderCoaching } from "./coaching.js";
import { pickDemoLinks } from "./demo-links.js";
import {
  displayPostCall,
  onSessionReady,
  onSessionCleared,
  setOnAnalysisSaved,
} from "./postcall.js";

const authEnabled = !!firebaseConfig.projectId;
const PREP_URL = `${WORKER_BASE_URL}/api/generate-prep`;
const TAB_STORAGE_KEY = "lionpath-active-tab";
const WORKER_DOWN_MSG =
  `Cannot reach the API server at ${WORKER_BASE_URL}. ` +
  "Start the worker in another terminal: cd worker → npm.cmd run dev (look for Ready on port 8787). " +
  "Use the same hostname for web and worker (both localhost or both 127.0.0.1), then refresh.";

let fb = null;
let currentSession = null;
let currentView = "dashboard";

const $ = (id) => document.getElementById(id);
const show = (el, on = true) => { el.hidden = !on; };

const VIEW_TITLES = {
  dashboard: "My dashboard",
  coaching: "My coaching",
  workspace: "One-pagers",
  manager: "Manager dashboard",
};

function esc(v) {
  return String(v ?? "").replace(/[&<>"']/g, (c) =>
    ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
}
const isUnknown = (v) => !v || String(v).trim().toLowerCase() === "unknown" || String(v).trim() === "-";
const dash = (v) => (isUnknown(v) ? '<span class="muted">—</span>' : esc(v));

function truncateWords(text, max) {
  const words = String(text ?? "").trim().split(/\s+/).filter(Boolean);
  if (words.length <= max) return esc(words.join(" "));
  return `${esc(words.slice(0, max).join(" "))}<span class="trunc-ellipsis">…</span>`;
}

const emailDomain = (email) => {
  const at = String(email || "").lastIndexOf("@");
  return at >= 0 ? email.slice(at + 1).trim().toLowerCase() : "";
};

const DOMAIN_RE = /^[a-z0-9]([a-z0-9-]*\.)+[a-z]{2,}$/i;
const DOMAIN_TYPO_MARKERS = [/acadmey/i, /academey/i, /acadamy/i];
const WELL_KNOWN_DOMAINS = {
  "khan academy": "khanacademy.org",
  "khan academey": "khanacademy.org",
};

function suggestDomainFromCompany(companyName) {
  const key = String(companyName || "").trim().toLowerCase();
  if (WELL_KNOWN_DOMAINS[key]) return WELL_KNOWN_DOMAINS[key];
  const words = key.split(/\s+/).filter(Boolean);
  if (words.length >= 1 && words.length <= 4) {
    const slug = words.join("").replace(/[^a-z0-9]/gi, "").toLowerCase();
    if (slug.length >= 4) return `${slug}.com`;
  }
  return null;
}

function validateProspectDomain(email, companyName) {
  const domain = emailDomain(email);
  if (!email?.trim()) return null;
  const hints = [];
  if (domain && !DOMAIN_RE.test(domain)) hints.push("Email domain format looks invalid.");
  if (domain && DOMAIN_TYPO_MARKERS.some((p) => p.test(domain))) {
    const suggested = suggestDomainFromCompany(companyName) || "khanacademy.org";
    hints.push(`Possible typo — did you mean ${suggested}?`);
  }
  const suggested = suggestDomainFromCompany(companyName);
  if (suggested && domain && domain !== suggested) {
    const norm = (s) => s.toLowerCase().replace(/[^a-z0-9]/g, "");
    if (norm(domain.split(".")[0]) !== norm(suggested.split(".")[0])) {
      hints.push(`For ${companyName.trim()}, official domain is usually ${suggested}.`);
    }
  }
  return hints.length ? hints.join(" ") : null;
}

function updateDomainHint() {
  const hint = $("domain-hint");
  if (!hint) return;
  const msg = validateProspectDomain($("prospectEmail")?.value, $("companyName")?.value);
  if (msg) {
    hint.textContent = msg;
    hint.className = "field-hint warn";
    hint.hidden = false;
  } else {
    hint.hidden = true;
  }
}

function gapDot(gap) {
  const cls = gap === "large" ? "gap-large" : gap === "parity" ? "gap-parity" : "gap-partial";
  const label = gap === "large" ? "Large gap" : gap === "parity" ? "Parity" : "Partial gap";
  return `<span class="gap-dot ${cls}" title="${label}" aria-label="${label}"></span>`;
}

function gapCell(row) {
  const verdict = String(row.gapVerdict || "").trim() || (row.gap === "large" ? "Behind" : row.gap === "parity" ? "Aligned" : "Partial");
  return `<span class="gap-verdict">${esc(verdict)}</span> ${gapDot(row.gap)}`;
}

function decisionDot(power) {
  const cls =
    power === "decision_maker" ? "dot-green" : power === "influencer" ? "dot-grey" : "dot-red";
  const label =
    power === "decision_maker" ? "Decision maker" : power === "influencer" ? "Influencer" : "Unknown";
  return `<span class="power-dot ${cls}" title="${label}" aria-label="${label}"></span>`;
}

function isV5Prep(p) {
  return !!(p?.incumbent?.displacement && p?.supportMaturity && p?.companySizeAgents);
}

const DISPLACEMENT_LABELS = {
  greenfield: "Greenfield",
  homegrown: "Homegrown",
  entrenched: "Entrenched",
};

function renderMaturityChip(label, flag) {
  const val = String(flag || "unknown").toUpperCase();
  const cls = val === "Y" ? "mat-y" : val === "N" ? "mat-n" : "mat-unknown";
  const text = val === "Y" ? "Y" : val === "N" ? "N" : "?";
  return `<span class="maturity-chip ${cls}" title="${esc(label)}: ${esc(text)}">${esc(label)} <strong>${esc(text)}</strong></span>`;
}

const BIZ_ROWS = [
  ["market", "Market"],
  ["model", "Business model"],
  ["users", "Users"],
  ["uptimeNeed", "Uptime need"],
  ["fundingParent", "Funding / parent"],
  ["headOffice", "Head office"],
  ["demography", "Demography"],
  ["languages", "Languages"],
];

const SIGNAL_ROWS = [
  ["supportJobListings", "Support job listings"],
  ["similarwebVisitors", "Similarweb visitors"],
];

// ---------- Tabs ----------

function getStoredTab() {
  const t = localStorage.getItem(TAB_STORAGE_KEY);
  return t === "postcall" ? "postcall" : "discovery";
}

function setStoredTab(tab) {
  localStorage.setItem(TAB_STORAGE_KEY, tab);
}

function switchWorkspaceTab(tab) {
  const discovery = tab === "discovery";
  const panels = { discovery: $("tab-discovery"), postcall: $("tab-postcall") };
  const reduceMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;

  Object.entries(panels).forEach(([key, el]) => {
    const showPanel = key === (discovery ? "discovery" : "postcall");
    if (showPanel) {
      show(el, true);
      el.classList.remove("tab-exit");
      el.classList.add("tab-enter");
      if (!reduceMotion) {
        requestAnimationFrame(() => {
          el.classList.remove("tab-enter");
          el.classList.add("tab-active");
        });
      } else {
        el.classList.remove("tab-enter");
        el.classList.add("tab-active");
      }
    } else if (!el.hidden) {
      if (reduceMotion) {
        show(el, false);
        el.classList.remove("tab-active", "tab-exit", "tab-enter");
      } else {
        el.classList.remove("tab-active");
        el.classList.add("tab-exit");
        setTimeout(() => {
          show(el, false);
          el.classList.remove("tab-exit", "tab-enter");
        }, 220);
      }
    }
  });

  document.querySelectorAll(".app-tab").forEach((btn) => {
    btn.classList.toggle("active", btn.dataset.tab === tab);
    btn.setAttribute("aria-selected", btn.dataset.tab === tab ? "true" : "false");
  });
  setStoredTab(tab);
}

function dashboardOpts() {
  return {
    seName: currentSession?.name,
    onOpenCall: (id) => openHistoryItem(id),
    onPrep: () => {
      switchView("precall");
    },
    onAnalyze: () => {
      switchView("analysis");
    },
    onCoaching: () => {
      switchView("coaching");
    },
  };
}

function updateNavForRole() {
  const isManager = isManagerRole(currentSession);
  document.querySelectorAll(".nav-item[data-role]").forEach((btn) => {
    const role = btn.dataset.role;
    const showBtn = role === "manager" ? isManager : !isManager;
    btn.hidden = !showBtn;
  });
}

function refreshActiveDashboard() {
  if (!currentSession?.email) return;
  if (isManagerRole(currentSession)) {
    if (currentView === "manager") {
      renderManagerDashboard($("view-manager"));
    }
    return;
  }
  if (currentView === "dashboard") {
    renderDashboard($("view-dashboard"), currentSession.email, dashboardOpts());
  } else if (currentView === "coaching") {
    renderCoaching($("view-coaching"), currentSession.email, {
      onOpenCall: (id) => openHistoryItem(id),
    });
  }
}

// ---------- Views ----------

function switchView(name) {
  currentView = name;
  const isManager = isManagerRole(currentSession);
  const panels = {
    dashboard: $("view-dashboard"),
    coaching: $("view-coaching"),
    workspace: $("view-workspace"),
    manager: $("view-manager"),
  };

  if (isManager) {
    if (name === "dashboard" || name === "coaching") name = "manager";
  } else if (name === "manager") {
    name = "dashboard";
  }

  if (name === "analysis") {
    name = "workspace";
    switchWorkspaceTab("postcall");
  } else if (name === "precall") {
    name = "workspace";
    switchWorkspaceTab("discovery");
  }

  Object.entries(panels).forEach(([key, el]) => show(el, key === name));
  $("main-view-title").textContent = VIEW_TITLES[name] || name;

  document.querySelectorAll(".nav-item").forEach((btn) => {
    btn.classList.toggle("active", btn.dataset.view === name);
  });

  if (name === "dashboard" && !isManager) {
    renderDashboard($("view-dashboard"), currentSession.email, dashboardOpts());
  } else if (name === "coaching" && !isManager) {
    renderCoaching($("view-coaching"), currentSession.email, {
      onOpenCall: (id) => openHistoryItem(id),
    });
  } else if (name === "manager" && isManager) {
    renderManagerDashboard($("view-manager"));
  }

  history.replaceState(null, "", `#${name}`);
  closeSidebar();
}

function openHistoryItem(id) {
  const record = getPostCallAnalysis(currentSession.email, id);
  if (!record?.result) return;
  switchView("workspace");
  switchWorkspaceTab("postcall");
  displayPostCall(record.result, { title: record.title });
  document.querySelectorAll(".sidebar-history-item").forEach((el) => {
    el.classList.toggle("active", el.dataset.id === id);
  });
}

function clearSidebarHistory() {
  const ul = $("sidebar-history-list");
  const empty = $("sidebar-history-empty");
  if (ul) ul.innerHTML = "";
  if (empty) show(empty, true);
}

function refreshDashboardFromStorage() {
  refreshActiveDashboard();
}

function setSidebarHistorySyncing(on) {
  const el = $("sidebar-history-sync");
  if (el) show(el, on);
}

async function loadPersistedHistory() {
  if (!currentSession?.email) {
    clearSidebarHistory();
    return 0;
  }
  setSidebarHistorySyncing(true);
  try {
    const list = await syncHistoryOnLogin(currentSession.email);
    refreshSidebarHistory();
    const count = list.length;
    console.info(`[app] loaded ${count} post-call record(s) for ${currentSession.email}`);
    return count;
  } catch (err) {
    console.warn("[app] history sync failed:", err);
    refreshSidebarHistory();
    return listPostCallAnalyses(currentSession.email).length;
  } finally {
    setSidebarHistorySyncing(false);
  }
}

function refreshSidebarHistory() {
  if (!currentSession?.email) {
    clearSidebarHistory();
    return;
  }
  const list = listPostCallAnalyses(currentSession.email);
  const ul = $("sidebar-history-list");
  const empty = $("sidebar-history-empty");

  if (!list.length) {
    ul.innerHTML = "";
    show(empty, true);
    return;
  }

  show(empty, false);
  ul.innerHTML = list
    .slice(0, 20)
    .map((r) => {
      const when = r.timestamp ? new Date(r.timestamp).toLocaleDateString() : "";
      const qc = r.analysis?.qualityCoach;
      const score = qc ? normalizeQualityCoach(qc).overallScore : null;
      const scoreBadge = score != null ? `<span class="hist-score">${score}/10</span>` : "";
      return `<li>
        <button type="button" class="sidebar-history-item" data-id="${esc(r.id)}" title="${esc(r.title)}">
          <span class="hist-title">${esc(r.title)}</span>
          <span class="hist-meta">${scoreBadge}<span class="hist-when">${esc(when)}</span></span>
        </button>
      </li>`;
    })
    .join("");

  ul.querySelectorAll(".sidebar-history-item").forEach((btn) => {
    btn.onclick = () => openHistoryItem(btn.dataset.id);
  });
}

function updateSidebarUser() {
  const name = currentSession?.name || "";
  $("sidebar-user-name").textContent = name;
  $("sidebar-user-role").textContent =
    isManagerRole(currentSession) ? "Manager" : "Solution Engineer";
  const avatar = $("sidebar-user-avatar");
  if (avatar) {
    avatar.textContent = name ? name.charAt(0).toUpperCase() : "🦁";
    avatar.title = name;
  }
}

// ---------- Sidebar mobile ----------

function openSidebar() {
  $("sidebar").classList.add("open");
  show($("sidebar-backdrop"), true);
}

function closeSidebar() {
  $("sidebar").classList.remove("open");
  show($("sidebar-backdrop"), false);
}

// ---------- Rendering (Discovery) ----------

function prefersReducedMotion() {
  return window.matchMedia("(prefers-reduced-motion: reduce)").matches;
}

function initPrepAnimations(root) {
  if (!root) return;
  root.classList.add("anim-root");
  const blocks = root.querySelectorAll(".header-strip, .must-see, .good-to-see, section, .prep-footer, .momentum-hero");
  blocks.forEach((el, i) => {
    el.classList.add("anim-block");
    el.style.setProperty("--anim-delay", `${i * 50}ms`);
  });

  root.querySelectorAll(".flow-row").forEach((row, rowIdx) => {
    row.querySelectorAll(".flow-cell, .flow-arrow").forEach((cell, cellIdx) => {
      cell.style.setProperty("--flow-delay", `${rowIdx * 140 + cellIdx * 55}ms`);
    });
  });

  if (prefersReducedMotion()) {
    root.classList.add("anim-ready");
    return;
  }
  requestAnimationFrame(() => {
    requestAnimationFrame(() => root.classList.add("anim-ready"));
  });
}

function renderPrep(p, meta = {}) {
  if (!p?.fitSnapshot && (p?.comparison || p?.researchSnapshot || p?.demoPlan)) {
    return `<div class="status err">This prep uses an older format. Regenerate to get the Discovery brief.</div>`;
  }
  if (!isV5Prep(p)) {
    return `<div class="status err">This prep uses the v4 format. Regenerate to get the v5 Discovery brief.</div>`;
  }

  const attendeeChips = (p.attendees || []).length
    ? (p.attendees || [])
        .map((a) => {
          const parts = [`<span class="attendee-chip">${decisionDot(a.decisionPower)}${dash(a.name)}`];
          if (!isUnknown(a.role)) parts.push(`<span class="chip-role">${truncateWords(a.role, 8)}</span>`);
          parts.push("</span>");
          return parts.join(" · ");
        })
        .join("")
    : '<span class="muted">—</span>';

  const snapshot = p.fitSnapshot || [];
  const focalIdx = snapshot.findIndex((r) => r.gap === "large");
  const focalRowIdx = focalIdx >= 0 ? focalIdx : 0;

  const fitRows = snapshot
    .map(
      (row, idx) => `<tr class="${idx === focalRowIdx ? "focal-gap-row" : ""}">
        <th class="prep-row-label">${truncateWords(row.label, 8)}</th>
        <td>${truncateWords(row.thisCompany, 8)}</td>
        <td>${truncateWords(row.industryNorm, 8)}</td>
        <td class="gap-cell">${gapCell(row)}</td>
      </tr>`,
    )
    .join("");

  const fitTable = fitRows
    ? `<table class="prep-compare fit-snapshot">
        <thead><tr><th></th><th>This company</th><th>Industry norm</th><th>Gap</th></tr></thead>
        <tbody>${fitRows}</tbody>
      </table>`
    : '<p class="muted">—</p>';

  const inc = p.incumbent || {};
  const disp = inc.displacement || "greenfield";
  const incumbentRow = `<div class="incumbent-row displacement-${esc(disp)}">
    <span class="incumbent-label">Incumbent</span>
    <span class="incumbent-name">${truncateWords(inc.incumbent_name, 8)}</span>
    <span class="displacement-badge">${esc(DISPLACEMENT_LABELS[disp] || disp)}</span>
  </div>`;

  const mat = p.supportMaturity || {};
  const maturityChips = `<div class="maturity-chips">
    ${renderMaturityChip("Self-service", mat.selfServicePortal)}
    ${renderMaturityChip("Web chat", mat.webChat)}
    ${renderMaturityChip("Phone", mat.phone)}
    ${renderMaturityChip("Omnichannel", mat.omnichannel)}
  </div>`;

  const useCases = (p.industryUseCases || []).filter((x) => !isUnknown(x)).slice(0, 3);
  const useCaseHtml = useCases.length
    ? `<ul class="use-case-list">${useCases.map((u) => `<li>${truncateWords(u, 10)}</li>`).join("")}</ul>`
    : '<p class="muted">—</p>';

  const csa = p.companySizeAgents || {};
  const sizeHtml = `<div class="company-size-row">
    <span class="company-size-label">Support agents</span>
    <span class="company-size-value">${truncateWords(csa.agents, 8)}${csa.estimated ? ' <span class="est-label">est.</span>' : ""}</span>
  </div>`;

  const bc = p.businessContext || {};
  const sig = bc.signals || {};
  const bizTable = `<table class="kv-table">
    <tbody>${BIZ_ROWS.map(
      ([key, label]) =>
        `<tr><th>${esc(label)}</th><td>${truncateWords(bc[key], 8)}</td></tr>`,
    ).join("")}</tbody>
  </table>`;

  const signalTable = `<table class="kv-table signal-table">
    <tbody>${SIGNAL_ROWS.map(
      ([key, label]) =>
        `<tr><th>${esc(label)}</th><td>${truncateWords(sig[key], 8)}</td></tr>`,
    ).join("")}</tbody>
  </table>`;

  const workflows = (bc.workflows || []).filter((x) => !isUnknown(x));
  const workflowHtml = workflows.length
    ? `<ul class="prep-bullets">${workflows
        .slice(0, 4)
        .map((b) => `<li>${truncateWords(b, 12)}</li>`)
        .join("")}</ul>`
    : '<p class="muted">—</p>';

  const kit = (p.discoveryKit || []).slice(0, 3);
  const kitHtml = kit.length
    ? `<table class="discovery-kit">
        <thead><tr><th>Ask this</th><th>Because</th></tr></thead>
        <tbody>${kit
          .map(
            (item) => `<tr>
              <td>${truncateWords(item.question, 12)}</td>
              <td class="because-cell">${truncateWords(item.because, 12)}</td>
            </tr>`,
          )
          .join("")}</tbody>
      </table>`
    : '<p class="muted">—</p>';

  const pcv = (p.painCapabilityValue || []).slice(0, 3);
  const flowHtml = pcv.length
    ? `<div class="flowchart flowchart-anim">${pcv
        .map(
          (row) => `<div class="flow-row">
            <span class="flow-cell pain">${truncateWords(row.pain, 8)}</span>
            <span class="flow-arrow" aria-hidden="true">→</span>
            <span class="flow-cell cap">${truncateWords(row.capability, 8)}</span>
            <span class="flow-arrow" aria-hidden="true">→</span>
            <span class="flow-cell val">${truncateWords(row.value, 8)}</span>
          </div>`,
        )
        .join("")}</div>`
    : '<p class="muted">—</p>';

  const demoLinksHtml = renderDemoLinks(p);

  const sources = (p.sources || []).length
    ? `<details class="sources"><summary>Sources (${p.sources.length})</summary><ul>${(p.sources || [])
        .map((s) => {
          const url = s.url && !isUnknown(s.url) ? s.url : null;
          const link = url
            ? `<a href="${esc(url)}" target="_blank" rel="noopener">${esc(url)}</a>`
            : '<span class="muted">unknown</span>';
          return `<li>${truncateWords(s.claim, 12)} — ${link}</li>`;
        })
        .join("")}</ul></details>`
    : "";

  const domain = meta.domain ? esc(meta.domain) : "";

  return `
    <div class="toolbar">
      <button class="ghost" onclick="window.print()">Print / PDF</button>
      <button class="ghost" id="copy-json">Copy JSON</button>
    </div>
    <header class="header-strip must-see-strip">
      <div class="header-main">
        <h2 class="one-pager-title">${esc(meta.company || "")}</h2>
        ${domain ? `<span class="header-domain">${domain}</span>` : ""}
      </div>
      <p class="header-desc">${truncateWords(p.description, 15)}</p>
      <div class="attendee-chips">${attendeeChips}</div>
    </header>
    <div class="must-see">
      ${incumbentRow}
      <section class="prep-hero"><h2>Fit snapshot</h2>${fitTable}</section>
      <section class="maturity-section"><h2>Support maturity</h2>${maturityChips}</section>
      <section class="use-cases-section"><h2>Industry use cases</h2>${useCaseHtml}</section>
      ${sizeHtml}
      <section><h2>Discovery kit</h2>${kitHtml}</section>
    </div>
    <details class="good-to-see" open>
      <summary>More context &amp; demo prep</summary>
      <details class="more-context" open>
        <summary>More context</summary>
        <section class="biz-context">
          <h2>Business context</h2>
          <div class="biz-grid">${bizTable}
            <div class="workflows-block"><h3>Workflows</h3>${workflowHtml}</div>
          </div>
        </section>
        <section class="signals-section"><h2>Signals</h2>${signalTable}</section>
      </details>
      ${demoLinksHtml}
      <details class="demo-prep-section">
        <summary>Demo prep</summary>
        ${flowHtml}
      </details>
      <footer class="prep-footer">${sources}</footer>
    </details>`;
}

function renderDemoLinks(prep) {
  const links = pickDemoLinks(prep);
  if (!links.length) return "";

  const chips = links
    .map(
      (link) =>
        `<a class="demo-link-chip" href="${esc(link.url)}" target="_blank" rel="noopener noreferrer" title="${esc(link.label)}">${esc(link.label)}<span class="demo-link-ext" aria-hidden="true">↗</span></a>`,
    )
    .join("");

  return `<div class="demo-resources">
    <p class="demo-resources-label">Demo resources</p>
    <div class="demo-link-chips">${chips}</div>
  </div>`;
}

function displayPrep(prep, meta) {
  const result = $("prep-result");
  result.classList.remove("anim-root", "anim-ready");
  result.innerHTML = renderPrep(prep, meta || {});
  show(result, true);
  initPrepAnimations(result);
  const copyBtn = $("copy-json");
  if (copyBtn) copyBtn.onclick = () => navigator.clipboard.writeText(JSON.stringify(prep, null, 2));
  result.scrollIntoView({ behavior: prefersReducedMotion() ? "auto" : "smooth", block: "start" });
}

// ---------- Generate ----------

async function generate(e) {
  e.preventDefault();
  const btn = $("generate");
  const status = $("prep-status");
  const payload = {
    companyName: $("companyName").value.trim(),
    prospectEmail: $("prospectEmail").value.trim(),
    additionalContext: $("additionalContext").value.trim() || undefined,
  };
  const meta = {
    company: payload.companyName,
    domain: emailDomain(payload.prospectEmail),
    additionalContext: payload.additionalContext,
  };
  btn.disabled = true;
  status.className = "status";
  status.textContent = "Researching the prospect and drafting the brief… usually 15–45 seconds. Please wait.";
  show(status, true);
  show($("prep-result"), false);
  const form = $("prep-form");
  form?.querySelectorAll("input, textarea, button").forEach((el) => { el.disabled = true; });

  try {
    const headers = { "content-type": "application/json" };
    if (authEnabled && fb?.auth?.currentUser) {
      headers["Authorization"] = `Bearer ${await fb.auth.currentUser.getIdToken()}`;
    }
    const res = await fetch(PREP_URL, { method: "POST", headers, body: JSON.stringify(payload) });
    const raw = await res.text();
    let data;
    try {
      data = JSON.parse(raw);
    } catch {
      throw new Error(raw.slice(0, 300) || `Request failed (${res.status}).`);
    }
    if (!res.ok) throw new Error(data.error || `Request failed (${res.status}).`);

    displayPrep(data.prep, meta);
    show(status, false);
    if (authEnabled && fb?.auth?.currentUser) await savePrep(payload, data.prep);
  } catch (err) {
    status.className = "status err";
    const msg = err.message || "Something went wrong.";
    status.textContent =
      msg === "Failed to fetch" || /network|fetch/i.test(msg) ? WORKER_DOWN_MSG : msg;
  } finally {
    btn.disabled = false;
    $("prep-form")?.querySelectorAll("input, textarea, button").forEach((el) => { el.disabled = false; });
  }
}

// ---------- Firestore prep history (when Firebase enabled) ----------

async function savePrep(input, prep) {
  try {
    const user = fb.auth.currentUser;
    await fb.addDoc(fb.collection(fb.db, "preps"), {
      uid: user.uid,
      email: user.email,
      company: input.companyName,
      prospectEmail: input.prospectEmail,
      additionalContext: input.additionalContext || "",
      prep,
      createdAt: fb.serverTimestamp(),
    });
    await loadPrepHistory();
  } catch (err) {
    console.warn("Could not save to history:", err);
  }
}

async function loadPrepHistory() {
  if (!authEnabled || !fb?.auth?.currentUser) return;
  const section = $("history-section");
  try {
    const user = fb.auth.currentUser;
    const q = fb.query(fb.collection(fb.db, "preps"), fb.where("uid", "==", user.uid));
    const snap = await fb.getDocs(q);
    const docs = snap.docs
      .map((d) => d.data())
      .sort((a, b) => (b.createdAt?.seconds || 0) - (a.createdAt?.seconds || 0))
      .slice(0, 10);
    if (!docs.length) { show(section, false); return; }
    $("history").innerHTML = docs
      .map((d, i) => {
        const when = d.createdAt?.seconds ? new Date(d.createdAt.seconds * 1000).toLocaleString() : "";
        return `<li><span><strong>${esc(d.company)}</strong> · ${esc(d.prospectEmail)}</span>
          <span><button class="link-btn" data-i="${i}">view</button> <span class="when">${esc(when)}</span></span></li>`;
      })
      .join("");
    $("history").querySelectorAll("button[data-i]").forEach((b) =>
      (b.onclick = () => {
        const d = docs[Number(b.dataset.i)];
        switchWorkspaceTab("discovery");
        displayPrep(d.prep, { company: d.company, domain: emailDomain(d.prospectEmail), additionalContext: d.additionalContext });
      }));
    show(section, true);
  } catch (err) {
    console.warn("Could not load history:", err);
    show(section, false);
  }
}

// ---------- Auth UI ----------

function showLogin() {
  show($("login-view"), true);
  show($("app-shell"), false);
  currentSession = null;
  clearHistoryAuthGetter();
  clearSidebarHistory();
  onSessionCleared();
}

async function showApp(session, opts = {}) {
  currentSession = session?.email
    ? { ...session, email: String(session.email).trim().toLowerCase() }
    : session;
  show($("login-view"), false);
  show($("app-shell"), true);
  updateSidebarUser();

  if (opts.freshLogin) {
    playRoar();
    triggerSignInPulse();
  }

  const tokenFn = authEnabled && fb?.auth?.currentUser
    ? () => fb.auth.currentUser.getIdToken()
    : null;
  setHistoryAuthGetter(tokenFn);
  onSessionReady(currentSession, tokenFn);

  updateNavForRole();

  const defaultView = isManagerRole(session) ? "manager" : "dashboard";
  const hash = location.hash.replace("#", "");
  const valid = ["dashboard", "coaching", "workspace", "analysis", "precall", "manager"];
  switchView(valid.includes(hash) ? hash : defaultView);
  if (hash === "workspace" || hash === "analysis" || hash === "precall" || !hash) {
    switchWorkspaceTab(getStoredTab());
  }
  if (authEnabled) loadPrepHistory();

  void loadPersistedHistory();
}

function handleSession(session, opts = {}) {
  if (session) void showApp(session, opts);
  else showLogin();
}

// ---------- Dummy login ----------

function initDummyAuth() {
  $("login-form").addEventListener("submit", (e) => {
    e.preventDefault();
    const errEl = $("login-error");
    show(errEl, false);
    const result = loginDummy($("login-email").value, $("login-password").value);
    if (!result.ok) {
      errEl.textContent = result.error;
      show(errEl, true);
      return;
    }
    handleSession(result.session, { freshLogin: true });
  });

  $("logout-btn").onclick = () => logout();

  const existing = getSession();
  if (existing) handleSession(existing);

  onSessionChange(handleSession);
}

// ---------- Firebase auth (optional) ----------

async function initFirebase() {
  const [{ initializeApp }, authMod, fsMod] = await Promise.all([
    import("https://www.gstatic.com/firebasejs/10.12.2/firebase-app.js"),
    import("https://www.gstatic.com/firebasejs/10.12.2/firebase-auth.js"),
    import("https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js"),
  ]);
  const app = initializeApp(firebaseConfig);
  const auth = authMod.getAuth(app);
  const provider = new authMod.GoogleAuthProvider();
  if (ALLOWED_EMAIL_DOMAIN) provider.setCustomParameters({ hd: ALLOWED_EMAIL_DOMAIN });

  fb = {
    auth, provider,
    signInWithPopup: authMod.signInWithPopup, signOut: authMod.signOut,
    db: fsMod.getFirestore(app),
    collection: fsMod.collection, addDoc: fsMod.addDoc, query: fsMod.query,
    where: fsMod.where, getDocs: fsMod.getDocs, serverTimestamp: fsMod.serverTimestamp,
  };

  show($("firebase-signin-block"), true);

  $("signin-google").onclick = async () => {
    show($("signin-error"), false);
    try {
      await fb.signInWithPopup(auth, provider);
      playRoar();
      triggerSignInPulse();
    }
    catch (err) { const e = $("signin-error"); e.textContent = err.message; show(e, true); }
  };

  $("logout-btn").onclick = async () => {
    await fb.signOut(auth);
    logout();
  };

  authMod.onAuthStateChanged(auth, (user) => {
    if (user && (!ALLOWED_EMAIL_DOMAIN || (user.email || "").endsWith(`@${ALLOWED_EMAIL_DOMAIN}`))) {
      persistFirebaseSession(user);
      handleSession(getSession());
    } else {
      if (user) fb.signOut(auth);
      logout();
    }
  });

  const existing = getSession();
  if (existing) handleSession(existing);
  onSessionChange(handleSession);
}

async function warnIfWorkerDown() {
  const banner = $("worker-warning");
  if (!banner) return;
  try {
    const res = await fetch(`${WORKER_BASE_URL}/api/config`, { signal: AbortSignal.timeout(8000) });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    banner.hidden = true;
  } catch {
    banner.textContent = WORKER_DOWN_MSG;
    banner.hidden = false;
  }
}

function boot() {
  initSidebar();
  $("prep-form").addEventListener("submit", generate);
  $("prospectEmail")?.addEventListener("input", updateDomainHint);
  $("companyName")?.addEventListener("input", updateDomainHint);

  document.querySelectorAll(".app-tab").forEach((btn) => {
    btn.onclick = () => {
      switchWorkspaceTab(btn.dataset.tab);
      if (btn.dataset.tab === "postcall") {
        show($("postcall-status"), false);
      }
    };
  });

  document.querySelectorAll(".nav-item").forEach((btn) => {
    btn.onclick = () => {
      if (btn.dataset.view === "workspace") {
        switchWorkspaceTab(getStoredTab());
      }
      switchView(btn.dataset.view);
    };
  });

  $("sidebar-toggle").onclick = openSidebar;
  $("sidebar-close").onclick = closeSidebar;
  $("sidebar-backdrop").onclick = closeSidebar;

  setOnAnalysisSaved(() => {
    void loadPersistedHistory().then(() => {
      if (currentView === "dashboard" || currentView === "coaching" || currentView === "manager") {
        refreshDashboardFromStorage();
      }
    });
  });

  if (authMode() === "firebase") {
    initFirebase();
  } else {
    initDummyAuth();
    const existing = getSession();
    if (!existing) showLogin();
  }

  void warnIfWorkerDown();
}

boot();
