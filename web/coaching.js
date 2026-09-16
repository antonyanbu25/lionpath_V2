/**
 * SE coaching view — private score trends and receipts (spec §11.7).
 */

import { buildDashboardMetrics, renderCoachingCharts } from "./dashboard.js";
import { wireScoreDisputes } from "./score-disputes.js";

/**
 * @param {ParentNode} root
 * @param {(id: string, opts?: { tab?: string, expandTheme?: string }) => void} onOpenCall
 */
function wireCoachingCallLinks(root, onOpenCall) {
  root.querySelectorAll(".dash-call-link[data-call-id]").forEach((btn) => {
    const id = btn.dataset.callId;
    if (!id) return;
    const open = () => {
      onOpenCall?.(id, {
        tab: btn.dataset.callTab || "qip",
        expandTheme: btn.dataset.expandTheme || undefined,
      });
    };
    btn.addEventListener("click", open);
    btn.addEventListener("fwClick", open);
  });
}

/**
 * @param {HTMLElement} container
 * @param {string} email
 * @param {{ onOpenCall?: (id: string, opts?: { tab?: string, expandTheme?: string }) => void }} opts
 */
export function renderCoaching(container, email, opts = {}) {
  const metrics = buildDashboardMetrics(email);

  container.innerHTML = `
    <div class="dash-one-pager one-pager coaching-view coaching-view--wireframe">
      <div class="head dash-head coaching-head">
        <h1 class="one-pager-title">Your coaching</h1>
        <p class="sub muted coaching-privacy">Private to you. Your manager sees trends and themes, never a leaderboard.</p>
      </div>
      ${renderCoachingCharts(metrics)}
    </div>`;

  wireCoachingCallLinks(container, opts.onOpenCall);
  wireScoreDisputes(container, email);
}
