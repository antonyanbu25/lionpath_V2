/** Pure HTML builders for pre-call wireframe (v8 brief). */

import { resolveCustomerReferenceUrl } from "./customer-reference-links.js";
import { esc } from "./shared.js";
import { EMPTY_DISPLAY } from "./shared.js";

const isUnknown = (v) => {
  const s = String(v || "").trim();
  if (!s) return true;
  if (s.toLowerCase() === "unknown") return true;
  return s === "-" || s === "-" || s === "–";
};
const dash = (v, unverified = false) => {
  if (isUnknown(v)) return `<span class="muted">${EMPTY_DISPLAY}</span>`;
  if (unverified) return `<span class="prep-unverified">${esc(v)} <span class="prep-unverified-tag">Unverified</span></span>`;
  return esc(v);
};

function isUnverifiedSource(sources, sourceLabel) {
  if (isSeNotesSource(sourceLabel)) return false;
  const src = sources?.find((s) => s.label === sourceLabel);
  if (!src) return true;
  const url = String(src.url || "").trim().toLowerCase();
  if (!url || url === "unknown") return true;
  return Number(src.confidence) < 55;
}

/** SE additional-context source. show as "Your notes", not Unverified. */
export function isSeNotesSource(sourceLabel) {
  return String(sourceLabel || "").trim().toUpperCase() === "SE";
}

export function countPopulatedSignals(signals, sources) {
  return (signals || []).filter((s) => {
    if (isUnknown(s.value)) return false;
    if (!sources?.length) return true;
    if (isSeNotesSource(s.sourceLabel)) return true;
    return !isUnverifiedSource(sources, s.sourceLabel);
  }).length;
}

function trustNotesBadge() {
  return '<span class="prep-trust-badge prep-trust-notes">Your notes</span>';
}

function sourceOrTrustBadge(sourceLabel, conf, idx, sources) {
  if (isSeNotesSource(sourceLabel)) return trustNotesBadge();
  return sourceBadge(sourceLabel, conf, idx >= 0 ? idx : 0);
}

export const SIGNAL_TOOLTIPS = {
  "Incumbent tool":
    "Current helpdesk or CX platform inferred from help center URLs, job posts, or public stack mentions.",
  Integrations:
    "CRM, billing, or ops tools the support team likely connects to. Probe integration pain in discovery.",
  "Web chat widget":
    "Whether live chat or messaging is exposed on their site. Signals omnichannel maturity and widget swap opportunity.",
  "AI in their current tech stack":
    "Existing AI bots, copilots, or automation in their support stack (not Freshworks). Use to position Freddy differentiation.",
  "Support portal":
    "Self-service KB or customer portal vendor. Indicates deflection motion and content migration scope.",
  "Hiring support roles":
    "Open support or CX hiring. Often signals growth, turnover, or tooling change windows.",
};

export function isV7Prep(p) {
  return !!(p?.about && Array.isArray(p?.facts) && Array.isArray(p?.signals) && p.signals.length >= 1);
}

export function isV8Prep(p) {
  return isV7Prep(p) && Array.isArray(p?.prospects) && p.prospects.length >= 1;
}

export function isV6Prep(p) {
  if (p?.supportMaturity || p?.businessContext?.signals || p?.businessContext?.workflows) return false;
  if (isV7Prep(p)) return false;
  return !!(
    p?.incumbent?.displacement &&
    p?.companySizeAgents &&
    p?.businessContext?.market &&
    Array.isArray(p?.fitSnapshot) &&
    p.fitSnapshot.length >= 1
  );
}

export function confidenceMeta(conf) {
  const n = Number(conf);
  if (n >= 80) return { word: "High", color: "var(--dew-green)", tier: "high", pct: n };
  if (n >= 55) return { word: "Medium", color: "var(--dew-amber)", tier: "medium", pct: n };
  return { word: "Low", color: "var(--dew-red)", tier: "low", pct: n };
}

export function companyMono(name) {
  const parts = String(name || "")
    .trim()
    .split(/\s+/)
    .filter(Boolean);
  if (parts.length >= 2) return (parts[0][0] + parts[1][0]).toUpperCase();
  const w = parts[0] || "?";
  return w.slice(0, 2).toUpperCase();
}

function dewCssVar(name, fallback) {
  if (typeof document === "undefined") return fallback;
  const v = getComputedStyle(document.documentElement).getPropertyValue(name).trim();
  return v || fallback;
}

