/**
 * Product signal dashboard — clustered gaps + what landed (spec §11.10, ADR-006).
 */

import { WORKER_BASE_URL } from "./firebase-config.js";
import { getStore } from "./domain/store.js";
import {
  buildAiResidencyJoinInsight,
  isProductSignalCurator,
  loadProductSignalDashboard,
  publishGapCluster,
  runGapClusteringJob,
} from "./domain/product-signal-service.js";
import { formatCompactUsd } from "./deal-view.js";
import { esc } from "./shared.js";

const GAP_STATUS_LABELS = {
  draft: "Triage",
  in_review: "Under review",
  published: "Published",
  routed_enablement: "Enablement",
  published_enablement: "Shipped",
  dismissed: "Dismissed",
  merged: "Merged",
};

const GAP_STATUS_COLORS = {
  draft: "grey",
  in_review: "yellow",
  published: "blue",
  routed_enablement: "orange",
  published_enablement: "green",
  dismissed: "grey",
  merged: "grey",
};

const DISPOSITION_LABELS = {
  hard_blocker: "Hard blocker",
  workaround_offered: "Workaround",
  roadmap_deflection: "Roadmap",
  se_didnt_know: "SE didn't know",
};

function formatUsd(n) {
  if (n == null || !Number.isFinite(n)) return "-";
  return formatCompactUsd(n);
}

function formatProductArea(area, subArea) {
  const a = String(area || "other").replace(/_/g, " ");
  if (!subArea || subArea === "other") return a;
  return `${a} › ${String(subArea).replace(/_/g, " ")}`;
}

function statusTag(label, color = "grey") {
  return `<fw-tag text="${esc(label)}" color="${esc(color)}"></fw-tag>`;
}

function renderThemeBars(themes, barClass) {
  if (!themes.length) {
    return `<p class="muted">Not enough TC data yet; reason-for-evaluation and why-AI populate after discovery and demo calls.</p>`;
  }
  return themes
    .map(
      (t) => `
    <div class="ps-theme-bar-row">
      <div class="ps-theme-bar-head">
        <span>${esc(t.label)}</span>
        <span class="ps-theme-bar-pct num">${esc(String(t.pct))}%</span>
      </div>
      <div class="ps-theme-bar-track"><span class="ps-theme-bar-fill ${barClass}" style="width:${Math.max(t.pct, 4)}%"></span></div>
    </div>`,
    )
    .join("");
}

function renderSummaryMetrics(summary) {
  return `
    <div class="dash-stats prep-action-grid product-signal-stats product-signal-stats--five product-signal-metrics-wire">
      <div class="dash-stat prep-action-block product-signal-metric-card">
        <span class="dash-stat-label">Distinct gaps</span>
        <span class="dash-stat-value product-signal-metric-num">${esc(String(summary.distinctClusters))}</span>
        <span class="dash-stat-sub product-signal-metric-hint">from ${esc(String(summary.rawGapCount))} raw asks</span>
      </div>
      <div class="dash-stat prep-action-block product-signal-metric-card">
        <span class="dash-stat-label">ARR touched</span>
        <span class="dash-stat-value product-signal-metric-num">${esc(formatUsd(summary.arrTouched))}</span>
        <span class="dash-stat-sub product-signal-metric-hint">${esc(String(summary.dealCount))} deals</span>
      </div>
      <div class="dash-stat prep-action-block product-signal-metric-card">
        <span class="dash-stat-label">Hard blockers</span>
        <span class="dash-stat-value product-signal-metric-num ps-stat-warn">${esc(String(summary.hardBlockerCount))}</span>
        <span class="dash-stat-sub product-signal-metric-hint">${esc(formatUsd(summary.blockerArr))} exposed</span>
      </div>
      <div class="dash-stat prep-action-block product-signal-metric-card">
        <span class="dash-stat-label">Enablement gaps</span>
        <span class="dash-stat-value product-signal-metric-num ps-stat-amber">${esc(String(summary.enablementCount))}</span>
        <span class="dash-stat-sub product-signal-metric-hint">we already do this</span>
      </div>
      <div class="dash-stat prep-action-block product-signal-metric-card">
        <span class="dash-stat-label">Loop closed</span>
        <span class="dash-stat-value product-signal-metric-num">${esc(String(summary.loopClosed))}</span>
        <span class="dash-stat-sub product-signal-metric-hint">SE told outcome</span>
      </div>
    </div>`;
}

