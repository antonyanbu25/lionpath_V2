/** Pure HTML builders for pre-call wireframe (v8 brief). */

import { resolveCustomerReferenceUrl } from "./customer-reference-links.js";
import {
  SOURCE_KIND_LABEL,
  citationNumber,
  isLinkableSource,
  sourceDisplayName,
  sourceKind,
} from "./prep-source-display.js";
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

/** SE additional-context source. shown as "From your input", not Unverified. */
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

/**
 * Non-web provenance as a small coloured dot rather than a shouted pill.
 * The old uppercase amber "FROM YOUR INPUT" badge pulled more attention than the value
 * it was annotating. Colour alone is not decipherable or accessible, so every dot
 * carries a title and an aria-label, and the card renders a legend.
 */
function kindDot(kind) {
  const name = SOURCE_KIND_LABEL[kind] || "Source";
  return `<span class="prep-kind-dot prep-kind-${kind}" role="img" title="${esc(name)}" aria-label="Source: ${esc(name)}"></span>`;
}

function trustNotesBadge() {
  return kindDot("context");
}

/** True when a row's provenance could not be resolved (canonicaliser's marker). */
export function isUnattributedSource(sourceLabel) {
  return String(sourceLabel || "").trim() === "?";
}

function unattributedBadge() {
  return `<span class="prep-kind-dot prep-kind-none" role="img" title="No source could be attributed to this value" aria-label="Source: none"></span>`;
}

/**
 * The one entry point for every citation chip. Web sources get a number, everything
 * else gets a kind dot — so `sourceBadge` is never called directly (that bypass is what
 * made SE and unattributed render as ordinary source chips on prospect/ICP/JD cards).
 */