export function logoGradient(name) {
  const hash = String(name || "")
    .split("")
    .reduce((a, c) => a + c.charCodeAt(0), 0);
  const primary = dewCssVar("--dew-primary", "#1266f1");
  const brand = dewCssVar("--dew-brand", "#6747d4");
  const green = dewCssVar("--dew-green", "#0aa06e");
  const amber = dewCssVar("--dew-amber", "#f79009");
  const red = dewCssVar("--dew-red", "#e5484d");
  const hues = [
    `linear-gradient(135deg,${primary},${brand})`,
    `linear-gradient(135deg,${green},${primary})`,
    `linear-gradient(135deg,${amber},${red})`,
    `linear-gradient(135deg,${brand},${primary})`,
  ];
  return hues[hash % hues.length];
}

function sourceBadge(label, conf, idx) {
  const meta = confidenceMeta(conf);
  return `<button type="button" class="prep-src-badge" data-src-idx="${idx}" aria-label="Source ${esc(label)}">
    ${esc(label)}<span class="prep-src-dot" style="background:${meta.color}"></span>
  </button>`;
}

/** Map discHint.confidence to hero chip suffix (e.g. "Confident - Low"). */
export function discConfidenceLabel(confidence) {
  const tier = { low: "Low", medium: "Medium", high: "High" }[confidence] || "Low";
  return `Confident - ${tier}`;
}

/** Friendly DISC inference line from enrichment source (discHint.source). */
export function discInferredLabel(source) {
  switch (source) {
    case "linkedin_pdf":
      return "Inferred from LinkedIn PDF, not a formal assessment";
    case "kaia":
      return "Inferred from Kaia meeting, not a formal assessment";
    case "merged":
      return "Inferred from LinkedIn + Kaia, not a formal assessment";
    case "zoom":
      return "Inferred from Zoom transcript, not a formal assessment";
    default:
      return "Inferred from LinkedIn, not a formal assessment";
  }
}

function prospectUsesKaia(p) {
  const src = p.discHint?.source;
  if (src === "kaia" || src === "merged") return true;
  return /kaia/i.test(String(p.sourceLabel || ""));
}

function prospectSourceBadges(p, src, sources, renderOpts = {}) {
  const primaryLabel = p.sourceLabel || src?.label || "S1";
  const conf = src?.confidence ?? 50;
  const idx = Math.max(0, sources.indexOf(src));
  let html = sourceBadge(primaryLabel, conf, idx);
  if (renderOpts.kaiaFetched && !prospectUsesKaia(p)) {
    html += `<span class="prep-src-badge prep-kaia-indicator" title="Kaia meeting linked for this brief">Kaia</span>`;
  }
  return html;
}

function sectionHead(title, dotColor) {
  return `<div class="prep-section-head">
    <span class="prep-section-dot" style="background:${dotColor}"></span>
    <span class="dew-mono-label">${esc(title)}</span>
  </div>`;
}

function signalLabelWithTooltip(label) {
  const tip = SIGNAL_TOOLTIPS[label] || "";
  if (!tip) return esc(label);
  return `<fw-tooltip content="${esc(tip)}">
    <span class="prep-signal-label-wrap">
      <span>${esc(label)}</span>
      <fw-icon name="info" size="12" class="prep-signal-info" aria-label="About this signal"></fw-icon>
    </span>
  </fw-tooltip>`;
}

function icpVerdictClass(verdict) {
  if (verdict === "Strong") return "good";
  if (verdict === "Moderate") return "ok";
  if (verdict === "Weak") return "weak";
  return "muted";
}

