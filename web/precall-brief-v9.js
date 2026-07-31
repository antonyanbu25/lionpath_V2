/**
 * SE Labs pre-call brief layout (Know your Customer + Demo Prep).
 * Maps existing v8 prep payloads to the v9 wireframe markup.
 */

import { esc } from "./shared.js";
import { EMPTY_DISPLAY } from "./shared.js";
import {
  resolveDisplayFacts,
  countPopulatedSignals,
  isLinkedInEnrichedProspect,
  discConfidenceLabel,
  discInferredLabel,
  isSeNotesSource,
  confidenceMeta,
} from "./precall-render.js";
import { resolveCustomerReferenceUrl } from "./customer-reference-links.js";

const isUnknown = (v) => {
  const s = String(v || "").trim();
  if (!s) return true;
  if (s.toLowerCase() === "unknown") return true;
  return s === "-" || s === "–" || s === "—";
};

const MATURITY_LEVELS = ["Manual", "Basic", "Automated", "AI-assisted"];

const GAP_STYLE = {
  large: { them: 1.5, norm: 4, label: "Big gap", color: "#b8544a", bg: "#f6ece7", text: "#b8544a" },
  partial: { them: 2.5, norm: 3.5, label: "Gap", color: "#a9782a", bg: "#f3ecda", text: "#8a7333" },
  small: { them: 3, norm: 3.5, label: "Close", color: "#6f6759", bg: "#f4f0e8", text: "#6f6759" },
  none: { them: 3.5, norm: 3.5, label: "At par", color: "#6f6759", bg: "#f4f0e8", text: "#6f6759" },
  ahead: { them: 4, norm: 3, label: "Ahead", color: "#2e897b", bg: "#e3efec", text: "#2e897b" },
};

const DISC_XY = { D: [34, 26], I: [86, 26], S: [86, 100], C: [34, 100] };

const COVER_PALETTE = [
  { color: "#b8544a", bg: "#f6ece7" },
  { color: "#a9782a", bg: "#f3ecda" },
  { color: "#7c7466", bg: "#f4f0e8" },
];

const RIBBON_TEMPLATE = [
  { title: "Frame", share: 5, color: "#c9bfa9" },
  { title: "Discovery", share: 13, color: "#6fb8ac" },
  { title: "Show", share: 17, color: "#4f9a8e" },
  { title: "Land it", share: 10, color: "#d6b678" },
];

function posPct(v) {
  return `${(12.5 + ((v - 1) / 3) * 75).toFixed(2)}%`;
}

function srcBadge(label, sources) {
  if (isSeNotesSource(label)) {
    return '<span class="prep-v9-src prep-v9-src-input">INPUT</span>';
  }
  const src = sources?.find((s) => s.label === label);
  if (!src) return "";
  const meta = confidenceMeta(src.confidence);
  return `<span class="prep-v9-src" title="${esc(meta.word)} confidence">${esc(label)}<span class="prep-v9-src-dot prep-v9-src-dot-${meta.tier}"></span></span>`;
}

function factTile(f, sources) {
  const empty = isUnknown(f.value);
  const seNotes = isSeNotesSource(f.sourceLabel);
  return `<div class="prep-v9-tile${empty ? " prep-v9-tile-empty" : ""}">
    <span class="prep-v9-tile-label">${esc(f.key)}</span>
    <div class="prep-v9-tile-row">
      <span class="prep-v9-tile-val${empty ? " muted" : ""}">${empty ? EMPTY_DISPLAY : esc(f.value)}</span>
      ${!empty ? srcBadge(f.sourceLabel, sources) : ""}
      ${seNotes && !empty ? '<span class="prep-v9-src prep-v9-src-input">INPUT</span>' : ""}
    </div>
  </div>`;
}

function signalByLabel(signals, pattern) {
  return (signals || []).find((s) => pattern.test(String(s.label || "")));
}

const STACK_STYLE = {
  missing: { border: "1.5px dashed #ddd6c7", bg: "#fff", color: "#7c7466", italic: "italic" },
  teal: { border: "1px solid #cfe3de", bg: "#eef7f5", color: "#2e897b", italic: "normal" },
  sand: { border: "1px solid #ece0c8", bg: "#f9f4ea", color: "#a5883f", italic: "normal" },
  platform: { border: "1px solid #f0d9c9", bg: "#fdf3ec", color: "#a9614f", italic: "normal" },
  platformMissing: { border: "1.5px dashed #ddd6c7", bg: "#fff", color: "#7c7466", italic: "italic" },
};

function stackChip(label, tone = "teal") {
  const s = STACK_STYLE[tone] || STACK_STYLE.teal;
  return `<div class="prep-v9-stack-box" style="border:${s.border};background:${s.bg};color:${s.color};font-style:${s.italic}">${esc(label)}</div>`;
}

function splitListValue(value) {
  if (isUnknown(value)) return [];
  return String(value)
    .split(/[,;·|/]+/)
    .map((p) => p.trim())
    .filter(Boolean);
}

