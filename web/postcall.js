import { WORKER_BASE_URL } from "./firebase-config.js";
import { isFirebaseAuthEnabled, getSession } from "./auth.js";
import { savePostCallHistory, normalizeUserEmail } from "./history.js";
import { normalizeQualityCoach, formatTypeComposite, typeComposite } from "./quality-score.js";
import { buildPostCallResolveContext, invalidatePostCallResolveContext } from "./postcall-resolve-context.js";
import { invalidateDealListCache } from "./deal-view.js";
import { sessionUserId, effectiveSessionUserId } from "./domain/session.js";
import { domainFromEmail } from "./domain/types.js";
import {
  readFieldValue,
  readFieldValueAsync,
  setButtonLoading,
  setFieldError,
  setFormFieldsDisabled,
  showInlineStatus,
  wirePrintToolbar,
  wireToolbarById,
} from "./crayons-ui.js";
import {
  clearLinkedInAttachments,
  initLinkedInPdfUpload,
  linkedinProfileExportsForPayload,
  linkedinProfileExportsForStorage,
} from "./prep-linkedin-pdf.js";
import { esc, $, show, EMPTY_DISPLAY } from "./shared.js";
import { companyNameFromEmail } from "./prep-domain.js";
export { companyNameFromEmail };
import { deriveCallTimeline } from "./domain/timeline-service.js";
import {
  barClass,
  scorePct,
  momentumClass,
  radarDimensionLabel,
  renderRadarLabelText,
} from "./chart-shared.js";
import { groupLinesBySection, themeLabel } from "./theme-library.js";
import {
  isThemeScoreSuppressed,
  THEME_SCORE_SUPPRESSION_MESSAGE,
} from "./theme-score-suppression.js";


const RESOLVE_URL = `${WORKER_BASE_URL}/api/postcall/resolve`;
const CLASSIFY_URL = `${WORKER_BASE_URL}/api/postcall/classify`;
const GENERATE_URL = `${WORKER_BASE_URL}/api/postcall/generate`;
const QUALIFY_URL = `${WORKER_BASE_URL}/api/postcall/qualify`;
const COMMIT_URL = `${WORKER_BASE_URL}/api/postcall/commit`;
const SUMMARISE_URL = `${WORKER_BASE_URL}/api/postcall/summarise`;
const ARR_INPUTS_URL = `${WORKER_BASE_URL}/api/postcall/arr-inputs`;
const ARR_COMPUTE_URL = `${WORKER_BASE_URL}/api/postcall/arr-compute`;
const GAPS_URL = `${WORKER_BASE_URL}/api/postcall/gaps`;
const VIDEO_PASS_URL = `${WORKER_BASE_URL}/api/video-pass`;

const CALL_TYPES = [
  "demo",
  "discovery",
  "technical_deep_dive",
  "reverse_demo",
  "use_case_discussion",
  "trial_setup",
  "troubleshooting",
  "qa_session",
];

const CALL_TYPE_LABELS = {
  demo: "Demo",
  discovery: "Discovery",
  technical_deep_dive: "Technical deep dive",
  reverse_demo: "Reverse demo",
  use_case_discussion: "Use case discussion",
  trial_setup: "Trial setup",
  troubleshooting: "Troubleshooting",
  qa_session: "Q&A session",
};

const VIDEO_THEME_LABELS = {
  camera_on: "Camera on",
  cde_build: "CDE build",
  call_flow: "Call flow",
  customer_engagement: "Customer engagement",
};

let linkedinParsing = false;
let companyNameTouched = false;
let suppressCompanyTouch = false;
let pcResolvedAccount = null;
let pcCreateNewAccount = false;
let companyPrefillTimer = null;

/** @type {null | { payload: object, resolve: object|null, classify: object|null, generated: boolean, recordId: string|null }} */
let pipelineState = null;

let currentSession = null;
let getAuthToken = null;

// #region agent log
function agentDebugLog(location, message, data, hypothesisId) {
  const payload = { sessionId: "064b3d", location, message, data, hypothesisId, timestamp: Date.now() };
  fetch("http://127.0.0.1:7865/ingest/46e458f7-44ce-49a5-87ef-1bb8839e9c5e", {
    method: "POST",
    headers: { "Content-Type": "application/json", "X-Debug-Session-Id": "064b3d" },
    body: JSON.stringify(payload),
  }).catch(() => {});
  try {
    const k = "debug-064b3d";
    const arr = JSON.parse(sessionStorage.getItem(k) || "[]");
    arr.push(payload);
    sessionStorage.setItem(k, JSON.stringify(arr.slice(-30)));
  } catch (_) { /* ignore */ }
}
// #endregion

const isUnknown = (v) => {
  const s = String(v ?? "").trim();
  if (!s || s.toLowerCase() === "unknown") return true;
  return s === "-" || s === "—" || s === "–";
};
const dash = (v) => (isUnknown(v) ? `<span class="muted">${EMPTY_DISPLAY}</span>` : esc(v));

/** Collapse duplicate display names (case-insensitive; strip role suffixes; email → local part). */
function normalizePersonKey(label) {
  let key = String(label || "")
    .trim()
    .toLowerCase()
    .replace(/\s*\([^)]*\)\s*/g, " ")
    .replace(/\s*\|.*$/, "")
    .replace(/<[^>]+>/g, "")
    .replace(/\s+/g, " ")
    .trim();
  const at = key.indexOf("@");
  if (at >= 0) {
    key = key
      .slice(0, at)
      .replace(/[._-]/g, " ")
      .replace(/\s+/g, " ")
      .trim();
  }
  return key;
}

/** Prefer a spoken name over an email or noisier variant when merging duplicates. */
function preferPersonLabel(a, b) {
  const score = (s) => {
    const t = String(s || "").trim();
    if (!t) return -1;
    if (/@/.test(t)) return 0;
    if (/\s/.test(t)) return 3;
    return 2;
  };
  const sa = score(a);
  const sb = score(b);
  if (sa !== sb) return sa > sb ? a : b;
  return String(a).trim().length <= String(b).trim().length ? a : b;
}

function dedupePersonLabels(labels) {
  const byKey = new Map();
  for (const raw of labels || []) {
    const label = String(raw || "").trim();
    if (!label) continue;
    const key = normalizePersonKey(label);
    if (!key) continue;
    const prev = byKey.get(key);
    byKey.set(key, prev ? preferPersonLabel(prev, label) : label);
  }
  return [...byKey.values()];
}

export { normalizePersonKey, dedupePersonLabels, preferPersonLabel };

function truncateWords(text, max) {
  const words = String(text ?? "").trim().split(/\s+/).filter(Boolean);
  if (words.length <= max) return esc(words.join(" "));
  return `${esc(words.slice(0, max).join(" "))}<span class="trunc-ellipsis">…</span>`;
}

async function authHeaders() {
  const headers = { "content-type": "application/json" };
  if (isFirebaseAuthEnabled() && getAuthToken) {
    const token = await getAuthToken();
    if (token) headers["Authorization"] = `Bearer ${token}`;
  }
  return headers;
}

/** Shared worker auth for deal ARR live recompute and other modules. */
export async function getWorkerAuthHeaders() {
  return authHeaders();
}

/** Parse "https://…/rec/share/… Passcode: abc" from one paste field. */
/** Zoom `?pwd=` query (API play passcode). NOT the `.token` path suffix. */
function extractZoomQueryPasscode(rawUrl) {
  try {
    const href = String(rawUrl || "").trim().split(/\s/)[0];
    if (!href) return undefined;
    const u = new URL(href);
    return u.searchParams.get("pwd")?.trim() || undefined;
  } catch {
    return undefined;
  }
}

function parseRecordingInput(rawUrl, rawPwd) {
  let url = String(rawUrl || "").trim();
  let password = String(rawPwd || "").trim();

  const passMatch = url.match(/\s+passcode\s*:\s*(.+)$/i);
  if (passMatch) {
    url = url.slice(0, passMatch.index).trim();
    if (!password) password = passMatch[1].trim();
  }

  // Do NOT treat `/share/id.token` as the meeting passcode — that trips Zoom CAPTCHA.
  if (!password) {
    const q = extractZoomQueryPasscode(url);
    if (q) password = q;
  }

  return { recordingUrl: url, recordingPassword: password || undefined };
}

function recordingHasExplicitPasscode(rawUrl, rawPwd) {
  if (String(rawPwd || "").trim()) return true;
  const raw = String(rawUrl || "");
  if (/\bpasscode\s*:/i.test(raw)) return true;
  return !!extractZoomQueryPasscode(raw);
}

function isKaiaRecordingUrl(url) {
  try {
    const u = new URL(String(url || "").trim().split(/\s/)[0]);
    return u.hostname.toLowerCase() === "engage.freshworks.com";
  } catch {
    return false;
  }
}

function isZoomRecordingUrl(url) {
  try {
    const host = new URL(String(url || "").trim().split(/\s/)[0]).hostname.toLowerCase();
    return host === "zoom.us" || host.endsWith(".zoom.us") || host === "zoomgov.com" || host.endsWith(".zoomgov.com");
  } catch {
    return false;
  }
}

/** Hidden by default. Only ask for a passcode when the pasted Zoom link has none. */
function syncPasscodeVisibility() {
  const wrap = $("pc-passcode-wrap");
  if (!wrap) return;
  const raw = readFieldValue($("pc-recording-url"));
  const { recordingUrl } = parseRecordingInput(raw, "");
  const needsPwd =
    !!recordingUrl &&
    isZoomRecordingUrl(recordingUrl) &&
    !isKaiaRecordingUrl(recordingUrl) &&
    !recordingHasExplicitPasscode(raw, readFieldValue($("pc-recording-pwd")));
  wrap.hidden = !needsPwd;
}

const TRANSCRIPT_FILE_MAX_BYTES = 5 * 1024 * 1024;

/**
 * Load a transcript file into the paste box. VTT/SRT cue markup is left intact —
 * the worker's parseTranscript understands both.
 */
export async function readTranscriptFile(file) {
  if (!file) return { ok: false, error: "No file selected." };
  if (file.size > TRANSCRIPT_FILE_MAX_BYTES) {
    return { ok: false, error: "That file is over 5 MB. Transcripts are text; check the file." };
  }
  if (!/\.(vtt|srt|txt)$/i.test(file.name || "")) {
    return { ok: false, error: "Use the .vtt transcript from Zoom (or a .txt / .srt)." };
  }
  let text = "";
  try {
    text = await file.text();
  } catch {
    return { ok: false, error: "Could not read that file." };
  }
  if (!text.trim()) return { ok: false, error: "That file is empty." };
  return { ok: true, text };
}

async function handleTranscriptFileChange(event) {
  const input = event?.target;
  const nameEl = $("pc-transcript-file-name");
  const errorEl = $("pc-transcript-file-error");
  const textarea = $("pc-transcript");
  const file = input?.files?.[0];

  if (nameEl) nameEl.hidden = true;
  if (errorEl) errorEl.hidden = true;

  const result = await readTranscriptFile(file);
  if (!result.ok) {
    if (errorEl) {
      errorEl.textContent = result.error;
      errorEl.hidden = false;
    }
    if (input) input.value = "";
    return;
  }

  if (textarea) textarea.value = result.text;
  if (nameEl) {
    const kb = Math.max(1, Math.round(file.size / 1024));
    nameEl.textContent = `${file.name} loaded (${kb} KB)`;
    nameEl.hidden = false;
  }
  if (input) input.value = "";
}

function parseProspectEmails(raw) {
  return String(raw || "")
    .split(/[,;\s]+/)
    .map((e) => e.trim().toLowerCase())
    .filter((e) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(e));
}

function scheduleCompanyPrefill() {
  window.clearTimeout(companyPrefillTimer);
  companyPrefillTimer = window.setTimeout(() => { void prefillCompanyFromEmails(); }, 300);
}

/** ISO yyyy-mm-dd for the actual recording, falling back to today. */
function meetingDateFromResolve(resolve) {
  const raw = resolve?.callTime || resolve?.media?.startTime || null;
  if (raw) {
    const d = new Date(raw);
    if (!Number.isNaN(d.getTime())) return d.toISOString().slice(0, 10);
  }
  return new Date().toISOString().slice(0, 10);
}

async function tryMatchEmail(ctx, email) {
  const domain = domainFromEmail(email);
  if (!domain) return null;
  const account = (ctx.accounts || []).find(
    (a) => String(a.domain || "").toLowerCase() === domain,
  );
  if (account?.name) {
    return { name: account.name, account };
  }
  const brief = (ctx.briefs || []).find((b) =>
    (b.prospectEmails || []).some((e) => e === email) ||
    String(b.domain || "").toLowerCase() === domain,
  );
  if (brief?.companyName) {
    return { name: brief.companyName, account: null };
  }
  return null;
}