function renderIcpFitment(icpFit, sources) {
  if (!icpFit) return "";
  const verdictCls = icpVerdictClass(icpFit.verdict);
  const score =
    typeof icpFit.score === "number" && Number.isFinite(icpFit.score)
      ? `<span class="prep-icp-score muted">${icpFit.score}/100</span>`
      : "";
  const highlights = (icpFit.highlights || [])
    .map((h) => `<li>${dash(h)}</li>`)
    .join("");
  const gaps = (icpFit.gaps || [])
    .map((g) => `<li>${dash(g)}</li>`)
    .join("");
  const refs = (icpFit.frameworkRefs || []).filter((r) => !isUnknown(r));
  const refChips = refs.length
    ? `<div class="prep-icp-ref-chips">${refs.map((r) => `<span class="prep-icp-ref-chip">${dash(r)}</span>`).join("")}</div>`
    : "";
  const hasDetails = highlights || gaps || refChips;
  const src = sources[0];
  const srcBadge = src ? sourceBadge(src.label, src.confidence, 0) : "";
  return `<div class="prep-icp-block">
    <div class="prep-icp-head">
      <span class="dew-mono-label">ICP fitment</span>
      <span class="prep-icp-product">${esc(icpFit.product || "Freshdesk")}</span>
      <span class="prep-icp-verdict prep-icp-pill ${verdictCls}">${esc(icpFit.verdict || "Unknown")}</span>
      ${score}
      ${srcBadge}
    </div>
    ${
      hasDetails
        ? `<details class="prep-icp-details">
        <summary class="prep-icp-details-summary">Highlights &amp; gaps</summary>
        <div class="prep-icp-details-body">
          ${highlights ? `<div class="prep-icp-subhead muted">Highlights</div><ul class="prep-icp-list">${highlights}</ul>` : ""}
          ${gaps ? `<div class="prep-icp-subhead muted">Gaps to probe</div><ul class="prep-icp-list prep-icp-gaps">${gaps}</ul>` : ""}
          ${refChips ? `<div class="prep-icp-subhead muted">Framework</div>${refChips}` : ""}
        </div>
      </details>`
        : ""
    }
  </div>`;
}

const FACT_BC_FALLBACK = {
  Industry: (prep) => prep.businessContext?.market,
  "Head office": (prep) => prep.businessContext?.headOffice,
  "Company size": (prep) => prep.businessContext?.users,
  "Support team": (prep) => prep.companySizeAgents?.agents,
  "Business model": (prep) => prep.businessContext?.model,
  Ownership: (prep) => prep.businessContext?.fundingParent,
  "Parent company": (prep) => prep.businessContext?.fundingParent,
  Languages: (prep) => prep.businessContext?.languages,
};

/** Fill unknown fact values from businessContext / companySizeAgents when present. */
export function resolveDisplayFacts(prep) {
  const facts = prep?.facts || [];
  if (!facts.length) return facts;
  return facts.map((f) => {
    if (!isUnknown(f.value)) return f;
    const fallback = FACT_BC_FALLBACK[f.key]?.(prep);
    if (isUnknown(fallback)) return f;
    return { ...f, value: String(fallback).trim() };
  });
}

function renderFactRows(facts, sources) {
  return (facts || [])
    .map((f, i) => {
      const src = sources.find((s) => s.label === f.sourceLabel) || sources[i % sources.length];
      const conf = src?.confidence ?? 50;
      const seNotes = isSeNotesSource(f.sourceLabel);
      const unverified = !seNotes && !isUnknown(f.value) && isUnverifiedSource(sources, f.sourceLabel);
      const srcIdx = Math.max(0, sources.indexOf(src));
      return `<div class="prep-kv-row${unverified ? " prep-kv-unverified" : ""}">
        <span class="prep-kv-key">${esc(f.key)}</span>
        <span class="prep-kv-val">${dash(f.value, unverified)} ${sourceOrTrustBadge(f.sourceLabel, conf, srcIdx, sources)}
          <button type="button" class="prep-dispute-trigger prep-dispute-btn-inline" data-dispute-step="brief_result" data-dispute-section="facts" data-dispute-idx="${i}" data-dispute-key="${esc(f.key)}">Report</button>
        </span>
      </div>`;
    })
    .join("");
}

export function isLinkedInEnrichedProspect(p, renderOpts = {}, prospectIdx = 0) {
  if (/linkedin/i.test(String(p?.sourceLabel || ""))) return true;
  const discSrc = p?.discHint?.source;
  if (discSrc === "linkedin_pdf" || discSrc === "merged") return true;
  const email = String(p?.email || renderOpts.prospectEmails?.[prospectIdx] || "").toLowerCase();
  const matched = (renderOpts.linkedinMatchedEmails || []).map((e) => String(e).toLowerCase());
  if (email && matched.includes(email)) return true;
  return false;
}

function renderAboutBlock(about) {
  const text = String(about || "").trim();
  if (isUnknown(text)) return "";
  if (text.length <= 160) return `<p class="prep-about muted">${esc(text)}</p>`;
  const short = `${text.slice(0, 157)}…`;
  return `<details class="prep-about-details">
    <summary class="prep-about muted">${esc(short)}</summary>
    <p class="prep-about-full muted">${esc(text)}</p>
  </details>`;
}

function prospectAboutSnippet(summary, maxLen = 220) {
  const text = String(summary || "").trim();
  if (isUnknown(text)) return "";
  if (text.length <= maxLen) return text;
  return `${text.slice(0, maxLen - 1)}…`;
}