function buildStackChannels(prep) {
  const chat = signalByLabel(prep.signals, /web chat|chat widget/i);
  const portal = signalByLabel(prep.signals, /support portal/i);
  const channelRow = (prep.fitSnapshot || []).find((r) => /channel/i.test(r.label || ""));
  const fromFit = splitListValue(channelRow?.thisCompany);
  const fromSignals = [
    ...splitListValue(chat?.value),
    ...splitListValue(portal?.value),
  ].filter(Boolean);
  const channels = [...new Set([...fromFit, ...fromSignals])];
  if (!channels.length) return [stackChip("Channels not found", "missing")];
  return channels.map((c) => stackChip(c, "teal"));
}

function buildStackIntegrations(prep) {
  const integrations = signalByLabel(prep.signals, /^integrations$/i);
  const items = splitListValue(integrations?.value);
  if (!items.length) return [stackChip("Integrations not found", "missing")];
  return items.map((c) => stackChip(c, "sand"));
}

function buildPlatformBox(prep) {
  const incumbentSig = signalByLabel(prep.signals, /incumbent/i);
  const name = incumbentSig?.value || prep.incumbent?.incumbent_name;
  if (isUnknown(name)) {
    return {
      html: `<div class="prep-v9-stack-platform" style="border:${STACK_STYLE.platformMissing.border};background:${STACK_STYLE.platformMissing.bg}">
        <div class="prep-v9-stack-platform-name" style="color:${STACK_STYLE.platformMissing.color};font-style:italic">Incumbent unknown</div>
        <div class="prep-v9-stack-platform-sub muted">Ask, then re-run this brief</div>
      </div>`,
      thin: true,
    };
  }
  const sub = prep.incumbent?.displacement ? `Incumbent · ${prep.incumbent.displacement}` : "Incumbent platform";
  return {
    html: `<div class="prep-v9-stack-platform" style="border:${STACK_STYLE.platform.border};background:${STACK_STYLE.platform.bg}">
      <div class="prep-v9-stack-platform-name" style="color:${STACK_STYLE.platform.color}">${esc(name)}</div>
      <div class="prep-v9-stack-platform-sub" style="color:${STACK_STYLE.platform.color}">${esc(sub)}</div>
    </div>`,
    thin: false,
  };
}

function buildAiLayerBox(prep) {
  const ai = signalByLabel(prep.signals, /AI in their/i);
  if (isUnknown(ai?.value)) {
    return `<div class="prep-v9-stack-ai">
      <div class="prep-v9-stack-ai-label">AI layer</div>
      <div class="prep-v9-stack-ai-val muted">Not found</div>
    </div>`;
  }
  return stackChip(ai.value, "teal");
}

function renderSupportStack(prep) {
  const channels = buildStackChannels(prep);
  const integrations = buildStackIntegrations(prep);
  const platform = buildPlatformBox(prep);
  const ai = buildAiLayerBox(prep);
  const stackNote = platform.thin
    ? "Sketch this live on the call. Naming the incumbent is the highest-value thing you can leave with — everything else improves once we have it."
    : prep.incumbent?.displacement
      ? `Freshworks replaces the platform box and adds the missing AI layer — a consolidation story, not an add-on.`
      : "Freshworks replaces the platform box and adds the missing AI layer — a consolidation story, not an add-on.";
  return `<div class="prep-v9-card prep-v9-stack-card">
    <h2 class="prep-v9-card-title">Their support stack</h2>
    <p class="muted prep-v9-card-sub">Dotted boxes are things we could not verify.</p>
    <div class="prep-v9-stack-flow">
      <div class="prep-v9-stack-col">
        <span class="prep-v9-stack-kicker">Channels in</span>
        ${channels.join("")}
      </div>
      <span class="prep-v9-stack-arrow" aria-hidden="true">→</span>
      <div class="prep-v9-stack-col prep-v9-stack-col-platform">
        <span class="prep-v9-stack-kicker">Platform</span>
        ${platform.html}
        ${ai}
      </div>
      <span class="prep-v9-stack-arrow" aria-hidden="true">→</span>
      <div class="prep-v9-stack-col">
        <span class="prep-v9-stack-kicker">Connected to</span>
        ${integrations.join("")}
      </div>
    </div>
    <div class="prep-v9-stack-note">
      <span class="prep-v9-stack-note-icon" aria-hidden="true">◆</span>
      <p>${esc(stackNote)}</p>
    </div>
  </div>`;
}

