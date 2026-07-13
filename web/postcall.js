import { firebaseConfig, WORKER_BASE_URL } from "./firebase-config.js";
import { savePostCallAnalysis } from "./history.js";
import { normalizeQualityCoach } from "./quality-score.js";

const authEnabled = !!firebaseConfig.projectId;
const ANALYZE_URL = `${WORKER_BASE_URL}/api/analyze-call`;

let currentSession = null;
let getAuthToken = null;

const $ = (id) => document.getElementById(id);
const show = (el, on = true) => { el.hidden = !on; };

function esc(v) {
  return String(v ?? "").replace(/[&<>"']/g, (c) =>
    ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
}

async function authHeaders() {
  const headers = { "content-type": "application/json" };
  if (authEnabled && getAuthToken) {
    const token = await getAuthToken();
    if (token) headers["Authorization"] = `Bearer ${token}`;
  }
  return headers;
}

/** Parse "https://…/rec/share/… Passcode: abc" from one paste field. */
function parseRecordingInput(rawUrl, rawPwd) {
  let url = rawUrl.trim();
  let password = rawPwd.trim();

  const passMatch = url.match(/\s+passcode\s*:\s*(.+)$/i);
  if (passMatch) {
    url = url.slice(0, passMatch.index).trim();
    if (!password) password = passMatch[1].trim();
  }

  return { recordingUrl: url, recordingPassword: password || undefined };
}

function priorityClass(p) {
  const v = String(p || "").toLowerCase();
  if (v === "high") return "pill high";
  if (v === "low") return "pill low";
  return "pill med";
}

function barClass(score, max = 5) {
  const pct = score / max;
  if (pct >= 0.8) return "good";
  if (pct >= 0.6) return "ok";
  return "weak";
}

function scorePct(score, max) {
  if (!max) return 0;
  return Math.min(100, Math.max(0, (score / max) * 100));
}

function renderScoreGauge(score, max = 10) {
  const r = 52;
  const c = 2 * Math.PI * r;
  const dash = c * (score / max);
  const cls = barClass(score, max);
  return `
    <div class="qc-gauge" role="img" aria-label="Overall score ${esc(score)} out of ${esc(max)}">
      <svg class="qc-gauge-svg" viewBox="0 0 120 120" aria-hidden="true">
        <circle class="qc-gauge-track" cx="60" cy="60" r="${r}" />
        <circle class="qc-gauge-fill ${cls}" cx="60" cy="60" r="${r}"
          stroke-dasharray="${dash} ${c}" transform="rotate(-90 60 60)" />
      </svg>
      <div class="qc-gauge-text">
        <span class="qc-gauge-score ${cls}">${esc(score)}</span>
        <span class="qc-gauge-denom">/${esc(max)}</span>
      </div>
    </div>`;
}

const RADAR_DIMENSION_LABELS = {
  discovery: "Discovery",
  demoalignment: "Demo alignment",
  objections: "Objections",
  valuearticulation: "Value articulation",
  nextstepclarity: "Next-step clarity",
  talkbalance: "Talk balance",
};

function normalizeDimensionKey(name) {
  return String(name ?? "").replace(/[\s_-]/g, "").toLowerCase();
}

function radarDimensionLabel(name) {
  const mapped = RADAR_DIMENSION_LABELS[normalizeDimensionKey(name)];
  return mapped || String(name ?? "");
}

function radarLabelAnchor(angle) {
  const cos = Math.cos(angle);
  const sin = Math.sin(angle);
  let anchor = "middle";
  if (cos > 0.25) anchor = "start";
  else if (cos < -0.25) anchor = "end";
  let baseline = "middle";
  if (sin > 0.35) baseline = "hanging";
  else if (sin < -0.35) baseline = "alphabetic";
  return { anchor, baseline };
}

function wrapRadarLabelLines(label) {
  if (label.length <= 14) return [label];
  const lastSpace = label.lastIndexOf(" ");
  if (lastSpace > 0) return [label.slice(0, lastSpace), label.slice(lastSpace + 1)];
  const hyphenIdx = label.indexOf("-");
  if (hyphenIdx > 0 && hyphenIdx < label.length - 1) {
    return [label.slice(0, hyphenIdx + 1), label.slice(hyphenIdx + 1).trim()];
  }
  return [label];
}

function renderRadarLabelText(label, x, y, angle) {
  const lines = wrapRadarLabelLines(label);
  const { anchor, baseline } = radarLabelAnchor(angle);
  if (lines.length === 1) {
    return `<text class="qc-radar-label" x="${x}" y="${y}" text-anchor="${anchor}" dominant-baseline="${baseline}">${esc(lines[0])}</text>`;
  }
  const lineHeight = 1.15;
  const startDy = baseline === "middle" ? `${-0.55 * lineHeight}em` : "0";
  const tspans = lines
    .map((line, i) => `<tspan x="${x}" dy="${i === 0 ? startDy : `${lineHeight}em`}">${esc(line)}</tspan>`)
    .join("");
  return `<text class="qc-radar-label" x="${x}" y="${y}" text-anchor="${anchor}" dominant-baseline="${baseline}">${tspans}</text>`;
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
      const label = radarDimensionLabel(d.name);
      return `
        <line class="qc-radar-axis" x1="${cx}" y1="${cy}" x2="${x2}" y2="${y2}" />
        ${renderRadarLabelText(label, lx, ly, angle)}`;
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
      <svg class="qc-radar" viewBox="0 0 260 260" role="img" aria-label="Radar chart of coaching dimension scores">
        ${rings}
        ${axes}
        <polygon class="qc-radar-data" points="${dataPts.join(" ")}" />
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
            <p class="qc-dim-feedback">${esc(d.feedback)}</p>
            <blockquote class="qc-dim-evidence"><span class="qc-ev-label">Evidence</span>${esc(d.evidence)}</blockquote>
          </div>
        </details>`;
    })
    .join("");
}

function renderInsightCards(items, title, tone) {
  const list = (items || []).length
    ? `<ul>${(items || []).map((i) => `<li>${esc(i)}</li>`).join("")}</ul>`
    : '<p class="muted">None noted.</p>';
  return `
    <div class="qc-insight qc-insight-${tone}">
      <h4>${esc(title)}</h4>
      ${list}
    </div>`;
}

function renderQualityCoach(qc) {
  const normalized = normalizeQualityCoach(qc);
  const dims = normalized.dimensions || [];
  return `
    <section class="qc-section">
      <h2>Quality coach</h2>
      <div class="qc-dashboard">
        <div class="qc-hero">
          ${renderScoreGauge(normalized.overallScore, 10)}
          <div class="qc-hero-meta">
            <span class="qc-overall-label">${esc(normalized.overallLabel)}</span>
            <p class="muted qc-hero-hint">Tap a dimension below for feedback and transcript evidence.</p>
          </div>
        </div>
        ${renderRadarChart(dims)}
      </div>
      <div class="qc-scorecard">
        <h3>Scorecard</h3>
        <div class="qc-dim-list">${renderDimensionRows(dims)}</div>
      </div>
      <div class="qc-insights">
        ${renderInsightCards(normalized.strengths, "Strengths", "good")}
        ${renderInsightCards(normalized.improvements, "Improvements", "ok")}
        ${renderInsightCards(normalized.missedOpportunities, "Missed opportunities", "weak")}
      </div>
    </section>`;
}

export function renderPostCall(data, meta = {}) {
  const a = data.analysis;
  const cs = a.callSummary;
  const ns = a.nextSteps;
  const qc = a.qualityCoach;
  const tm = data.transcriptMeta || {};

  const attendees = (cs.attendees || []).length
    ? `<table><tr><th>Name</th><th>Role</th><th>Engagement</th></tr>${(cs.attendees || [])
        .map((x) => `<tr><td>${esc(x.name)}</td><td>${esc(x.role)}</td><td>${esc(x.engagement)}</td></tr>`)
        .join("")}</table>`
    : '<p class="muted">No attendees identified.</p>';

  const list = (items) =>
    (items || []).length
      ? `<ul>${(items || []).map((i) => `<li>${esc(i)}</li>`).join("")}</ul>`
      : '<p class="muted">None noted.</p>';

  const seActions = (ns.seActions || []).length
    ? `<table><tr><th>Action</th><th>Priority</th><th>Due</th><th>Why</th></tr>${(ns.seActions || [])
        .map((x) => `<tr><td>${esc(x.action)}</td><td><span class="${priorityClass(x.priority)}">${esc(x.priority)}</span></td><td>${esc(x.dueHint)}</td><td>${esc(x.rationale)}</td></tr>`)
        .join("")}</table>`
    : '<p class="muted">No SE actions.</p>';

  const metaLine = [
    meta.title,
    tm.durationMinutes != null ? `~${tm.durationMinutes} min` : "",
    tm.wordCount ? `${tm.wordCount} words` : "",
  ].filter(Boolean).map(esc).join(" · ");

  return `
    <div class="toolbar">
      <button class="ghost" onclick="window.print()">Print / PDF</button>
      <button class="ghost" id="copy-postcall-json">Copy JSON</button>
      <button class="ghost" id="copy-followup">Copy follow-up email</button>
    </div>
    <div class="head">
      <h2 style="border:none">${esc(cs.headline || meta.title || "Call analysis")}</h2>
      <span class="sub">${metaLine}</span>
    </div>

    <section>
      <h2>Call summary</h2>
      <p>${esc(cs.customerContext)}</p>
      <h3>Attendees</h3>${attendees}
      <h3>Key topics</h3>${list(cs.keyTopics)}
      <h3>Pain points confirmed</h3>${list(cs.painPointsConfirmed)}
      <h3>Objections raised</h3>${list(cs.objectionsRaised)}
      <h3>Competitive mentions</h3>${list(cs.competitiveMentions)}
      <h3>Decisions made</h3>${list(cs.decisionsMade)}
      <h3>Open questions</h3>${list(cs.openQuestions)}
    </section>

    <section>
      <h2>Next steps</h2>
      <h3>SE actions</h3>${seActions}
      <h3>AE actions</h3>${list((ns.aeActions || []).map((x) => `${x.action} (${x.priority}) — ${x.rationale}`))}
      <h3>Customer commitments</h3>${list(ns.customerCommitments)}
      <h3>Suggested follow-up email</h3>
      <div class="email-draft">
        <p><strong>Subject:</strong> ${esc(ns.suggestedFollowUpEmail?.subject)}</p>
        <pre>${esc(ns.suggestedFollowUpEmail?.body)}</pre>
      </div>
      <h3>CRM notes</h3>
      <p class="crm-notes">${esc(ns.crmNotes)}</p>
    </section>

    ${renderQualityCoach(qc)}`;
}

export function displayPostCall(data, meta) {
  const result = $("postcall-result");
  result.innerHTML = renderPostCall(data, meta);
  show(result, true);
  const copyJson = $("copy-postcall-json");
  if (copyJson) copyJson.onclick = () => navigator.clipboard.writeText(JSON.stringify(data, null, 2));
  const copyEmail = $("copy-followup");
  if (copyEmail) {
    copyEmail.onclick = () => {
      const e = data.analysis?.nextSteps?.suggestedFollowUpEmail;
      if (e) navigator.clipboard.writeText(`Subject: ${e.subject}\n\n${e.body}`);
    };
  }
  result.scrollIntoView({ behavior: "smooth", block: "start" });
}

let onAnalysisSaved = null;

/** @param {(record: object) => void} fn */
export function setOnAnalysisSaved(fn) {
  onAnalysisSaved = fn;
}

async function analyzeCall(e) {
  e.preventDefault();
  const btn = $("analyze-call");
  const status = $("postcall-status");
  const { recordingUrl, recordingPassword } = parseRecordingInput(
    $("pc-recording-url").value,
    $("pc-recording-pwd").value,
  );

  if (!recordingUrl) {
    status.className = "status err";
    status.textContent = "Paste a Zoom recording link.";
    show(status, true);
    return;
  }

  const payload = { recordingUrl, recordingPassword };
  const meta = { title: "" };

  btn.disabled = true;
  status.className = "status";
  status.textContent = "Fetching transcript from Zoom, then analyzing… usually 10–25 seconds. Please wait.";
  show(status, true);
  show($("postcall-result"), false);
  const form = $("postcall-form");
  form?.querySelectorAll("input, textarea, button").forEach((el) => { el.disabled = true; });

  try {
    const res = await fetch(ANALYZE_URL, {
      method: "POST",
      headers: await authHeaders(),
      body: JSON.stringify(payload),
    });
    const raw = await res.text();
    let data;
    try {
      data = JSON.parse(raw);
    } catch {
      throw new Error(raw.slice(0, 300) || `Request failed (${res.status}).`);
    }
    if (!res.ok) throw new Error(data.error || `Request failed (${res.status}).`);

    meta.title = data.analysis?.callSummary?.headline || "";
    displayPostCall(data, meta);
    show(status, false);

    if (currentSession?.email) {
      const record = savePostCallAnalysis(currentSession.email, payload, data);
      onAnalysisSaved?.(record);
    }
  } catch (err) {
    status.className = "status err";
    const msg = err.message || "Something went wrong.";
    if (msg === "Failed to fetch" || /network|fetch/i.test(msg)) {
      status.textContent =
        `Cannot reach the API server at ${WORKER_BASE_URL}. ` +
        "Start the worker in another terminal: cd worker → npm.cmd run dev (look for Ready on port 8787). " +
        "Use the same hostname for web and worker (both localhost or both 127.0.0.1), then refresh.";
    } else {
      status.textContent = msg;
    }
  } finally {
    btn.disabled = false;
    $("postcall-form")?.querySelectorAll("input, textarea, button").forEach((el) => { el.disabled = false; });
  }
}

export function onSessionReady(session, tokenFn) {
  currentSession = session;
  getAuthToken = tokenFn || null;
}

export function onSessionCleared() {
  currentSession = null;
  getAuthToken = null;
  show($("postcall-result"), false);
}

function boot() {
  $("postcall-form")?.addEventListener("submit", analyzeCall);
}

boot();