function renderSignalRows(signals, sources) {
  return (signals || [])
    .map((s, i) => {
      const src = sources.find((x) => x.label === s.sourceLabel) || sources[i % sources.length];
      const conf = src?.confidence ?? 50;
      const seNotes = isSeNotesSource(s.sourceLabel);
      const empty = isUnknown(s.value);
      const unverified = !seNotes && !empty && isUnverifiedSource(sources, s.sourceLabel);
      const showEmpty = empty || unverified;
      const srcIdx = Math.max(0, sources.indexOf(src));
      const valueHtml =
        showEmpty ? '<span class="muted prep-signal-empty">Not found</span>'
        : seNotes ? `<span class="prep-signal-val-text">${esc(s.value)}</span>`
        : dash(s.value, false);
      const actions =
        showEmpty ?
          ""
        : `<span class="prep-signal-actions">${sourceOrTrustBadge(s.sourceLabel, conf, srcIdx, sources)}
            <button type="button" class="prep-dispute-trigger prep-dispute-btn-inline" data-dispute-step="brief_result" data-dispute-section="signals" data-dispute-idx="${i}" data-dispute-key="${esc(s.label)}">Report</button>
          </span>`;
      return `<div class="prep-signal-cell${showEmpty ? " prep-signal-cell-empty" : ""}">
        <div class="prep-signal-top">
          <span class="prep-kv-key prep-signal-label">${signalLabelWithTooltip(s.label)}</span>
          ${actions}
        </div>
        <div class="prep-signal-val">${valueHtml}</div>
      </div>`;
    })
    .join("");
}

function renderSignalsSection(signals, sources) {
  const found = countPopulatedSignals(signals, sources);
  return `<fw-card class="prep-card prep-signals-section">
    <details class="prep-signals-details">
      <summary class="prep-signals-summary dew-mono-label">Tech stack &amp; signals (${found} found)</summary>
      <div class="prep-signals-grid">${renderSignalRows(signals, sources)}</div>
    </details>
  </fw-card>`;
}

function prospectTabLabel(name, index) {
  const n = String(name || "").trim();
  if (n && n !== "unknown") {
    const parts = n.split(/\s+/);
    return parts.length > 1 ? `${parts[0]} ${parts[parts.length - 1][0]}.` : parts[0];
  }
  return `Prospect ${index + 1}`;
}

function experienceHeroLine(totalExperience, employers) {
  let exp = String(totalExperience ?? "").trim();
  let shortExp = exp;
  if (exp.length > 80) {
    const sent = exp.match(/^[^.!?]+[.!?]?/);
    shortExp = sent ? sent[0].trim() : `${exp.slice(0, 77)}…`;
  }
  const emp = (employers || []).filter((e) => e && !isUnknown(e));
  const top2 = emp.slice(0, 2).join(", ");
  const more = emp.length > 2 ? ` · +${emp.length - 2} more` : "";
  if (shortExp && !isUnknown(shortExp) && top2) return `${shortExp} · ${top2}${more}`;
  if (shortExp && !isUnknown(shortExp)) return shortExp;
  if (top2) return `${top2}${more}`;
  return "";
}

function renderSkillChips(skills, maxVisible = 6) {
  const list = (skills || []).filter(Boolean);
  if (!list.length) return "";
  const visible = list.slice(0, maxVisible);
  const extra = list.length - visible.length;
  return `<div class="prep-skill-chips">${visible
    .map((s) => `<span class="prep-skill-chip">${esc(s)}</span>`)
    .join("")}${extra > 0 ? `<span class="prep-skill-chip prep-skill-more">+${extra}</span>` : ""}</div>`;
}