const UNKNOWN_CHECKS = [
  {
    field: "Incumbent platform",
    question: "What are you using for support today?",
    missing: (prep) => {
      const sig = signalByLabel(prep.signals, /incumbent/i);
      return isUnknown(sig?.value) && isUnknown(prep.incumbent?.incumbent_name);
    },
  },
  {
    field: "Support channels",
    question: "How can customers reach you — chat, phone, email?",
    missing: (prep) => buildStackChannels(prep).some((h) => h.includes("Channels not found")),
  },
  {
    field: "Team size",
    question: "How many people are on the support team?",
    missing: (prep) => {
      const facts = resolveDisplayFacts(prep);
      const size = facts.find((f) => /size|employee|agent|team/i.test(f.key));
      return !size || isUnknown(size.value);
    },
  },
  {
    field: "Ticket volume",
    question: "Roughly how many tickets a month?",
    missing: () => true, // rarely in public data — show when thin
  },
  {
    field: "AI in current stack",
    question: "Any automation or AI in support today?",
    missing: (prep) => {
      const ai = signalByLabel(prep.signals, /AI in their/i);
      return isUnknown(ai?.value);
    },
  },
  {
    field: "After-hours coverage",
    question: "Who covers tickets outside business hours?",
    missing: () => true,
  },
  {
    field: "Support hiring",
    question: "Grow the team, or hold headcount flat?",
    missing: (prep) => {
      const hire = signalByLabel(prep.signals, /hiring support/i);
      return isUnknown(hire?.value);
    },
  },
];

function buildUnknownsList(prep) {
  const thin = countPopulatedSignals(prep.signals, prep.sources) < 3;
  if (thin) {
    return UNKNOWN_CHECKS.filter((c) => c.field !== "Support hiring" && c.missing(prep));
  }
  return UNKNOWN_CHECKS.filter(
    (c) =>
      ["AI in current stack", "Support hiring", "After-hours coverage"].includes(c.field) && c.missing(prep),
  );
}

function renderUnknownsGaps(prep) {
  const unknowns = buildUnknownsList(prep);
  if (!unknowns.length) return "";
  const subtitle = `${unknowns.length} gap${unknowns.length === 1 ? "" : "s"}. Each one is a question.`;
  const rows = unknowns
    .map(
      (u) => `<div class="prep-v9-unknown-row">
        <div class="prep-v9-unknown-body">
          <div class="prep-v9-unknown-field">${esc(u.field)}</div>
          <div class="prep-v9-unknown-question">${esc(u.question)}</div>
        </div>
        <button type="button" class="prep-v9-unknown-add" data-unknown-question="${esc(u.question)}" title="Add to discovery kit" aria-label="Add to my questions">＋</button>
      </div>`,
    )
    .join("");
  return `<div class="prep-v9-card prep-v9-unknowns-card">
    <div class="prep-v9-unknowns-head">
      <div>
        <h2 class="prep-v9-card-title">What we could not find</h2>
        <p class="muted prep-v9-card-sub">${esc(subtitle)}</p>
      </div>
      <button type="button" class="prep-v9-unknown-add-all">Add all</button>
    </div>
    <div class="prep-v9-unknown-list">${rows}</div>
  </div>`;
}

function maturityRows(fitSnapshot) {
  const rows = (fitSnapshot || []).slice(0, 5);
  if (!rows.length) return "";
  const body = rows
    .map((ft) => {
      const g = GAP_STYLE[ft.gap] || GAP_STYLE.partial;
      const them = g.them;
      const norm = g.norm;
      const bandLeft = posPct(Math.min(them, norm));
      const bandWidth = `${Math.abs(norm - them) * 25}%`;
      return `<div class="prep-v9-maturity-row">
        <div class="prep-v9-maturity-label">
          <span class="prep-v9-maturity-name">${esc(ft.label)}</span>
          <span class="prep-v9-maturity-them muted">${esc(ft.thisCompany || "Unknown")}</span>
        </div>
        <div class="prep-v9-maturity-track" aria-hidden="true">
          <span class="prep-v9-maturity-rail"></span>
          <span class="prep-v9-maturity-band" style="left:${bandLeft};width:${bandWidth};background:${g.color}"></span>
          <span class="prep-v9-maturity-norm" style="left:${posPct(norm)}"></span>
          <span class="prep-v9-maturity-them-dot" style="left:${posPct(them)}"></span>
        </div>
        <span class="prep-v9-gap-pill" style="color:${g.text};background:${g.bg}">${esc(ft.gapVerdict || g.label)}</span>
      </div>`;
    })
    .join("");
  return `<div class="prep-v9-card">
    <div class="prep-v9-card-head">
      <div>
        <h2 class="prep-v9-card-title">Where they sit versus their industry</h2>
        <p class="muted prep-v9-card-sub">The shaded distance is your pitch.</p>
      </div>
      <div class="prep-v9-maturity-legend muted">
        <span><span class="prep-v9-legend-dot prep-v9-legend-them"></span>Them</span>
        <span><span class="prep-v9-legend-dot prep-v9-legend-norm"></span>Norm</span>
      </div>
    </div>
    <div class="prep-v9-maturity-head">
      <span></span>
      <div class="prep-v9-maturity-levels">${MATURITY_LEVELS.map((l) => `<span>${esc(l)}</span>`).join("")}</div>
      <span class="prep-v9-maturity-gap-label">Gap</span>
    </div>
    ${body}
  </div>`;
}