function renderNotWorkingRow({ cluster, members, sampleVerbatim, meta }) {
  const tags = (cluster.crossCuttingTags || [])
    .slice(0, 3)
    .map((t) => `<fw-tag text="${esc(t.replace(/_/g, " "))}" color="orange"></fw-tag>`)
    .join(" ");
  const areaGap = members.find((g) => g.productArea) || members[0];
  const areaLabel = formatProductArea(
    cluster.productArea || areaGap?.productArea,
    areaGap?.subArea,
  );
  const typeLabel = meta.gapType === "enablement_gap" ? "Enablement" : "Real gap";
  const typeColor = meta.gapType === "enablement_gap" ? "orange" : "red";
  const status = GAP_STATUS_LABELS[meta.gapStatus] || meta.gapStatus || "Triage";
  const statusColor = GAP_STATUS_COLORS[meta.gapStatus] || "grey";
  const competitorNote = meta.competitor?.name
    ? `<div class="muted ps-competitor-note">${esc(meta.competitor.name)}${meta.competitor.saidBetter ? " · said better" : ""}</div>`
    : "";
  const blockerNote =
    meta.disposition === "hard_blocker" || meta.dealImpact === "blocker"
      ? `<fw-tag text="${esc(DISPOSITION_LABELS.hard_blocker)}" color="red"></fw-tag>`
      : meta.disposition
        ? `<fw-tag text="${esc(DISPOSITION_LABELS[meta.disposition] || meta.disposition)}" color="yellow"></fw-tag>`
        : "";

  return `
    <tr class="product-signal-cluster-row" data-cluster-id="${esc(cluster.id)}">
      <td class="ps-col-gap">
        <div class="ps-cluster-label">${esc(cluster.label || "Untitled theme")}</div>
        ${sampleVerbatim ? `<div class="muted ps-cluster-sample">"${esc(sampleVerbatim.slice(0, 120))}${sampleVerbatim.length > 120 ? "…" : ""}"</div>` : ""}
        ${competitorNote}
      </td>
      <td>${statusTag(areaLabel, "blue")}</td>
      <td class="ps-col-tags">${tags || `<span class="muted">-</span>`}</td>
      <td class="ps-col-num">${esc(String(cluster.dealCount ?? 0))}</td>
      <td class="ps-col-num ps-col-arr">${esc(formatUsd(cluster.arrTotal))}</td>
      <td class="ps-col-type">
        ${statusTag(typeLabel, typeColor)}
        ${blockerNote}
      </td>
      <td>${statusTag(status, statusColor)}</td>
      <td class="ps-col-actions">
        ${
          cluster.status === "draft"
            ? `<fw-button class="ps-publish-btn" size="small" color="primary" data-cluster-id="${esc(cluster.id)}">Publish</fw-button>`
            : `<span class="muted">-</span>`
        }
      </td>
    </tr>`;
}

function renderWorkingRow(row) {
  const refLabel =
    row.referenceCount > 0
      ? `<fw-tag text="${esc(String(row.referenceCount))} account${row.referenceCount === 1 ? "" : "s"}" color="green"></fw-tag>`
      : `<span class="muted">-</span>`;
  return `
    <tr>
      <td class="ps-col-gap">
        <div class="ps-cluster-label">${esc(row.label)}</div>
        ${row.sampleVerbatim ? `<div class="muted ps-cluster-sample">${esc(row.sampleVerbatim.slice(0, 120))}${row.sampleVerbatim.length > 120 ? "…" : ""}</div>` : ""}
      </td>
      <td>${statusTag(formatProductArea(row.productArea), "blue")}</td>
      <td class="ps-col-num">${esc(String(row.dealCount))}</td>
      <td>${refLabel}</td>
    </tr>`;
}

/**
 * @param {object|null} session
 * @param {HTMLElement} container
 * @param {{ onRefresh?: () => void }} [opts]
 */