function renderProspectCard(p, i, sources, renderOpts = {}) {
  const mono = companyMono(p.name);
  const src = sources.find((s) => s.label === p.sourceLabel) || sources[i % sources.length];
  const conf = src?.confidence ?? 50;
  const employers = (p.priorEmployers || []).filter((e) => !isUnknown(e));
  const touchpoints = (p.competitorTouchpoints || []).filter((t) => !isUnknown(t));
  const linkedInEnriched = isLinkedInEnrichedProspect(p, renderOpts, i);
  const showCompetitorTouchpoints = linkedInEnriched;
  const verifiedTouchpoints = showCompetitorTouchpoints ? touchpoints : [];
  const unverified = isUnverifiedSource(sources, p.sourceLabel);
  const disc = p.discHint;
  const discPrimary = disc?.primary && disc.primary !== "unknown" ? disc.primary : "";
  const discEvidence = (disc?.evidence || []).slice(0, 4);
  const skills = (p.skills || []).filter(Boolean);
  const langs = (p.languages || []).filter(Boolean);
  const edu = (p.education || []).filter(Boolean);
  const summary = p.summary && !isUnknown(p.summary) ? p.summary : "";
  const aboutLine = prospectAboutSnippet(summary);
  const expLine = experienceHeroLine(p.totalExperience, employers);

  const discHero = discPrimary
    ? `<div class="prep-prospect-disc-row">
        <span class="prep-disc-chip">DISC ${esc(discPrimary)}${disc.secondary && disc.secondary !== "unknown" ? `<span class="prep-disc-chip-sec"> / ${esc(disc.secondary)}</span>` : ""}${disc.confidence ? `<span class="prep-disc-chip-conf"> · ${esc(discConfidenceLabel(disc.confidence))}</span>` : ""}</span>
        <p class="prep-disc-inferred muted">${esc(discInferredLabel(disc?.source))}</p>
      </div>`
    : "";

  const detailsBlocks = [
    summary ?
      `<div class="prep-detail-block"><span class="prep-kv-key">Full summary</span><p>${esc(summary)}</p></div>`
    : "",
    employers.length ?
      `<div class="prep-detail-block"><span class="prep-kv-key">Prior employers</span><p>${esc(employers.join(", "))}</p></div>`
    : "",
    langs.length ?
      `<div class="prep-detail-block"><span class="prep-kv-key">Languages</span><p>${esc(langs.join(", "))}</p></div>`
    : "",
    edu.length ?
      `<div class="prep-detail-block"><span class="prep-kv-key">Education</span><p>${esc(edu.join("; "))}</p></div>`
    : "",
    showCompetitorTouchpoints ?
      `<div class="prep-detail-block"><span class="prep-kv-key">Competitor touchpoints</span><p>${verifiedTouchpoints.length ? esc(verifiedTouchpoints.join(", ")) : '<span class="muted prep-signal-empty">Not found</span>'}</p></div>`
    : "",
    discPrimary && discEvidence.length ?
      `<div class="prep-detail-block"><span class="prep-kv-key">Why (DISC)</span><ul class="prep-disc-evidence">${discEvidence.map((q) => `<li>${esc(q)}</li>`).join("")}</ul></div>`
    : "",
  ]
    .filter(Boolean)
    .join("");

  const hasDetails = !!(summary || employers.length || langs.length || edu.length || showCompetitorTouchpoints || discEvidence.length);

  return `<div class="prep-prospect-card${unverified ? " prep-kv-unverified" : ""}" data-prospect-idx="${i}">
    <div class="prep-prospect-hero">
      <div class="prep-prospect-head">
        <span class="prep-prospect-avatar">${esc(mono)}</span>
        <div class="prep-prospect-head-text">
          <div class="prep-prospect-name">${dash(p.name, unverified && !isUnknown(p.name))}</div>
          ${!isUnknown(p.role)
            ? linkedInEnriched
              ? `<p class="prep-prospect-headline muted">${esc(p.role)}</p>`
              : `<div class="prep-prospect-role muted">${dash(p.role, unverified)}</div>`
            : `<div class="prep-prospect-role muted">${dash(p.role, unverified)}</div>`}
        </div>
        ${prospectSourceBadges(p, src, sources, renderOpts)}
      </div>
      ${discHero}
      ${aboutLine ? `<p class="prep-prospect-about muted">${esc(aboutLine)}</p>` : ""}
      ${expLine ? `<p class="prep-prospect-exp-line muted">${esc(expLine)}</p>` : ""}
      ${renderSkillChips(skills, 4)}
    </div>
    ${
      hasDetails ?
        `<details class="prep-prospect-details">
        <summary>Profile details</summary>
        <div class="prep-prospect-details-body">${detailsBlocks}</div>
      </details>`
      : ""
    }
  </div>`;
}

function resolvePeopleProspectTab(requested, prospectCount) {
  const match = String(requested || "").match(/^prospect-(\d+)$/);
  if (!match) return "prospect-0";
  const idx = Number(match[1]);
  if (!Number.isFinite(idx) || idx < 0 || idx >= prospectCount) return "prospect-0";
  return `prospect-${idx}`;
}