function benchmarkRows(prep) {
  const agents = prep.companySizeAgents?.agents;
  const facts = resolveDisplayFacts(prep);
  const funding = facts.find((f) => /fund|raised|ownership/i.test(f.key))?.value;
  const size = facts.find((f) => /size|employee|agent|team/i.test(f.key))?.value;
  const items = [
    agents && !isUnknown(agents) ? { label: "Support agents", value: agents } : null,
    funding && !isUnknown(funding) ? { label: "Funding raised", value: funding } : null,
    size && !isUnknown(size) ? { label: "Team size", value: size } : null,
  ].filter(Boolean);
  if (!items.length) {
    return `<div class="prep-v9-card">
      <h2 class="prep-v9-card-title">How big is this fish?</h2>
      <div class="prep-v9-empty-box">
        <p class="prep-v9-empty-title">We could not size this account.</p>
        <p class="muted">No headcount, funding or volume figures are public. Ask for team size — it anchors everything else.</p>
      </div>
    </div>`;
  }
  return `<div class="prep-v9-card">
    <h2 class="prep-v9-card-title">How big is this fish?</h2>
    <div class="prep-v9-benchmark-list">${items
      .map(
        (b) => `<div class="prep-v9-benchmark">
          <div class="prep-v9-benchmark-head"><span>${esc(b.label)}</span><strong>${esc(b.value)}</strong></div>
        </div>`,
      )
      .join("")}</div>
  </div>`;
}

function signalNewsRows(signals, sources) {
  const populated = (signals || []).filter((s) => !isUnknown(s.value) && !isSeNotesSource(s.sourceLabel));
  if (!populated.length) {
    return `<div class="prep-v9-empty-box"><p class="muted">No public signals found for this account. Ask what's changed recently — a new launch, funding, or reorg is your opening.</p></div>`;
  }
  return populated
    .slice(0, 4)
    .map(
      (s) => `<div class="prep-v9-news-row">
        <span class="prep-v9-news-dot"></span>
        <div>
          <span class="prep-v9-news-title">${esc(s.label)}: ${esc(s.value)}</span>
          <span class="prep-v9-news-meta muted">${srcBadge(s.sourceLabel, sources)}</span>
        </div>
      </div>`,
    )
    .join("");
}

function discSvg(p) {
  const primary = String(p.discHint?.primary || "").toUpperCase()[0] || "";
  const [x, y] = DISC_XY[primary] || [60, 60];
  const opacity = primary ? 1 : 0;
  const note = primary
    ? discInferredLabel(p.discHint?.source)
    : "No DISC signal yet — listen for pace and detail in the first five minutes.";
  return `<svg class="prep-v9-disc" viewBox="0 0 120 120" role="img" aria-label="DISC quadrant">
    <rect x="8" y="8" width="104" height="104" rx="10" fill="#faf8f3" stroke="#ece7de" stroke-width="1.5"/>
    <line x1="60" y1="8" x2="60" y2="112" stroke="#ece7de" stroke-width="1.5"/>
    <line x1="8" y1="60" x2="112" y2="60" stroke="#ece7de" stroke-width="1.5"/>
    <text x="34" y="26" text-anchor="middle" font-size="11" font-weight="700" fill="#b8544a">D</text>
    <text x="86" y="26" text-anchor="middle" font-size="11" font-weight="700" fill="#7c7466">I</text>
    <text x="86" y="100" text-anchor="middle" font-size="11" font-weight="700" fill="#7c7466">S</text>
    <text x="34" y="100" text-anchor="middle" font-size="11" font-weight="700" fill="#a5883f">C</text>
    <circle cx="${x}" cy="${y}" r="9" fill="#2b2926" opacity="${opacity}"/>
  </svg>
  <p class="prep-v9-disc-note muted">${esc(note)}${primary && p.discHint?.confidence ? ` · ${esc(discConfidenceLabel(p.discHint.confidence))}` : ""}</p>`;
}

