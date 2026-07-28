/** Pure HTML builders for pre-call wireframe (v8 brief). */

import { resolveCustomerReferenceUrl } from "./customer-reference-links.js";
import { esc } from "./shared.js";

const isUnknown = (v) => !v || String(v).trim().toLowerCase() === "unknown" || String(v).trim() === "-";
const dash = (v, unverified = false) => {
  if (isUnknown(v)) return '<span class="muted">—</span>';
  if (unverified) return `<span class="prep-unverified">${esc(v)} <span class="prep-unverified-tag">Unverified</span></span>`;
  return esc(v);
};

function isUnverifiedSource(sources, sourceLabel) {
  const src = sources?.find((s) => s.label === sourceLabel);
  if (!src) return true;
  const url = String(src.url || "").trim().toLowerCase();
  if (!url || url === "unknown") return true;
  return Number(src.confidence) < 55;
}

export const SIGNAL_TOOLTIPS = {
  "Incumbent tool":
    "Current helpdesk or CX platform inferred from help center URLs, job posts, or public stack mentions.",
  Integrations:
    "CRM, billing, or ops tools the support team likely connects to — probe integration pain in discovery.",
  "Web chat widget":
    "Whether live chat or messaging is exposed on their site — signals omnichannel maturity and widget swap opportunity.",
  "AI in their current tech stack":
    "Existing AI bots, copilots, or automation in their support stack — not Freshworks; use to position Freddy differentiation.",
  "Support portal":
    "Self-service KB or customer portal vendor — indicates deflection motion and content migration scope.",
  "Hiring support roles":
    "Open support or CX hiring — often signals growth, turnover, or tooling change windows.",
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

/** Friendly DISC inference line from enrichment source (discHint.source). */
export function discInferredLabel(source) {
  switch (source) {
    case "linkedin_pdf":
      return "Inferred from LinkedIn PDF — not a formal assessment";
    case "kaia":
      return "Inferred from Kaia meeting — not a formal assessment";
    case "merged":
      return "Inferred from LinkedIn + Kaia — not a formal assessment";
    case "zoom":
      return "Inferred from Zoom transcript — not a formal assessment";
    default:
      return "Inferred from LinkedIn — not a formal assessment";
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

function renderFactRows(facts, sources) {
  return (facts || [])
    .map((f, i) => {
      const src = sources.find((s) => s.label === f.sourceLabel) || sources[i % sources.length];
      const conf = src?.confidence ?? 50;
      const unverified = isUnverifiedSource(sources, f.sourceLabel) || isUnknown(f.value);
      return `<div class="prep-kv-row${unverified && !isUnknown(f.value) ? " prep-kv-unverified" : ""}">
        <span class="prep-kv-key">${esc(f.key)}</span>
        <span class="prep-kv-val">${dash(f.value, unverified && !isUnknown(f.value))} ${sourceBadge(f.sourceLabel, conf, sources.indexOf(src))}
          <button type="button" class="prep-dispute-trigger prep-dispute-btn-inline" data-dispute-step="brief_result" data-dispute-section="facts" data-dispute-idx="${i}" data-dispute-key="${esc(f.key)}">Report</button>
        </span>
      </div>`;
    })
    .join("");
}

function renderSignalRows(signals, sources) {
  return (signals || [])
    .map((s, i) => {
      const src = sources.find((x) => x.label === s.sourceLabel) || sources[i % sources.length];
      const conf = src?.confidence ?? 50;
      const unverified = isUnverifiedSource(sources, s.sourceLabel) || isUnknown(s.value);
      return `<div class="prep-signal-row${unverified && !isUnknown(s.value) ? " prep-kv-unverified" : ""}">
        <div class="prep-signal-top">
          <span class="prep-kv-key prep-signal-label">${signalLabelWithTooltip(s.label)}</span>
          <span class="prep-signal-actions">
            ${sourceBadge(s.sourceLabel, conf, sources.indexOf(src))}
            <button type="button" class="prep-dispute-trigger prep-dispute-btn-inline" data-dispute-step="brief_result" data-dispute-section="signals" data-dispute-idx="${i}" data-dispute-key="${esc(s.label)}">Report</button>
          </span>
        </div>
        <div class="prep-signal-val">${dash(s.value, unverified && !isUnknown(s.value))}</div>
      </div>`;
    })
    .join("");
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
  const unverified = isUnverifiedSource(sources, p.sourceLabel);
  const disc = p.discHint;
  const discPrimary = disc?.primary && disc.primary !== "unknown" ? disc.primary : "";
  const discEvidence = (disc?.evidence || []).slice(0, 4);
  const skills = (p.skills || []).filter(Boolean);
  const langs = (p.languages || []).filter(Boolean);
  const edu = (p.education || []).filter(Boolean);
  const summary = p.summary && !isUnknown(p.summary) ? p.summary : "";
  const expLine = experienceHeroLine(p.totalExperience, employers);

  const discHero = discPrimary
    ? `<div class="prep-prospect-disc-row">
        <span class="prep-disc-chip">DISC ${esc(discPrimary)}${disc.secondary && disc.secondary !== "unknown" ? `<span class="prep-disc-chip-sec"> / ${esc(disc.secondary)}</span>` : ""}${disc.confidence ? `<span class="prep-disc-chip-conf"> · ${esc(disc.confidence)}</span>` : ""}</span>
        <p class="prep-disc-inferred muted">${esc(discInferredLabel(disc?.source))}</p>
      </div>`
    : "";

  const summaryPreview =
    summary ?
      `<p class="prep-prospect-summary prep-line-clamp">${esc(summary)}</p>`
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
    `<div class="prep-detail-block"><span class="prep-kv-key">Competitor touchpoints</span><p>${touchpoints.length ? esc(touchpoints.join(", ")) : dash("")}</p></div>`,
    discPrimary && discEvidence.length ?
      `<div class="prep-detail-block"><span class="prep-kv-key">Why (DISC)</span><ul class="prep-disc-evidence">${discEvidence.map((q) => `<li>${esc(q)}</li>`).join("")}</ul></div>`
    : "",
  ]
    .filter(Boolean)
    .join("");

  const hasDetails = !!(summary || employers.length || langs.length || edu.length || touchpoints.length || discEvidence.length);

  return `<div class="prep-prospect-card${unverified ? " prep-kv-unverified" : ""}" data-prospect-idx="${i}">
    <div class="prep-prospect-hero">
      <div class="prep-prospect-head">
        <span class="prep-prospect-avatar">${esc(mono)}</span>
        <div class="prep-prospect-head-text">
          <div class="prep-prospect-name">${dash(p.name, unverified && !isUnknown(p.name))}</div>
          <div class="prep-prospect-role muted">${dash(p.role, unverified && !isUnknown(p.role))}</div>
        </div>
        ${prospectSourceBadges(p, src, sources, renderOpts)}
      </div>
      ${discHero}
      ${expLine ? `<p class="prep-prospect-exp-line muted">${esc(expLine)}</p>` : ""}
      ${renderSkillChips(skills)}
      ${summaryPreview}
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
    return `<fw-card class="prep-card prep-people-section">${head}<p class="muted">No prospect profiles yet — regenerate the brief.</p></fw-card>`;
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
      .join("") || '<li class="muted">—</li>'}</ul>
  </div>`;
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

function renderDiscoveryKit(kit) {
  return (kit || [])
    .map(
      (item, i) => `<div class="prep-kit-item">
        <div class="prep-kit-num">${i + 1}</div>
        <div>
          <div class="prep-kit-ask">${dash(item.question)}</div>
          <div class="prep-kit-because muted">because ${dash(item.because)}</div>
        </div>
      </div>`,
    )
    .join("");
}

function renderPains(pains) {
  if (!(pains || []).length) return '<p class="muted">—</p>';
  return `<ul class="prep-pain-list">${pains
    .map((p) => `<li><span class="prep-pain-dot"></span>${dash(p)}</li>`)
    .join("")}</ul>`;
}

function renderSourcesAccordion(sources, open) {
  const rows = (sources || [])
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
  return `<details class="prep-sources-card" ${open ? "open" : ""}>
    <summary class="prep-sources-summary dew-mono-label">Sources &amp; confidence</summary>
    <div class="prep-sources-body">${rows || '<p class="muted">—</p>'}</div>
  </details>`;
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
          : '<p class="muted">—</p>';
      return `<div class="prep-script-row">
        <div>${dash(row.pain)}</div>
        <div class="prep-script-cap">${dash(row.capability)}</div>
        <div class="prep-script-val">${valueList}</div>
      </div>`;
    })
    .join("");
  return header + (rows || '<p class="muted">—</p>');
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
  if (!(assets || []).length) return '<p class="muted">—</p>';
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
        <p class="prep-desc muted">${dash(prep.description)}</p>
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
      Generated by AI — prone to error. Please validate before customer conversations.
    </fw-inline-message>
    <div class="prep-grid-2 prep-grid-account">
      <fw-card class="prep-card">
        ${sectionHead("Account facts", "var(--dew-primary)")}
        <p class="prep-about muted">${dash(prep.about)}</p>
        ${renderFactRows(prep.facts, sources)}
        ${renderIcpFitment(prep.icpFit, sources)}
      </fw-card>
      <fw-card class="prep-card">
        ${sectionHead("Signals", "var(--dew-purple)")}
        ${renderSignalRows(prep.signals, sources)}
      </fw-card>
    </div>
    ${renderProspectSection(prep.prospects, sources, peopleNotes, renderOpts.peopleProspectTab, renderOpts)}
    ${renderSupportJDBlock(prep.supportJD, sources)}
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
    ${renderSourcesAccordion(sources, sourcesOpen)}
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