export async function renderProductSignalView(session, container, opts = {}) {
  if (!session?.orgId) {
    container.innerHTML = `<p class="muted">Org context required for product signal.</p>`;
    return;
  }
  if (!isProductSignalCurator(session)) {
    container.innerHTML = `<p class="muted">Product signal is for PM and admin roles only.</p>`;
    return;
  }

  const store = getStore();
  if (!store.listGapClustersByOrg) {
    container.innerHTML = `<p class="muted">Product signal store is not available.</p>`;
    return;
  }

  container.innerHTML = `<p class="muted">Loading product signal…</p>`;

  try {
    const data = await loadProductSignalDashboard(store, session.orgId);
    const { summary, clusterRows, workingRows, aiThemes, residencyGaps, topCluster, clusteringState } =
      data;

    const notWorkingRows = clusterRows.map(renderNotWorkingRow).join("");
    const workingTableRows = workingRows.map(renderWorkingRow).join("");

    const residencyInsight = buildAiResidencyJoinInsight(
      topCluster,
      aiThemes.decline,
      residencyGaps,
      formatUsd,
    );

    const enablementNote =
      summary.enablementCount > 0 && summary.distinctClusters > 0
        ? `<div class="product-signal-note card-wire card-wire--tight">
            <strong>${esc(String(summary.enablementCount))} of ${esc(String(summary.distinctClusters))} are enablement gaps</strong>. the product already does it and the SE didn't know. Those route to enablement, not a PM's backlog. Sorting them out is most of the value on this screen.
          </div>`
        : "";

    const pending = clusteringState?.pendingGapCount ?? 0;
    const lastRun = clusteringState?.lastFullRunAt || clusteringState?.lastIncrementalAt;
    const callSubtitle = summary.callCount
      ? `Clustered from ${summary.callCount} calls across your org. Every row is a theme, not a ticket.`
      : "Clustered from verbatim embeddings, not taxonomy labels.";

    container.innerHTML = `
      <div class="product-signal-view product-signal-view--wireframe">
        <header class="product-signal-head">
          <div>
            <h1 class="product-signal-title">Product signal</h1>
            <p class="muted product-signal-sub">${esc(callSubtitle)}</p>
          </div>
          <div class="product-signal-actions">
            <fw-button id="ps-recluster-btn" color="secondary" fill="outline" size="small">Recluster now</fw-button>
            <span id="ps-job-status" class="muted ps-job-status" hidden></span>
          </div>
        </header>
        ${renderSummaryMetrics(summary)}
        ${enablementNote}
        <p class="muted ps-pipeline-meta">
          Pending unclustered gaps: ${esc(String(pending))}
          ${lastRun ? ` · Last run ${esc(new Date(lastRun).toLocaleString())}` : ""}
        </p>

        <div class="card-wire product-signal-table-card">
          <div class="prep-form-eyebrow product-signal-eyebrow">What's not working</div>
          <div class="product-signal-table-wrap">
            <table class="product-signal-table">
              <thead>
                <tr>
                  <th class="ps-col-gap-head">Gap</th>
                  <th>Area</th>
                  <th>Tags</th>
                  <th>Deals</th>
                  <th>ARR</th>
                  <th>Type</th>
                  <th>Status</th>
                  <th></th>
                </tr>
              </thead>
              <tbody>${notWorkingRows || `<tr><td colspan="8" class="muted">No clusters yet. Run post-call analysis to create gaps, then recluster.</td></tr>`}</tbody>
            </table>
          </div>
        </div>

        <div class="card-wire product-signal-table-card">
          <div class="prep-form-eyebrow product-signal-eyebrow">What's working · reference and case study pipeline</div>
          <div class="product-signal-table-wrap">
            <table class="product-signal-table">
              <thead>
                <tr>
                  <th class="ps-col-gap-head">What landed</th>
                  <th>Area</th>
                  <th>Deals</th>
                  <th>Reference candidate</th>
                </tr>
              </thead>
              <tbody>${workingTableRows || `<tr><td colspan="4" class="muted">No positive signal yet. What landed rows appear after Pass 6 analysis.</td></tr>`}</tbody>
            </table>
          </div>
        </div>

        <div class="product-signal-ai-grid">
          <div class="card-wire card-wire--tight product-signal-ai-card">
            <h2 class="ps-ai-title">Why customers opt into AI</h2>
            <p class="muted ps-ai-sub">${esc(String(aiThemes.optInDeals))} deals with AI attach · reason-for-evaluation is the attach story</p>
            <div class="ps-theme-bars">${renderThemeBars(aiThemes.optIn, "ps-bar-opt-in")}</div>
            ${
              aiThemes.optIn.some((t) => t.label.includes("Copilot"))
                ? `<p class="muted ps-ai-footnote">Copilot shown in demo is a leading opt-in driver; that number is an enablement argument.</p>`
                : ""
            }
          </div>
          <div class="card-wire card-wire--tight product-signal-ai-card">
            <h2 class="ps-ai-title">Why they don't</h2>
            <p class="muted ps-ai-sub">${esc(String(aiThemes.declineDeals))} deals where AI was shown and declined</p>
            <div class="ps-theme-bars">${renderThemeBars(aiThemes.decline, "ps-bar-decline")}</div>
            ${residencyInsight ? `<p class="muted ps-ai-footnote">${esc(residencyInsight)}</p>` : ""}
          </div>
        </div>
      </div>`;

    const statusEl = container.querySelector("#ps-job-status");
    const setStatus = (msg, isError = false) => {
      if (!statusEl) return;
      statusEl.textContent = msg;
      statusEl.hidden = !msg;
      statusEl.classList.toggle("warn", isError);
    };

    container.querySelector("#ps-recluster-btn")?.addEventListener("fwClick", () => {
      void (async () => {
        setStatus("Clustering…");
        try {
          const result = await runGapClusteringJob(getStore(), WORKER_BASE_URL, session.orgId, {
            force: true,
            mode: "full",
          });
          if (result.skipped) {
            setStatus(`Skipped: ${result.reason || "unknown"}`);
          } else {
            setStatus(`Done. ${result.mode} run, ${result.clusterCount} clusters updated.`);
            opts.onRefresh?.();
            await renderProductSignalView(session, container, opts);
          }
        } catch (err) {
          setStatus(err?.message || "Clustering failed", true);
        }
      })();
    });

    container.querySelectorAll(".ps-publish-btn").forEach((btn) => {
      btn.addEventListener("fwClick", () => {
        void (async () => {
          const clusterId = btn.dataset.clusterId;
          const row = container.querySelector(`tr[data-cluster-id="${clusterId}"]`);
          const current = row?.querySelector(".ps-cluster-label")?.textContent?.trim() || "";
          const label = window.prompt("Publish cluster label:", current);
          if (label == null) return;
          try {
            await publishGapCluster(getStore(), clusterId, label);
            setStatus("Cluster published.");
            await renderProductSignalView(session, container, opts);
          } catch (err) {
            setStatus(err?.message || "Publish failed", true);
          }
        })();
      });
    });
  } catch (err) {
    console.error("[product-signal-view]", err);
    container.innerHTML = `<p class="muted">Could not load product signal.</p>`;
  }
}