function attendeeRow(p, i, sources, renderOpts) {
  const touchpoints = (p.competitorTouchpoints || []).filter((t) => !isUnknown(t));
  const linkedIn = isLinkedInEnrichedProspect(p, renderOpts, i);
  const summary = String(p.summary || "").trim();
  const behaviour = (p.discHint?.evidence || []).slice(0, 3).map((text, idx) => ({
    verb: ["Ask", "Watch", "Match"][idx] || "Note",
    text,
  }));
  return `<div class="prep-v9-attendee">
    <div class="prep-v9-attendee-disc">${discSvg(p)}</div>
    <div class="prep-v9-attendee-main">
      <span class="prep-v9-attendee-name">${esc(p.name || "Prospect")}</span>
      <p class="muted prep-v9-attendee-role">${esc(p.role || "—")}</p>
      ${summary && !isUnknown(summary) ? `<p class="prep-v9-attendee-summary">${esc(summary.slice(0, 220))}${summary.length > 220 ? "…" : ""}</p>` : ""}
      ${linkedIn && touchpoints.length ? `<div class="prep-v9-touchpoints"><span class="muted">Has used</span>${touchpoints.map((t) => `<span class="prep-v9-touch-chip">${esc(t)}</span>`).join("")}</div>` : ""}
    </div>
    <div class="prep-v9-attendee-behaviour">${behaviour
      .map((b) => `<div class="prep-v9-beh-row"><span class="prep-v9-beh-verb">${esc(b.verb)}</span><span>${esc(b.text)}</span></div>`)
      .join("")}</div>
  </div>`;
}

function renderAttendees(prospects, sources, renderOpts) {
  const list = prospects?.length ? prospects : [];
  return `<div class="prep-v9-card prep-v9-attendees-card">
    <div class="prep-v9-card-head">
      <h2 class="prep-v9-card-title">Who is in the room</h2>
      <span class="prep-v9-seats-pill">${list.length || 0} seat${list.length === 1 ? "" : "s"}</span>
    </div>
    ${list.length ? list.map((p, i) => attendeeRow(p, i, sources, renderOpts)).join("") : '<p class="muted">No prospect profiles yet.</p>'}
  </div>`;
}

function renderHowToRead() {
  return `<div class="prep-v9-read-legend muted">
    <span class="prep-v9-read-kicker">How to read this</span>
    <span><span class="prep-v9-src">S#<span class="prep-v9-src-dot prep-v9-src-dot-high"></span></span> AI-researched · confidence</span>
    <span><span class="prep-v9-src prep-v9-src-input">INPUT</span> From your input</span>
    <span><span class="prep-v9-missing-box"></span> Not found — ask on the call</span>
  </div>`;
}

function splitFacts(facts) {
  const firm = [];
  const fin = [];
  for (const f of facts) {
    if (/fund|revenue|raised|valuation|ownership/i.test(f.key)) fin.push(f);
    else firm.push(f);
  }
  return { firm: firm.slice(0, 4), fin: fin.slice(0, 3) };
}

function renderDiscoveryKit(kit) {
  return (kit || [])
    .map(
      (item, i) => `<div class="prep-kit-item">
        <div class="prep-kit-num">${i + 1}</div>
        <div>
          <div class="prep-kit-ask">${isUnknown(item.question) ? `<span class="muted">${EMPTY_DISPLAY}</span>` : esc(item.question)}</div>
          <div class="prep-kit-because muted">${esc(String(item.because || "").replace(/^because\s+/i, ""))}</div>
        </div>
      </div>`,
    )
    .join("");
}

function renderPains(pains) {
  if (!(pains || []).length) return '<p class="muted">—</p>';
  return `<ul class="prep-pain-list">${pains.map((p) => `<li><span class="prep-pain-dot"></span>${isUnknown(p) ? `<span class="muted">${EMPTY_DISPLAY}</span>` : esc(p)}</li>`).join("")}</ul>`;
}

function renderResearchExtras(sources, open) {
  const rows = (sources || [])
    .map((s) => {
      const meta = confidenceMeta(s.confidence);
      const pct = Number.isFinite(meta.pct) ? meta.pct : 50;
      return `<div class="prep-source-row">
        <span class="prep-source-label">${esc(s.label)}</span>
        <span class="prep-source-title">${isUnknown(s.title) ? `<span class="muted">${EMPTY_DISPLAY}</span>` : esc(s.title)}</span>
        <div class="prep-conf-bar-wrap"><div class="prep-conf-bar prep-conf-${meta.tier}" style="width:${pct}%"></div></div>
        <span class="prep-conf-word prep-conf-text-${meta.tier}">${meta.word} · ${pct}%</span>
      </div>`;
    })
    .join("");
  return `<details class="prep-research-extras" ${open ? "open" : ""}>
    <summary class="prep-research-extras-summary dew-mono-label">Research extras</summary>
    <div class="prep-research-extras-body"><div class="prep-sources-body">${rows || '<p class="muted">—</p>'}</div></div>
  </details>`;
}

function renderIcpBlock(icpFit, sources) {
  if (!icpFit) return "";
  const src = sources?.[0];
  return `<div class="prep-icp-block prep-v9-icp">
    <div class="prep-icp-head">
      <span class="dew-mono-label">ICP fitment</span>
      <span class="prep-icp-verdict prep-icp-pill">${esc(icpFit.verdict || "Unknown")}</span>
      ${src ? srcBadge(src.label, sources) : ""}
    </div>
    <details class="prep-icp-details"><summary class="prep-icp-details-summary">Highlights &amp; gaps</summary>
      <div class="prep-icp-details-body">
        ${(icpFit.highlights || []).length ? `<ul class="prep-icp-list">${icpFit.highlights.map((h) => `<li>${esc(h)}</li>`).join("")}</ul>` : ""}
        ${(icpFit.gaps || []).length ? `<ul class="prep-icp-list prep-icp-gaps">${icpFit.gaps.map((g) => `<li>${esc(g)}</li>`).join("")}</ul>` : ""}
      </div>
    </details>
  </div>`;
}

