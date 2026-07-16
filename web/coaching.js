/**
 * SE coaching view — aggregate quality charts (deduped by call identity).
 */

import { buildDashboardMetrics, renderCoachingCharts, buildCoachingNudge, renderCoachingNudgeCard } from "./dashboard.js";
import { wireCallLinks } from "./crayons-ui.js";

/**
 * @param {HTMLElement} container
 * @param {string} email
 * @param {{ onOpenCall?: (id: string) => void }} opts
 */
export function renderCoaching(container, email, opts = {}) {
  const metrics = buildDashboardMetrics(email);
  const nudge = buildCoachingNudge(email, metrics);

  container.innerHTML = `
    <div class="dash-one-pager one-pager coaching-view">
      <div class="head dash-head">
        <h1 class="one-pager-title">Coaching</h1>
        <span class="sub muted">Quality trends across your analyzed calls — re-analyses of the same recording count once.</span>
      </div>
      ${renderCoachingNudgeCard(nudge)}
      ${renderCoachingCharts(metrics)}
    </div>`;

  wireCallLinks(container, opts.onOpenCall);
}