/** @param {object} gap @param {string|null} [clusterLabel] @param {string|null} [loopNote] */
export function renderCallProductGapRow(gap, clusterLabel, loopNote) {
  const status = GAP_STATUS_LABELS[gap.status] || gap.status || "draft";
  const statusColor = GAP_STATUS_COLORS[gap.status] || "grey";
  const typeLabel = gap.gapType === "enablement_gap" ? "Enablement" : "Real gap";
  const typeColor = gap.gapType === "enablement_gap" ? "orange" : "red";
  const closed = ["published", "published_enablement", "dismissed", "merged"].includes(gap.status);
  const loopHtml = closed
    ? `<p class="muted call-product-gap-loop"><strong>Outcome:</strong> ${esc(loopNote || status)}${gap.arbitrationNote ? `. ${esc(gap.arbitrationNote)}` : ""}</p>`
    : `<p class="muted call-product-gap-loop">Status: ${esc(status)}. PM triage in progress.</p>`;

  return `
    <div class="call-product-gap-row">
      <div class="call-product-gap-head">
        <span class="call-product-gap-area">${esc(formatProductArea(gap.productArea, gap.subArea))}</span>
        ${statusTag(typeLabel, typeColor)}
        ${statusTag(status, statusColor)}
        ${gap.competitorNamed?.name ? statusTag(gap.competitorNamed.name, "grey") : ""}
      </div>
      <blockquote class="call-product-gap-verbatim">${esc(gap.verbatim || "")}</blockquote>
      <p class="muted call-product-gap-meta">
        ${gap.arrTouched != null ? `ARR touched ${esc(formatUsd(gap.arrTouched))}` : ""}
        ${clusterLabel ? ` · Cluster: ${esc(clusterLabel)}` : ""}
      </p>
      ${loopHtml}
    </div>`;
}