function renderSignalsGrid(signals, sources) {
  const found = countPopulatedSignals(signals, sources);
  return `<details class="prep-signals-details prep-v9-signals">
    <summary class="prep-signals-summary dew-mono-label">Tech stack &amp; signals (${found} found)</summary>
    <div class="prep-signals-grid">${(signals || [])
      .map((s) => {
        const empty = isUnknown(s.value);
        return `<div class="prep-signal-cell${empty ? " prep-signal-cell-empty" : ""}">
          <span class="prep-kv-key">${esc(s.label)}</span>
          <div class="prep-signal-val">${empty ? '<span class="muted prep-signal-empty">Not found</span>' : esc(s.value)}</div>
        </div>`;
      })
      .join("")}</div>
  </details>`;
}

function renderSupportJD(supportJD, sources) {
  if (!supportJD || (isUnknown(supportJD.title) && !(supportJD.bullets || []).some((b) => !isUnknown(b)))) return "";
  return `<div class="prep-v9-card prep-jd-full">
    <h2 class="prep-v9-card-title">Support agent JD · LinkedIn</h2>
    <p class="muted">${isUnknown(supportJD.title) ? EMPTY_DISPLAY : esc(supportJD.title)}</p>
    <ul class="prep-jd-bullets">${(supportJD.bullets || []).map((b) => `<li>${isUnknown(b) ? `<span class="muted">${EMPTY_DISPLAY}</span>` : esc(b)}</li>`).join("")}</ul>
  </div>`;
}

function sixtySeconds(prep, sources) {
  const facts = resolveDisplayFacts(prep);
  const sourced = facts.filter((f) => !isUnknown(f.value)).length;
  const total = Math.max(facts.length, 1);
  const pct = Math.round((sourced / total) * 100);
  const thin = pct < 40;
  const firstQ = prep.discoveryKit?.[0]?.question;
  const topGap = prep.fitSnapshot?.find((f) => f.gap === "large")?.label;
  return {
    pct: `${pct}%`,
    color: thin ? "#dba79f" : "#6fb8ac",
    sub: `${sourced} of ${total} facts sourced`,
    tiles: thin
      ? [
          { label: "The thesis", color: "#dba79f", value: "You're going in with limited data.", sub: "Make this a listening call." },
          { label: "Biggest gap", color: "#b3ab9c", value: topGap ? `${topGap} is unknown.` : "Benchmarks are thin.", sub: "Ask where they sit today." },
          { label: "Ask this first", color: "#7fd0c4", value: firstQ || "Walk me through what happens when a customer contacts you.", sub: "One open question fills gaps fast." },
          { label: "Bring this", color: "#e0bd7e", value: prep.likelyPains?.[0] || "A discovery question bank", sub: "Anchor on their pain, not features." },
        ]
      : [
          { label: "The thesis", color: "#dba79f", value: prep.about?.slice(0, 80) || "Strong fit for Freshdesk.", sub: prep.incumbent?.displacement ? `Displacement: ${prep.incumbent.displacement}` : "Lead with their biggest gap." },
          { label: "Biggest gap", color: "#b3ab9c", value: topGap || prep.fitSnapshot?.[0]?.label || "Support maturity", sub: prep.fitSnapshot?.[0]?.gapVerdict || "Pitch the shaded distance." },
          { label: "Ask this first", color: "#7fd0c4", value: firstQ || "What's driving the evaluation now?", sub: "Tie urgency to renewal or growth." },
          { label: "Bring this", color: "#e0bd7e", value: prep.painCapabilityValue?.[0]?.capability || "Demo storyline", sub: prep.painCapabilityValue?.[0]?.pain || "Match feature to pain." },
        ],
  };
}

function callRibbon(prep, mins = 45) {
  const questions = (prep.discoveryKit || []).map((k) => k.question).filter(Boolean);
  const pains = prep.likelyPains || [];
  const show = (prep.painCapabilityValue || []).slice(0, 3).flatMap((r) => r.capability).filter(Boolean);
  const beats = [
    ["Confirm the time and who else joins", "One line on why you asked for the call"],
    questions.slice(0, 3).length ? questions.slice(0, 3) : pains.slice(0, 3),
    show.length ? show : ["Lead with the highest-gap capability", "Tie demo to their workflow"],
    ["Name the next step before you hang up", "Get a date with their technical lead"],
  ];
  const total = RIBBON_TEMPLATE.reduce((a, r) => a + r.share, 0);
  let cursor = 0;
  return RIBBON_TEMPLATE.map((r, i) => {
    const span = Math.round((r.share / total) * mins);
    const start = cursor;
    cursor += span;
    return {
      ...r,
      flex: r.share,
      mins: `${start}–${Math.min(cursor, mins)} min`,
      beats: beats[i] || [],
    };
  });
}

