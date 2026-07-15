/**
 * SE coaching view — aggregate quality charts (deduped by call identity).
 */

import { buildDashboardMetrics, renderCoachingCharts } from "./dashboard.js";

/**
 * @param {HTMLElement} container
 * @param {string} email
 * @param {{ onOpenCall?: (id: string) => void }} opts
 */
export function renderCoaching(container, email, opts = {}) {
  const metrics = buildDashboardMetrics(email);

  container.innerHTML = `
    <div class="dash-one-pager one-pager coaching-view">
      <div class="head dash-head">
        <h1 class="one-pager-title">My coaching</h1>
        <span class="sub muted">Quality trends across your analyzed calls — re-analyses of the same recording count once.</span>
      </div>
      ${renderCoachingCharts(metrics)}
    </div>`;

  container.querySelectorAll(".dash-call-link").forEach((btn) => {
    btn.onclick = () => opts.onOpenCall?.(btn.dataset.callId);
  });
}