async function prefillCompanyFromEmails() {
  if (companyNameTouched) return;
  const companyEl = $("pc-company-name");
  if (!companyEl) return;
  // Only an SE-typed company blocks the prefill. A value we filled ourselves is replaceable.
  const existing = (await readFieldValueAsync(companyEl))?.trim();
  if (existing && companyNameTouched) return;
  if (existing && pcResolvedAccount && existing === pcResolvedAccount.name) {
    // fall through — emails may have changed to a different account
  } else if (existing) {
    return;
  }

  const emails = parseProspectEmails(await readFieldValueAsync($("pc-prospect-emails")));
  if (!emails.length) return;

  const ownerId = effectiveSessionUserId(currentSession);
  if (!ownerId) return;
  try {
    const ctx = await buildPostCallResolveContext(ownerId);
    const primary = emails[0];
    let match = await tryMatchEmail(ctx, primary);
    if (!match) {
      for (const email of emails.slice(1)) {
        match = await tryMatchEmail(ctx, email);
        if (match) break;
      }
    }
    if (match) {
      suppressCompanyTouch = true;
      companyEl.value = match.name;
      window.setTimeout(() => { suppressCompanyTouch = false; }, 0);
      if (match.account) {
        pcResolvedAccount = {
          id: match.account.id,
          name: match.account.name,
          domain: match.account.domain || null,
        };
        pcCreateNewAccount = false;
      }
      return;
    }
    const derived = companyNameFromEmail(primary);
    if (derived) {
      suppressCompanyTouch = true;
      companyEl.value = derived;
      window.setTimeout(() => { suppressCompanyTouch = false; }, 0);
    }
  } catch {
    /* prefills are best-effort */
  }
}

/**
 * Account lookup with a create-new escape hatch.
 * Mirrors the confirm-gate account picker so intake and gate behave identically.
 * @param {{ inputEl: HTMLElement, menuEl: HTMLElement, noteEl?: HTMLElement,
 *           onPick: (account: object|null, typedName: string) => void }} cfg
 */
function attachAccountLookup(cfg) {
  const { inputEl, menuEl, noteEl, onPick } = cfg;
  if (!inputEl || !menuEl) return;

  let debounceTimer = null;
  let activeIndex = -1;
  let rows = [];
  let blurTimer = null;

  const closeMenu = () => {
    menuEl.hidden = true;
    activeIndex = -1;
    rows = [];
    menuEl.innerHTML = "";
  };

  const renderRows = (accounts, typed) => {
    const q = typed.trim().toLowerCase();
    const matches = q
      ? accounts
          .filter(
            (a) =>
              String(a.name || "").toLowerCase().includes(q) ||
              String(a.domain || "").toLowerCase().includes(q),
          )
          .slice(0, 8)
      : [];

    const exactMatch = matches.some(
      (a) => String(a.name || "").toLowerCase() === q,
    );
    const html = matches
      .map(
        (a) =>
          `<button type="button" class="pc-lookup-option" role="option" data-account-id="${esc(a.id)}">
            <span>${esc(a.name)}</span>
            ${a.domain ? `<span class="pc-lookup-option-sub">${esc(a.domain)}</span>` : ""}
          </button>`,
      )
      .join("");

    const createRow =
      q && !exactMatch
        ? `<button type="button" class="pc-lookup-option pc-lookup-option--create" role="option" data-create="1">
            ＋ Create new account "${esc(typed.trim())}"
          </button>`
        : "";

    menuEl.innerHTML = html + createRow;
    rows = [...menuEl.querySelectorAll(".pc-lookup-option")];
    if (!rows.length) {
      closeMenu();
      return;
    }
    menuEl.hidden = false;
    activeIndex = -1;
  };

  const pickRow = (btn) => {
    if (!btn) return;
    const typed = readFieldValue(inputEl)?.trim() || "";
    if (btn.dataset.create === "1") {
      onPick(null, typed);
      pcCreateNewAccount = true;
      pcResolvedAccount = null;
      if (noteEl) {
        noteEl.textContent = "New account (will be created on confirm)";
        noteEl.hidden = false;
      }
    } else {
      const accountId = btn.dataset.accountId;
      buildPostCallResolveContext(effectiveSessionUserId(currentSession))
        .then((ctx) => {
          const account = (ctx.accounts || []).find((a) => a.id === accountId);
          if (account) {
            onPick(account, account.name);
            pcResolvedAccount = {
              id: account.id,
              name: account.name,
              domain: account.domain || null,
            };
            pcCreateNewAccount = false;
            if (noteEl) noteEl.hidden = true;
          }
        })
        .catch((err) => {
          console.warn("[postcall] account lookup pick failed:", err?.message || err);
        });
    }
    closeMenu();
  };

  const refreshMenu = () => {
    const typed = readFieldValue(inputEl)?.trim() || "";
    if (!typed) {
      closeMenu();
      return;
    }
    buildPostCallResolveContext(effectiveSessionUserId(currentSession))
      .then((ctx) => renderRows(ctx.accounts || [], typed))
      .catch((err) => {
        console.warn("[postcall] account lookup failed:", err?.message || err);
        closeMenu();
      });
  };

  const scheduleRefresh = () => {
    window.clearTimeout(debounceTimer);
    debounceTimer = window.setTimeout(refreshMenu, 200);
  };

  inputEl.addEventListener("fwInput", scheduleRefresh);
  inputEl.addEventListener("input", scheduleRefresh);

  inputEl.addEventListener("keydown", (ev) => {
    if (menuEl.hidden || !rows.length) return;
    if (ev.key === "ArrowDown") {
      ev.preventDefault();
      activeIndex = Math.min(activeIndex + 1, rows.length - 1);
      rows.forEach((r, i) => r.classList.toggle("is-active", i === activeIndex));
    } else if (ev.key === "ArrowUp") {
      ev.preventDefault();
      activeIndex = Math.max(activeIndex - 1, 0);
      rows.forEach((r, i) => r.classList.toggle("is-active", i === activeIndex));
    } else if (ev.key === "Enter" && activeIndex >= 0) {
      ev.preventDefault();
      pickRow(rows[activeIndex]);
    } else if (ev.key === "Escape") {
      closeMenu();
    }
  });

  menuEl.addEventListener("click", (ev) => {
    const btn = ev.target?.closest?.(".pc-lookup-option");
    if (btn) pickRow(btn);
  });

  inputEl.addEventListener("fwBlur", () => {
    window.clearTimeout(blurTimer);
    blurTimer = window.setTimeout(closeMenu, 120);
  });
  inputEl.addEventListener("blur", () => {
    window.clearTimeout(blurTimer);
    blurTimer = window.setTimeout(closeMenu, 120);
  });

  document.addEventListener("pointerdown", (ev) => {
    if (!inputEl.contains(ev.target) && !menuEl.contains(ev.target)) closeMenu();
  });
}

const CATEGORY_LABELS = {
  decision: "Decision",
  commitment: "Commitment",
  se_action: "SE action",
  ae_action: "AE action",
  objection: "Objection",
  next_meeting: "Next meeting",
};

function influenceDot(level) {
  const cls = level === "high" ? "dot-green" : level === "medium" ? "dot-amber" : "dot-grey";
  const label = level === "high" ? "High influence" : level === "medium" ? "Medium influence" : "Low influence";
  return `<span class="power-dot ${cls}" title="${label}" aria-label="${label}"></span>`;
}

function momentumArrow(status) {
  if (status === "Advancing") return "↑";
  if (status === "At risk") return "↓";
  return "→";
}

function renderScoreGauge(score, max = 10) {
  const r = 52;
  const c = 2 * Math.PI * r;
  const dashLen = c * (score / max);
  const cls = barClass(score, max);
  return `
    <div class="qc-gauge" role="img" aria-label="Overall score ${esc(score)} out of ${esc(max)}" data-score="${esc(score)}" data-max="${esc(max)}">
      <svg class="qc-gauge-svg" viewBox="0 0 120 120" aria-hidden="true">
        <circle class="qc-gauge-track" cx="60" cy="60" r="${r}" />
        <circle class="qc-gauge-fill ${cls}" cx="60" cy="60" r="${r}"
          data-target-dash="${dashLen}" data-circumference="${c}"
          stroke-dasharray="0 ${c}" transform="rotate(-90 60 60)" />
      </svg>
      <div class="qc-gauge-text">
        <span class="qc-gauge-score ${cls}" data-target="${esc(score)}">0</span>
        <span class="qc-gauge-denom">/${esc(max)}</span>
      </div>
    </div>`;
}

function renderRadarChart(dimensions) {
  if (!dimensions?.length) return "";
  const n = dimensions.length;
  const cx = 130;
  const cy = 130;
  const maxR = 58;
  const labelR = maxR + 32;
  const rings = [0.25, 0.5, 0.75, 1]
    .map((level) => {
      const pts = [];
      for (let i = 0; i < n; i++) {
        const angle = (Math.PI * 2 * i) / n - Math.PI / 2;
        pts.push(`${cx + maxR * level * Math.cos(angle)},${cy + maxR * level * Math.sin(angle)}`);
      }
      return `<polygon class="qc-radar-grid" points="${pts.join(" ")}" />`;
    })
    .join("");
  const axes = dimensions
    .map((d, i) => {
      const angle = (Math.PI * 2 * i) / n - Math.PI / 2;
      const x2 = cx + maxR * Math.cos(angle);
      const y2 = cy + maxR * Math.sin(angle);
      const lx = cx + labelR * Math.cos(angle);
      const ly = cy + labelR * Math.sin(angle);
      return `
        <line class="qc-radar-axis" x1="${cx}" y1="${cy}" x2="${x2}" y2="${y2}" />
        ${renderRadarLabelText(radarDimensionLabel(d.name), lx, ly, angle)}`;
    })
    .join("");
  const dataPts = dimensions.map((d, i) => {
    const pct = d.score / d.maxScore;
    const angle = (Math.PI * 2 * i) / n - Math.PI / 2;
    const rad = maxR * pct;
    return `${cx + rad * Math.cos(angle)},${cy + rad * Math.sin(angle)}`;
  });
  const dots = dimensions
    .map((d, i) => {
      const pct = d.score / d.maxScore;
      const angle = (Math.PI * 2 * i) / n - Math.PI / 2;
      const rad = maxR * pct;
      return `<circle class="qc-radar-dot" cx="${cx + rad * Math.cos(angle)}" cy="${cy + rad * Math.sin(angle)}" r="3.5" />`;
    })
    .join("");
  return `
    <div class="qc-radar-wrap">
      <p class="qc-radar-title">Dimension profile</p>
      <svg class="qc-radar qc-radar-anim" viewBox="0 0 260 260" role="img" aria-label="Radar chart of coaching dimension scores">
        ${rings}
        ${axes}
        <polygon class="qc-radar-data" points="${dataPts.join(" ")}" data-anim="radar" />
        ${dots}
      </svg>
    </div>`;
}

function renderDimensionRows(dimensions) {
  if (!dimensions?.length) return '<p class="muted">No dimension scores.</p>';
  return dimensions
    .map((d) => {
      const pct = scorePct(d.score, d.maxScore);
      const cls = barClass(d.score, d.maxScore);
      return `
        <details class="qc-dim">
          <summary class="qc-dim-summary">
            <span class="qc-dim-name">${esc(d.name)}</span>
            <span class="qc-dim-bar" aria-hidden="true">
              <span class="qc-dim-bar-fill ${cls}" style="width:${pct}%"></span>
            </span>
            <span class="qc-dim-score ${cls}">${esc(d.score)}/${esc(d.maxScore)}</span>
          </summary>
          <div class="qc-dim-body">
            <p class="qc-dim-feedback">${truncateWords(d.feedback, 12)}</p>
            <blockquote class="qc-dim-evidence"><span class="qc-ev-label">Evidence</span>${truncateWords(d.evidence, 12)}</blockquote>
          </div>
        </details>`;
    })
    .join("");
}

function renderInsightList(items, title, tone) {
  const list = (items || []).filter((x) => !isUnknown(x));
  const html = list.length
    ? `<ul>${list.map((i) => `<li>${truncateWords(i, 12)}</li>`).join("")}</ul>`
    : '<p class="muted">None noted.</p>';
  return `<div class="qc-insight qc-insight-${tone}"><h4>${esc(title)}</h4>${html}</div>`;
}

function renderQualityCoach(qc) {
  const normalized = normalizeQualityCoach(qc);
  const dims = normalized.dimensions || [];
  return `
    <div class="qc-dashboard">
      <div class="qc-hero">
        ${renderScoreGauge(normalized.overallScore, 10)}
        <div class="qc-hero-meta">
          <span class="qc-overall-label">${esc(normalized.overallLabel)}</span>
          <p class="muted qc-hero-hint">Quality score (separate from deal momentum above).</p>
        </div>
      </div>
      ${renderRadarChart(dims)}
    </div>
    <div class="qc-insights qc-insights-compact">
      ${renderInsightList(normalized.strengths?.slice(0, 2), "Top strengths", "good")}
      ${renderInsightList(normalized.improvements?.slice(0, 2), "Top improvements", "ok")}
      ${renderInsightList(normalized.missedOpportunities?.slice(0, 1), "Missed opportunity", "weak")}
    </div>
    <details class="qc-details sources">
      <summary>Details: full scorecard</summary>
      <div class="qc-scorecard">
        <div class="qc-dim-list">${renderDimensionRows(dims)}</div>
      </div>
    </details>`;
}

function renderLegacyPostCall(data, meta) {
  const a = data.analysis;
  const cs = a.callSummary || {};
  return `
    <fw-inline-message type="warning" open closable="false">This analysis uses an older format. Re-run analysis for the new post-call one-pager.</fw-inline-message>
    <div class="head"><h2 class="one-pager-title">${esc(cs.headline || meta.title || "Call analysis")}</h2></div>`;
}