function demoMomentsFromPcv(pcv) {
  return (pcv || []).slice(0, 4).map((row, i) => {
    const pains = [row.pain].filter(Boolean);
    const palette = COVER_PALETTE[Math.min(i, COVER_PALETTE.length - 1)];
    return {
      feature: row.capability || "Capability",
      coverLabel: pains.length ? `Answers ${pains.length} pain${pains.length > 1 ? "s" : ""}` : "Industry default",
      coverColor: palette.color,
      coverBg: palette.bg,
      pains,
      value: row.values || (row.value ? [row.value] : []),
    };
  });
}

function assetRows(assets, prep) {
  const customerRefUrl = resolveCustomerReferenceUrl(prep);
  return (assets || []).map((a) => {
    let url = a.url;
    if (String(a.label || "").trim().toLowerCase() === "customer reference" && customerRefUrl) url = customerRefUrl;
    const ext = String(a.ext || "DOC").toUpperCase();
    return `<a class="prep-v9-asset-row" href="${url && !isUnknown(url) ? esc(url) : "#"}" target="_blank" rel="noopener noreferrer">
      <span class="prep-v9-asset-tag">${esc(ext)}</span>
      <span class="prep-v9-asset-label">${esc(a.label)}</span>
    </a>`;
  }).join("");
}

function sandboxRows(checklist, checks, accountId) {
  const items = checklist?.length ? checklist : ["Create demo account", "Configure support email", "Add sample tickets", "Enable web widget"];
  const done = items.filter((_, i) => checks?.[accountId]?.[i]).length;
  const rows = items
    .map(
      (label, i) => {
        const checked = checks?.[accountId]?.[i];
        return `<label class="prep-v9-sandbox-row">
          <fw-checkbox data-check-idx="${i}" ${checked ? "checked" : ""}></fw-checkbox>
          <span class="${checked ? "muted prep-v9-sandbox-done" : ""}">${esc(label)}</span>
        </label>`;
      },
    )
    .join("");
  return { done, total: items.length, rows };
}

export function renderKnowTab(prep, sourcesOpen, renderOpts = {}) {
  const sources = prep.sources || [];
  const facts = resolveDisplayFacts(prep);
  const { firm, fin } = splitFacts(facts);
  const domain = renderOpts.domain || "";
  const linkedinNote = renderOpts.linkedinMatchedEmails?.length
    ? `<p class="muted prep-linkedin-result-note">Includes LinkedIn PDF you attached (${renderOpts.linkedinMatchedEmails.length} matched).</p>`
    : "";
  const kaiaNote = renderOpts.kaiaFetched
    ? `<p class="muted prep-kaia-result-note">Includes Kaia meeting summary from your link.</p>`
    : "";

  return `<div class="prep-tab-body prep-rise prep-v9">
    <fw-inline-message type="warning" open class="prep-ai-banner">
      Generated by AI, prone to error. Please validate before customer conversations.
    </fw-inline-message>
    ${renderHowToRead()}
    <div class="prep-v9-grid-2">
      <div class="prep-v9-card">
        <h2 class="prep-v9-card-title">About the company</h2>
        <p class="prep-v9-about">${isUnknown(prep.about) ? `<span class="muted">${EMPTY_DISPLAY}</span>` : esc(prep.about)}</p>
        ${domain ? `<div class="prep-v9-website-row"><span class="prep-v9-tile-label">Website</span><a class="prep-v9-domain-link" href="https://${esc(domain)}" target="_blank" rel="noopener noreferrer">${esc(domain)} ↗</a></div>` : ""}
        <div class="prep-v9-tile-grid">${firm.map((f) => factTile(f, sources)).join("")}</div>
        ${fin.length ? `<div class="prep-v9-section-kicker">Financials &amp; funding</div><div class="prep-v9-tile-grid prep-v9-tile-grid-3">${fin.map((f) => factTile(f, sources)).join("")}</div>` : ""}
        ${renderIcpBlock(prep.icpFit, sources)}
      </div>
      <div class="prep-v9-card">
        <h2 class="prep-v9-card-title">Recent news</h2>
        ${signalNewsRows(prep.signals, sources)}
      </div>
    </div>
    <div class="prep-v9-grid-2">
      ${maturityRows(prep.fitSnapshot)}
      ${benchmarkRows(prep)}
    </div>
    ${renderSupportStack(prep)}
    ${renderUnknownsGaps(prep)}
    ${renderAttendees(prep.prospects, sources, renderOpts)}
    ${linkedinNote}${kaiaNote}
    ${renderSupportJD(prep.supportJD, sources)}
    ${renderSignalsGrid(prep.signals, sources)}
    <div class="prep-grid-kit">
      <fw-card class="prep-card">
        ${`<div class="prep-section-head"><span class="prep-section-dot" style="background:var(--dew-primary)"></span><span class="dew-mono-label">Discovery kit · ask this</span></div>`}
        ${renderDiscoveryKit(prep.discoveryKit)}
      </fw-card>
      <fw-card class="prep-card">
        ${`<div class="prep-section-head"><span class="prep-section-dot" style="background:var(--dew-red)"></span><span class="dew-mono-label">Likely pain points</span></div>`}
        ${renderPains(prep.likelyPains)}
      </fw-card>
    </div>
    ${renderResearchExtras(sources, sourcesOpen)}
  </div>`;
}