function renderProspectSection(prospects, sources, sectionNotes = "", peopleProspectTab, renderOpts = {}) {
  const list = prospects?.length ? prospects : [];
  const head = `${sectionHead("People on this call", "var(--dew-amber)")}${sectionNotes}`;

  if (!list.length) {
    return `<fw-card class="prep-card prep-people-section">${head}<p class="muted">No prospect profiles yet. regenerate the brief.</p></fw-card>`;
  }

  if (list.length === 1) {
    return `<fw-card class="prep-card prep-people-section">${head}${renderProspectCard(list[0], 0, sources, renderOpts)}</fw-card>`;
  }

  const tabs = list
    .map(
      (p, i) =>
        `<fw-tab slot="tab" panel="prospect-${i}">${esc(prospectTabLabel(p.name, i))}</fw-tab>`,
    )
    .join("");
  const panels = list
    .map((p, i) => `<fw-tab-panel name="prospect-${i}">${renderProspectCard(p, i, sources, renderOpts)}</fw-tab-panel>`)
    .join("");
  const activeTab = resolvePeopleProspectTab(peopleProspectTab, list.length);

  return `<fw-card class="prep-card prep-people-section">${head}
    <fw-tabs id="prep-people-tabs" class="prep-people-tabs" active-tab-name="${esc(activeTab)}">
      ${tabs}
      ${panels}
    </fw-tabs>
  </fw-card>`;
}

function renderSupportJDBlock(supportJD, sources) {
  const src = sources.find((s) => s.label === supportJD?.sourceLabel) || sources[1] || sources[0];
  const conf = src?.confidence ?? 55;
  return `<div class="prep-jd-block prep-jd-full">
    <div class="prep-jd-head">
      <span class="prep-jd-title">Support agent JD · LinkedIn</span>
      ${sourceBadge(supportJD?.sourceLabel || src?.label || "S2", conf, sources.indexOf(src))}
    </div>
    <p class="muted prep-jd-role">${dash(supportJD?.title)}</p>
    <ul class="prep-jd-bullets">${(supportJD?.bullets || [])
      .map((b) => `<li>${dash(b)}</li>`)
      .join("") || '<li class="muted">-</li>'}</ul>
  </div>`;
}

function renderSupportJDCard(supportJD, sources) {
  const hasContent =
    supportJD &&
    (!isUnknown(supportJD.title) || (supportJD.bullets || []).some((b) => !isUnknown(b)));
  if (!hasContent) return "";
  return `<fw-card class="prep-card prep-jd-card">${renderSupportJDBlock(supportJD, sources)}</fw-card>`;
}

function renderFitGrid(fitSnapshot) {
  return (fitSnapshot || [])
    .slice(0, 3)
    .map(
      (ft) => `<div class="prep-fit-cell">
        <div class="prep-fit-attr">${esc(ft.label)}</div>
        <div class="prep-fit-row">
          <span class="prep-chip prep-chip-them">Them</span>
          <span class="prep-fit-text">${dash(ft.thisCompany)}</span>
        </div>
        <div class="prep-fit-row">
          <span class="prep-chip prep-chip-norm">Norm</span>
          <span class="prep-fit-text muted">${dash(ft.industryNorm)}</span>
        </div>
      </div>`,
    )
    .join("");
}

function formatKitReason(because) {
  const raw = String(because || "").trim();
  if (!raw || raw === "-") return dash(raw);
  return dash(raw.replace(/^because\s+/i, ""));
}

function renderDiscoveryKit(kit) {
  return (kit || [])
    .map(
      (item, i) => `<div class="prep-kit-item">
        <div class="prep-kit-num">${i + 1}</div>
        <div>
          <div class="prep-kit-ask">${dash(item.question)}</div>
          <div class="prep-kit-because muted">${formatKitReason(item.because)}</div>
        </div>
      </div>`,
    )
    .join("");
}

function renderPains(pains) {
  if (!(pains || []).length) return '<p class="muted">-</p>';
  return `<ul class="prep-pain-list">${pains
    .map((p) => `<li><span class="prep-pain-dot"></span>${dash(p)}</li>`)
    .join("")}</ul>`;
}

function renderSourcesRows(sources) {
  return (sources || [])
    .map((s) => {
      const meta = confidenceMeta(s.confidence);
      const pct = Number.isFinite(meta.pct) ? meta.pct : 50;
      return `<div class="prep-source-row">
        <span class="prep-source-label">${esc(s.label)}</span>
        <span class="prep-source-title">${dash(s.title)}</span>
        <div class="prep-conf-bar-wrap">
          <div class="prep-conf-bar prep-conf-${meta.tier}" style="width:${pct}%"></div>
        </div>
        <span class="prep-conf-word prep-conf-text-${meta.tier}">${meta.word} · ${pct}%</span>
      </div>`;
    })
    .join("");
}

