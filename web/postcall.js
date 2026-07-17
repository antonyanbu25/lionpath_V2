import { WORKER_BASE_URL } from "./firebase-config.js";
import { authMode } from "./auth.js";
import { savePostCallHistory, normalizeUserEmail } from "./history.js";
import { normalizeQualityCoach } from "./quality-score.js";
import { readFieldValue, readFieldValueAsync, setFormFieldsDisabled, wirePrintToolbar, wireToolbarById } from "./crayons-ui.js";

const ANALYZE_URL = `${WORKER_BASE_URL}/api/analyze-call`;

let currentSession = null;
let getAuthToken = null;

const $ = (id) => document.getElementById(id);
const show = (el, on = true) => { el.hidden = !on; };

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

async function authHeaders() {
  const headers = { "content-type": "application/json" };
  if (authMode() === "firebase" && getAuthToken) {
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

function momentumClass(status) {
  if (status === "Advancing") return "momentum-advancing";
  if (status === "At risk") return "momentum-risk";
  return "momentum-stalled";
}

function momentumArrow(status) {
  if (status === "Advancing") return "↑";
  if (status === "At risk") return "↓";
  return "→";
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
  return RADAR_DIMENSION_LABELS[normalizeDimensionKey(name)] || String(name ?? "");
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
          <p class="muted qc-hero-hint">Quality score — separate from deal momentum above.</p>
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
      <summary>Details — full scorecard</summary>
      <div class="qc-scorecard">
        <div class="qc-dim-list">${renderDimensionRows(dims)}</div>
      </div>
    </details>`;
}

function renderLegacyPostCall(data, meta) {
  const a = data.analysis;
  const cs = a.callSummary || {};
  return `
    <div class="status err">This analysis uses an older format. Re-run analysis for the new post-call one-pager.</div>
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

/** Normalize v4 + partial v5 payloads before render. */
function normalizeAnalysisForRender(raw) {
  if (!raw) return null;
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
  };
}

export function renderPostCall(data, meta = {}) {
  const raw = data?.analysis;
  if (!raw) {
    return `<div class="status err">No analysis data returned. Try running analysis again.</div>`;
  }
  if (!raw?.callHeader && raw?.callSummary && !raw?.momentum?.status) {
    return renderLegacyPostCall(data, meta);
  }

  const a = normalizeAnalysisForRender(raw);
  const hdr = a.callHeader;
  const mom = a.momentum;
  const sig = a.signals;
  const arts = a.artifacts;
  const tm = data.transcriptMeta || {};

  const attendeeChips = hdr.attendees.length
    ? hdr.attendees
        .map((x) => {
          const parts = [`<span class="attendee-chip">${influenceDot(x.influence)}${dash(x.name)}`];
          if (!isUnknown(x.role)) parts.push(`<span class="chip-role">${truncateWords(x.role, 8)}</span>`);
          parts.push("</span>");
          return parts.join(" · ");
        })
        .join("")
    : '<span class="muted">—</span>';

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
    : '<p class="muted">—</p>';

  const signalCol = (items) => {
    const list = (items || []).filter((x) => !isUnknown(x)).slice(0, 4);
    return list.length
      ? `<ul class="signal-list">${list.map((x) => `<li>${truncateWords(x, 12)}</li>`).join("")}</ul>`
      : '<p class="muted">—</p>';
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
    : '<p class="muted">—</p>';

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
    <section><h2>Quality coach</h2>${renderQualityCoach(a.qualityCoach)}</section>
    <footer class="prep-footer">${followUpEmail}${crmBlock}${transcriptDetails}</footer>`;
}

export function displayPostCall(data, meta) {
  const result = $("postcall-result");
  if (!result) return;
  result.classList.remove("anim-root", "anim-ready");
  try {
    result.innerHTML = renderPostCall(data, meta);
  } catch (err) {
    console.error("[postcall] render failed:", err);
    result.innerHTML = `<div class="status err">${esc(err.message || "Could not render analysis.")}</div>`;
  }
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

let onAnalysisSaved = null;

/** @param {(record: object) => void} fn */
export function setOnAnalysisSaved(fn) {
  onAnalysisSaved = fn;
}

async function analyzeCall(e) {
  e?.preventDefault?.();
  const btn = $("analyze-call");
  const status = $("postcall-status");
  const { recordingUrl, recordingPassword } = parseRecordingInput(
    await readFieldValueAsync($("pc-recording-url")),
    await readFieldValueAsync($("pc-recording-pwd")),
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
  setFormFieldsDisabled(form, true);

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

    meta.title = getCallTitle(data.analysis, meta);
    displayPostCall(data, meta);
    show(status, false);

    if (currentSession?.email) {
      const email = normalizeUserEmail(currentSession.email);
      const record = await savePostCallHistory(email, payload, data);
      if (record) onAnalysisSaved?.(record);
    } else {
      console.warn("[postcall] analysis not saved — no logged-in SE session");
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
    setFormFieldsDisabled($("postcall-form"), false);
  }
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
  show($("postcall-form-view"), true);
  show($("postcall-result"), false);
}

function boot() {
  $("postcall-form")?.addEventListener("submit", (e) => { void analyzeCall(e); });
  $("analyze-call")?.addEventListener("fwClick", (e) => { void analyzeCall(e); });
}

boot();