function prefersReducedMotion() {
  return window.matchMedia("(prefers-reduced-motion: reduce)").matches;
}

function radarPolygonPerimeter(polygon) {
  const pts = (polygon.getAttribute("points") || "")
    .trim()
    .split(/\s+/)
    .map((p) => p.split(",").map(Number));
  let len = 0;
  for (let i = 0; i < pts.length; i++) {
    const [x1, y1] = pts[i];
    const [x2, y2] = pts[(i + 1) % pts.length];
    len += Math.hypot(x2 - x1, y2 - y1);
  }
  return len;
}

function animateScoreGauge(gauge, duration = 380) {
  const fill = gauge?.querySelector(".qc-gauge-fill");
  const scoreEl = gauge?.querySelector(".qc-gauge-score[data-target]");
  if (!fill || !scoreEl) return;

  const targetDash = parseFloat(fill.dataset.targetDash || "0");
  const circumference = parseFloat(fill.dataset.circumference || "0");
  const targetScore = parseFloat(scoreEl.dataset.target || "0");

  if (prefersReducedMotion()) {
    fill.style.strokeDasharray = `${targetDash} ${circumference}`;
    scoreEl.textContent = String(targetScore);
    return;
  }

  const start = performance.now();
  function tick(now) {
    const t = Math.min(1, (now - start) / duration);
    const eased = 1 - (1 - t) ** 3;
    const dash = targetDash * eased;
    fill.style.strokeDasharray = `${dash} ${circumference}`;
    scoreEl.textContent = String(Math.round(targetScore * eased * 10) / 10);
    if (t < 1) requestAnimationFrame(tick);
    else scoreEl.textContent = String(targetScore);
  }
  requestAnimationFrame(tick);
}

export function initPostCallAnimations(root) {
  if (!root) return;
  root.classList.add("anim-root");

  const blocks = root.querySelectorAll(".header-strip, .momentum-hero, section, .prep-footer");
  blocks.forEach((el, i) => {
    el.classList.add("anim-block");
    el.style.setProperty("--anim-delay", `${i * 50}ms`);
  });

  const radarPoly = root.querySelector(".qc-radar-data[data-anim]");
  if (radarPoly) {
    const perimeter = radarPolygonPerimeter(radarPoly);
    radarPoly.style.setProperty("--radar-perimeter", String(perimeter));
    radarPoly.style.strokeDasharray = `${perimeter}`;
    radarPoly.style.strokeDashoffset = String(perimeter);
  }

  root.querySelectorAll(".qc-gauge[data-score]").forEach((gauge) => animateScoreGauge(gauge));

  if (prefersReducedMotion()) {
    root.classList.add("anim-ready");
    if (radarPoly) radarPoly.style.strokeDashoffset = "0";
    return;
  }

  requestAnimationFrame(() => {
    requestAnimationFrame(() => {
      root.classList.add("anim-ready");
      if (radarPoly) radarPoly.style.strokeDashoffset = "0";
    });
  });
}

function getCallTitle(analysis, meta) {
  return analysis?.callHeader?.title || analysis?.callSummary?.headline || meta.title || "Call analysis";
}

function coalesceAttendees(analysis) {
  const hdr = analysis?.callHeader || {};
  const cs = analysis?.callSummary || {};
  const list = hdr.attendees ?? analysis?.attendees ?? cs.attendees ?? [];
  return Array.isArray(list) ? list : [];
}