function renderSourcesAccordion(sources, open) {
  return `<details class="prep-sources-card" ${open ? "open" : ""}>
    <summary class="prep-sources-summary dew-mono-label">Sources &amp; confidence</summary>
    <div class="prep-sources-body">${renderSourcesRows(sources) || '<p class="muted">-</p>'}</div>
  </details>`;
}

function renderResearchExtras(sources, open) {
  return `<fw-card class="prep-card prep-research-extras-card">
    <details class="prep-research-extras" ${open ? "open" : ""}>
      <summary class="prep-research-extras-summary dew-mono-label">Research extras</summary>
      <div class="prep-research-extras-body">
        <div class="prep-sources-inline">
          <span class="dew-mono-label prep-sources-inline-label">Sources &amp; confidence</span>
          <div class="prep-sources-body">${renderSourcesRows(sources) || '<p class="muted">-</p>'}</div>
        </div>
      </div>
    </details>
  </fw-card>`;
}

function renderStoryline(pcv) {
  const header = `<div class="prep-script-head">
    <span>Pain</span><span>Feature</span><span>Value</span>
  </div>`;
  const rows = (pcv || [])
    .map((row) => {
      const valueItems = Array.isArray(row.values)
        ? row.values
        : row.value
          ? [row.value]
          : [];
      const valueList =
        valueItems.length > 0
          ? `<ul class="prep-script-values">${valueItems.map((v) => `<li>${dash(v)}</li>`).join("")}</ul>`
          : '<p class="muted">-</p>';
      return `<div class="prep-script-row">
        <div>${dash(row.pain)}</div>
        <div class="prep-script-cap">${dash(row.capability)}</div>
        <div class="prep-script-val">${valueList}</div>
      </div>`;
    })
    .join("");
  return header + (rows || '<p class="muted">-</p>');
}

function renderChecklist(checklist, checks, accountId) {
  const items = checklist?.length
    ? checklist
    : ["Create demo account", "Configure support email", "Add sample tickets", "Enable web widget"];
  const done = items.filter((_, i) => checks?.[accountId]?.[i]).length;
  const rows = items
    .map(
      (label, i) => `<label class="prep-check-row">
        <fw-checkbox data-check-idx="${i}" ${checks?.[accountId]?.[i] ? "checked" : ""}></fw-checkbox>
        <span>${esc(label)}</span>
      </label>`,
    )
    .join("");
  return `<div class="prep-check-head">
    <span class="dew-mono-label">Sandbox setup</span>
    <span class="prep-check-progress">${done} / ${items.length}</span>
  </div>${rows}`;
}

function renderAssets(assets, prep) {
  if (!(assets || []).length) return '<p class="muted">-</p>';
  const customerRefUrl = resolveCustomerReferenceUrl(prep);
  return (assets || [])
    .map((a) => {
      const extClass = `prep-ext prep-ext-${String(a.ext || "DOC").toLowerCase()}`;
      let url = a.url;
      if (String(a.label || "").trim().toLowerCase() === "customer reference" && customerRefUrl) {
        url = customerRefUrl;
      }
      const href = url && !isUnknown(url) ? esc(url) : "#";
      return `<a class="prep-asset-row" href="${href}" target="_blank" rel="noopener noreferrer">
        <span class="prep-asset-label">${esc(a.label)}</span>
        <span class="${extClass}">${esc(a.ext || "DOC")}</span>
      </a>`;
    })
    .join("");
}

export function renderDemoTab(prep, checks, accountId) {
  return `<div class="prep-tab-body prep-rise">
    <div class="prep-grid-demo">
      <fw-card class="prep-card">
        ${sectionHead("Demo script · pain → feature → value", "var(--dew-primary)")}
        ${renderStoryline(prep.painCapabilityValue)}
      </fw-card>
      <div class="prep-demo-side">
        <fw-card class="prep-card prep-check-card">
          ${renderChecklist(prep.checklist, checks, accountId)}
        </fw-card>
        <fw-card class="prep-card">
          ${sectionHead("Deck and assets", "var(--dew-purple)")}
          ${renderAssets(prep.assets, prep)}
        </fw-card>
      </div>
    </div>
  </div>`;
}