export function renderDemoPrepTab(prep, checks, accountId, renderOpts = {}) {
  const hero = sixtySeconds(prep, prep.sources || []);
  const ribbon = callRibbon(prep);
  const moments = demoMomentsFromPcv(prep.painCapabilityValue);
  const sandbox = sandboxRows(prep.checklist, checks, accountId);
  const assets = assetRows(prep.assets, prep);

  return `<div class="prep-tab-body prep-rise prep-v9 prep-v9-demo">
    <div class="prep-v9-hero">
      <div class="prep-v9-hero-head">
        <span class="prep-v9-hero-kicker">Sixty seconds before the call</span>
        <div class="prep-v9-hero-conf muted">
          <span>Brief confidence</span>
          <span class="prep-v9-conf-bar"><span style="width:${hero.pct};background:${hero.color}"></span></span>
          <strong style="color:${hero.color}">${hero.pct}</strong>
          <span>· ${esc(hero.sub)}</span>
        </div>
      </div>
      <div class="prep-v9-hero-grid">${hero.tiles
        .map(
          (t) => `<div class="prep-v9-hero-tile">
            <span class="prep-v9-hero-label" style="color:${t.color}">${esc(t.label)}</span>
            <span class="prep-v9-hero-value">${esc(t.value)}</span>
            <span class="prep-v9-hero-sub muted">${esc(t.sub)}</span>
          </div>`,
        )
        .join("")}</div>
    </div>
    <div class="prep-v9-card">
      <div class="prep-v9-card-head">
        <h2 class="prep-v9-card-title">Your call plan</h2>
        <span class="prep-v9-call-length muted">45 min call</span>
      </div>
      <div class="prep-v9-ribbon">${ribbon
        .map(
          (r) => `<div class="prep-v9-ribbon-seg" style="flex:${r.flex}">
            <div class="prep-v9-ribbon-bar" style="background:${r.color}"></div>
            <div class="prep-v9-ribbon-meta"><span class="muted">${esc(r.mins)}</span><strong>${esc(r.title)}</strong></div>
            <div class="prep-v9-ribbon-beats">${(r.beats || []).map((b) => `<div class="prep-v9-beat"><span style="background:${r.color}"></span>${esc(b)}</div>`).join("")}</div>
          </div>`,
        )
        .join("")}</div>
    </div>
    <div class="prep-v9-grid-demo">
      <div class="prep-v9-card">
        <h2 class="prep-v9-card-title">Demo: Value to highlight</h2>
        <div class="prep-v9-moment-list">${moments.length ? moments
          .map(
            (d) => `<div class="prep-v9-moment">
              <div class="prep-v9-moment-left">
                <div class="prep-v9-moment-feature">${esc(d.feature)}</div>
                <span class="prep-v9-cover-pill" style="color:${d.coverColor};background:${d.coverBg}">${esc(d.coverLabel)}</span>
                <div class="prep-v9-moment-pains">${d.pains.map((p) => `<span class="muted">↳ ${esc(p)}</span>`).join("")}</div>
              </div>
              <div class="prep-v9-moment-values">${d.value.map((v) => `<div class="prep-v9-value-row"><span></span>${esc(v)}</div>`).join("")}</div>
            </div>`,
          )
          .join("") : '<p class="muted">Regenerate the brief to populate demo moments.</p>'}</div>
      </div>
      <div class="prep-v9-demo-side">
        <div class="prep-v9-card prep-check-card">
          <div class="prep-check-head"><span class="dew-mono-label">Sandbox setup</span><span class="prep-check-progress">${sandbox.done} / ${sandbox.total}</span></div>
          ${sandbox.rows}
        </div>
        <div class="prep-v9-card">
          <h2 class="prep-v9-card-title">Bring these</h2>
          ${assets || '<p class="muted">—</p>'}
        </div>
      </div>
    </div>
    <div class="prep-grid-demo prep-v9-legacy-script" hidden>
      <fw-card class="prep-card"><div class="prep-section-head"><span class="prep-section-dot" style="background:var(--dew-primary)"></span><span class="dew-mono-label">Demo script · pain → feature → value</span></div></fw-card>
    </div>
  </div>`;
}
