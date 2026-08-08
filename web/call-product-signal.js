/**
 * Call-record Product signal tab — full-width card tile (matches QIP scorecard).
 * Layout: competitors bar → asks | customer voice → pains | integrations.
 */

import { esc } from "./shared.js";

const ICON_CHECK =
  '<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3.4" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M20 6 9 17l-5-5"/></svg>';
const ICON_X =
  '<svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M18 6 6 18M6 6l12 12"/></svg>';

const INTEGRATION_RE =
  /\b(integrat(?:e|ion|ions)?|api|sdk|webhook|connector|shopify|netsuite|salesforce|native)\b/i;

function signalKey(text) {
  return String(text || "")
    .trim()
    .toLowerCase()
    .replace(/\s+/g, " ")
    .slice(0, 96);
}

function formatTs(atS) {
  const n = Number(atS);
  if (!Number.isFinite(n) || n < 0) return "0:00";
  const m = Math.floor(n / 60);
  const s = Math.floor(n % 60);
  return `${m}:${String(s).padStart(2, "0")}`;
}

function quoteText(text) {
  const t = String(text || "").trim();
  if (!t) return "";
  const inner = t.replace(/^["'""]|["'""]$/g, "");
  return `\u201c${inner}\u201d`;
}

function pillLabel(row, fallbackArea) {
  if (row?.headline?.trim()) return row.headline.trim();
  if (row?.title?.trim()) return row.title.trim();
  const area = String(row?.subArea || row?.productArea || fallbackArea || "")
    .replace(/_/g, " ")
    .trim();
  if (area && area !== "other") {
    return area.replace(/\b\w/g, (c) => c.toUpperCase());
  }
  const words = String(row?.verbatim || "").split(/\s+/).slice(0, 4);
  return words.join(" ") || "Signal";
}

function askCardTitle(obj) {
  if (obj?.headline?.trim()) return obj.headline.trim();
  let text = String(obj?.objectionText || obj?.text || obj?.verbatim || "").trim();
  text = text.replace(
    /^(?:Customer|Prospect|The customer|The prospect)\s+(?:expressed|raised|asked|questioned|noted|was concerned)\s+(?:concern\s+that\s+)?/i,
    "",
  );
  const first = text.split(/[.!?]/)[0]?.trim() || text;
  if (first.length <= 52) return first;
  return `${first.slice(0, 49).trimEnd()}…`;
}

function painLabel(text) {
  const t = String(text || "").trim();
  if (t.length <= 72) return t;
  return `${t.slice(0, 69).trimEnd()}…`;
}

function isIntegrationGap(g) {
  if (g?.productArea === "integrations_extensibility") return true;
  const sub = String(g?.subArea || "");
  if (INTEGRATION_RE.test(sub.replace(/_/g, " "))) return true;
  if (INTEGRATION_RE.test(String(g?.verbatim || ""))) return true;
  return (g?.crossCuttingTags || []).some((t) => INTEGRATION_RE.test(String(t).replace(/_/g, " ")));
}

function integrationLabel(g) {
  if (g?.headline?.trim()) return g.headline.trim();
  const sub = String(g?.subArea || "").replace(/_/g, " ");
  if (sub && sub !== "other") return sub.replace(/\b\w/g, (c) => c.toUpperCase());
  return painLabel(g?.verbatim || "Integration need");
}

/** @param {object} record @param {object} [opts] */
export function resolveCallProductSignal(record, opts = {}) {
  const result = record?.result || {};
  const analysis = record?.analysis || result.analysis || {};
  const signals = analysis?.signals || {};
  const pass6 = record?.pass6 || result.pass6 || null;

  const gaps = (opts.productGaps || []).map((g) => ({ ...g, source: "pass6" }));
  const wins = (opts.whatWorks || []).map((w) => ({ ...w, source: "pass6" }));
  const seen = new Set([
    ...gaps.map((g) => signalKey(g.verbatim)),
    ...wins.map((w) => signalKey(w.verbatim)),
  ]);

  /** @type {object[]} */
  const asks = [];
  for (const obj of opts.objections || []) {
    const text = String(obj?.objectionText || obj?.text || "").trim();
    if (!text || seen.has(signalKey(text))) continue;
    seen.add(signalKey(text));
    asks.push({
      id: `ask_${signalKey(text)}`,
      title: askCardTitle(obj),
      raised: text,
      response: obj?.handling ? String(obj.handling).trim() : null,
      landed: obj?.landed,
      theme: obj?.theme || "product_gap",
      atS: obj?.atS ?? null,
    });
  }

  /** @type {object[]} */
  const incumbentPains = [];
  for (const line of signals.painsConfirmed || []) {
    const t = String(line || "").trim();
    if (!t || seen.has(signalKey(t))) continue;
    seen.add(signalKey(t));
    incumbentPains.push({ id: `pain_${signalKey(t)}`, label: painLabel(t) });
  }

  /** @type {object[]} */
  const integrationsNeeded = [];
  for (const g of gaps) {
    if (!isIntegrationGap(g)) continue;
    const label = integrationLabel(g);
    if (!label || integrationsNeeded.some((p) => signalKey(p.label) === signalKey(label))) continue;
    integrationsNeeded.push({ id: `int_${signalKey(label)}`, label, gap: g, surfacedOnThisCall: !!g.surfacedOnThisCall });
  }

  /** @type {object[]} */
  const competitors = [];
  for (const g of gaps) {
    const comp = g.competitorNamed;
    if (comp?.name) {
      competitors.push({
        id: `gap_comp_${signalKey(comp.name)}`,
        name: comp.name,
        saidBetter: !!comp.saidBetter,
        source: "pass6",
      });
    }
  }
  for (const line of signals.competitors || []) {
    const name = String(line || "").trim();
    if (!name) continue;
    const key = signalKey(name);
    if (competitors.some((c) => signalKey(c.name) === key)) continue;
    competitors.push({ id: `sig_comp_${key}`, name, source: "analysis" });
  }

  const nonIntegrationGaps = gaps.filter((g) => !isIntegrationGap(g));

  const voicePositive = wins.slice(0, 4).map((w) => ({
    quote: w.verbatim,
    atS: w.atS ?? null,
  }));
  const voiceNegative = [
    ...nonIntegrationGaps.slice(0, 2).map((g) => ({ quote: g.verbatim, atS: g.atS ?? null })),
    ...(signals.objectionsOpen || [])
      .slice(0, 2)
      .map((line) => ({ quote: String(line), atS: null })),
  ].slice(0, 4);

  const winPills = wins.slice(0, 6).map((w) => pillLabel(w));
  const lossPills = nonIntegrationGaps.slice(0, 6).map((g) => pillLabel(g));
  const surfacedOnThisCall =
    gaps.filter((g) => g.surfacedOnThisCall).length + wins.filter((w) => w.surfacedOnThisCall).length;

  const pass6Pending = !pass6 && !gaps.length && !wins.length;
  const hasPass6 = !!pass6 || gaps.length > 0 || wins.length > 0;
  const hasAny =
    gaps.length > 0 ||
    wins.length > 0 ||
    asks.length > 0 ||
    incumbentPains.length > 0 ||
    integrationsNeeded.length > 0 ||
    competitors.length > 0 ||
    voicePositive.length > 0 ||
    voiceNegative.length > 0;

  return {
    gaps,
    wins,
    asks,
    incumbentPains,
    integrationsNeeded,
    competitors,
    voicePositive,
    voiceNegative,
    winPills,
    lossPills,
    clusterLabels: opts.clusterLabels || {},
    dealRollup: !!opts.dealRollup,
    surfacedOnThisCall,
    pass6Pending,
    hasPass6,
    hasAny,
  };
}

function renderStatusBadge(bundle) {
  if (bundle.pass6Pending) {
    return `<span class="ps-status"><span class="ps-dot"></span>Analyzing · pass 6</span>`;
  }
  if (bundle.hasPass6) {
    return `<span class="ps-status ps-status--ready"><span class="ps-dot"></span>Ready · pass 6</span>`;
  }
  return "";
}

function renderCompBar(competitors) {
  const chips = competitors.length
    ? competitors
        .map((c) => `<span class="ps-comp"><span class="ps-cdot"></span>${esc(c.name)}</span>`)
        .join("")
    : `<span class="muted ps-comp-empty">None mentioned on this call</span>`;
  return `<div class="ps-compbar">
    <span class="ps-clabel">Competitors mentioned</span>
    ${chips}
  </div>`;
}

function renderVoiceQuote(q) {
  if (!q?.quote) return "";
  return `<div class="ps-q">
    <span class="ps-qtext">${esc(quoteText(q.quote))}</span>
    <span class="ps-qtime">${esc(formatTs(q.atS))}</span>
  </div>`;
}

function renderCustomerVoicePanel(bundle) {
  const pos = bundle.voicePositive;
  const neg = bundle.voiceNegative;

  const posLane = pos.length
    ? `<div class="ps-lane pos">
        <div class="ps-lane-head">
          <span class="ps-lane-tag pos"><span class="ps-cdot"></span>Positive</span>
          <span class="ps-lc">${pos.length} line${pos.length === 1 ? "" : "s"}</span>
        </div>
        ${pos.map(renderVoiceQuote).join("")}
      </div>`
    : `<div class="ps-lane pos"><div class="ps-lane-head"><span class="ps-lane-tag pos"><span class="ps-cdot"></span>Positive</span></div><p class="muted ps-lane-empty">No positive product quotes captured.</p></div>`;

  const negLane = neg.length
    ? `<div class="ps-lane neg">
        <div class="ps-lane-head">
          <span class="ps-lane-tag neg"><span class="ps-cdot"></span>Negative</span>
          <span class="ps-lc">${neg.length} line${neg.length === 1 ? "" : "s"}</span>
        </div>
        ${neg.map(renderVoiceQuote).join("")}
      </div>`
    : `<div class="ps-lane neg"><div class="ps-lane-head"><span class="ps-lane-tag neg"><span class="ps-cdot"></span>Negative</span></div><p class="muted ps-lane-empty">No doubts surfaced on this call.</p></div>`;

  const winPills = bundle.winPills.length
    ? bundle.winPills.map((label) => `<span class="ps-pill win">${ICON_CHECK}${esc(label)}</span>`).join("")
    : `<span class="muted ps-pill-empty">None flagged</span>`;

  const lossPills = bundle.lossPills.length
    ? bundle.lossPills.map((label) => `<span class="ps-pill loss">${ICON_X}${esc(label)}</span>`).join("")
    : `<span class="muted ps-pill-empty">None flagged</span>`;

  return `<div class="ps-panel ps-panel--voice">
    <div class="ps-sec-head">
      <h3>Customer voice</h3>
      <span class="ps-sub">How they talked about our product — what they liked, what they doubted, and how each capability landed.</span>
    </div>
    <div class="ps-lanes">${posLane}${negLane}</div>
    <div class="ps-wl">
      <div>
        <div class="ps-wlh win">Wins<span class="ps-wlc">landed well</span></div>
        <div class="ps-pills">${winPills}</div>
      </div>
      <div>
        <div class="ps-wlh loss">Losses<span class="ps-wlc">didn\u2019t land</span></div>
        <div class="ps-pills">${lossPills}</div>
      </div>
    </div>
  </div>`;
}

function renderAskCard(ask) {
  const resolved = ask.landed === true;
  const statusCls = resolved ? "resolved" : "open";
  const statusLabel = resolved ? "Resolved" : "Open";
  const theme = ask.theme ? String(ask.theme).replace(/_/g, " ") : "product gap";
  return `<article class="ps-ask ${statusCls}">
    <div class="ps-ask-top">
      <div class="ps-ask-title">${esc(ask.title)}</div>
      <span class="ps-ask-time">${esc(formatTs(ask.atS))}</span>
    </div>
    <div class="ps-chips">
      <span class="ps-chip ${statusCls}"><span class="ps-cdot"></span>${esc(statusLabel)}</span>
      <span class="ps-chip tag">${esc(theme)}</span>
    </div>
    <div class="ps-well voice">
      <span class="ps-well-lbl">Raised</span>
      <p>${esc(ask.raised)}</p>
    </div>
    <div class="ps-well reply">
      <span class="ps-well-lbl">SE response</span>
      <p>${esc(ask.response || "— No response captured")}</p>
    </div>
  </article>`;
}

function renderAsksPanel(asks) {
  const body = asks.length
    ? `<div class="ps-asks-stack">${asks.map(renderAskCard).join("")}</div>`
    : `<p class="muted ps-panel-empty">No asks or objections captured on this call.</p>`;
  return `<div class="ps-panel ps-panel--asks">
    <div class="ps-sec-head">
      <h3>Asks &amp; objections</h3>
      ${asks.length ? `<span class="ps-n">${asks.length}</span>` : ""}
      <span class="ps-sub">What the customer pushed on, and how the room handled it.</span>
    </div>
    ${body}
  </div>`;
}

function renderSurfacedPill(onThisCall) {
  if (!onThisCall) return "";
  return `<span class="ps-chip tag"><span class="ps-cdot"></span>Surfaced in this conversation</span>`;
}

function renderPainGrid(items, emptyHint) {
  if (!items.length) {
    return `<p class="muted ps-panel-empty">${esc(emptyHint)}</p>`;
  }
  return `<div class="ps-pains">${items
    .map(
      (p) =>
        `<div class="ps-pain"><span class="ps-pdot"></span><span>${esc(p.label)}</span>${renderSurfacedPill(p.surfacedOnThisCall)}</div>`,
    )
    .join("")}</div>`;
}

function renderBottomPanel(title, count, subtitle, items, emptyHint) {
  return `<div class="ps-panel ps-panel--bottom">
    <div class="ps-sec-head">
      <h3>${esc(title)}</h3>
      ${count ? `<span class="ps-n">${count}</span>` : ""}
      <span class="ps-sub">${esc(subtitle)}</span>
    </div>
    ${renderPainGrid(items, emptyHint)}
  </div>`;
}

function renderSignalCardBody(bundle) {
  return `${renderCompBar(bundle.competitors)}
    <div class="ps-main-grid">
      ${renderAsksPanel(bundle.asks)}
      ${renderCustomerVoicePanel(bundle)}
    </div>
    <div class="ps-bottom-grid">
      ${renderBottomPanel(
        "Confirmed incumbent pains",
        bundle.incumbentPains.length,
        "Gaps in the customer\u2019s current tool that they confirmed on the call \u2014 what\u2019s pushing them to switch.",
        bundle.incumbentPains,
        "No incumbent pains confirmed on this call.",
      )}
      ${renderBottomPanel(
        "Integrations needed",
        bundle.integrationsNeeded.length,
        "Connectors, APIs, or native integrations the customer asked for or that surfaced as gaps.",
        bundle.integrationsNeeded,
        "No integration requirements surfaced on this call.",
      )}
    </div>`;
}

function renderDealRollupBanner(bundle) {
  if (!bundle.dealRollup) return "";
  const n = bundle.surfacedOnThisCall || 0;
  const tail = n
    ? `${n} signal${n === 1 ? "" : "s"} first surfaced on this call.`
    : "Signals from prior calls on this deal are included below.";
  return `<p class="ps-deal-banner muted">${esc(tail)}</p>`;
}

/** @param {object} record @param {object} [opts] */
export function renderCallProductSignalTab(record, opts = {}) {
  const bundle = resolveCallProductSignal(record, opts);
  const statusHtml = renderStatusBadge(bundle);
  const subtitle = bundle.dealRollup
    ? "Product signals across this deal — gaps, wins, and objections accumulated from every call."
    : "What the customer asked for, pushed back on, and measured us against on this call.";

  if (!bundle.hasAny) {
    const pending = bundle.pass6Pending
      ? "Pass 6 product extraction may still be running — refresh in a minute."
      : "Pass 6 ran but found no explicit product signal in the transcript.";
    return `<section class="card ps-signal-card ps-signal-card--wireframe">
      <div class="ps-head">
        <div>
          <h2>Product signal</h2>
          <p class="sub">${esc(subtitle)}</p>
        </div>
        ${statusHtml}
      </div>
      <div class="ps-empty-inner">
        <p class="muted">Nothing product-specific was extracted yet.</p>
        <p class="sub">${esc(pending)}</p>
      </div>
    </section>`;
  }

  return `<section class="card ps-signal-card ps-signal-card--wireframe">
    <div class="ps-head">
      <div>
        <h2>Product signal</h2>
        <p class="sub">${esc(subtitle)}</p>
        ${renderDealRollupBanner(bundle)}
      </div>
      ${statusHtml}
    </div>
    ${renderSignalCardBody(bundle)}
  </section>`;
}

export { pillLabel as formatProductAreaLabel };