export function renderResultHeader(prep, meta) {
  const company = meta.company || "Account";
  const domain = meta.domain || "";
  const mono = companyMono(company);
  const domainLink = domain && !isUnknown(domain) ? `https://${domain}` : "#";

  return `<div class="prep-result-header-inner">
    <div class="prep-header-left">
      <div class="prep-logo" style="background:${logoGradient(company)}">${esc(mono)}</div>
      <div class="prep-header-text">
        <div class="prep-header-title-row">
          <h1 class="prep-company-name">${esc(company)}</h1>
          ${domain ? `<a class="prep-domain-link" href="${esc(domainLink)}" target="_blank" rel="noopener noreferrer">${esc(domain)} ↗</a>` : ""}
        </div>
        <p class="prep-desc muted" title="${esc(String(prep.description || "").trim())}">${dash(prep.description)}</p>
      </div>
    </div>
    <div class="prep-header-right">
      <button type="button" class="prep-dispute-trigger prep-dispute-btn-inline prep-dispute-btn-outline" data-dispute-step="brief_result" data-dispute-section="general">Report issue</button>
      <fw-button id="prep-new-search" color="secondary" fill="outline">New search</fw-button>
    </div>
  </div>`;
}

export function renderDiscoveryTab(prep, sourcesOpen, renderOpts = {}) {
  const sources = prep.sources || [];
  const linkedinNote =
    renderOpts.linkedinMatchedEmails?.length ?
      `<p class="muted prep-linkedin-result-note">Includes LinkedIn PDF you attached (${renderOpts.linkedinMatchedEmails.length} matched).</p>`
    : "";
  const kaiaNote =
    renderOpts.kaiaFetched ?
      `<p class="muted prep-kaia-result-note">Includes Kaia meeting summary from your link.</p>`
    : "";
  const peopleNotes = `${linkedinNote}${kaiaNote}`;
  return `<div class="prep-tab-body prep-rise">
    <fw-inline-message type="warning" open class="prep-ai-banner">
      Generated by AI, prone to error. Please validate before customer conversations.
    </fw-inline-message>
    <div class="prep-grid-2 prep-grid-account">
      <fw-card class="prep-card">
        ${sectionHead("Account facts", "var(--dew-primary)")}
        ${renderAboutBlock(prep.about)}
        ${renderFactRows(resolveDisplayFacts(prep), sources)}
        ${renderIcpFitment(prep.icpFit, sources)}
      </fw-card>
      ${renderProspectSection(prep.prospects, sources, peopleNotes, renderOpts.peopleProspectTab, renderOpts)}
    </div>
    ${renderSignalsSection(prep.signals, sources)}
    ${renderSupportJDCard(prep.supportJD, sources)}
    <fw-card class="prep-card prep-fit-card">
      ${sectionHead("Fit · them vs industry norm", "var(--dew-green)")}
      <div class="prep-fit-grid">${renderFitGrid(prep.fitSnapshot)}</div>
    </fw-card>
    <div class="prep-grid-kit">
      <fw-card class="prep-card">
        ${sectionHead("Discovery kit · ask this", "var(--dew-primary)")}
        ${renderDiscoveryKit(prep.discoveryKit)}
      </fw-card>
      <fw-card class="prep-card">
        ${sectionHead("Likely pain points", "var(--dew-red)")}
        ${renderPains(prep.likelyPains)}
      </fw-card>
    </div>
    ${renderResearchExtras(sources, sourcesOpen)}
  </div>`;
}

export function renderSourcePopover(source, x, y) {
  if (!source) return "";
  const conf = confidenceMeta(source.confidence);
  const pct = Number.isFinite(conf.pct) ? conf.pct : 50;
  const url = source.url && !isUnknown(source.url) ? source.url : "";
  return `<div class="prep-popover" style="left:${x}px;top:${y}px" role="dialog" aria-label="Source details">
    <div class="prep-popover-head">
      <span class="dew-mono-label">Source ${esc(source.label)}</span>
      <span class="prep-conf-text-${conf.tier}">${conf.word} · ${pct}%</span>
    </div>
    <p class="prep-popover-title">${dash(source.title)}</p>
    ${url ? `<a href="${esc(url)}" target="_blank" rel="noopener noreferrer">${esc(url)}</a>` : '<span class="muted">No URL</span>'}
    <div class="prep-conf-bar-wrap prep-popover-bar">
      <div class="prep-conf-bar prep-conf-${conf.tier}" style="width:${pct}%"></div>
    </div>
    <button type="button" class="prep-popover-backdrop" aria-label="Close"></button>
  </div>`;
}

export function renderLegacyFallback() {
  return `<fw-inline-message type="warning" open closable="false">This prep uses an older format. Regenerate to get the Discovery + Demo brief.</fw-inline-message>`;
}