function sourceOrTrustBadge(sourceLabel, conf, idx, sources) {
  if (isSeNotesSource(sourceLabel)) return trustNotesBadge();
  if (isUnattributedSource(sourceLabel)) return unattributedBadge();
  const src = sources?.find((s) => s.label === sourceLabel);
  const kind = sourceKind(src || { label: sourceLabel });
  if (kind !== "web") return kindDot(kind);
  return sourceBadge(sourceLabel, conf, idx >= 0 ? idx : 0, src);
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

/**
 * Web citation chip: a compact [n] keyed to the Sources & confidence list, like a
 * footnote. Domains were self-describing but 90-115px wide each, and
 * `.prep-kv-actions` is flex-shrink:0/nowrap, so they stole width from the value.
 *
 * Always a <button>: as an <a> it double-fired (opened a tab AND the popover). The
 * popover carries the link instead. `data-src-idx` and `aria-label` are preserved —
 * the click wiring and the accessible name both depend on them.
 */
function sourceBadge(label, conf, idx, src) {
  const n = citationNumber(label);
  const text = n === null ? sourceDisplayName(src || { label }) : String(n);
  const domain = sourceDisplayName(src || { label });
  const title = n === null ? `${label} · ${src?.title || text}` : `${domain} — ${src?.title || "source"}`;
  return `<button type="button" class="prep-src-badge${n === null ? "" : " prep-src-num"}" data-src-idx="${idx}" aria-label="Source ${esc(label)}: ${esc(domain)}" title="${esc(title)}">${esc(text)}</button>`;
}

/** Key for the kind dots. Colour alone is not usable, so name each one. */
function sourceKindLegend(sources) {
  const kinds = [...new Set((sources || []).map((s) => sourceKind(s)))].filter((k) => k !== "web");
  if (!kinds.length) return "";
  const order = ["context", "linkedin", "recording", "none"];
  const items = order
    .filter((k) => kinds.includes(k))
    .map((k) => `<span class="prep-kind-legend-item">${kindDot(k)}${esc(SOURCE_KIND_LABEL[k])}</span>`)
    .join("");
  return `<div class="prep-kind-legend"><span class="prep-kind-legend-item"><span class="prep-src-badge prep-src-num prep-kind-legend-num">1</span>Web source — see Research extras</span>${items}</div>`;
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
  let html = sourceOrTrustBadge(primaryLabel, conf, idx, sources);
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
  if (verdict === "Medium") return "ok";
  if (verdict === "Weak") return "weak";
  return "muted";
}

const CRITERION_STATE_LABEL = {
  met: "Met",
  unmet: "Not met",
  unknown: "No evidence yet",
};

const CRITERION_MARK = { met: "✓", unmet: "✕", unknown: "–" };

/**
 * One criterion as a label and a tick. Nothing else.
 *
 * Earlier versions put the evidence inline and grouped the rows under three headings; SEs
 * asked for a plain checklist instead. The evidence and its source still travel on the
 * row's tooltip, so nothing is lost — it just is not competing for the eye.
 */
function icpTick(row, sources) {
  const state = row.state === "met" || row.state === "unmet" ? row.state : "unknown";
  const label = row.label || row.id || "Criterion";
  const src = (sources || []).find((s) => s.label === row.sourceLabel);
  // Tooltip carries what the row used to show inline: the evidence and where it came from.
  const detail = [
    CRITERION_STATE_LABEL[state],
    !isUnknown(row.evidence) ? row.evidence : "",
    src ? `Source: ${sourceDisplayName(src)}` : "",
  ]
    .filter(Boolean)
    .join(" — ");
  const dq =
    row.disqualifying && state === "unmet"
      ? ` <span class="prep-icp-tick-dq" title="A KB disqualifier — this alone caps the alignment at Weak">disqualifier</span>`
      : "";
  return `<li class="prep-icp-tick prep-icp-tick-${state}" title="${esc(detail)}">
    <span class="prep-icp-tick-mark" role="img" aria-label="${esc(CRITERION_STATE_LABEL[state])}">${CRITERION_MARK[state]}</span>
    <span class="prep-icp-tick-label">${esc(label)}${dq}</span>
  </li>`;
}

/** Met first, then not-met, then unevidenced — so the shape of the read is visible. */
const TICK_ORDER = { met: 0, unmet: 1, unknown: 2 };

function renderIcpFitment(icpFit, sources) {
  if (!icpFit) return "";
  const rows = icpFit.criteria || [];

  const ordered = [...rows].sort(
    (a, b) =>
      (TICK_ORDER[a.state] ?? 2) - (TICK_ORDER[b.state] ?? 2) ||
      // Within a state, the two gating criteria lead: they decide the tier.
      Number(!!b.gating) - Number(!!a.gating),
  );

  // The only prose kept: when a disqualifier caps the tier, the ticks alone would not
  // explain why mostly-met reads Weak.
  const disqualified = rows.filter((r) => r.state === "unmet" && r.disqualifying);
  const capNote = disqualified.length
    ? `<p class="prep-icp-cap">Capped at <strong>Weak</strong> — fails ${
        disqualified.length === 1 ? "a disqualifier" : `${disqualified.length} disqualifiers`
      }: ${disqualified.map((d) => esc(d.label || d.id)).join(", ")}.</p>`
    : "";

  const unplaced =
    rows.some((r) => r.gating) && !icpFit.zone
      ? `<p class="prep-icp-cap">Not placed — ${esc(
          rows
            .filter((r) => r.gating)
            .map((r) => String(r.label || r.id).toLowerCase())
            .join(" and "),
        )} not sourced. Ask on the call.</p>`
      : "";

  const legacyNote = rows.length
    ? ""
    : `<p class="prep-icp-legacy muted">Fitment factors were added after this brief was generated. Re-run the brief to see them.</p>`;

  return `<div class="prep-icp-block">
    <div class="prep-icp-head">
      <span class="dew-mono-label">ICP fitment</span>
      <span class="prep-icp-product">${esc(icpFit.product || "Freshdesk")}</span>
      <span class="prep-icp-verdict prep-icp-pill ${icpVerdictClass(icpFit.verdict)}">${esc(icpFit.verdict || "Unknown")} alignment</span>
      ${icpFit.zone ? `<span class="prep-icp-zone">${esc(icpFit.zone)}</span>` : ""}
    </div>
    ${
      ordered.length
        ? `<ul class="prep-icp-tick-list">${ordered.map((r) => icpTick(r, sources)).join("")}</ul>`
        : ""
    }
    ${capNote}
    ${unplaced}
    ${legacyNote}
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

/**
 * "Report this row is wrong" control.
 *
 * Framed as a bordered button with a flag glyph because SEs read the old borderless
 * text link as another data column rather than an action. Keeps `.prep-dispute-trigger`
 * and every data-dispute-* attribute so the handler contract is unchanged.
 */
function reportButton({ section, idx, key, step = "brief_result" }) {
  return `<button type="button"
    class="prep-dispute-trigger prep-report-btn"
    data-dispute-step="${esc(step)}"
    data-dispute-section="${esc(section)}"
    data-dispute-idx="${idx}"
    data-dispute-key="${esc(key)}"
    title="Report incorrect data or a wrong source for ${esc(key)}"
    aria-label="Report an issue with ${esc(key)}"
  ><span class="prep-report-icon" aria-hidden="true">⚑</span><span class="prep-report-text">Report</span></button>`;
}

function renderFactRows(facts, sources) {
  return (facts || [])
    .map((f, i) => {
      // No positional fallback: crediting a neighbouring source made the confidence dot
      // and the source popover describe a publisher this fact never came from.
      const src = sources.find((s) => s.label === f.sourceLabel);
      const conf = src?.confidence ?? 50;
      const seNotes = isSeNotesSource(f.sourceLabel);
      // The "No source" chip carries the same meaning, so skip the duplicate tag.
      const unverified =
        !seNotes &&
        !isUnattributedSource(f.sourceLabel) &&
        !isUnknown(f.value) &&
        isUnverifiedSource(sources, f.sourceLabel);
      const srcIdx = Math.max(0, sources.indexOf(src));
      // A row with no value has nothing to attribute, so its chip and Report are muted
      // rather than presented as live provenance.
      const emptyVal = isUnknown(f.value);
      // Grid row, not inline flow: as a bare inline span the value, chip and Report
      // button competed for one line box, so Report wrapped to its own line at random.
      return `<div class="prep-kv-row${unverified ? " prep-kv-unverified" : ""}${emptyVal ? " prep-kv-empty" : ""}">
        <span class="prep-kv-key">${esc(f.key)}</span>
        <span class="prep-kv-val">${dash(f.value, unverified)}</span>
        <span class="prep-kv-actions">${sourceOrTrustBadge(f.sourceLabel, conf, srcIdx, sources)}${reportButton({
          section: "facts",
          idx: i,
          key: f.key,
        })}</span>
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

function renderSignalRows(signals, sources) {
  return (signals || [])
    .map((s, i) => {
      const src = sources.find((x) => x.label === s.sourceLabel);
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
        : `<span class="prep-signal-actions">${sourceOrTrustBadge(s.sourceLabel, conf, srcIdx, sources)}${reportButton({
            section: "signals",
            idx: i,
            key: s.label,
          })}</span>`;
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
  const src = sources.find((s) => s.label === p.sourceLabel);
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
  // No truncated teaser: "Profile details" is open by default and shows the full
  // summary a few lines below, so a clipped copy of the same text was pure duplication.
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
      ${expLine ? `<p class="prep-prospect-exp-line muted">${esc(expLine)}</p>` : ""}
      ${renderSkillChips(skills, 4)}
    </div>
    ${
      hasDetails ?
        `<details class="prep-prospect-details" open>
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

/**
 * A real, cited job posting. No positional source fallback and no hardcoded "· LinkedIn"
 * — nothing fetches LinkedIn, so claiming it was simply untrue. The chip now names the
 * page the JD actually came from.
 */
function renderSupportJDBlock(supportJD, sources) {
  const src = sources.find((s) => s.label === supportJD?.sourceLabel);
  const conf = src?.confidence ?? 55;
  return `<div class="prep-jd-block prep-jd-full">
    <div class="prep-jd-head">
      <span class="prep-jd-title">Support agent JD</span>
      ${sourceOrTrustBadge(supportJD?.sourceLabel || "", conf, sources.indexOf(src), sources)}
    </div>
    <p class="muted prep-jd-role">${dash(supportJD?.title)}</p>
    <ul class="prep-jd-bullets">${(supportJD?.bullets || [])
      .map((b) => `<li>${dash(b)}</li>`)
      .join("") || '<li class="muted">-</li>'}</ul>
  </div>`;
}

/**
 * No cited posting: say so, and hand the SE the one thing we do know (the hiring signal)
 * plus a question to ask. Previously this slot showed a model-invented job description
 * with a borrowed citation, which was the least trustworthy content on the page.
 */
function renderSupportJDFallback(signals) {
  const hiring = (signals || []).find((s) => s.label === "Hiring support roles");
  const known =
    hiring && !isUnknown(hiring.value)
      ? `<p class="prep-jd-known"><span class="prep-kv-key">Hiring signal</span> ${esc(hiring.value)}</p>`
      : "";
  return `<div class="prep-jd-block prep-jd-full prep-jd-empty">
    <div class="prep-jd-head">
      <span class="prep-jd-title">Support agent JD</span>
      <span class="prep-jd-none">Not found</span>
    </div>
    <p class="muted">No public support-role posting found on their careers pages, so there is no JD to quote.</p>
    ${known}
    <p class="prep-jd-ask"><span class="prep-kv-key">Ask instead</span> How is the support team structured today, and are you hiring into it?</p>
  </div>`;
}

function renderSupportJDCard(supportJD, sources, signals) {
  const hasContent =
    supportJD &&
    (!isUnknown(supportJD.title) || (supportJD.bullets || []).some((b) => !isUnknown(b)));
  const body = hasContent
    ? renderSupportJDBlock(supportJD, sources)
    : renderSupportJDFallback(signals);
  return `<fw-card class="prep-card prep-jd-card">${body}</fw-card>`;
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
      // Lead with the same domain the chip shows, so the two are cross-referenceable.
      const name = sourceDisplayName(s);
      const detail = s.title && s.title !== name ? `<span class="muted"> · ${esc(s.title)}</span>` : "";
      const title = isLinkableSource(s.url)
        ? `<a href="${esc(s.url)}" target="_blank" rel="noopener noreferrer">${esc(name)}</a>${detail}`
        : `${esc(name)}${detail}`;
      return `<div class="prep-source-row">
        <span class="prep-source-label">${esc(String(citationNumber(s.label) ?? s.label))}</span>
        <span class="prep-source-title">${title}</span>
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
      // A missing URL used to render href="#": a link to nowhere that looked live.
      if (!url || isUnknown(url)) {
        return `<span class="prep-asset-row prep-asset-row-disabled" title="No link available for this asset">
          <span class="prep-asset-label">${esc(a.label)}</span>
          <span class="${extClass}">${esc(a.ext || "DOC")}</span>
        </span>`;
      }
      return `<a class="prep-asset-row" href="${esc(url)}" target="_blank" rel="noopener noreferrer">
        <span class="prep-asset-label">${esc(a.label)}</span>
        <span class="${extClass}">${esc(a.ext || "DOC")}</span>
      </a>`;
    })
    .join("");
}

/** Free-string decisionRole → human label. Pass-through default: never a lookup miss. */
function humanDecisionRole(role) {
  const raw = String(role || "").trim();
  if (!raw || raw.toLowerCase() === "unknown") return "";
  const known = {
    economic_buyer: "Economic buyer",
    champion: "Champion",
    influencer: "Influencer",
    technical_buyer: "Technical buyer",
    end_user: "End user",
  };
  if (known[raw.toLowerCase()]) return known[raw.toLowerCase()];
  const spaced = raw.replace(/[_-]+/g, " ").trim();
  return spaced.charAt(0).toUpperCase() + spaced.slice(1);
}

function resolveGuidanceTab(requested, count) {
  const match = String(requested || "").match(/^guidance-(\d+)$/);
  if (!match) return "guidance-0";
  const idx = Number(match[1]);
  if (!Number.isFinite(idx) || idx < 0 || idx >= count) return "guidance-0";
  return `guidance-${idx}`;
}

function guidanceTabLabel(name, i) {
  return prospectTabLabel(name, i);
}

/** One attendee's demo guidance. */
function renderGuidanceBlock(g) {
  const discChip = g.disc
    ? `<span class="prep-disc-chip">DISC ${esc(g.disc)}${
        g.confidence ? `<span class="prep-disc-chip-conf"> · ${esc(discConfidenceLabel(g.confidence))}</span>` : ""
      }</span>`
    : `<span class="prep-disc-chip prep-disc-chip-unknown">DISC unknown</span>`;
  const role = humanDecisionRole(g.decisionRole);
  const roleChip = role ? `<span class="prep-guidance-role">${esc(role)}</span>` : "";

  // DISC here is inferred from text, never assessed — say so when it is weak.
  const lowNote =
    g.disc && g.confidence === "low"
      ? `<p class="prep-guidance-hedge muted">Low confidence — treat this as a hypothesis to test, not a script.</p>`
      : "";
  const unknownNote = !g.disc
    ? `<p class="prep-guidance-hedge muted">No DISC read available — guidance below is based on role and pains only.</p>`
    : "";

  const line = (label, value) =>
    value ? `<div class="prep-guidance-line"><span class="prep-kv-key">${label}</span><p>${esc(value)}</p></div>` : "";

  const list = (label, items, cls = "") =>
    items?.length
      ? `<div class="prep-guidance-line"><span class="prep-kv-key">${label}</span><ul class="prep-guidance-list ${cls}">${items
          .map((s) => `<li>${esc(s)}</li>`)
          .join("")}</ul></div>`
      : "";

  const objections = g.objections?.length
    ? `<div class="prep-guidance-line"><span class="prep-kv-key">Expect</span><ul class="prep-guidance-objections">${g.objections
        .map(
          (o) =>
            `<li><span class="prep-guidance-obj">“${esc(o.objection)}”</span><span class="prep-guidance-counter">${esc(o.counter)}</span></li>`,
        )
        .join("")}</ul></div>`
    : "";

  const leadAsset = g.leadAsset
    ? `<div class="prep-guidance-line"><span class="prep-kv-key">Lead with</span><p><span class="prep-guidance-asset">${esc(g.leadAsset)}</span></p></div>`
    : "";

  return `<div class="prep-guidance-block">
    <div class="prep-guidance-head">
      <span class="prep-guidance-name">${esc(g.name || "Prospect")}</span>
      ${discChip}${roleChip}
    </div>
    ${lowNote}${unknownNote}
    ${line("Open with", g.openWith)}
    ${list("Ice breakers", g.iceBreakers)}
    ${line("Pacing", g.pacing)}
    ${objections}
    ${list("Avoid", g.avoid, "prep-guidance-avoid")}
    ${line("Next step", g.nextStep)}
    ${leadAsset}
  </div>`;
}

/**
 * "How to run this demo" — DISC-driven, per attendee.
 * Guidance is generated server-side (worker/src/prep/demo-guidance.ts) and is absent
 * whenever enrichment didn't run, which is the common case rather than an edge case.
 */
export function renderDemoGuidance(prep, renderOpts = {}) {
  const head = sectionHead("How to run this demo", "var(--dew-amber)");
  const list = prep?.demoGuidance?.perProspect || [];

  if (!list.length) {
    return `<fw-card class="prep-card prep-guidance-section">${head}
      <p class="muted">No demo guidance yet. Attach a LinkedIn PDF, add meeting notes, or link a Kaia meeting on the pre-call form — guidance is built from the prospect profile those produce.</p>
    </fw-card>`;
  }

  const room = prep.demoGuidance.room
    ? `<div class="prep-guidance-room">
        <span class="prep-kv-key">The room</span>
        <p>${esc(prep.demoGuidance.room.read)}</p>
        <p class="prep-guidance-sequence">${esc(prep.demoGuidance.room.sequence)}</p>
      </div>`
    : "";

  if (list.length === 1) {
    return `<fw-card class="prep-card prep-guidance-section">${head}${room}${renderGuidanceBlock(list[0])}</fw-card>`;
  }

  // Plain buttons, not fw-tabs. The demo tab's HTML is rendered eagerly while its
  // fw-tab-panel is still display:none, and a nested fw-tabs that hydrates hidden never
  // activates a panel — neither activeTabName nor activateTab() recovers it.
  const activeTab = resolveGuidanceTab(renderOpts.demoGuidanceTab, list.length);
  const tabs = list
    .map(
      (g, i) =>
        `<button type="button" class="prep-guidance-tab" role="tab" data-guidance-tab="guidance-${i}" aria-selected="${
          `guidance-${i}` === activeTab ? "true" : "false"
        }">${esc(guidanceTabLabel(g.name, i))}</button>`,
    )
    .join("");
  const panels = list
    .map(
      (g, i) =>
        `<div class="prep-guidance-panel" data-guidance-panel="guidance-${i}"${
          `guidance-${i}` === activeTab ? "" : " hidden"
        }>${renderGuidanceBlock(g)}</div>`,
    )
    .join("");

  return `<fw-card class="prep-card prep-guidance-section">${head}${room}
    <div class="prep-guidance-tabs" role="tablist">${tabs}</div>
    ${panels}
  </fw-card>`;
}

/**
 * Industry use cases from demoGuidance — support scenarios described in the account's own
 * operational terms, not demo click paths. An unordered list, deliberately: numbered
 * steps read as "do this then that", which is what the first version wrongly produced.
 *
 * Renders nothing when the server's grounding guard rejected everything. An empty section
 * beats generic filler, which is why these were removed the first time.
 */
function renderUseCases(useCases) {
  const list = (useCases || []).filter((u) => u?.name && (u.scenario || []).length);
  if (!list.length) return "";
  return `<div class="prep-uc-block">
    <div class="prep-uc-head">
      <span class="dew-mono-label">Common use cases</span>
      <span class="prep-uc-sub muted">Scenarios specific to this account's industry and markets</span>
    </div>
    <div class="prep-uc-grid">
      ${list
        .map(
          (u) => `<div class="prep-uc-item">
        <div class="prep-uc-name">${esc(u.name)}</div>
        <ul class="prep-uc-scenario">${u.scenario.map((s) => `<li>${esc(s)}</li>`).join("")}</ul>
      </div>`,
        )
        .join("")}
    </div>
  </div>`;
}

export function renderDemoTab(prep, checks, accountId, renderOpts = {}) {
  return `<div class="prep-tab-body prep-rise">
    <div class="prep-grid-demo">
      ${renderDemoGuidance(prep, renderOpts)}
      <fw-card class="prep-card">
        ${sectionHead("Deck and assets", "var(--dew-purple)")}
        ${renderAssets(prep.assets, prep)}
        ${renderUseCases(prep.demoGuidance?.useCases)}
      </fw-card>
    </div>
    <fw-card class="prep-card prep-demo-script-card">
      ${sectionHead("Demo script · pain → feature → value", "var(--dew-primary)")}
      ${renderStoryline(prep.painCapabilityValue)}
    </fw-card>
    <fw-card class="prep-card prep-check-card">
      ${renderChecklist(prep.checklist, checks, accountId)}
    </fw-card>
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
        ${sourceKindLegend(sources)}
        ${renderIcpFitment(prep.icpFit, sources)}
      </fw-card>
      ${renderProspectSection(prep.prospects, sources, peopleNotes, renderOpts.peopleProspectTab, renderOpts)}
    </div>
    ${renderSignalsSection(prep.signals, sources)}
    ${renderSupportJDCard(prep.supportJD, sources, prep.signals)}
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
      <span class="dew-mono-label">${esc(
        citationNumber(source.label) === null
          ? SOURCE_KIND_LABEL[sourceKind(source)] || source.label
          : `Source ${citationNumber(source.label)}`,
      )}</span>
      <span class="prep-conf-text-${conf.tier}">${conf.word} · ${pct}%</span>
    </div>
    <p class="prep-popover-title">${esc(sourceDisplayName(source))}</p>
    ${source.title && source.title !== sourceDisplayName(source) ? `<p class="muted prep-popover-detail">${esc(source.title)}</p>` : ""}
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