function normalizeActionKey(text) {
  return String(text ?? "")
    .toLowerCase()
    .replace(/[^\w\s]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function actionTextsSimilar(a, b) {
  const na = normalizeActionKey(a);
  const nb = normalizeActionKey(b);
  if (!na || !nb) return false;
  if (na === nb) return true;
  if (na.includes(nb) || nb.includes(na)) return true;
  const wa = new Set(na.split(" ").filter((w) => w.length > 2));
  const wb = new Set(nb.split(" ").filter((w) => w.length > 2));
  if (!wa.size || !wb.size) return false;
  let overlap = 0;
  for (const w of wa) if (wb.has(w)) overlap++;
  return overlap / Math.min(wa.size, wb.size) >= 0.6;
}

function followUpTexts(followUpTable) {
  return (followUpTable || [])
    .flatMap((row) => [row.thisCall, row.followUp])
    .filter((t) => !isUnknown(t));
}

function dedupeNextSteps(nextSteps, followUpTable) {
  const fuTexts = followUpTexts(followUpTable);
  return (nextSteps || []).filter((step) => {
    if (step.isRisk) return true;
    if (isUnknown(step.action)) return false;
    return !fuTexts.some((fu) => actionTextsSimilar(step.action, fu));
  });
}

function inferSeOwner(attendees) {
  const se = (attendees || []).find((a) => /se|solution|engineer/i.test(String(a.role ?? "")));
  if (se && !isUnknown(se.name)) return se.name;
  const named = (attendees || []).find((a) => !isUnknown(a.name));
  return named?.name || "SE";
}

function injectRiskRow(nextSteps, missed, momentum, attendees) {
  if (isUnknown(missed)) return nextSteps || [];
  const action = String(missed).replace(/^risk:\s*/i, "").trim();
  if (isUnknown(action)) return nextSteps || [];
  const steps = nextSteps || [];
  if (steps.some((s) => s.isRisk || actionTextsSimilar(s.action, action))) return steps;
  return [{
    owner: inferSeOwner(attendees),
    action,
    due: "Next call",
    why: momentum?.reason && !isUnknown(momentum.reason) ? momentum.reason : "Deal momentum at risk",
    isRisk: true,
  }, ...steps];
}

/** Normalize v4 + partial v5 + v2 (QIP) payloads before render. */
function normalizeAnalysisForRender(raw) {
  if (!raw) return null;
  const version = raw.analysisVersion ?? 1;
  const cs = raw.callSummary || {};
  const hdr = raw.callHeader || {};
  const attendees = coalesceAttendees(raw);
  const followUpTable = raw.followUpTable || [];
  const momentum = raw.momentum || {};
  const qualityCoach = raw.qualityCoach || {
    dimensions: [],
    strengths: [],
    improvements: [],
    missedOpportunities: [],
  };
  const missed = (qualityCoach.missedOpportunities || []).find((x) => !isUnknown(x));
  const nextSteps = dedupeNextSteps(
    injectRiskRow(raw.nextSteps || [], missed, momentum, attendees),
    followUpTable,
  );

  return {
    ...raw,
    analysisVersion: version,
    callHeader: {
      title: hdr.title || cs.headline || raw.title || "",
      duration: hdr.duration || cs.duration || raw.duration || "",
      date: hdr.date || cs.date || raw.date || "",
      attendees,
    },
    momentum,
    signals: raw.signals || { painsConfirmed: [], objectionsOpen: [], competitors: [] },
    followUpTable,
    nextSteps,
    qualityCoach,
    artifacts: raw.artifacts || {
      suggestedFollowUpEmail: { subject: "", body: "" },
      crmNotes: "",
    },
    callNotes: typeof raw.callNotes === "string" ? raw.callNotes : "",
  };
}

function formatEvidenceAt(atS) {
  if (atS == null || !Number.isFinite(atS)) return null;
  const s = Math.max(0, Math.floor(atS));
  const m = Math.floor(s / 60);
  const sec = s % 60;
  return `${String(m).padStart(2, "0")}:${String(sec).padStart(2, "0")}`;
}

function renderQipEvidence(evidence) {
  const items = (evidence || []).filter((e) => e?.quote && !isUnknown(e.quote));
  if (!items.length) return '<p class="muted qip-evidence-empty">No timestamped evidence</p>';
  return `<ul class="qip-evidence-list">${items
    .map((e) => {
      const ts = formatEvidenceAt(e.atS);
      return `<li class="qip-evidence">
        ${ts != null ? `<span class="qip-evidence-ts">${esc(ts)}</span>` : '<span class="qip-evidence-ts muted">-</span>'}
        <blockquote class="qip-evidence-quote">${truncateWords(e.quote, 40)}</blockquote>
      </li>`;
    })
    .join("")}</ul>`;
}

function qipLineConfidencePill(line, fallbackConf) {
  if (!line.applicable) return "";
  const c = line.confidence ?? fallbackConf;
  if (c == null) return `<span class="pill">-</span>`;
  if (c >= 0.65) return '<span class="pill green">High</span>';
  if (c >= 0.4) return '<span class="pill amber">Med</span>';
  return '<span class="pill red">Low</span>';
}

function renderQipEvidenceBlocks(evidence, tone) {
  const items = (evidence || []).filter((e) => e?.quote && !isUnknown(e.quote));
  if (!items.length) return "";
  return items
    .map((e) => {
      const ts = formatEvidenceAt(e.atS);
      const evCls = tone ? ` ev ${tone}` : " ev";
      return `<div class="${evCls.trim()}">${ts != null ? `<div class="ts">${esc(ts)}</div>` : ""}${truncateWords(e.quote, 40)}</div>`;
    })
    .join("");
}

function qipScoreColor(pct) {
  if (pct >= 0.8) return "var(--green)";
  if (pct >= 0.6) return "var(--amber)";
  return "var(--red)";
}

/** v2 QIP scorecard. wireframe srow layout: theme, score, weighted bar, confidence. */
export function renderQipScorecard(scorecard, analysisMeta = {}, opts = {}) {
  if (!scorecard?.lines?.length) {
    return '<fw-inline-message type="warning" open closable="false">No QIP scorecard lines returned.</fw-inline-message>';
  }

  const wireframe = opts.context === "call-record";
  const provisional = !!(scorecard.provisional ?? analysisMeta.provisional);
  const callType = scorecard.callType || analysisMeta.callType || "demo";
  const rubricVersion = scorecard.rubricVersion || analysisMeta.rubricVersion || "1.0";
  const composite = typeComposite(
    [{
      callType,
      rubricVersion,
      lines: scorecard.lines,
      provisional: scorecard.provisional ?? analysisMeta.provisional,
      confidence: scorecard.confidence ?? analysisMeta.analysisConfidence,
    }],
    callType,
    { includeIneligible: true },
  );
  const totalLabel = formatTypeComposite(composite);
  const conf = scorecard.confidence ?? analysisMeta.analysisConfidence;
  const confPct = conf != null ? Math.round(conf * 100) : null;
  const callTypeLabel = CALL_TYPE_LABELS[callType] || callType;
  const heavyCount = scorecard.lines.filter((l) => (l.weight || 0) >= 10 && l.applicable).length;
  const subCopy = wireframe
    ? `Click any theme for the evidence.${heavyCount ? ` ${heavyCount} theme${heavyCount === 1 ? "" : "s"} carry extra weight on the 100 points.` : " Heavy themes carry more of the 100 points."}`
    : "Click any theme for the evidence. Heavy themes carry more of the 100 points.";

  const lineGroups = wireframe
    ? [{ label: "", lines: scorecard.lines }]
    : groupLinesBySection(scorecard.lines);

  const renderLine = (line) => {
    const heavy = (line.weight || 0) >= 10;
    const na = !line.applicable;
    const suppressed = !na && isThemeScoreSuppressed(line.themeKey);
    const maxScore = line.maxScore || 100;
    const pct = na || suppressed ? 0 : scorePct(line.score, maxScore);
    const cls = [
      "qip-line",
      wireframe ? "srow" : "",
      suppressed ? "qip-line-suppressed" : "",
      heavy ? "qip-line-heavy" : "",
      na ? "qip-line-na" : "",
    ]
      .filter(Boolean)
      .join(" ");
    const scoreCol = na
      ? `<span class="qip-na-badge">N/A</span>`
      : suppressed
        ? `<span class="qip-suppressed-badge">${esc(THEME_SCORE_SUPPRESSION_MESSAGE)}</span>`
        : wireframe
          ? `<span class="qip-line-score num" style="font-weight:700;color:${qipScoreColor(pct)}">${esc(line.score)}<span class="qip-line-max"> / ${esc(maxScore)}</span></span>`
          : `<span class="qip-line-score ${barClass(line.score, maxScore)}">${esc(line.score)}<span class="qip-line-max">/${esc(maxScore)}</span></span>`;
    const barCls = barClass(line.score, maxScore);
    const barColor =
      barCls === "strong" ? "var(--green)" : barCls === "weak" ? "var(--red)" : "var(--amber)";
    const barCol = na || suppressed
      ? `<span class="muted">-</span>`
      : `<div class="bar qip-weight-bar"><span style="width:${Math.max(pct, line.score === 0 ? 0 : 4)}%;background:${barColor}"></span></div>`;
    const reason = na && line.notApplicableReason
      ? `<p class="qip-na-reason">${esc(line.notApplicableReason)}</p>`
      : "";
    const note =
      !na && line.coachingNote && !isUnknown(line.coachingNote)
        ? `<p class="qip-coaching"><span class="qip-coaching-label">Coach</span> ${truncateWords(line.coachingNote, 20)}</p>`
        : "";
    const evidenceHtml = na
      ? ""
      : renderQipEvidenceBlocks(line.evidence || line.evidenceJson) ||
        renderQipEvidence(line.evidence || line.evidenceJson);
    return `<details class="${cls}" data-theme-key="${esc(line.themeKey)}">
      <summary class="qip-line-summary srow-hd">
        <div class="qip-theme-cell">
          <span class="qip-theme-name${heavy ? " qip-theme-name--heavy" : ""}">${esc(themeLabel(line.themeKey))}</span>
          ${heavy ? '<span class="pill purple qip-heavy-pill">10 pt</span>' : ""}
          ${line.sourceHint && !isUnknown(line.sourceHint) ? `<div class="sub qip-theme-hint">${esc(line.sourceHint)}</div>` : ""}
        </div>
        <div class="qip-score-cell">${scoreCol}</div>
        <div class="qip-weighted-cell">${barCol}</div>
        <div class="qip-conf-cell">${na ? "" : qipLineConfidencePill(line, conf)}</div>
        <div class="chev" aria-hidden="true">›</div>
      </summary>
      <div class="qip-line-body srow-bd">
        ${reason}
        ${evidenceHtml}
        ${note}
      </div>
    </details>`;
  };

  const rowHtml = lineGroups
    .map((sec) => {
      const rows = sec.lines.map(renderLine).join("");
      return sec.label && !wireframe
        ? `<div class="qip-section">
            <h3 class="qip-section-title">${esc(sec.label)}</h3>
            <div class="qip-section-lines">${rows}</div>
          </div>`
        : `<div class="qip-section-lines">${rows}</div>`;
    })
    .join("");

  const actionsHtml = wireframe
    ? `<div class="qip-scorecard-actions">
        <button type="button" class="btn-wire sm" disabled title="Score override (coming soon)">Override a score</button>
        <button type="button" class="btn-wire sm" disabled title="Compare to your average (coming soon)">Compare to my average</button>
      </div>`
    : "";

  return `
    <div class="qip-scorecard${provisional ? " qip-provisional" : ""}${wireframe ? " qip-scorecard--wireframe" : ""}">
      <div class="qip-scorecard-head">
        <div>
          <h2 class="qip-scorecard-title">QIP · ${esc(callTypeLabel.toLowerCase())} profile</h2>
          <p class="sub qip-scorecard-sub">${subCopy}</p>
        </div>
        <span class="pill qip-total-pill">${esc(totalLabel)} · weighted</span>
      </div>
      ${provisional ? '<span class="qip-provisional-badge" title="Shadow mode (excluded from averages)">Provisional</span>' : ""}
      ${confPct != null ? `<p class="muted qip-confidence">Analysis confidence ${esc(confPct)}%</p>` : ""}
      <div class="qip-grid-header eyebrow">
        <div>Theme</div><div>Score</div><div>Weighted</div><div>Conf</div><div></div>
      </div>
      ${rowHtml}
      ${actionsHtml}
    </div>`;
}

function renderVideoNaBanner(data) {
  const themes =
    data?.analysisMeta?.videoThemesNotApplicable ||
    data?.resolve?.videoThemesNotApplicable ||
    [];
  const videoAvailable =
    data?.analysisMeta?.videoAvailable ?? data?.resolve?.videoAvailable;
  if (!themes.length || videoAvailable) return "";
  const conf = data?.analysisMeta?.analysisConfidence ?? data?.resolve?.analysisConfidence;
  const confPct = conf != null ? Math.round(conf * 100) : null;
  const labels = themes
    .map((t) => VIDEO_THEME_LABELS[t.themeKey] || t.themeKey)
    .join(", ");
  return `<fw-inline-message type="warning" open closable="false">
    Video themes not scored (${esc(labels)}). Denominator renormalised${confPct != null ? `; analysis confidence ${esc(confPct)}%` : ""}.
  </fw-inline-message>`;
}

function renderConfirmedReadOnlyBanner(data) {
  const c = data?.confirmed;
  const am = data?.analysisMeta;
  if (!c && !am) return "";
  const callType = c?.callType || am?.callType;
  const callLabel = CALL_TYPE_LABELS[callType] || callType || "-";
  const accountName =
    data?.resolve?.account?.accountName ||
    data?.analysis?.callHeader?.company ||
    "-";
  const deal =
    data?.resolve?.deals?.find((d) => d.dealId === c?.dealId) ||
    data?.resolve?.deals?.find((d) => d.preselected);
  const dealLabel = deal?.title || c?.dealId || "-";
  const accountId = data?.resolve?.account?.accountId || c?.accountId || null;
  const dealId = c?.dealId || deal?.dealId || null;
  const accountLink = accountId
    ? `<a href="#accounts/${esc(accountId)}" class="postcall-nav-link" data-postcall-nav="account">${esc(accountName)}</a>`
    : esc(accountName);
  const dealLink = dealId
    ? `<a href="#deals/${esc(dealId)}" class="postcall-nav-link" data-postcall-nav="deal">${esc(dealLabel)}</a>`
    : esc(dealLabel);
  const overrideNotes = [];
  if (c?.callTypeOverride) {
    overrideNotes.push(
      `Call type corrected from ${CALL_TYPE_LABELS[c.callTypeOverride.from] || c.callTypeOverride.from}`,
    );
  }
  if (c?.dealMatchOverride) {
    overrideNotes.push("Deal selection corrected");
  }
  return `<div class="postcall-confirmed-banner" aria-label="Confirmed match summary">
    <strong>Confirmed</strong>. Account: ${accountLink} · Deal: ${dealLink} · Call type: ${esc(callLabel)}
    ${overrideNotes.length ? `<span class="muted"> (${esc(overrideNotes.join("; "))})</span>` : ""}
  </div>${renderVideoNaBanner(data)}`;
}

export function renderPostCall(data, meta = {}) {
  const raw = data?.analysis;
  if (!raw) {
    return `<fw-inline-message type="error" open closable="false">No analysis data returned. Try running analysis again.</fw-inline-message>`;
  }
  if (!raw?.callHeader && raw?.callSummary && !raw?.momentum?.status) {
    return renderLegacyPostCall(data, meta);
  }

  const a = normalizeAnalysisForRender(raw);
  if (!a) {
    return `<fw-inline-message type="error" open closable="false">Could not normalize analysis for display.</fw-inline-message>`;
  }
  const hdr = a.callHeader;
  const mom = a.momentum;
  const sig = a.signals;
  const arts = a.artifacts;
  const tm = data.transcriptMeta || {};
  const scorecard = data.scorecard;
  const useQip = !!(scorecard?.lines?.length || a.analysisVersion === 2);

  const attendeeChips = hdr.attendees.length
    ? hdr.attendees
        .map((x) => {
          const parts = [`<span class="attendee-chip">${influenceDot(x.influence)}${dash(x.name)}`];
          if (!isUnknown(x.role)) parts.push(`<span class="chip-role">${truncateWords(x.role, 8)}</span>`);
          parts.push("</span>");
          return parts.join(" · ");
        })
        .join("")
    : '<span class="muted">-</span>';

  const metaLine = [hdr.duration, hdr.date].filter((x) => !isUnknown(x)).map(esc).join(" · ");

  const followRows = (a.followUpTable || [])
    .filter((row) => !isUnknown(row.thisCall) || !isUnknown(row.followUp))
    .map(
      (row) => `<tr>
        <th class="prep-row-label">${esc(CATEGORY_LABELS[row.category] || row.category)}</th>
        <td>${truncateWords(row.thisCall, 8)}</td>
        <td>${truncateWords(row.followUp, 8)}</td>
      </tr>`,
    )
    .join("");

  const followTable = followRows
    ? `<table class="prep-compare call-compare">
        <thead><tr><th></th><th>This call</th><th>Follow-up</th></tr></thead>
        <tbody>${followRows}</tbody>
      </table>`
    : '<p class="muted">-</p>';

  const signalCol = (items) => {
    const list = (items || []).filter((x) => !isUnknown(x)).slice(0, 4);
    return list.length
      ? `<ul class="signal-list">${list.map((x) => `<li>${truncateWords(x, 12)}</li>`).join("")}</ul>`
      : '<p class="muted">-</p>';
  };

  const nextRows = (a.nextSteps || [])
    .filter((row) => !isUnknown(row.action))
    .map(
      (row) => `<tr class="${row.isRisk ? "risk-row" : ""}">
        <td>${truncateWords(row.owner, 8)}</td>
        <td>${row.isRisk ? '<span class="risk-flag">⚠</span> ' : ""}${truncateWords(row.action, 8)}</td>
        <td>${truncateWords(row.due, 8)}</td>
        <td>${truncateWords(row.why, 14)}</td>
      </tr>`,
    )
    .join("");

  const nextTable = nextRows
    ? `<table class="next-steps-table">
        <thead><tr><th>Owner</th><th>Action</th><th>Due</th><th>Why</th></tr></thead>
        <tbody>${nextRows}</tbody>
      </table>`
    : '<p class="muted">-</p>';

  const followUpEmail = arts.suggestedFollowUpEmail?.subject || arts.suggestedFollowUpEmail?.body
    ? `<details class="sources email-sources">
        <summary>Follow-up email</summary>
        <div class="email-draft">
          <p><strong>Subject:</strong> ${esc(arts.suggestedFollowUpEmail?.subject)}</p>
          <pre>${esc(arts.suggestedFollowUpEmail?.body)}</pre>
        </div>
      </details>`
    : "";

  const crmBlock = arts.crmNotes && !isUnknown(arts.crmNotes)
    ? `<details class="sources crm-sources"><summary>CRM notes</summary><p class="crm-notes">${esc(arts.crmNotes)}</p></details>`
    : "";

  const callNotes = a.callNotes && !isUnknown(a.callNotes)
    ? `<section class="call-notes-section">
        <h2>Call notes</h2>
        <p class="muted call-notes-hint">Internal: blunt coaching narrative. Not the customer MoM.</p>
        <div class="call-notes-body">${esc(a.callNotes)}</div>
      </section>`
    : "";

  const momDraft = data.summarise?.momDraft || data.momDraft;
  const momBody = momDraft?.editedBody || momDraft?.draftBody || "";
  const momBlock = momBody && !isUnknown(momBody)
    ? `<section class="mom-draft-section">
        <h2>Minutes draft</h2>
        <p class="muted mom-hint">Customer-facing: edit before send. Never auto-sent.${
          momDraft?.sentAt
            ? ` Sent ${esc(new Date(momDraft.sentAt).toLocaleString())}.`
            : " Not sent yet."
        }</p>
        <div class="mom-draft-body">${esc(momBody)}</div>
      </section>`
    : "";

  const followUps = data.summarise?.followUps || data.followUps || [];
  const followUpCollectionRows = followUps
    .filter((f) => f?.description && !isUnknown(f.description))
    .map(
      (f) => `<tr>
        <td>${esc(f.owner || "se")}</td>
        <td>${truncateWords(f.description, 25)}</td>
        <td>${truncateWords(f.dueDate || "-", 8)}</td>
        <td>${esc(f.status || "open")}</td>
      </tr>`,
    )
    .join("");
  const followUpCollectionBlock = followUpCollectionRows
    ? `<section class="follow-ups-section">
        <h2>Commitments</h2>
        <table class="next-steps-table">
          <thead><tr><th>Owner</th><th>Description</th><th>Due</th><th>Status</th></tr></thead>
          <tbody>${followUpCollectionRows}</tbody>
        </table>
      </section>`
    : "";

  const objections = data.summarise?.objections || data.objections || [];
  const objectionRows = objections
    .filter((o) => o?.objectionText && !isUnknown(o.objectionText))
    .map(
      (o) => `<tr class="${o.landed ? "" : "risk-row"}">
        <td>${truncateWords(o.objectionText, 30)}</td>
        <td>${truncateWords(o.handling || "-", 30)}</td>
        <td>${o.landed ? "Landed" : "Open"}</td>
        <td>${esc(o.theme || "-")}</td>
      </tr>`,
    )
    .join("");
  const objectionsBlock = objectionRows
    ? `<section class="objections-section">
        <h2>Objections</h2>
        <table class="next-steps-table">
          <thead><tr><th>Objection</th><th>Handling</th><th>Landed</th><th>Theme</th></tr></thead>
          <tbody>${objectionRows}</tbody>
        </table>
      </section>`
    : "";

  const transcriptDetails = tm.wordCount || tm.durationMinutes != null || (tm.speakers || []).length
    ? `<details class="sources transcript-sources">
        <summary>Transcript</summary>
        <ul>
          ${tm.durationMinutes != null ? `<li>Duration: ~${esc(tm.durationMinutes)} min</li>` : ""}
          ${tm.wordCount ? `<li>Word count: ${esc(tm.wordCount)}</li>` : ""}
          ${tm.speakerCount ? `<li>Speakers: ${esc(tm.speakerCount)}</li>` : ""}
          ${(tm.speakers || []).length ? `<li>Names: ${(tm.speakers || []).map(esc).join(", ")}</li>` : ""}
        </ul>
      </details>`
    : "";

  const momCls = momentumClass(mom.status);

  const momentumHero = `<section class="outcome-bar outcome-focal momentum-hero ${momCls}">
    <div class="outcome-status">
      <span class="outcome-arrow" aria-hidden="true">${momentumArrow(mom.status)}</span>
      <span class="outcome-label">${esc(mom.status || "Stalled")}</span>
    </div>
    <p class="outcome-reason">${truncateWords(mom.reason, 18)}</p>
    <div class="outcome-action">
      <strong>Top action:</strong> ${truncateWords(mom.topAction, 8)}
      ${!isUnknown(mom.topActionDue) ? ` · <span class="muted">Due ${truncateWords(mom.topActionDue, 8)}</span>` : ""}
    </div>
  </section>`;

  return `
    <div class="toolbar">
      <fw-button id="toolbar-print" color="secondary" fill="outline">Print / PDF</fw-button>
      <fw-button id="copy-postcall-json" color="secondary" fill="outline">Copy JSON</fw-button>
      <fw-button id="copy-followup" color="secondary" fill="outline">Copy follow-up email</fw-button>
    </div>
    <header class="header-strip">
      <div class="header-main">
        <h2 class="one-pager-title">${esc(getCallTitle(a, meta))}</h2>
        ${metaLine ? `<span class="header-meta">${metaLine}</span>` : ""}
      </div>
      <div class="attendee-chips">${attendeeChips}</div>
    </header>
    ${momentumHero}
    <section class="prep-hero"><h2>This call → Follow-up</h2>${followTable}</section>
    <section class="signals-row">
      <h2>Signals</h2>
      <div class="signals-grid">
        <div class="signal-col signal-pains"><h3>Pains confirmed</h3>${signalCol(sig.painsConfirmed)}</div>
        <div class="signal-col signal-objections"><h3>Objections open</h3>${signalCol(sig.objectionsOpen)}</div>
        <div class="signal-col signal-competitors"><h3>Competitors</h3>${signalCol(sig.competitors)}</div>
      </div>
    </section>
    <section class="next-steps-section"><h2>Next steps</h2>${nextTable}</section>
    ${followUpCollectionBlock}
    ${objectionsBlock}
    ${callNotes}
    ${momBlock}
    <section class="qip-section-wrap">
      <h2>${useQip ? "QIP scorecard" : "Quality coach"}</h2>
      ${
        useQip
          ? renderQipScorecard(scorecard || { lines: [] }, data.analysisMeta || {})
          : renderQualityCoach(a.qualityCoach)
      }
    </section>
    <footer class="prep-footer">${followUpEmail}${crmBlock}${transcriptDetails}</footer>`;
}

/** Keep the inline one-pager hidden once a call record exists. */
export function hidePostCallLegacyResult() {
  const result = $("postcall-result");
  if (result) {
    result.classList.remove("anim-root", "anim-ready");
    show(result, false);
  }
}

/** Route to the call-record view. never leave the legacy one-pager visible. */
function navigateToCallRecord(recordId) {
  if (!recordId) return;
  hidePostCallLegacyResult();
  show($("postcall-form-view"), false);
  show($("postcall-confirm-view"), false);
  show($("postcall-loading"), false);
  // #region agent log
  agentDebugLog("postcall.js:navigateToCallRecord", "navigateToCallRecord", {
    recordId,
    hasCallback: typeof onCallRecordReady === "function",
    hashBefore: location.hash,
  }, "H3");
  console.warn("[DEBUG-064b3d] navigateToCallRecord", recordId, location.hash);
  // #endregion
  if (typeof onCallRecordReady === "function") {
    onCallRecordReady(recordId);
  }
  window.dispatchEvent(
    new CustomEvent("lionpath:open-call-record", { detail: { id: recordId }, bubbles: true }),
  );
  if (!location.hash.includes(recordId)) {
    location.hash = `#calls/${recordId}`;
  }
}

export function displayPostCall(data, meta) {
  // #region agent log
  agentDebugLog("postcall.js:displayPostCall", "displayPostCall invoked", {
    recordId: pipelineState?.recordId || null,
    generated: !!pipelineState?.generated,
    hash: location.hash,
  }, "H4");
  // #endregion
  if (pipelineState?.recordId || pipelineState?.generated) {
    hidePostCallLegacyResult();
    return;
  }
  const result = $("postcall-result");
  if (!result) return;
  result.classList.remove("anim-root", "anim-ready");
  try {
    const confirmedBanner = renderConfirmedReadOnlyBanner(data);
    result.innerHTML = confirmedBanner + renderPostCall(data, meta);
  } catch (err) {
    console.error("[postcall] render failed:", err);
    result.innerHTML = `<fw-inline-message type="error" open closable="false">${esc(err.message || "Could not render analysis.")}</fw-inline-message>`;
  }
  wirePostCallNavigation(result, data);
  show($("postcall-form-view"), false);
  show(result, true);
  initPostCallAnimations(result);
  wirePrintToolbar(result);
  wireToolbarById(result, {
    "copy-postcall-json": () => navigator.clipboard.writeText(JSON.stringify(data, null, 2)),
    "copy-followup": () => {
      const e = data.analysis?.artifacts?.suggestedFollowUpEmail
        || data.analysis?.nextSteps?.suggestedFollowUpEmail;
      if (e) navigator.clipboard.writeText(`Subject: ${e.subject}\n\n${e.body}`);
    },
  });
  result.scrollIntoView({ behavior: prefersReducedMotion() ? "auto" : "smooth", block: "start" });
}

function wirePostCallNavigation(root, data) {
  if (!root) return;
  const accountId = data?.resolve?.account?.accountId || data?.confirmed?.accountId || null;
  const dealId =
    data?.confirmed?.dealId ||
    data?.resolve?.deals?.find((d) => d.preselected)?.dealId ||
    data?.resolve?.deals?.[0]?.dealId ||
    null;
  root.querySelectorAll('[data-postcall-nav="account"]').forEach((el) => {
    el.addEventListener("click", (e) => {
      if (!accountId) return;
      e.preventDefault();
      location.hash = `#accounts/${accountId}`;
    });
  });
  root.querySelectorAll('[data-postcall-nav="deal"]').forEach((el) => {
    el.addEventListener("click", (e) => {
      if (!dealId) return;
      e.preventDefault();
      location.hash = `#deals/${dealId}`;
    });
  });
}

let onAnalysisSaved = null;
/** @type {((id: string) => void) | null} */
let onCallRecordReady = null;
/** @type {((id: string) => void) | null} */
let onCallRecordHydrated = null;

/** @param {(record: object) => void} fn */
export function setOnAnalysisSaved(fn) {
  onAnalysisSaved = fn;
}

/** @param {(id: string) => void} fn */
export function setOnCallRecordReady(fn) {
  onCallRecordReady = fn;
}

/** @param {(id: string) => void} fn */
export function setOnCallRecordHydrated(fn) {
  onCallRecordHydrated = fn;
}

async function postJson(url, body) {
  const res = await fetch(url, {
    method: "POST",
    headers: await authHeaders(),
    body: JSON.stringify(body),
  });
  const raw = await res.text();
  let data;
  try {
    data = JSON.parse(raw);
  } catch {
    throw new Error(raw.slice(0, 300) || `Request failed (${res.status}).`);
  }
  if (!res.ok) throw new Error(data.error || `Request failed (${res.status}).`);
  return data;
}

function renderProgressStep(label, status, index) {
  const icon =
    status === "done" ? "✓" : status === "active" ? "…" : status === "error" ? "!" : String(index + 1);
  const cls =
    status === "done"
      ? "postcall-step-done"
      : status === "active"
        ? "postcall-step-active"
        : status === "error"
          ? "postcall-step-error"
          : "postcall-step-pending";
  return `<li class="postcall-step ${cls}"><span class="postcall-step-icon" aria-hidden="true">${icon}</span><span class="postcall-step-label">${esc(label)}</span></li>`;
}

function showPipelineProgress(steps) {
  const host = $("postcall-progress");
  if (!host) return;
  const doneCount = steps.filter((s) => s.status === "done").length;
  const pct = steps.length ? Math.round((doneCount / steps.length) * 100) : 0;
  host.innerHTML = `
    <div class="postcall-pipeline-card">
      <div class="postcall-pipeline-head">
        <span class="prep-form-eyebrow">Pipeline</span>
        <span class="muted postcall-pipeline-meta">${esc(String(doneCount))} of ${esc(String(steps.length))} complete</span>
      </div>
      <div class="postcall-pipeline-bar" role="progressbar" aria-valuenow="${esc(String(pct))}" aria-valuemin="0" aria-valuemax="100">
        <span style="width:${pct}%"></span>
      </div>
      <ol class="postcall-step-list">${steps.map((s, i) => renderProgressStep(s.label, s.status, i)).join("")}</ol>
    </div>`;
  show(host, true);
}

function formatMatchReasons(reasons) {
  if (!reasons?.length) return '<span class="muted">No match signals</span>';
  return `<ul class="postcall-match-reasons">${reasons
    .map((r) => `<li><span class="postcall-match-rank">#${esc(r.rank)}</span> ${esc(r.detail)}</li>`)
    .join("")}</ul>`;
}

function matchConfidencePill(score) {
  if (score == null || !Number.isFinite(Number(score))) return "";
  const pct = Math.round(Number(score) * 100);
  if (pct >= 80) return '<span class="pill green">Confident</span>';
  if (pct >= 50) return `<span class="pill amber">${esc(String(pct))}% sure</span>`;
  return `<span class="pill red">${esc(String(pct))}% match</span>`;
}

function formatDurationMinutes(mins) {
  if (mins == null || !Number.isFinite(Number(mins))) return "-";
  const n = Number(mins);
  if (n < 1) return "< 1 min";
  return `${Math.round(n * 10) / 10} min`;
}

function isInternalIdentity(label) {
  return /@(?:freshworks|freshdesk|freshservice)\./i.test(String(label || ""));
}

function looksLikeAeIdentity(label) {
  const s = String(label || "");
  if (/\|\s*ae\b/i.test(s) || /\bae\s*@/i.test(s)) return true;
  return /(?:^|[\s|,/(-])(ae|a\.e\.|account\s*exec(?:utive)?|account\s*manager|sales\s*rep|sdr|bdr)(?:$|[\s|,/)-])/i.test(
    s,
  );
}

function looksLikeSeIdentity(label) {
  const s = String(label || "");
  if (looksLikeAeIdentity(s)) return false;
  if (/\|\s*se\b/i.test(s)) return true;
  return /(?:^|[\s|,/(-])(se|s\.e\.|solutions?\s*engineer|solutions?\s*consultant|sales\s*engineer|pre[- ]?sales)(?:$|[\s|,/)-])/i.test(
    s,
  );
}

function identityOptionList(resolve) {
  const fromResolve = resolve?.identityOptions || [];
  const speakers = resolve?.transcriptMeta?.speakers || [];
  const emails = resolve?.participantEmails || [];
  const extras = [
    currentSession?.name,
    currentSession?.displayName,
    currentSession?.email,
  ].filter(Boolean);
  // Session SE first so dropdown default never collapses to speaker[0] (often the AE).
  return dedupePersonLabels([...extras, ...fromResolve, ...speakers, ...emails]);
}

function pickIdentityDefaults(resolve) {
  const speakers = resolve?.transcriptMeta?.speakers || [];
  const options = identityOptionList(resolve);
  const sessionLabel =
    currentSession?.name || currentSession?.displayName || currentSession?.email || "";

  // Prefer speakers on the call; session user is fallback (reviewer ≠ call SE).
  let se = resolve?.seIdentity || "";
  if (!se || looksLikeAeIdentity(se)) {
    se =
      speakers.find((s) => looksLikeSeIdentity(s)) ||
      speakers.find((s) => !looksLikeAeIdentity(s)) ||
      (sessionLabel && !looksLikeAeIdentity(sessionLabel) ? sessionLabel : "") ||
      "";
  }
  if (!se || looksLikeAeIdentity(se)) {
    se =
      options.find((o) => looksLikeSeIdentity(o)) ||
      options.find((o) => !looksLikeAeIdentity(o) && !isInternalIdentity(o)) ||
      sessionLabel ||
      "";
  }

  let ae = resolve?.aeIdentity || speakers.find((s) => looksLikeAeIdentity(s)) || "";
  if (ae && se && ae.trim().toLowerCase() === se.trim().toLowerCase()) {
    ae = speakers.find((s) => looksLikeAeIdentity(s) && s.trim().toLowerCase() !== se.trim().toLowerCase()) || "";
  }

  const used = new Set([se, ae].filter(Boolean).map((s) => normalizePersonKey(s)));
  const customerCandidates = (resolve?.customerIdentities || []).filter((c) => {
    const key = normalizePersonKey(c);
    if (!key || used.has(key) || isInternalIdentity(c) || looksLikeAeIdentity(c) || looksLikeSeIdentity(c)) {
      return false;
    }
    return true;
  });
  let customers = dedupePersonLabels(customerCandidates);
  if (!customers.length) {
    customers = dedupePersonLabels(
      speakers.filter((s) => {
        const key = normalizePersonKey(s);
        return (
          key &&
          !used.has(key) &&
          !looksLikeAeIdentity(s) &&
          !looksLikeSeIdentity(s) &&
          !isInternalIdentity(s)
        );
      }),
    );
  }
  return { seDefault: se, aeDefault: ae, customers, options };
}

function renderIdentitySelect(id, label, selected, options, { required = false, allowEmpty = false } = {}) {
  const selectedKey = normalizePersonKey(selected);
  const opts = [];
  if (allowEmpty) {
    opts.push(`<option value="">(None)</option>`);
  }
  let hasSelected = false;
  for (const opt of options) {
    const isSel = normalizePersonKey(opt) === selectedKey;
    if (isSel) hasSelected = true;
    opts.push(`<option value="${esc(opt)}"${isSel ? " selected" : ""}>${esc(opt)}</option>`);
  }
  if (selected && !hasSelected) {
    opts.push(`<option value="${esc(selected)}" selected>${esc(selected)}</option>`);
  }
  return `<div class="postcall-identity-field">
    <label for="${esc(id)}">${esc(label)}${required ? " *" : ""}</label>
    <select id="${esc(id)}" class="postcall-confirm-select"${required ? " required" : ""}>
      ${opts.join("")}
    </select>
  </div>`;
}

function renderCustomerChecks(selected, options) {
  const selectedKeys = new Set(
    (selected || []).map((s) => normalizePersonKey(s)).filter(Boolean),
  );
  if (!options.length) {
    return `<p class="muted">No speakers/emails to pick; type names into AE notes if needed.</p>`;
  }
  return `<div class="postcall-customer-checks" role="group" aria-label="Customer identities">
    ${options
      .map((opt, i) => {
        const checked = selectedKeys.has(normalizePersonKey(opt)) ? " checked" : "";
        const id = `pc-confirm-customer-${i}`;
        return `<label class="postcall-customer-option" for="${esc(id)}">
          <input id="${esc(id)}" type="checkbox" name="postcall-customer" value="${esc(opt)}"${checked} />
          <span>${esc(opt)}</span>
        </label>`;
      })
      .join("")}
  </div>`;
}

function renderIdentityConfirm(resolve) {
  const { seDefault, aeDefault, customers, options } = pickIdentityDefaults(resolve);
  const customerOptions = dedupePersonLabels(options.filter((o) => !isInternalIdentity(o)));
  return `<div class="postcall-confirm-block postcall-identity-block">
    <h3>Call identities</h3>
    <p class="muted">Confirm SE, AE, and customer before analysis. guesses are often wrong.</p>
    ${renderIdentitySelect("pc-confirm-se", "SE", seDefault, options, { required: true })}
    ${renderIdentitySelect("pc-confirm-ae", "AE", aeDefault, options, { allowEmpty: true })}
    <div class="postcall-identity-field">
      <span class="postcall-identity-label">Customer</span>
      ${renderCustomerChecks(customers, customerOptions.length ? customerOptions : options)}
    </div>
  </div>`;
}

function renderDerivedFacts(resolve) {
  const domains = resolve?.participantDomains || [];
  const speakers = resolve?.transcriptMeta?.speakers || [];
  const duration = resolve?.durationMinutes ?? resolve?.transcriptMeta?.durationMinutes;
  const rows = [
    ["Domains", domains.length ? domains.join(", ") : "-"],
    ["Duration", formatDurationMinutes(duration)],
    ["Source", resolve?.sourceKind || "-"],
  ];
  if (speakers.length) {
    rows.push(["Speakers", dedupePersonLabels(speakers).join(", ")]);
  }
  return `<div class="postcall-confirm-block">
    <h3>Derived from recording</h3>
    <p class="muted">Confirm these; we don't ask for them again.</p>
    <dl class="postcall-derived-facts">
      ${rows
        .map(
          ([k, v]) =>
            `<div class="postcall-derived-row"><dt>${esc(k)}</dt><dd>${esc(v)}</dd></div>`,
        )
        .join("")}
    </dl>
  </div>`;
}

function renderVideoThemeWarning(resolve) {
  const themes = resolve?.videoThemesNotApplicable || [];
  if (!themes.length || resolve?.videoAvailable) return "";
  const confPct = Math.round((resolve?.analysisConfidence ?? 0.55) * 100);
  const items = themes
    .map((t) => {
      const label = VIDEO_THEME_LABELS[t.themeKey] || t.themeKey;
      return `<li><strong>${esc(label)}</strong>. ${esc(t.reason || "Not applicable without video.")}</li>`;
    })
    .join("");
  return `<div class="postcall-confirm-block postcall-video-na">
    <h3>Video themes not scored</h3>
    <p class="muted">No video stream. denominator will renormalise. Analysis confidence: ${esc(confPct)}%.</p>
    <ul class="postcall-video-na-list">${items}</ul>
  </div>`;
}

function renderConfirmationGate(resolve, classify) {
  const account = resolve?.account;
  const deals = resolve?.deals || [];
  const selectedDealId = deals.find((d) => d.preselected)?.dealId || deals[0]?.dealId || "";
  const selectedDeal = deals.find((d) => d.dealId === selectedDealId) || deals[0] || null;
  const callType = classify?.primary || "discovery";
  const confidencePct = Math.round((classify?.confidence ?? 0) * 100);
  const formCompany = pipelineState?.payload?.companyName || "";
  const dealScore = selectedDeal?.score ?? account?.score;
  const dealPill = matchConfidencePill(dealScore);
  const callTypePill =
    confidencePct >= 80
      ? '<span class="pill green">Confident</span>'
      : `<span class="pill amber">${esc(String(confidencePct))}% sure</span>`;

  const callTypeOptions = CALL_TYPES.map(
    (t) =>
      `<option value="${esc(t)}"${t === callType ? " selected" : ""}>${esc(CALL_TYPE_LABELS[t] || t)}</option>`,
  ).join("");

  const dealOptions = deals.length
    ? deals
        .map((d) => {
          const checked = d.dealId === selectedDealId ? " checked" : "";
          return `<label class="postcall-deal-option">
            <input type="radio" name="postcall-deal" value="${esc(d.dealId)}"${checked} />
            <span class="postcall-deal-option-body">
              <strong>${esc(d.title)}</strong>
              <span class="muted">${esc(d.type)} · ${esc(d.stage)}</span>
              ${formatMatchReasons(d.reasons)}
            </span>
          </label>`;
        })
        .join("")
    : "";

  const accountMatchDetail = account ? formatMatchReasons(account.reasons) : "";

  const dealHeadline =
    account && selectedDeal
      ? `<div class="postcall-match-row">
          <div>
            <div class="postcall-match-title"><strong>${esc(account.accountName)} · ${esc(selectedDeal.title)} · ${esc(selectedDeal.stage)}</strong></div>
            <div class="postcall-match-detail">${accountMatchDetail}</div>
          </div>
          <button type="button" class="postcall-change-btn btn-wire" id="postcall-deal-change-btn">Change</button>
        </div>`
      : account
        ? `<div class="postcall-match-row">
            <div><div class="postcall-match-title"><strong>${esc(account.accountName)}</strong></div></div>
            <button type="button" class="postcall-change-btn btn-wire" id="postcall-deal-change-btn">Change</button>
          </div>`
        : "";

  const accountFieldsHidden = account ? ' hidden' : '';

  const accountFields = account
    ? `<label class="postcall-confirm-edit" for="pc-confirm-account">Change account name</label>
        <input id="pc-confirm-account" class="postcall-confirm-input" type="text" value="${esc(account.accountName)}" />`
    : `<label for="pc-confirm-account">Company name</label>
        <input id="pc-confirm-account" class="postcall-confirm-input" type="text"
          value="${esc(resolve?.noMatch?.suggestedCompanyName || formCompany || "")}" placeholder="Company name" />
        <label for="pc-confirm-search">Search accounts</label>
        <div class="pc-lookup-field">
          <input id="pc-confirm-search" class="postcall-confirm-input" type="search" placeholder="Type to search…" />
          <div id="pc-confirm-suggest" class="pc-lookup-menu" role="listbox" hidden></div>
        </div>`;

  const accountBlock = account
    ? `<div class="postcall-match-banner postcall-match-banner--deal">
        <div class="postcall-match-banner-head">
          <div class="prep-form-eyebrow">Deal matched</div>
          ${dealPill}
        </div>
        ${dealHeadline}
        <div class="postcall-confirm-block postcall-confirm-block--nested postcall-match-edit"${accountFieldsHidden}>
          ${accountFields}
        </div>
        ${dealOptions ? `<div class="postcall-confirm-block postcall-confirm-block--nested postcall-deal-picker"${accountFieldsHidden}>
          <h3 class="postcall-confirm-subhead">Deal on account</h3>
          <div class="postcall-deal-list">${dealOptions}</div>
        </div>` : ""}
      </div>`
    : `<div class="postcall-match-banner postcall-match-banner--neutral">
        <div class="postcall-match-banner-head">
          <div class="prep-form-eyebrow">Account match</div>
        </div>
        <div class="postcall-confirm-block postcall-confirm-block--nested">
          <h3 class="postcall-confirm-subhead">No account matched</h3>
          <p class="muted">Search or create from participant hints.</p>
          ${accountFields}
        </div>
        ${dealOptions ? `<div class="postcall-confirm-block postcall-confirm-block--nested">
          <h3 class="postcall-confirm-subhead">Deal on account</h3>
          <div class="postcall-deal-list">${dealOptions}</div>
        </div>` : ""}
      </div>`;

  const freeMailBlock = resolve?.needsCompanyDomain
    ? `<div class="postcall-confirm-block">
        <h3>Company domain required</h3>
        <p class="muted">Participant email uses a personal domain (${esc((resolve.freeMailDomains || []).join(", "))}). Enter the real company domain.</p>
        <label for="pc-confirm-domain">Company domain</label>
        <input id="pc-confirm-domain" class="postcall-confirm-input" type="text" placeholder="acme.com" required />
      </div>`
    : "";

  return `
    <header class="postcall-confirm-header">
      <h2>Confirm before analysis</h2>
      <p class="muted">Review identities, match, and call type. Nothing runs until you confirm.</p>
    </header>
    ${renderDerivedFacts(resolve)}
    ${renderIdentityConfirm(resolve)}
    ${renderVideoThemeWarning(resolve)}
    ${accountBlock}
    ${freeMailBlock}
    <div class="postcall-match-banner postcall-match-banner--type">
      <div class="postcall-match-banner-head">
        <div class="prep-form-eyebrow">Call type · confirm before we score</div>
        ${callTypePill}
      </div>
      <label class="postcall-confirm-sr" for="pc-confirm-call-type">Call type</label>
      <select id="pc-confirm-call-type" class="postcall-confirm-select">${callTypeOptions}</select>
      <p class="muted postcall-type-hint">Pick the primary; the rubric and its weights follow from this.</p>
    </div>
    <div class="postcall-confirm-actions">
      <fw-button id="postcall-confirm-btn" color="primary" class="prep-form-submit">Confirm and generate</fw-button>
      <fw-button id="postcall-restart-btn" color="secondary" fill="outline">Discard and start over</fw-button>
    </div>
    <p class="prep-form-footnote">Analysis usually finishes in 20–45 seconds after confirm.</p>`;
}

function wireDealChangeToggle(card) {
  const btn = card?.querySelector("#postcall-deal-change-btn");
  if (!btn) return;
  btn.addEventListener("click", () => {
    card.querySelectorAll(".postcall-match-edit, .postcall-deal-picker").forEach((el) => {
      el.hidden = !el.hidden;
    });
  });
}

function showConfirmationGate(resolve, classify) {
  import("./domain/store.js").catch(() => {});
  import("./domain/arr-service.js").catch(() => {});

  const card = $("postcall-confirm-view");
  if (!card) return;
  card.innerHTML = renderConfirmationGate(resolve, classify);
  show($("postcall-form-view"), false);
  show($("postcall-loading"), false);
  show(card, true);
  show($("postcall-result"), false);

  $("postcall-confirm-btn")?.addEventListener("fwClick", (e) => { void confirmAndGenerate(e); });
  $("postcall-confirm-btn")?.addEventListener("click", (e) => { void confirmAndGenerate(e); });
  $("postcall-restart-btn")?.addEventListener("fwClick", (e) => { void restartPipeline(e); });
  $("postcall-restart-btn")?.addEventListener("click", (e) => { void restartPipeline(e); });

  wireDealChangeToggle(card);

  const confirmSearch = card.querySelector("#pc-confirm-search");
  const confirmSuggest = card.querySelector("#pc-confirm-suggest");
  const confirmAccount = card.querySelector("#pc-confirm-account");
  if (confirmSearch && confirmSuggest && confirmAccount) {
    attachAccountLookup({
      inputEl: confirmSearch,
      menuEl: confirmSuggest,
      onPick: (account, typedName) => {
        confirmAccount.value = typedName;
        if (account) {
          pcResolvedAccount = {
            id: account.id,
            name: account.name,
            domain: account.domain || null,
          };
          pcCreateNewAccount = false;
        }
      },
    });
  }

  card.scrollIntoView({ behavior: prefersReducedMotion() ? "auto" : "smooth", block: "start" });
}

function readConfirmationSelections() {
  const callTypeEl = $("pc-confirm-call-type");
  const callType = callTypeEl?.value || pipelineState?.classify?.primary || "discovery";
  const dealRadio = document.querySelector('input[name="postcall-deal"]:checked');
  const dealId = dealRadio?.value || null;
  const accountName = ($("pc-confirm-account")?.value || "").trim();
  const companyDomain = ($("pc-confirm-domain")?.value || "").trim().toLowerCase();
  const seIdentity = ($("pc-confirm-se")?.value || "").trim();
  const aeIdentity = ($("pc-confirm-ae")?.value || "").trim();
  const customerIdentities = [
    ...document.querySelectorAll('input[name="postcall-customer"]:checked'),
  ]
    .map((el) => String(el.value || "").trim())
    .filter(Boolean);
  return { callType, dealId, accountName, companyDomain, seIdentity, aeIdentity, customerIdentities };
}

function formatConfirmedIdentitiesContext({ seIdentity, aeIdentity, customerIdentities }) {
  const lines = ["Confirmed call identities (authoritative; use these for attendees/roles):"];
  if (seIdentity) lines.push(`- SE: ${seIdentity}`);
  if (aeIdentity) lines.push(`- AE: ${aeIdentity}`);
  if (customerIdentities?.length) {
    lines.push(`- Customer: ${customerIdentities.join(", ")}`);
  } else {
    lines.push("- Customer: (none selected)");
  }
  return lines.join("\n");
}

async function confirmAndGenerate(e) {
  e?.preventDefault?.();
  if (!pipelineState?.resolve || !pipelineState?.classify) return;

  const btn = $("postcall-confirm-btn");
  const status = $("postcall-status");
  const {
    callType,
    dealId,
    accountName,
    companyDomain,
    seIdentity,
    aeIdentity,
    customerIdentities,
  } = readConfirmationSelections();

  if (!seIdentity) {
    showInlineStatus(status, { type: "error", message: "Confirm who the SE is before continuing." });
    return;
  }

  if (pipelineState.resolve.needsCompanyDomain && !companyDomain) {
    showInlineStatus(status, { type: "error", message: "Enter the real company domain before continuing." });
    return;
  }

  pipelineState.confirmedIdentities = { seIdentity, aeIdentity, customerIdentities };

  const classify = pipelineState.classify;
  const preselectedId = pipelineState.resolve.deals?.find((d) => d.preselected)?.dealId || null;
  const callTypeOverride =
    callType !== classify.primary
      ? { from: classify.primary, to: callType, at: Date.now() }
      : undefined;
  const dealMatchOverride =
    dealId && preselectedId && dealId !== preselectedId
      ? { from: preselectedId, to: dealId, at: Date.now() }
      : undefined;

  setButtonLoading(btn, true);
  show($("postcall-confirm-view"), false);
  show($("postcall-loading"), true);

  const companyName =
    accountName ||
    pipelineState.payload.companyName ||
    pipelineState.resolve.account?.accountName;
  const identityContext = formatConfirmedIdentitiesContext(
    pipelineState.confirmedIdentities || { seIdentity, aeIdentity, customerIdentities },
  );
  const additionalContext = [identityContext, pipelineState.payload.additionalContext]
    .filter(Boolean)
    .join("\n\n");
  const accountId =
    pipelineState.resolve.account?.accountId || pipelineState.payload.accountId || null;
  const qualifyBody = {
    transcript: pipelineState.resolve.transcript,
    dealId: dealId || null,
    companyName,
    meetingTitle: pipelineState.payload.meetingTitle || companyName,
    callType,
    additionalContext,
    meetingDate: meetingDateFromResolve(pipelineState.resolve),
  };
  const summariseBody = {
    transcript: pipelineState.resolve.transcript,
    dealId: dealId || null,
    companyName,
    meetingTitle: pipelineState.payload.meetingTitle || companyName,
    callType,
    additionalContext,
    meetingDate: meetingDateFromResolve(pipelineState.resolve),
  };

  const qualifyP = postJson(QUALIFY_URL, qualifyBody).catch((err) => {
    console.warn("[postcall] qualify soft-fail:", err?.message || err);
    return null;
  });
  const summariseP = postJson(SUMMARISE_URL, summariseBody).catch((err) => {
    console.warn("[postcall] summarise soft-fail:", err?.message || err);
    return null;
  });
  const arrInputsP =
    dealId && accountId
      ? postJson(ARR_INPUTS_URL, {
          transcript: pipelineState.resolve.transcript,
          dealId,
          callId: pipelineState.recordId || null,
          companyName,
          meetingTitle: pipelineState.payload.meetingTitle || companyName,
          callType,
          additionalContext,
        }).catch((err) => {
          console.warn("[postcall] arr-inputs soft-fail:", err?.message || err);
          return null;
        })
      : Promise.resolve(null);
  const prevCommitP = dealId
    ? import("./domain/store.js")
        .then(({ getStore }) => {
          const store = getStore();
          return store.getTechnicalCommitByDeal
            ? store.getTechnicalCommitByDeal(dealId)
            : null;
        })
        .catch((err) => {
          console.warn("[postcall] prior technical commit lookup failed:", err?.message || err);
          return null;
        })
    : Promise.resolve(null);
  const allowanceP =
    dealId && accountId
      ? Promise.all([import("./domain/store.js"), import("./domain/arr-service.js")])
          .then(([{ getStore }, { accountAllowanceConsumedForDeal }]) =>
            accountAllowanceConsumedForDeal(getStore(), accountId, dealId),
          )
          .catch((err) => {
            console.warn("[postcall] allowance lookup failed:", err?.message || err);
            return null;
          })
      : Promise.resolve(null);
  const commitP = prevCommitP.then((previousCommit) =>
    postJson(COMMIT_URL, {
      ...qualifyBody,
      callId: pipelineState.recordId || null,
      previous: previousCommit,
    }).catch((err) => {
      console.warn("[postcall] commit soft-fail:", err?.message || err);
      return null;
    }),
  );

  let videoFacts = null;
  const pass2Transcript = pipelineState.resolve.transcript?.trim() || "";
  const pass2DurationSec =
    pipelineState.resolve.media?.durationSec ??
    (pipelineState.resolve.durationMinutes != null
      ? Math.round(Number(pipelineState.resolve.durationMinutes) * 60)
      : null);
  const canRunPass2 =
    (pipelineState.resolve.videoAvailable && pipelineState.payload.recordingUrl) ||
    pass2Transcript.length > 0;

  if (canRunPass2) {
    showPipelineProgress([
      { label: "Resolve recording and match deal", status: "done" },
      { label: "Classify call type", status: "done" },
      { label: "Generate analysis + qualification + commitments", status: "active" },
    ]);
    showInlineStatus(status, {
      type: "info",
      message: pass2Transcript
        ? "Running Pass 2 via Gemini (slide/PPT + screen-share inference from transcript)…"
        : "Sampling Zoom video for camera / share facts… (ffmpeg on VPS when available)",
      loading: true,
    });
    try {
      const provisionalCallId = `call_pending_${Date.now()}`;
      const videoRes = await postJson(VIDEO_PASS_URL, {
        callId: provisionalCallId,
        recordingUrl: pipelineState.payload.recordingUrl,
        recordingPassword: pipelineState.payload.recordingPassword,
        // Do not pass resolve.media — Zoom signed URLs expire during the confirm gate.
        transcript: pass2Transcript || undefined,
        durationSec: pass2DurationSec,
        callType,
        visualAnalysisConsent: !!pipelineState.payload.visualAnalysisConsent,
        seIdentity,
        aeIdentity,
        customerIdentities,
      });
      videoFacts = videoRes?.videoFacts || null;
      pipelineState.videoFacts = videoFacts;
      // #region agent log
      const curve = videoFacts?.attendeeCurveJson;
      const hasCam = Array.isArray(curve) && curve.some(
        (p) => p?.cameraOn != null || p?.cameraOnPct != null,
      );
      agentDebugLog("postcall.js:videoPass", "video pass result", {
        streamKind: videoFacts?.streamKind || null,
        status: videoFacts?.status || null,
        hasCameraData: hasCam,
        seCameraOnPct: videoFacts?.cameraOnPct ?? null,
        ok: videoRes?.ok ?? null,
        pass2Error: videoFacts?.errorMessage || null,
        pass2Debug: videoRes?.pass2Debug || null,
      }, "H1");
      console.warn("[DEBUG-064b3d] pass2 videoFacts", {
        streamKind: videoFacts?.streamKind,
        hasCamera: hasCam,
        status: videoFacts?.status,
        pass2Error: videoFacts?.errorMessage || null,
        pass2Debug: videoRes?.pass2Debug || null,
      });
      // #endregion
    } catch (videoErr) {
      console.warn("[postcall] video-pass soft-fail:", videoErr?.message || videoErr);
      videoFacts = null;
    }
  } else {
    showPipelineProgress([
      { label: "Resolve recording and match deal", status: "done" },
      { label: "Classify call type", status: "done" },
      { label: "Generate analysis + qualification + commitments", status: "active" },
    ]);
  }

  showInlineStatus(status, {
    type: "info",
    message: "Generating analysis, qualification, and commitments… usually 15–40 seconds.",
    loading: true,
  });

  try {
    const body = {
      transcript: pipelineState.resolve.transcript,
      recordingUrl: pipelineState.payload.recordingUrl,
      recordingPassword: pipelineState.payload.recordingPassword,
      companyName,
      prospectEmails: pipelineState.payload.prospectEmails,
      additionalContext,
      deckLink: pipelineState.payload.deckLink,
      linkedinProfileExports: pipelineState.payload.linkedinProfileExports,
      confirmed: true,
      callType,
      dealId,
      accountId,
      companyDomain: companyDomain || undefined,
      meetingDate: meetingDateFromResolve(pipelineState.resolve),
      resolveSnapshot: {
        ...pipelineState.resolve,
        seIdentity,
        aeIdentity,
        customerIdentities,
      },
      classifySnapshot: pipelineState.classify,
      callTypeOverride,
      dealMatchOverride,
      videoFacts: videoFacts || undefined,
    };

    const [data, qualify, commit, summarise] = await Promise.all([
      postJson(GENERATE_URL, body),
      qualifyP,
      commitP,
      summariseP,
    ]);
    if (qualify?.qualification) {
      data.qualification = qualify.qualification;
      data.framework = qualify.framework;
    }
    if (commit?.technicalCommit) {
      data.technicalCommit = commit.technicalCommit;
      data.tcDeltas = commit.tcDeltas || [];
    }
    if (summarise) {
      data.summarise = summarise;
      if (typeof summarise.callNotes === "string" && summarise.callNotes.trim()) {
        data.analysis = { ...(data.analysis || {}), callNotes: summarise.callNotes };
      }
    }

    pipelineState.generated = true;

    const meta = { title: "" };
    meta.title = getCallTitle(data.analysis, meta);
    show($("postcall-progress"), false);
    show($("postcall-loading"), false);
    showInlineStatus(status, { open: false });

    let record = null;
    const sessionEmail = normalizeUserEmail(currentSession?.email || getSession()?.email);
    // #region agent log
    agentDebugLog("postcall.js:confirmAndGenerate", "post-save path", {
      sessionEmail: sessionEmail || null,
      hasOnCallRecordReady: typeof onCallRecordReady === "function",
      hashBefore: location.hash,
    }, "H1");
    // #endregion
    if (sessionEmail) {
      const savePayload = {
        ...pipelineState.payload,
        dealId,
        callType,
        companyName,
        confirmedIdentities: pipelineState.confirmedIdentities || {
          seIdentity,
          aeIdentity,
          customerIdentities,
        },
      };
      record = await savePostCallHistory(sessionEmail, savePayload, {
        ...data,
        videoFacts: data.videoFacts || pipelineState.videoFacts || videoFacts || undefined,
      });
      // #region agent log
      agentDebugLog("postcall.js:confirmAndGenerate", "savePostCallHistory result", {
        recordId: record?.id || null,
        writeOk: !!record?.id,
      }, "H2");
      // #endregion
      if (record?.id) {
        pipelineState.recordId = record.id;
        navigateToCallRecord(record.id);
        invalidatePostCallResolveContext();
        invalidateDealListCache();
        const DUAL_WRITE_BUDGET_MS = 2000;
        if (onAnalysisSaved) {
          void Promise.race([
            onAnalysisSaved(record, savePayload, data).catch((err) =>
              console.warn("[postcall] analysis-saved hook failed:", err?.message || err),
            ),
            new Promise((r) => window.setTimeout(r, DUAL_WRITE_BUDGET_MS)),
          ]);
        }
      }
    }

    // Call record is canonical after a successful generate — never show the legacy one-pager.
    if (pipelineState.generated) {
      hidePostCallLegacyResult();
      show($("postcall-form-view"), false);
      show($("postcall-confirm-view"), false);
      if (!record?.id) {
        // #region agent log
        agentDebugLog("postcall.js:confirmAndGenerate", "generate ok but no record id", {
          sessionEmail: sessionEmail || null,
        }, "H2");
        console.warn("[DEBUG-064b3d] generate succeeded but history save returned no record");
        // #endregion
      }
    } else if (!record?.id) {
      displayPostCall(data, meta);
    }

    // Hydrate the slow passes after the SE is already looking at the analysis.
    void (async () => {
      try {
        const arrInputs = await arrInputsP;
        let arrCompute = null;
        if (arrInputs && dealId && accountId) {
          arrCompute = await postJson(ARR_COMPUTE_URL, {
            ...arrInputs,
            accountAllowanceConsumed: await allowanceP,
          }).catch((err) => {
            console.warn("[postcall] arr-compute soft-fail:", err?.message || err);
            return null;
          });
        }
        const arrPoint =
          arrCompute?.arrPoint ?? arrCompute?.arrEstimatePoint ?? null;
        const callNotes =
          typeof data.summarise?.callNotes === "string" ? data.summarise.callNotes.trim() : "";
        const gapsContext = [
          additionalContext,
          callNotes
            ? `Call notes (product gaps mentioned here MUST appear in productGaps when they describe missing product capability, SDKs, or integrations):\n${callNotes}`
            : "",
        ]
          .filter(Boolean)
          .join("\n\n");
        const pass6 = await postJson(GAPS_URL, {
          transcript: pipelineState.resolve.transcript,
          dealId: dealId || null,
          accountId,
          companyName,
          meetingTitle: pipelineState.payload.meetingTitle || companyName,
          callType,
          arrSnapshot: arrPoint != null ? { arrEstimatePoint: arrPoint } : null,
          additionalContext: gapsContext || undefined,
        }).catch((err) => {
          console.warn("[postcall] pass6 gaps soft-fail:", err?.message || err);
          return null;
        });
        const timeline = await deriveCallTimeline({
          transcript: pipelineState.resolve.transcript,
          gaps: pass6?.productGaps || [],
          whatWorks: pass6?.whatWorks || [],
          objections: data.summarise?.objections || [],
          scorecardLines: data.scorecard?.lines || [],
        });
        if (!record?.id || !sessionEmail) return;
        const { updatePostCallAnalysis } = await import("./history.js");
        await updatePostCallAnalysis(sessionEmail, record.id, (rec) => {
          rec.pass6 = pass6 || rec.pass6 || null;
          rec.result = { ...(rec.result || {}), arrInputs, arrCompute, pass6, timeline };
          return rec;
        });
        onCallRecordHydrated?.(record.id);
      } catch (err) {
        console.warn("[postcall] background hydration failed:", err?.message || err);
      }
    })();
  } catch (err) {
    showPipelineProgress([
      { label: "Resolve recording and match deal", status: "done" },
      { label: "Classify call type", status: "done" },
      { label: "Generate analysis", status: "error" },
    ]);
    show($("postcall-confirm-view"), true);
    show($("postcall-loading"), false);
    showInlineStatus(status, { type: "error", message: err.message || "Generation failed." });
  } finally {
    setButtonLoading(btn, false);
  }
}

function restartPipeline(e) {
  e?.preventDefault?.();
  resetPostCallView();
}

const PC_TEXT_FIELD_IDS = [
  "pc-recording-url",
  "pc-recording-pwd",
  "pc-prospect-emails",
  "pc-company-name",
  "pc-deck-link",
  "pc-additional-context",
  "pc-transcript",
];

/** Blank every post-call intake field so "New post call" starts genuinely empty. */
export function clearPostCallForm() {
  for (const id of PC_TEXT_FIELD_IDS) {
    const el = $(id);
    if (!el) continue;
    try { el.value = ""; } catch { /* crayons guard */ }
    setFieldError(el);
  }

  const suggest = $("pc-company-suggest");
  if (suggest) { suggest.innerHTML = ""; suggest.hidden = true; }
  const note = $("pc-company-lookup-note");
  if (note) { note.textContent = ""; note.hidden = true; }

  const fileInput = $("pc-transcript-file");
  if (fileInput) fileInput.value = "";
  const fileName = $("pc-transcript-file-name");
  if (fileName) fileName.hidden = true;
  const fileErr = $("pc-transcript-file-error");
  if (fileErr) fileErr.hidden = true;

  const fallback = $("pc-transcript-fallback");
  if (fallback) fallback.open = false;

  clearLinkedInAttachments("postcall");
  companyNameTouched = false;
  pcResolvedAccount = null;
  pcCreateNewAccount = false;
  syncPasscodeVisibility();
}

/** Reset post-call UI for a fresh analysis (e.g. nav back from call record). */
export function resetPostCallView() {
  pipelineState = null;
  clearPostCallForm();
  show($("postcall-confirm-view"), false);
  show($("postcall-progress"), false);
  show($("postcall-result"), false);
  show($("postcall-loading"), false);
  show($("postcall-form-view"), true);
  showInlineStatus($("postcall-status"), { open: false });
  setFormFieldsDisabled($("postcall-form"), false);
  setButtonLoading($("analyze-call"), false);
}

export function isPostCallGenerationBusy() {
  const loadingEl = $("postcall-loading");
  return !!loadingEl && !loadingEl.hidden;
}

async function collectIntakePayload() {
  const recordingField = $("pc-recording-url");
  const companyField = $("pc-company-name");
  const emailsField = $("pc-prospect-emails");
  const { recordingUrl, recordingPassword } = parseRecordingInput(
    await readFieldValueAsync(recordingField),
    await readFieldValueAsync($("pc-recording-pwd")),
  );
  const companyName = (await readFieldValueAsync(companyField))?.trim() || "";
  const prospectEmailsRaw = (await readFieldValueAsync(emailsField))?.trim() || "";
  const prospectEmails = parseProspectEmails(prospectEmailsRaw);
  const transcript = (await readFieldValueAsync($("pc-transcript")))?.trim() || "";
  const deckLink = (await readFieldValueAsync($("pc-deck-link")))?.trim() || undefined;
  const additionalContext =
    (await readFieldValueAsync($("pc-additional-context")))?.trim() || undefined;
  const linkedinProfileExports = linkedinProfileExportsForPayload("postcall");
  // SEs are obliged to visual analysis by policy — no per-call checkbox.
  // Kept in the payload because the worker (Pass 2 + scorecard camera_on) reads it.
  const visualAnalysisConsent = true;

  setFieldError(recordingField);
  setFieldError(companyField);
  setFieldError(emailsField);

  if (!recordingUrl && !transcript) {
    const message = "Paste a Zoom/Kaia recording link, or a transcript below.";
    setFieldError(recordingField, message);
    return { error: message };
  }
  if (!companyName) {
    const message = "Company name is required.";
    setFieldError(companyField, message);
    return { error: message };
  }
  if (!prospectEmails.length) {
    const message = "Add at least one prospect email (comma separated).";
    setFieldError(emailsField, message);
    return { error: message };
  }

  return {
    payload: {
      recordingUrl: recordingUrl || undefined,
      recordingPassword: recordingUrl ? recordingPassword : undefined,
      transcript: transcript || undefined,
      companyName,
      prospectEmails,
      participantEmails: prospectEmails,
      deckLink,
      additionalContext,
      linkedinProfileExports,
      linkedinProfileExportsStored: linkedinProfileExportsForStorage("postcall"),
      visualAnalysisConsent,
      accountId: pcResolvedAccount?.id || undefined,
      createNewAccount: pcCreateNewAccount || undefined,
    },
  };
}

async function startPipeline(e) {
  e?.preventDefault?.();
  if (linkedinParsing) return;
  const btn = $("analyze-call");
  const status = $("postcall-status");

  const collected = await collectIntakePayload();
  if (collected.error) {
    showInlineStatus(status, { type: "error", message: collected.error });
    return;
  }
  const { payload } = collected;
  pipelineState = { payload, resolve: null, classify: null, generated: false, recordId: null };

  setButtonLoading(btn, true);
  setFormFieldsDisabled($("postcall-form"), true);
  show($("postcall-result"), false);
  show($("postcall-confirm-view"), false);
  show($("postcall-loading"), false);
  showPipelineProgress([
    { label: "Resolve recording and match deal", status: "active" },
    { label: "Classify call type", status: "pending" },
    { label: "Generate analysis", status: "pending" },
  ]);
  showInlineStatus(status, {
    type: "info",
    message: "Pass 0: fetching transcript and matching account…",
    loading: true,
  });

  try {
    const ownerId = effectiveSessionUserId(currentSession) || undefined;
    const domainContext = ownerId
      ? await buildPostCallResolveContext(ownerId)
      : { briefs: [], accounts: [], deals: [] };
    const resolve = await postJson(RESOLVE_URL, {
      transcript: payload.transcript,
      recordingUrl: payload.recordingUrl,
      recordingPassword: payload.recordingPassword,
      companyName: payload.companyName,
      participantEmails: payload.participantEmails,
      accountId: payload.accountId,
      ownerId,
      ownerEmail: currentSession?.email || undefined,
      ownerDisplayName: currentSession?.name || currentSession?.displayName || undefined,
      briefs: domainContext.briefs,
      accounts: domainContext.accounts,
      deals: domainContext.deals,
    });
    pipelineState.resolve = resolve;
    // Prefer form company when resolve did not match; keep for generate.
    if (!payload.companyName && resolve.account?.accountName) {
      payload.companyName = resolve.account.accountName;
    }

    showPipelineProgress([
      { label: "Resolve recording and match deal", status: "done" },
      { label: "Classify call type", status: "active" },
      { label: "Generate analysis", status: "pending" },
    ]);
    showInlineStatus(status, {
      type: "info",
      message: "Pass 1: classifying call type from transcript…",
      loading: true,
    });

    const classify = await postJson(CLASSIFY_URL, {
      transcript: resolve.transcript,
      meetingTitle: resolve.meetingTitle,
    });
    pipelineState.classify = classify;

    showPipelineProgress([
      { label: "Resolve recording and match deal", status: "done" },
      { label: "Classify call type", status: "done" },
      { label: "Generate analysis", status: "pending" },
    ]);
    showInlineStatus(status, { open: false });
    showConfirmationGate(resolve, classify);
  } catch (err) {
    const msg = err.message || "Something went wrong.";
    showPipelineProgress([
      { label: "Resolve recording and match deal", status: "error" },
      { label: "Classify call type", status: "pending" },
      { label: "Generate analysis", status: "pending" },
    ]);
    if (msg === "Failed to fetch" || /^networkerror/i.test(msg) || /load failed/i.test(msg)) {
      showInlineStatus(status, {
        type: "error",
        message:
          `Cannot reach the API server at ${WORKER_BASE_URL}. ` +
          "Start the worker in another terminal and refresh.",
      });
    } else {
      showInlineStatus(status, { type: "error", message: msg });
    }
    setFormFieldsDisabled($("postcall-form"), false);
  } finally {
    setButtonLoading(btn, false);
  }
}

async function analyzeCall(e) {
  return startPipeline(e);
}

export function onSessionReady(session, tokenFn) {
  currentSession = session?.email
    ? { ...session, email: String(session.email).trim().toLowerCase() }
    : session;
  getAuthToken = tokenFn || null;
}

export function onSessionCleared() {
  currentSession = null;
  getAuthToken = null;
  pipelineState = null;
  companyNameTouched = false;
  pcResolvedAccount = null;
  pcCreateNewAccount = false;
  invalidatePostCallResolveContext();
  clearLinkedInAttachments("postcall");
  show($("postcall-form-view"), true);
  show($("postcall-result"), false);
  show($("postcall-confirm-view"), false);
  show($("postcall-progress"), false);
}

export function initPostcall() {
  $("postcall-form")?.addEventListener("submit", (e) => { void analyzeCall(e); });
  $("analyze-call")?.addEventListener("fwClick", (e) => { void analyzeCall(e); });

  const recordingUrl = $("pc-recording-url");
  recordingUrl?.addEventListener("fwInput", syncPasscodeVisibility);
  recordingUrl?.addEventListener("input", syncPasscodeVisibility);
  recordingUrl?.addEventListener("fwBlur", syncPasscodeVisibility);
  syncPasscodeVisibility();

  const recordingPwd = $("pc-recording-pwd");
  recordingPwd?.addEventListener("fwInput", syncPasscodeVisibility);
  recordingPwd?.addEventListener("input", syncPasscodeVisibility);

  const transcriptFile = $("pc-transcript-file");
  const transcriptFileBtn = $("pc-transcript-file-btn");
  transcriptFileBtn?.addEventListener("fwClick", () => transcriptFile?.click());
  transcriptFileBtn?.addEventListener("click", () => transcriptFile?.click());
  transcriptFile?.addEventListener("change", (e) => { void handleTranscriptFileChange(e); });

  const companyEl = $("pc-company-name");
  companyEl?.addEventListener("fwInput", () => { if (!suppressCompanyTouch) companyNameTouched = true; });
  companyEl?.addEventListener("input", () => { if (!suppressCompanyTouch) companyNameTouched = true; });

  const emailsEl = $("pc-prospect-emails");
  emailsEl?.addEventListener("fwBlur", () => { void prefillCompanyFromEmails(); });
  emailsEl?.addEventListener("blur", () => { void prefillCompanyFromEmails(); });
  emailsEl?.addEventListener("fwInput", scheduleCompanyPrefill);
  emailsEl?.addEventListener("input", scheduleCompanyPrefill);

  attachAccountLookup({
    inputEl: $("pc-company-name"),
    menuEl: $("pc-company-suggest"),
    noteEl: $("pc-company-lookup-note"),
    onPick: (account, typedName) => {
      const companyEl = $("pc-company-name");
      if (companyEl) {
        suppressCompanyTouch = true;
        companyEl.value = typedName;
        window.setTimeout(() => { suppressCompanyTouch = false; }, 0);
      }
      companyNameTouched = true;
    },
  });

  initLinkedInPdfUpload({
    bag: "postcall",
    fileInputId: "pc-linkedin-pdfs",
    addBtnId: "pc-linkedin-add-btn",
    listElId: "pc-linkedin-file-list",
    errElId: "pc-linkedin-error",
    parsingElId: "pc-linkedin-parsing",
    setParsing: (on) => {
      linkedinParsing = on;
      const btn = $("analyze-call");
      if (btn) btn.disabled = on;
      const addBtn = $("pc-linkedin-add-btn");
      if (addBtn) addBtn.disabled = on;
    },
  });
}
