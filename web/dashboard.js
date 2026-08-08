/**
 * Role-aware dashboards — SE launchpad + manager team view.
 * Coaching charts exported for coaching.js.
 */

import { listAnalysesWithQuality, listPostCallAnalyses, mergePostCallRecordsIntoLocal } from "./history.js";
import { dedupeAnalysesByCallIdentity } from "./call-identity.js";
import {
  normalizeQualityCoach,
  scoreBand,
  qipScoreBand,
  isEligibleForAggregate,
  typeComposite,
  spineComposite,
  themeAverage,
  formatTypeComposite,
} from "./quality-score.js";
import { themeLabel } from "./theme-library.js";
import { CALL_TYPES, heatmapThemeKeys, isProvisionalCallType } from "./rubric-profiles.js";
import { buildTeamThemeAverages as teamThemeAveragesFromAccess } from "./domain/se-access-service.js";
import { aggregateFollowUps } from "./follow-ups.js";
import { listTeamSeEmails, listTeamSeEmailsAsync, displayNameForEmail } from "./auth.js";
import { getStore } from "./domain/store.js";
import { mapEmailToTeamName } from "./domain/org-service.js";
import { renderTaskBoard, renderTaskCharts, aggregateTaskMetrics, listTasks } from "./tasks.js";
import { countPrepsGenerated, loadAllLocalBriefs } from "./precall.js?v=2.1.14";
import { mergeAllBriefs } from "./briefs-list-view.js";
import { buildLaunchpadCallMetricsFromRecords } from "./calls-list-view.js";
import { renderLoadingPanel, wireCallLinks } from "./crayons-ui.js";
import { esc } from "./shared.js";
import { resolveCallTitleFromRecord } from "./call-type-labels.js";
import {
  hasCoachingAnalysis,
  postCallRecordsToAnalyses,
  hydratePostCallAnalyses,
  loadTeamCallSummariesFromStore,
} from "./domain/postcall-hydrate.js";
import { loadScoreOverridesForSession } from "./domain/score-override-service.js";
import { applyScoreOverridesToScorecard } from "./shared/qip-scorecard-normalize.js";
import { getSessionGreeting } from "./greeting.js";
import {
  getOrgMetricsReadModel,
  getSeLaunchpadReadModel,
  getTeamMetricsReadModel,
} from "./domain/read-models-service.js";
import {
  normalizeDimensionKey,
  barClass,
  scorePct,
  momentumClass,
  radarDimensionLabel,
  renderRadarLabelText,
  heatmapShadeForScore,
  TREND_LINE_COLORS,
  CHART_SCORE_BANDS,
} from "./chart-shared.js";

export { radarDimensionLabel } from "./chart-shared.js";

const DIMENSION_ORDER = [
  "discovery",
  "demoalignment",
  "objections",
  "valuearticulation",
  "nextstepclarity",
  "talkbalance",
];

function sortDimensions(dimensions) {
  return [...dimensions].sort((a, b) => {
    const ia = DIMENSION_ORDER.indexOf(normalizeDimensionKey(a.name));
    const ib = DIMENSION_ORDER.indexOf(normalizeDimensionKey(b.name));
    if (ia === -1 && ib === -1) return a.name.localeCompare(b.name);
    if (ia === -1) return 1;
    if (ib === -1) return -1;
    return ia - ib;
  });
}

const COACHING_AGG_OPTS = { requireHighConfidence: true };
const QIP_SCORE_MAX = 100;
const COACHING_TREND_MAX = 14;
const COACHING_RECEIPT_MAX = 3;
const COACHING_QUEUE_SCORE_MAX = 70;
const COACHING_QUEUE_MAX = 12;
const MANAGER_DEALS_MAX = 15;

const CALL_TYPE_LABELS = {
  demo: "Demo",
  discovery: "Discovery",
  technical_deep_dive: "Technical deep dive",
  reverse_demo: "Reverse demo",
  use_case_discussion: "Use case discussion",
  trial_setup: "Trial setup",
  troubleshooting: "Troubleshooting",
  qa_session: "Q&A session",
};

const TREND_TYPE_COLORS = TREND_LINE_COLORS;

/** @param {object} rec @param {object[]} [overrides] */
function scorecardFromRecord(rec, overrides = []) {
  const scorecard = rec.scorecard || rec.result?.scorecard;
  const meta = rec.analysisMeta || rec.result?.analysisMeta || {};
  if (!scorecard?.lines?.length) {
    if (scorecard?.overall != null || scorecard?.categoryScores) {
      const base = {
        callType: scorecard.callType || meta.callType || "demo",
        rubricVersion: scorecard.rubricVersion || meta.rubricVersion || "2.1",
        overall: scorecard.overall ?? null,
        categoryScores: scorecard.categoryScores || {},
        lines: [],
        provisional: scorecard.provisional ?? meta.provisional,
        confidence: scorecard.confidence ?? meta.analysisConfidence,
        callId: rec.id,
      };
      return applyScoreOverridesToScorecard(base, overrides);
    }
    return null;
  }
  const base = {
    callType: scorecard.callType || meta.callType || "demo",
    rubricVersion: scorecard.rubricVersion || meta.rubricVersion || "2.1",
    overall: scorecard.overall ?? (typeof scorecard.rawScore === "number" ? scorecard.rawScore / 10 : null),
    lines: scorecard.lines,
    provisional: scorecard.provisional ?? meta.provisional,
    confidence: scorecard.confidence ?? meta.analysisConfidence,
    callId: rec.id,
  };
  return applyScoreOverridesToScorecard(base, overrides);
}

/** Shadow + low-confidence exclusion for coaching averages (§6.6 / §9). */
function isCoachingQueueEligible(rec) {
  const scorecard = scorecardFromRecord(rec);
  if (scorecard) {
    return isEligibleForAggregate(scorecard, COACHING_AGG_OPTS);
  }
  // Legacy qualityCoach — no provisional flag; include
  return !!rec.analysis?.qualityCoach;
}

function legacyDimensionMetrics(records) {
  const dimMap = new Map();
  for (const rec of records) {
    const qc = normalizeQualityCoach(rec.analysis?.qualityCoach);
    for (const d of qc.dimensions || []) {
      const key = normalizeDimensionKey(d.name);
      const cur = dimMap.get(key) || {
        name: d.name,
        scoreSum: 0,
        maxScore: d.maxScore || 5,
        count: 0,
      };
      cur.scoreSum += d.score ?? 0;
      cur.count += 1;
      cur.maxScore = d.maxScore || cur.maxScore;
      dimMap.set(key, cur);
    }
  }
  return sortDimensions(
    [...dimMap.values()].map((d) => ({
      name: d.name,
      avgScore: d.scoreSum / d.count,
      maxScore: d.maxScore,
      count: d.count,
    })),
  );
}

function rankDimensions(dimensions) {
  const ranked = [...dimensions].sort((a, b) => b.avgScore / b.maxScore - a.avgScore / a.maxScore);
  return {
    bestDimension: ranked[0] || null,
    worstDimension: ranked[ranked.length - 1] || null,
  };
}

function formatEvidenceTimestamp(atS) {
  if (atS == null || !Number.isFinite(atS)) return null;
  const s = Math.max(0, Math.floor(atS));
  const m = Math.floor(s / 60);
  const sec = s % 60;
  return `${String(m).padStart(2, "0")}:${String(sec).padStart(2, "0")}`;
}

function formatPerTypeHeadline(typeResult, callCount) {
  if (typeResult.score == null) return null;
  const type = typeResult.callType || "call";
  const ver = typeResult.rubricVersion || "1.0";
  const countLabel = callCount === 1 ? "1 call" : `${callCount} calls`;
  return {
    headline: `${Math.round(typeResult.score)} ${type} (v${ver})`,
    sub: countLabel,
  };
}

function countScorecardsByType(scorecards) {
  const counts = new Map();
  for (const sc of scorecards) {
    const ct = sc.callType || "demo";
    counts.set(ct, (counts.get(ct) || 0) + 1);
  }
  return counts;
}

/** @param {object[]} coachingRecords */
function buildTrendByCallType(coachingRecords) {
  const sorted = [...coachingRecords]
    .filter((rec) => scorecardFromRecord(rec))
    .sort((a, b) => (a.timestamp || 0) - (b.timestamp || 0))
    .slice(-COACHING_TREND_MAX);

  const points = sorted.map((rec) => {
    const sc = scorecardFromRecord(rec);
    const callType = sc.callType || "demo";
    const perCall = typeComposite([sc], callType, COACHING_AGG_OPTS);
    const score = perCall.score ?? spineComposite([sc], COACHING_AGG_OPTS).score;
    return {
      callId: rec.id,
      timestamp: rec.timestamp,
      callType,
      score,
    };
  });

  const callTypes = [...new Set(points.map((p) => p.callType))];
  const series = Object.fromEntries(
    callTypes.map((ct) => [ct, points.filter((p) => p.callType === ct && p.score != null)]),
  );
  return { points, callTypes, series };
}

/** @param {object[]} coachingRecords @param {string} themeKey */
function collectWeakestThemeReceipts(coachingRecords, themeKey, limit = COACHING_RECEIPT_MAX) {
  if (!themeKey) return [];
  const receipts = [];

  for (const rec of coachingRecords) {
    const sc = scorecardFromRecord(rec);
    if (!sc) continue;
    const line = (sc.lines || []).find(
      (l) => l.themeKey === themeKey && l.applicable !== false && !l.evidenceUnavailable && !l.modelOmitted,
    );
    if (!line) continue;
    const evidence = (line.subParameters || [])
      .flatMap((sp) => sp?.evidence || [])
      .concat(line.evidence || line.evidenceJson || [])
      .filter((e) => e?.quote);
    if (!evidence.length) continue;
    const ev = evidence[0];
    receipts.push({
      callId: rec.id,
      company: companyFromRecord(rec),
      timestamp: rec.timestamp,
      themeKey,
      lineScore: line.grade ?? line.score,
      quote: ev.quote,
      atS: ev.atS,
      provisional: !!sc.provisional,
    });
  }

  return receipts.sort((a, b) => a.lineScore - b.lineScore).slice(0, limit);
}

/** @param {object[]} deduped */
function buildScoredCallsList(deduped) {
  return deduped
    .map((rec) => {
      const sc = scorecardFromRecord(rec);
      if (!sc) return null;
      const meta = rec.analysisMeta || rec.result?.analysisMeta || {};
      const callType = sc.callType || meta.callType || "demo";
      const composite = typeComposite(
        [{
          callType,
          rubricVersion: sc.rubricVersion || meta.rubricVersion || "1.0",
          lines: sc.lines,
          provisional: sc.provisional ?? meta.provisional,
          confidence: sc.confidence ?? meta.analysisConfidence,
        }],
        callType,
        { includeIneligible: true },
      );
      const conf = sc.confidence ?? meta.analysisConfidence;
      const company = companyFromRecord(rec);
      return {
        id: rec.id,
        company,
        callTitle: resolveCallTitleFromRecord(rec, { accountName: company }),
        timestamp: rec.timestamp,
        callType,
        callTypeLabel: CALL_TYPE_LABELS[callType] || callType,
        rubricVersion: sc.rubricVersion || meta.rubricVersion || "1.0",
        confidence: conf,
        confidencePct: conf != null ? Math.round(conf * 100) : null,
        score: composite.score,
        scoreLabel: formatTypeComposite(composite),
        provisional: !!(sc.provisional ?? meta.provisional),
        eligible: isCoachingQueueEligible(rec),
      };
    })
    .filter(Boolean)
    .sort((a, b) => (b.timestamp || 0) - (a.timestamp || 0));
}

function emptyQualityMetrics() {
  return {
    totalCalls: 0,
    provisionalExcluded: 0,
    spine: { score: null, themeCount: 0, callCount: 0, coverage: 0 },
    byType: [],
    trendByType: { points: [], callTypes: [], series: {} },
    weakestReceipts: [],
    scoredCalls: [],
    avgOverall: null,
    dimensions: [],
    bestDimension: null,
    worstDimension: null,
    recentCalls: [],
    scoreTrend: [],
    scoreBands: { excellent: 0, strong: 0, good: 0, developing: 0, needsFocus: 0 },
    usesLegacyCoach: false,
  };
}

/**
 * Coaching metrics — spine + per-type + theme averages. Never blends weighted composites across types (§6.1).
 * @param {object[]} analyses — records from history.js
 */
export function aggregateQualityMetrics(analyses) {
  const deduped = dedupeAnalysesByCallIdentity(analyses);
  const coachingRecords = deduped.filter(isCoachingQueueEligible);
  const scorecards = coachingRecords.map(scorecardFromRecord).filter(Boolean);
  const provisionalExcluded = deduped.filter((rec) => {
    const sc = scorecardFromRecord(rec);
    return sc && !isCoachingQueueEligible(rec);
  }).length;

  if (scorecards.length) {
    const spine = spineComposite(scorecards, COACHING_AGG_OPTS);
    const typeCounts = countScorecardsByType(scorecards);
    const callTypes = [...new Set(scorecards.map((sc) => sc.callType).filter(Boolean))];
    const byType = callTypes.map((callType) => ({
      callType,
      callCount: typeCounts.get(callType) || 0,
      ...typeComposite(scorecards, callType, COACHING_AGG_OPTS),
    }));
    const themeKeys = [
      ...new Set(scorecards.flatMap((sc) => (sc.lines || []).map((l) => l.themeKey))),
    ];
    const dimensions = themeKeys
      .map((themeKey) => {
        const avg = themeAverage(scorecards, themeKey, null, COACHING_AGG_OPTS);
        if (avg.score == null) return null;
        return {
          name: themeKey,
          avgScore: avg.score,
          maxScore: avg.maxScore,
          count: avg.count,
        };
      })
      .filter(Boolean)
      .sort((a, b) => a.name.localeCompare(b.name));
    const { bestDimension, worstDimension } = rankDimensions(dimensions);
    const scoreBands = { excellent: 0, strong: 0, good: 0, developing: 0, needsFocus: 0 };
    const trendByType = buildTrendByCallType(coachingRecords);
    const weakestReceipts = collectWeakestThemeReceipts(
      coachingRecords,
      worstDimension?.name,
      COACHING_RECEIPT_MAX,
    );
    const scoredCalls = buildScoredCallsList(deduped);

    const recentCalls = coachingRecords.slice(0, 10).map((r) => {
      const sc = scorecardFromRecord(r);
      const perCall = sc
        ? typeComposite([sc], sc.callType, { includeIneligible: true })
        : { score: null, callType: sc?.callType };
      const perCallSpine = sc ? spineComposite([sc], { includeIneligible: true }).score : null;
      const trendScore = sc?.overall ?? perCall.score ?? perCallSpine;
      if (trendScore != null) scoreBands[qipScoreBand(trendScore)] += 1;
      const mom = r.analysis?.momentum || {};
      const company = companyFromRecord(r);
      const nextStep = (r.analysis?.nextSteps || []).find((s) => s.action)?.action
        || mom.topAction
        || "-";
      return {
        id: r.id,
        title: r.title,
        company,
        timestamp: r.timestamp,
        overallScore: trendScore,
        callType: sc?.callType,
        typeCompositeLabel: sc ? formatTypeCompositeLabel(perCall) : null,
        momentum: mom.status || "Stalled",
        nextAction: nextStep,
      };
    });

    return {
      totalCalls: scorecards.length,
      provisionalExcluded,
      spine,
      byType,
      trendByType,
      weakestReceipts,
      scoredCalls,
      avgOverall:
        spine.score ??
        (byType.length === 1 ? byType[0].score : null),
      dimensions,
      bestDimension,
      worstDimension,
      recentCalls,
      scoreTrend: [...recentCalls].reverse(),
      scoreBands,
      usesLegacyCoach: false,
    };
  }

  const withQc = coachingRecords
    .filter((a) => a.analysis?.qualityCoach)
    .map((rec) => ({ ...rec, _qc: normalizeQualityCoach(rec.analysis.qualityCoach) }));
  const totalCalls = withQc.length;
  if (!totalCalls) return emptyQualityMetrics();

  const dimensions = legacyDimensionMetrics(withQc);
  const { bestDimension, worstDimension } = rankDimensions(dimensions);
  const scoreBands = { excellent: 0, strong: 0, good: 0, developing: 0, needsFocus: 0 };
  const recentCalls = withQc.slice(0, 10).map((r) => {
    const qc = r._qc;
    const overall = qc.overallScore ?? 0;
    scoreBands[scoreBand(overall)] += 1;
    const mom = r.analysis?.momentum || {};
    const company = companyFromRecord(r);
    const nextStep = (r.analysis?.nextSteps || []).find((s) => s.action)?.action
      || mom.topAction
      || "-";
    return {
      id: r.id,
      title: r.title,
      company,
      timestamp: r.timestamp,
      overallScore: overall,
      overallLabel: qc.overallLabel,
      momentum: mom.status || "Stalled",
      nextAction: nextStep,
    };
  });

  return {
    totalCalls,
    provisionalExcluded,
    spine: { score: null, themeCount: 0, callCount: 0, coverage: 0 },
    byType: [],
    trendByType: { points: [], callTypes: [], series: {} },
    weakestReceipts: [],
    scoredCalls: buildScoredCallsList(deduped),
    avgOverall: null,
    dimensions,
    bestDimension,
    worstDimension,
    recentCalls,
    scoreTrend: [...recentCalls].reverse(),
    scoreBands,
    usesLegacyCoach: true,
  };
}

function formatTypeCompositeLabel(result) {
  if (result.score == null) return null;
  return `${result.score} / 100 (${result.callType})`;
}

function dimensionDisplayLabel(name, usesLegacyCoach) {
  return usesLegacyCoach ? radarDimensionLabel(name) : themeLabel(name);
}

export function buildDashboardMetrics(email) {
  return aggregateQualityMetrics(listAnalysesWithQuality(email));
}

function companyFromRecord(record) {
  const a = record.analysis || {};
  const title = a.callHeader?.title || record.title || "Call";
  const parts = String(title).split(/[·|–—-]/);
  return (parts[0] || title).trim();
}

function formatDate(ts) {
  if (!ts) return "";
  return new Date(ts).toLocaleString(undefined, {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
}

function formatShortDate(ts) {
  if (!ts) return "";
  return new Date(ts).toLocaleDateString(undefined, { month: "short", day: "numeric" });
}

function formatTrendLabel(ts, idx, total) {
  if (!ts) return `#${idx + 1}`;
  const d = new Date(ts);
  if (total <= 4) {
    return d.toLocaleString(undefined, { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" });
  }
  return d.toLocaleString(undefined, { month: "short", day: "numeric" });
}

export function buildCoachingNudge(email, metrics) {
  const deduped = dedupeAnalysesByCallIdentity(listPostCallAnalyses(email));
  const themes = new Map();

  for (const rec of deduped) {
    const missed = rec.analysis?.qualityCoach?.missedOpportunities || [];
    for (const m of missed) {
      const t = String(m ?? "").trim();
      if (!t || t.toLowerCase() === "unknown") continue;
      themes.set(t, (themes.get(t) || 0) + 1);
    }
  }

  const recurring = [...themes.entries()]
    .filter(([, c]) => c >= 2)
    .sort((a, b) => b[1] - a[1])[0];

  if (recurring) {
    return `Recurring missed opportunity: "${recurring[0]}" across ${recurring[1]} calls.`;
  }
  if (metrics.worstDimension) {
    const w = metrics.worstDimension;
    const label = dimensionDisplayLabel(w.name, metrics.usesLegacyCoach);
    const max = metrics.usesLegacyCoach ? w.maxScore : QIP_SCORE_MAX;
    return `Your lowest theme is ${label} (${w.avgScore.toFixed(1)}/${max} avg).`;
  }
  if (metrics.totalCalls) {
    return "Review dimension breakdowns below to spot coaching themes.";
  }
  return "Analyze a few calls to unlock personalized coaching insights.";
}

function renderScoreGauge(score, max = QIP_SCORE_MAX, title = "Spine composite") {
  const r = 52;
  const c = 2 * Math.PI * r;
  const pct = max && score != null ? score / max : 0;
  const dash = c * pct;
  const cls = score != null ? barClass(score, max) : "";
  const display = Number.isFinite(score) ? score.toFixed(1) : "-";
  return `
    <div class="dash-gauge-wrap">
      <p class="dash-chart-title">${esc(title)}</p>
      <div class="qc-gauge dash-gauge" role="img" aria-label="${esc(title)} ${esc(display)} out of ${esc(max)}">
        <svg class="qc-gauge-svg" viewBox="0 0 120 120" aria-hidden="true">
          <circle class="qc-gauge-track" cx="60" cy="60" r="${r}" />
          <circle class="qc-gauge-fill ${cls}" cx="60" cy="60" r="${r}"
            stroke-dasharray="${dash} ${c}" transform="rotate(-90 60 60)" />
        </svg>
        <div class="qc-gauge-text">
          <span class="qc-gauge-score ${cls}">${esc(display)}</span>
          <span class="qc-gauge-denom">/${esc(max)}</span>
        </div>
      </div>
    </div>`;
}

function renderRadarChart(dimensions, usesLegacyCoach = false) {
  if (!dimensions?.length) {
    return `<div class="dash-radar-empty muted">No dimension data yet.</div>`;
  }
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
        ${renderRadarLabelText(dimensionDisplayLabel(d.name, usesLegacyCoach), lx, ly, angle)}`;
    })
    .join("");
  const dataPts = dimensions.map((d, i) => {
    const pct = d.avgScore / d.maxScore;
    const angle = (Math.PI * 2 * i) / n - Math.PI / 2;
    const rad = maxR * pct;
    return `${cx + rad * Math.cos(angle)},${cy + rad * Math.sin(angle)}`;
  });
  const dots = dimensions
    .map((d, i) => {
      const pct = d.avgScore / d.maxScore;
      const angle = (Math.PI * 2 * i) / n - Math.PI / 2;
      const rad = maxR * pct;
      return `<circle class="qc-radar-dot" cx="${cx + rad * Math.cos(angle)}" cy="${cy + rad * Math.sin(angle)}" r="3.5" />`;
    })
    .join("");
  return `
    <div class="qc-radar-wrap dash-radar-wrap">
      <p class="qc-radar-title">Average dimension profile</p>
      <svg class="qc-radar" viewBox="0 0 260 260" role="img" aria-label="Radar chart of average dimension scores">
        ${rings}
        ${axes}
        <polygon class="qc-radar-data" points="${dataPts.join(" ")}" />
        ${dots}
      </svg>
    </div>`;
}

function renderDimensionBarChart(dimensions, usesLegacyCoach = false) {
  if (!dimensions.length) return "";
  const rows = dimensions
    .map((d) => {
      const pct = scorePct(d.avgScore, d.maxScore);
      const cls = barClass(d.avgScore, d.maxScore);
      return `
        <div class="dash-dim-row">
          <span class="dash-dim-label">${esc(dimensionDisplayLabel(d.name, usesLegacyCoach))}</span>
          <span class="qc-dim-bar dash-dim-bar" aria-hidden="true">
            <span class="qc-dim-bar-fill ${cls}" style="width:${pct}%"></span>
          </span>
          <span class="qc-dim-score ${cls} dash-dim-score">${d.avgScore.toFixed(1)}/${d.maxScore}</span>
        </div>`;
    })
    .join("");
  return `
    <section class="dash-section dash-dim-chart">
      <h2 class="dash-section-title">${usesLegacyCoach ? "Dimension averages" : "Theme averages"}</h2>
      <fw-card class="dash-dim-card">
        <div class="dash-dim-rows">${rows}</div>
      </fw-card>
    </section>`;
}

function renderTrendChart(trend, usesLegacyCoach = false) {
  if (!trend.length) return "";
  const w = 320;
  const h = 140;
  const padL = 28;
  const padR = 12;
  const padT = 12;
  const padB = 32;
  const chartW = w - padL - padR;
  const chartH = h - padT - padB;
  const n = trend.length;
  const barGap = n > 1 ? Math.min(8, chartW / (n * 4)) : 0;
  const barW = n ? (chartW - barGap * (n - 1)) / n : chartW;
  const maxScore = usesLegacyCoach ? 10 : QIP_SCORE_MAX;
  const midScore = usesLegacyCoach ? 5 : 50;

  const bars = trend
    .map((c, i) => {
      const score = c.overallScore ?? 0;
      const barH = (score / maxScore) * chartH;
      const x = padL + i * (barW + barGap);
      const y = padT + chartH - barH;
      const cls = barClass(score, maxScore);
      const label = formatTrendLabel(c.timestamp, i, n);
      return `
        <g class="dash-trend-bar-group">
          <rect class="dash-trend-bar ${cls}" x="${x}" y="${y}" width="${barW}" height="${barH}" rx="3"
            aria-label="${esc(label)}: ${score}/${maxScore}" />
          <text class="dash-trend-label" x="${x + barW / 2}" y="${h - 8}" text-anchor="middle">${esc(label)}</text>
          <text class="dash-trend-value ${cls}" x="${x + barW / 2}" y="${y - 4}" text-anchor="middle">${score}</text>
        </g>`;
    })
    .join("");

  const gridLines = [0, midScore, maxScore]
    .map((v) => {
      const y = padT + chartH - (v / maxScore) * chartH;
      return `
        <line class="dash-trend-grid" x1="${padL}" y1="${y}" x2="${w - padR}" y2="${y}" />
        <text class="dash-trend-axis" x="${padL - 6}" y="${y + 4}" text-anchor="end">${v}</text>`;
    })
    .join("");

  return `
    <section class="dash-section dash-trend-section">
      <h2 class="dash-section-title">Score trend</h2>
      <fw-card class="dash-trend-card">
        <p class="muted dash-chart-sub">Last ${n} call${n === 1 ? "" : "s"} · oldest → newest · per-call type composite</p>
        <svg class="dash-trend-svg" viewBox="0 0 ${w} ${h}" role="img" aria-label="Score trend over recent calls">
          ${gridLines}
          ${bars}
        </svg>
      </fw-card>
    </section>`;
}

function renderScoreDistribution(bands, total, usesLegacyCoach = false) {
  if (!total) return "";
  const segments = usesLegacyCoach
    ? [
        { key: "excellent", label: "Excellent (9+)", count: bands.excellent, cls: "good" },
        { key: "strong", label: "Strong (7–8.9)", count: bands.strong, cls: "ok" },
        { key: "good", label: "Good (5.5–6.9)", count: bands.good, cls: "ok" },
        { key: "developing", label: "Developing (4–5.4)", count: bands.developing, cls: "ok" },
        { key: "needsFocus", label: "Needs focus (<4)", count: bands.needsFocus, cls: "weak" },
      ]
    : [
        { key: "excellent", label: "Excellent (90+)", count: bands.excellent, cls: "good" },
        { key: "strong", label: "Strong (70–89)", count: bands.strong, cls: "ok" },
        { key: "good", label: "Good (55–69)", count: bands.good, cls: "ok" },
        { key: "developing", label: "Developing (40–54)", count: bands.developing, cls: "ok" },
        { key: "needsFocus", label: "Needs focus (<40)", count: bands.needsFocus, cls: "weak" },
      ];
  const r = 44;
  const c = 2 * Math.PI * r;
  let angleOffset = -90;
  const arcs = segments
    .filter((s) => s.count > 0)
    .map((s) => {
      const frac = s.count / total;
      const dash = c * frac;
      const rot = angleOffset;
      angleOffset += frac * 360;
      return `<circle class="dash-donut-seg ${s.cls}" cx="60" cy="60" r="${r}"
        stroke-dasharray="${dash} ${c - dash}" transform="rotate(${rot} 60 60)" />`;
    })
    .join("");

  const legend = segments
    .map((s) => {
      const pct = total ? Math.round((s.count / total) * 100) : 0;
      return `
        <div class="dash-donut-legend-item">
          <span class="dash-donut-swatch ${s.cls}" aria-hidden="true"></span>
          <span class="dash-donut-legend-label">${esc(s.label)}</span>
          <span class="dash-donut-legend-count qc-dim-score ${s.cls}">${s.count} <span class="muted">(${pct}%)</span></span>
        </div>`;
    })
    .join("");

  return `
    <section class="dash-section dash-distribution-section">
      <h2 class="dash-section-title">Score distribution</h2>
      <fw-card class="dash-distribution-card">
        <div class="dash-distribution">
          <div class="dash-donut-wrap" role="img" aria-label="Call score distribution across ${total} calls">
            <svg class="dash-donut-svg" viewBox="0 0 120 120" aria-hidden="true">
              <circle class="dash-donut-track" cx="60" cy="60" r="${r}" />
              ${arcs}
            </svg>
            <div class="dash-donut-center">
              <span class="dash-donut-total">${total}</span>
              <span class="dash-donut-total-label">calls</span>
            </div>
          </div>
          <div class="dash-donut-legend">${legend}</div>
        </div>
      </fw-card>
    </section>`;
}

function renderCoachingPerTypeStats(byType) {
  if (!byType?.length) return "";
  return byType
    .map((t) => {
      const headline = formatPerTypeHeadline(t, t.callCount || 0);
      if (!headline) return "";
      const cls = barClass(t.score, QIP_SCORE_MAX);
      return `
        <div class="dash-stat prep-action-block coaching-metric-card coaching-type-stat">
          <span class="dash-stat-label">${esc(CALL_TYPE_LABELS[t.callType] || t.callType)} average</span>
          <span class="dash-stat-value coaching-metric-num ${cls}">${Math.round(t.score)}</span>
          <span class="dash-stat-sub muted coaching-metric-hint">${esc(headline.sub)} · weighted within type</span>
        </div>`;
    })
    .join("");
}

function renderCoachingThemeStat(label, dimension, legacy, toneCls) {
  if (!dimension) {
    return `
      <div class="dash-stat prep-action-block coaching-metric-card">
        <span class="dash-stat-label">${esc(label)}</span>
        <span class="dash-stat-value coaching-metric-theme">-</span>
      </div>`;
  }
  return `
    <div class="dash-stat prep-action-block coaching-metric-card coaching-theme-metric">
      <span class="dash-stat-label">${esc(label)}</span>
      <span class="dash-stat-value coaching-metric-theme ${toneCls}">${esc(dimensionDisplayLabel(dimension.name, legacy))}</span>
      <span class="dash-stat-sub coaching-metric-hint">${dimension.avgScore.toFixed(0)} · all types</span>
    </div>`;
}

function renderCoachingTrendByType(trendByType, usesLegacyCoach = false) {
  if (usesLegacyCoach) return renderTrendChart(trendByType?.points || [], true);
  const points = trendByType?.points || [];
  if (!points.length) return "";

  const w = 480;
  const h = 150;
  const padL = 30;
  const padR = 12;
  const padT = 16;
  const padB = 28;
  const chartW = w - padL - padR;
  const chartH = h - padT - padB;
  const maxScore = QIP_SCORE_MAX;
  const n = points.length;

  const gridLines = [100, 70, 40]
    .map((v) => {
      const y = padT + chartH - (v / maxScore) * chartH;
      return `
        <line class="dash-trend-grid" x1="${padL}" y1="${y}" x2="${w - padR}" y2="${y}" />
        <text class="dash-trend-axis" x="4" y="${y + 4}">${v}</text>`;
    })
    .join("");

  const xForIndex = (idx) => (n <= 1 ? padL + chartW / 2 : padL + (idx / (n - 1)) * chartW);
  const yForScore = (score) => padT + chartH - (score / maxScore) * chartH;

  const polylines = (trendByType.callTypes || [])
    .map((callType, typeIdx) => {
      const style = TREND_TYPE_COLORS[typeIdx % TREND_TYPE_COLORS.length];
      const pts = points
        .map((p, idx) => (p.callType === callType && p.score != null ? `${xForIndex(idx)},${yForScore(p.score)}` : null))
        .filter(Boolean);
      if (pts.length < 2) {
        const dots = points
          .map((p, idx) =>
            p.callType === callType && p.score != null
              ? `<circle cx="${xForIndex(idx)}" cy="${yForScore(p.score)}" r="3.5" fill="${style.stroke}" />`
              : "",
          )
          .join("");
        return dots;
      }
      return `<polyline class="coaching-trend-line" points="${pts.join(" ")}" fill="none" stroke="${style.stroke}" stroke-width="2.2"${style.dash ? ` stroke-dasharray="${style.dash}"` : ""} />`;
    })
    .join("");

  const legend = (trendByType.callTypes || [])
    .map((callType, typeIdx) => {
      const style = TREND_TYPE_COLORS[typeIdx % TREND_TYPE_COLORS.length];
      const count = trendByType.series?.[callType]?.length || 0;
      return `
        <span class="coaching-trend-legend-item">
          <span class="coaching-trend-swatch" style="background:${style.stroke}${style.dash ? ";opacity:.85" : ""}"></span>
          ${esc(CALL_TYPE_LABELS[callType] || callType)} (${count})
        </span>`;
    })
    .join("");

  const typeLegend = (trendByType.callTypes || [])
    .map((callType, typeIdx) => {
      const style = TREND_TYPE_COLORS[typeIdx % TREND_TYPE_COLORS.length];
      const label = (CALL_TYPE_LABELS[callType] || callType).toLowerCase();
      return `${label}${style.dash ? " dashed" : " solid"}`;
    })
    .join(", ");

  return `
    <div class="coaching-chart-card card-wire card-wire--tight">
      <h2 class="coaching-card-title">Score trend</h2>
      <p class="muted coaching-card-sub">Last ${n} scored call${n === 1 ? "" : "s"}${typeLegend ? ` · ${typeLegend}` : ""}</p>
      <svg class="dash-trend-svg coaching-trend-svg" viewBox="0 0 ${w} ${h}" role="img" aria-label="Score trend segmented by call type">
        ${gridLines}
        ${polylines}
      </svg>
      <div class="coaching-trend-legend">${legend}</div>
    </div>`;
}

function renderCoachingThemeBars(dimensions, usesLegacyCoach = false) {
  if (!dimensions.length) return "";
  const sorted = [...dimensions].sort((a, b) => b.avgScore - a.avgScore);
  const rows = sorted
    .map((d) => {
      const pct = scorePct(d.avgScore, d.maxScore);
      const cls = barClass(d.avgScore, d.maxScore);
      return `
        <div class="dash-dim-row coaching-theme-row">
          <span class="dash-dim-label">${esc(dimensionDisplayLabel(d.name, usesLegacyCoach))}</span>
          <span class="qc-dim-bar dash-dim-bar" aria-hidden="true">
            <span class="qc-dim-bar-fill ${cls}" style="width:${pct}%"></span>
          </span>
          <span class="qc-dim-score ${cls} dash-dim-score">${d.avgScore.toFixed(0)}</span>
        </div>`;
    })
    .join("");
  return `
    <div class="coaching-chart-card card-wire card-wire--tight">
      <h2 class="coaching-card-title">Themes</h2>
      <p class="muted coaching-card-sub">Across all call types · comparable because themes are shared</p>
      <div class="dash-dim-rows coaching-theme-rows">${rows}</div>
    </div>`;
}

function renderCoachingReceipts(worstDimension, receipts, legacy) {
  if (!worstDimension || !receipts?.length) {
    return `
      <div class="coaching-receipts-card card-wire card-wire--tight">
        <h2 class="coaching-card-title">Your weakest theme, with the receipts</h2>
        <p class="muted coaching-card-sub">Analyze more calls with timestamped evidence to unlock coaching receipts.</p>
      </div>`;
  }

  const label = dimensionDisplayLabel(worstDimension.name, legacy);
  const rows = receipts
    .map((r) => {
      const ts = formatEvidenceTimestamp(r.atS);
      const dateLabel = formatShortDate(r.timestamp);
      const metaParts = [r.company, dateLabel];
      if (ts) metaParts.push(ts);
      const meta = metaParts.map((p) => esc(String(p))).join(" · ");
      const prov = r.provisional
        ? ' <span class="qip-provisional-badge" title="Shadow mode (excluded from averages)">Provisional</span>'
        : "";
      return `
        <article class="coaching-ev coaching-ev--bad${r.lineScore < 55 ? " coaching-ev--weak" : ""}">
          <button type="button" class="coaching-receipt-link dash-call-link" data-call-id="${esc(r.callId)}" data-call-tab="qip" data-expand-theme="${esc(r.themeKey)}">
            <div class="coaching-ev-ts">${meta}${prov}</div>
            <div class="coaching-ev-body">${esc(r.quote)}</div>
          </button>
          <button type="button" class="score-dispute-trigger coaching-receipt-dispute" data-call-id="${esc(r.callId)}" data-theme-key="${esc(r.themeKey)}" data-score="${esc(String(r.lineScore))}" data-company="${esc(r.company)}">Dispute</button>
        </article>`;
    })
    .join("");

  return `
    <div class="coaching-receipts-card card-wire card-wire--tight">
      <h2 class="coaching-card-title">Your weakest theme, with the receipts</h2>
      <p class="muted coaching-receipts-sub">${esc(label)} · ${worstDimension.avgScore.toFixed(0)} average · scored on ${worstDimension.count} call${worstDimension.count === 1 ? "" : "s"}</p>
      <div class="coaching-receipt-list">${rows}</div>
    </div>`;
}

function renderCoachingScoredCallsTable(scoredCalls) {
  if (!scoredCalls?.length) return "";
  const rows = scoredCalls
    .map((c) => {
      const conf = c.confidencePct != null ? `${c.confidencePct}%` : "-";
      const scoreCell = c.provisional
        ? `<span class="coaching-call-score">${esc(c.scoreLabel)} <span class="qip-provisional-badge" title="Shadow mode (excluded from averages)">Provisional</span></span>`
        : `<span class="coaching-call-score">${esc(c.scoreLabel)}</span>`;
      return `
        <tr class="coaching-call-row">
          <td class="coaching-calls-col-call">
            <button type="button" class="coaching-call-link dash-call-link" data-call-id="${esc(c.id)}" data-call-tab="qip">${esc(c.callTitle || c.company)}</button>
          </td>
          <td>${esc(c.callTypeLabel)}</td>
          <td class="muted">${esc(c.company)}</td>
          <td class="muted coaching-calls-col-date">${esc(formatShortDate(c.timestamp))}</td>
          <td>v${esc(c.rubricVersion)}</td>
          <td>${esc(conf)}</td>
          <td>${scoreCell}</td>
          <td>
            <button type="button" class="score-dispute-trigger coaching-call-dispute" data-call-id="${esc(c.id)}" data-score="${esc(String(c.score ?? ""))}" data-company="${esc(c.company)}">Dispute</button>
          </td>
        </tr>`;
    })
    .join("");

  return `
    <div class="coaching-calls-card card-wire">
      <div class="prep-form-eyebrow coaching-calls-eyebrow">Your scored calls · every type is scored</div>
      <div class="coaching-calls-table-wrap">
        <table class="coaching-calls-table">
          <thead>
            <tr>
              <th class="coaching-calls-col-call">Call</th>
              <th>Type</th>
              <th>Account</th>
              <th>Date</th>
              <th>Profile</th>
              <th>Conf</th>
              <th>Score</th>
              <th></th>
            </tr>
          </thead>
          <tbody>${rows}</tbody>
        </table>
      </div>
    </div>`;
}

export function renderCoachingCharts(metrics) {
  if (!metrics.totalCalls && !metrics.scoredCalls?.length) {
    return `
      <fw-card class="dash-empty">
        <fw-icon class="dash-empty-icon" name="nav-dashboard" size="24" aria-hidden="true"></fw-icon>
        <h2>No coaching data yet</h2>
        <p class="muted">Analyze a few calls to see per-type averages, theme bars, trends, and timestamped receipts.</p>
      </fw-card>`;
  }

  const legacy = metrics.usesLegacyCoach;
  const provNote =
    metrics.provisionalExcluded > 0
      ? `<p class="coaching-provisional-note muted">${metrics.provisionalExcluded} provisional call${metrics.provisionalExcluded === 1 ? "" : "s"} excluded from averages.</p>`
      : "";

  if (legacy) {
    return `
      ${provNote}
      <div class="dash-stats prep-action-grid coaching-stats">
        <div class="dash-stat prep-action-block">
          <span class="dash-stat-label">Calls analyzed</span>
          <span class="dash-stat-value">${metrics.totalCalls}</span>
        </div>
        ${renderCoachingThemeStat("Strongest dimension", metrics.bestDimension, true, "good")}
        ${renderCoachingThemeStat("Focus area", metrics.worstDimension, true, "weak")}
      </div>
      ${renderDimensionBarChart(metrics.dimensions, true)}
      <div class="dash-charts-bottom">
        ${renderTrendChart(metrics.scoreTrend, true)}
        ${renderScoreDistribution(metrics.scoreBands, metrics.totalCalls, true)}
      </div>`;
  }

  return `
    ${provNote}
    <div class="dash-stats prep-action-grid coaching-stats coaching-stats-wire">
      ${renderCoachingPerTypeStats(metrics.byType)}
      ${renderCoachingThemeStat("Strongest theme", metrics.bestDimension, false, "good")}
      ${renderCoachingThemeStat("Weakest theme", metrics.worstDimension, false, "weak")}
    </div>
    <div class="coaching-two-averages-note">
      <strong>Why two averages.</strong> Each call type uses its own weight profile, so a single blended QIP would be meaningless. Theme scores compare across every type; composites only compare within one.
      <span class="coaching-spine-note">Shared themes (core four) compare call_flow, engagement, objections, and camera_on across every type, not your overall grade.</span>
    </div>
    <div class="coaching-charts-grid">
      ${renderCoachingTrendByType(metrics.trendByType, false)}
      ${renderCoachingThemeBars(metrics.dimensions, false)}
    </div>
    ${renderCoachingReceipts(metrics.worstDimension, metrics.weakestReceipts, false)}
    ${renderCoachingScoredCallsTable(metrics.scoredCalls)}`;
}

function renderOverviewEmptyState() {
  return `
    <fw-card class="dash-empty launch-empty">
      <fw-icon class="dash-empty-icon" name="add-note" size="24" aria-hidden="true"></fw-icon>
      <h3>Get started</h3>
      <p class="muted">Run pre-call prep or analyze a recording to populate your task list.</p>
      <p class="task-empty-links">
        <fw-button color="link" data-action="prep">Pre-call prep</fw-button>
        ·
        <fw-button color="link" data-action="analyze">Analyze a recording</fw-button>
      </p>
    </fw-card>`;
}

function firstNameFromDisplay(seName) {
  const name = String(seName || "").trim();
  if (!name) return "there";
  return name.split(/\s+/)[0];
}

const KPI_SNAPSHOT_PREFIX = "se-sp-kpi-snapshot:";

function readKpiSnapshot(email) {
  const key = String(email || "").trim().toLowerCase();
  if (!key) return null;
  try {
    const raw =
      sessionStorage.getItem(`${KPI_SNAPSHOT_PREFIX}${key}`) ??
      localStorage.getItem(`${KPI_SNAPSHOT_PREFIX}${key}`);
    if (!raw) return null;
    const snap = JSON.parse(raw);
    return snap && typeof snap === "object" ? snap : null;
  } catch {
    return null;
  }
}

function writeKpiSnapshot(email, data) {
  const key = String(email || "").trim().toLowerCase();
  if (!key || !data) return;
  try {
    const json = JSON.stringify({ ...data, savedAt: Date.now() });
    sessionStorage.setItem(`${KPI_SNAPSHOT_PREFIX}${key}`, json);
    localStorage.setItem(`${KPI_SNAPSHOT_PREFIX}${key}`, json);
  } catch {
    // ignore quota / private-mode errors
  }
}

function metricsFromKpiSnapshot(snap) {
  if (!snap) return null;
  return {
    taskMetrics: {
      openTotal: snap.openTotal ?? 0,
      overdueOpen: snap.overdueOpen ?? 0,
      completedThisWeek: snap.completedThisWeek ?? 0,
    },
    launchCallMetrics: {
      totalCalls: snap.totalCalls ?? 0,
      callsThisWeek: snap.callsThisWeek ?? 0,
    },
    prepsCount: snap.prepsCount ?? 0,
  };
}

function kpiSnapshotFromMetrics(taskMetrics, launchCallMetrics, prepsCount) {
  return {
    openTotal: taskMetrics?.openTotal ?? 0,
    overdueOpen: taskMetrics?.overdueOpen ?? 0,
    completedThisWeek: taskMetrics?.completedThisWeek ?? 0,
    totalCalls: launchCallMetrics?.totalCalls ?? 0,
    callsThisWeek: launchCallMetrics?.callsThisWeek ?? 0,
    prepsCount: prepsCount ?? 0,
  };
}

function callsThisWeekCount(callMetrics) {
  return callMetrics.callsThisWeek ?? 0;
}

function renderLaunchKpis(taskMetrics, callMetrics, prepsCount, kpiOpts = {}) {
  const remotePending = kpiOpts.remotePending || {};
  const syncing = kpiOpts.syncing || {};
  const kpiValue = (value, stat) => {
    const pending =
      (stat === "calls" && remotePending.calls) ||
      (!value && stat === "preps" && remotePending.preps);
    if (pending) {
      return `<span class="launch-kpi-value launch-kpi-value--pending" data-stat="${stat}" aria-busy="true"><span class="launch-kpi-shimmer" aria-hidden="true"></span></span>`;
    }
    const syncMark = syncing[stat]
      ? `<span class="launch-kpi-syncing" aria-hidden="true" title="Syncing latest counts">↻</span>`
      : "";
    const cls = syncing[stat] ? " launch-kpi-value--syncing" : "";
    return `<span class="launch-kpi-value${cls}" data-stat="${stat}">${value}${syncMark}</span>`;
  };

  const overdueDelta =
    taskMetrics.overdueOpen > 0
      ? `${taskMetrics.overdueOpen} overdue`
      : taskMetrics.openTotal
        ? "On track"
        : "";
  const overdueCls = taskMetrics.overdueOpen > 0 ? "warn" : taskMetrics.openTotal ? "good" : "muted";

  const callsWeek = callsThisWeekCount(callMetrics);
  const callsDelta = callsWeek > 0 ? `↑ ${callsWeek} this week` : "";
  const callsDeltaCls = callsWeek > 0 ? "good" : "muted";

  const prepsDelta = prepsCount > 0 ? `${prepsCount} total` : "";
  const prepsDeltaCls = prepsCount > 0 ? "good" : "muted";

  return `
    <div class="launch-kpi-grid" aria-label="Dashboard summary">
      <button type="button" class="launch-kpi-card" data-kpi-nav="tasks" aria-label="Open tasks — view task board">
        <div class="launch-kpi-head">
          <span class="launch-kpi-label">Open tasks</span>
          <span class="launch-kpi-icon tile-clay" aria-hidden="true">☑</span>
        </div>
        <div class="launch-kpi-foot">
          ${kpiValue(taskMetrics.openTotal, "open")}
          ${overdueDelta ? `<span class="launch-kpi-delta ${overdueCls}">${esc(overdueDelta)}</span>` : ""}
        </div>
      </button>
      <button type="button" class="launch-kpi-card" data-kpi-nav="calls" aria-label="Calls analysed — view all calls">
        <div class="launch-kpi-head">
          <span class="launch-kpi-label">Calls analysed</span>
          <span class="launch-kpi-icon tile-teal" aria-hidden="true">☎</span>
        </div>
        <div class="launch-kpi-foot">
          ${kpiValue(callMetrics.totalCalls, "calls")}
          ${callsDelta && !(remotePending.calls && !callMetrics.totalCalls) ? `<span class="launch-kpi-delta ${callsDeltaCls}">${esc(callsDelta)}</span>` : ""}
        </div>
      </button>
      <button type="button" class="launch-kpi-card" data-kpi-nav="briefs" aria-label="Briefs generated — view pre-call brief">
        <div class="launch-kpi-head">
          <span class="launch-kpi-label">Briefs generated</span>
          <span class="launch-kpi-icon tile-sand" aria-hidden="true">✎</span>
        </div>
        <div class="launch-kpi-foot">
          ${kpiValue(prepsCount, "preps")}
          ${prepsDelta && !(remotePending.preps && !prepsCount) ? `<span class="launch-kpi-delta ${prepsDeltaCls}">${esc(prepsDelta)}</span>` : ""}
        </div>
      </button>
    </div>`;
}

function relativeWhen(ts) {
  if (!ts) return "";
  const diffMs = Date.now() - ts;
  const mins = Math.floor(diffMs / 60000);
  if (mins < 60) return `${Math.max(1, mins)}m ago`;
  const hours = Math.floor(mins / 60);
  if (hours < 48) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  return `${days}d ago`;
}

function renderRecentActivityRow(c, usesLegacyCoach = false) {
  const scoreMax = usesLegacyCoach ? 10 : QIP_SCORE_MAX;
  const score = c.overallScore;
  const scoreCls = score != null ? barClass(score, scoreMax) : "";
  const status =
    score != null
      ? `Analysed · ${score}/${scoreMax} score`
      : `Analysed · ${esc(c.momentum || "review")}`;
  const statusColor = scoreCls === "good" ? "var(--dew-green)" : "var(--dew-text-secondary)";
  return `
    <button type="button" class="launch-activity-row dash-call-link" data-call-id="${esc(c.id)}">
      <span class="launch-activity-inner">
        <span class="launch-activity-icon tile-teal" aria-hidden="true"><fw-icon name="phone" size="18"></fw-icon></span>
        <span class="launch-activity-body">
          <span class="launch-activity-title">${esc(c.company)} · Call debrief</span>
          <span class="launch-activity-status" style="color:${statusColor}">${status}</span>
        </span>
        <span class="launch-activity-when">${esc(relativeWhen(c.timestamp))}</span>
      </span>
    </button>`;
}

function renderRecentCallRow(c, { compact = false, usesLegacyCoach = false } = {}) {
  const momCls = momentumClass(c.momentum);
  const scoreMax = usesLegacyCoach ? 10 : QIP_SCORE_MAX;
  const score = c.overallScore;
  const scoreCls = score != null ? barClass(score, scoreMax) : "";
  const scoreLabel = score != null ? `${score}/${scoreMax}` : "-";
  const innerCls = compact ? " launch-recent-inner-side" : "";
  const nextCol = compact
    ? ""
    : `<span class="launch-recent-next muted">${esc(c.nextAction)}</span>`;
  return `
    <fw-button class="launch-recent-row dash-call-link" color="secondary" fill="clear" data-call-id="${esc(c.id)}">
      <span class="launch-recent-inner${innerCls}">
        <span class="launch-recent-company">${esc(c.company)}</span>
        <span class="launch-recent-date muted">${esc(formatShortDate(c.timestamp))}</span>
        <span class="launch-recent-momentum ${momCls}">${esc(c.momentum)}</span>
        ${nextCol}
        <span class="launch-recent-score qc-dim-score ${scoreCls}">${esc(scoreLabel)}</span>
      </span>
    </fw-button>`;
}

function renderRecentCallsLaunchpad(recentCalls, usesLegacyCoach = false) {
  const compact = recentCalls.slice(0, 5);
  if (!compact.length) {
    return `
      <section class="dash-section launch-recent" aria-labelledby="recent-heading">
        <h2 id="recent-heading" class="dash-section-title">Recent calls</h2>
        ${renderOverviewEmptyState()}
      </section>`;
  }

  const rows = compact.map((c) => renderRecentCallRow(c, { usesLegacyCoach })).join("");

  return `
    <section class="dash-section launch-recent" aria-labelledby="recent-heading">
      <h2 id="recent-heading" class="dash-section-title">Recent calls</h2>
      <fw-card class="launch-recent-list">${rows}</fw-card>
    </section>`;
}

export function renderCoachingNudgeCard(nudgeText) {
  return `
    <section class="dash-section launch-nudge" aria-labelledby="nudge-heading">
      <h2 id="nudge-heading" class="dash-section-title">Coaching nudge</h2>
      <fw-card class="launch-nudge-card">
        <p class="launch-nudge-text">${esc(nudgeText)}</p>
      </fw-card>
    </section>`;
}

function renderSideStats(taskMetrics, callMetrics, prepsCount = 0) {
  const legacy = callMetrics.usesLegacyCoach;
  const scoreMax = legacy ? 10 : QIP_SCORE_MAX;
  const headline = legacy ? null : callMetrics.spine?.score;
  const avgScore = headline != null ? headline.toFixed(1) : "-";
  const avgLabel = avgScore !== "-" ? `${avgScore}/${scoreMax} spine` : "No coaching data";
  return `
    <section class="dash-section dash-side-stats" aria-labelledby="side-stats-heading">
      <h2 id="side-stats-heading" class="dash-section-title">Snapshot</h2>
      <div class="dash-side-stats-grid">
        <div class="dash-stat prep-action-block">
          <span class="dash-stat-label">Open tasks</span>
          <span class="dash-stat-value" data-stat="open">${taskMetrics.openTotal}</span>
        </div>
        <div class="dash-stat prep-action-block">
          <span class="dash-stat-label">Preps generated</span>
          <span class="dash-stat-value" data-stat="preps">${prepsCount}</span>
        </div>
        <div class="dash-stat prep-action-block">
          <span class="dash-stat-label">Done this week</span>
          <span class="dash-stat-value good" data-stat="done-week">${taskMetrics.completedThisWeek}</span>
        </div>
        <div class="dash-stat prep-action-block">
          <span class="dash-stat-label">Calls analyzed</span>
          <span class="dash-stat-value" data-stat="calls">${callMetrics.totalCalls}</span>
          <span class="dash-stat-sub">${esc(avgLabel)}</span>
        </div>
      </div>
    </section>`;
}

function briefsCountFetcher(opts = {}) {
  return opts.fetchAllRemotePreps ?? opts.fetchRemotePreps;
}

function stopRemotePrepsSubscribe(container) {
  if (typeof container?._prepsUnsub === "function") {
    container._prepsUnsub();
    container._prepsUnsub = null;
  }
}

function stopRemoteCallsSubscribe(container) {
  if (typeof container?._callsUnsub === "function") {
    container._callsUnsub();
    container._callsUnsub = null;
  }
}

function patchLaunchKpiValue(container, stat, value) {
  const el = container.querySelector(`.launch-kpi-value[data-stat="${stat}"]`);
  if (!el) return false;
  const next = String(value);
  const syncing = el.querySelector(".launch-kpi-syncing");
  if (el.classList.contains("launch-kpi-value--pending")) {
    el.classList.remove("launch-kpi-value--pending");
    el.removeAttribute("aria-busy");
    el.innerHTML = syncing ? `${next}${syncing.outerHTML}` : next;
  } else if (el.textContent.replace(/\s*↻\s*/g, "").trim() !== next) {
    el.innerHTML = syncing ? `${next}${syncing.outerHTML}` : next;
  } else {
    return false;
  }
  const card = el.closest(".launch-kpi-card");
  const delta = card?.querySelector(".launch-kpi-delta");
  if (stat === "preps" && delta) {
    if (value > 0) {
      delta.textContent = `${value} total`;
      delta.className = "launch-kpi-delta good";
      delta.hidden = false;
    } else {
      delta.hidden = true;
    }
  }
  return true;
}

function patchLaunchKpis(container, taskMetrics, callMetrics, prepsCount) {
  patchLaunchKpiValue(container, "open", taskMetrics.openTotal);
  patchLaunchKpiValue(container, "calls", callMetrics.totalCalls);
  patchLaunchKpiValue(container, "preps", prepsCount);
}

async function applyRemoteBriefsToLaunchpad(container, email, opts, remoteBriefs) {
  if (!container?.isConnected) return;
  const prepsCount = mergeAllBriefs(loadAllLocalBriefs(), remoteBriefs || []).length;
  patchLaunchKpiValue(container, "preps", prepsCount);
  const callRecords = dedupeAnalysesByCallIdentity(listPostCallAnalyses(email));
  const usesLegacyCoach = aggregateQualityMetrics(analysesWithQualityFromRecords(callRecords)).usesLegacyCoach;
  await updateRecentActivitySection(container, callRecords, usesLegacyCoach, {
    ...opts,
    fetchAllRemotePreps: async () => remoteBriefs || [],
  });
  const taskMetrics = aggregateTaskMetrics(listTasks(email));
  const callMetrics = buildLaunchpadCallMetricsFromRecords(callRecords);
  writeKpiSnapshot(email, kpiSnapshotFromMetrics(taskMetrics, callMetrics, prepsCount));
}

function wireRemotePrepsSubscribe(container, email, opts = {}) {
  stopRemotePrepsSubscribe(container);
  if (typeof opts.subscribeRemotePreps !== "function") return;
  container._prepsUnsub = opts.subscribeRemotePreps((remoteBriefs) => {
    void applyRemoteBriefsToLaunchpad(container, email, opts, remoteBriefs);
  });
}

async function applyRemoteCallsToLaunchpad(container, email, opts, remoteCalls) {
  if (!container?.isConnected) return;
  // Persist Firestore calls to local history so the dashboard renders the value
  // instantly on return — otherwise the tile shows shimmer until the snapshot
  // network round-trip fires on every navigation back.
  mergePostCallRecordsIntoLocal(email, Array.isArray(remoteCalls) ? remoteCalls : []);
  const callRecords = dedupeAnalysesByCallIdentity(listPostCallAnalyses(email));
  const callMetrics = buildLaunchpadCallMetricsFromRecords(callRecords);
  patchLaunchKpiValue(container, "calls", callRecords.length);
  const usesLegacyCoach = aggregateQualityMetrics(analysesWithQualityFromRecords(callRecords)).usesLegacyCoach;
  await updateRecentActivitySection(container, callRecords, usesLegacyCoach, opts);
  if (!container.isConnected) return;
  const taskMetrics = aggregateTaskMetrics(listTasks(email));
  const prepsCount = loadAllLocalBriefs().length;
  writeKpiSnapshot(email, kpiSnapshotFromMetrics(taskMetrics, callMetrics, prepsCount));
}

function wireRemoteCallsSubscribe(container, email, opts = {}) {
  stopRemoteCallsSubscribe(container);
  if (typeof opts.subscribeRemoteCalls !== "function") return;
  container._callsUnsub = opts.subscribeRemoteCalls((remoteCalls) => {
    void applyRemoteCallsToLaunchpad(container, email, opts, remoteCalls);
  });
}

function withDashboardTimeout(promise, ms, label) {
  let timer;
  return Promise.race([
    promise,
    new Promise((_, reject) => {
      timer = setTimeout(() => reject(new Error(`${label} timed out after ${ms}ms`)), ms);
    }),
  ]).finally(() => clearTimeout(timer));
}

function launchpadRemotePending(callRecords, prepsCount, opts = {}, cached = null) {
  const hasRemoteHistory = typeof opts.fetchRemoteHistory === "function";
  const hasRemotePreps = typeof briefsCountFetcher(opts) === "function";
  const cachedCalls = cached?.totalCalls;
  const cachedPreps = cached?.prepsCount;
  return {
    calls:
      hasRemoteHistory &&
      ((!(callRecords?.length) && cachedCalls == null) ||
        (cachedCalls != null && (callRecords?.length ?? 0) < cachedCalls)),
    preps: hasRemotePreps && !prepsCount && cachedPreps == null,
  };
}

function launchpadSyncingFlags(callRecords, prepsCount, cached, opts = {}) {
  const hasRemoteHistory = typeof opts.fetchRemoteHistory === "function";
  const hasRemotePreps = typeof briefsCountFetcher(opts) === "function";
  const cachedMetrics = metricsFromKpiSnapshot(cached);
  return {
    calls:
      hasRemoteHistory &&
      !callRecords?.length &&
      (cachedMetrics?.launchCallMetrics?.totalCalls ?? 0) > 0,
    preps:
      hasRemotePreps && !prepsCount && (cachedMetrics?.prepsCount ?? 0) > 0,
  };
}

async function refreshLaunchpadRemote(container, email, opts = {}) {
  if (!container?.isConnected) return;
  if (
    typeof opts.fetchRemoteHistory !== "function" &&
    typeof briefsCountFetcher(opts) !== "function" &&
    typeof opts.subscribeRemoteCalls !== "function" &&
    typeof opts.subscribeRemotePreps !== "function"
  ) {
    return;
  }
  try {
    const store = getStore();
    const prepsFetcher = briefsCountFetcher(opts);
    const launchpadPromise =
      opts.session && store.getReadModel
        ? (async () => {
            const { resolveAuthIndexOwnerId, resolveEffectiveOwnerId } = await import("./domain/user-resolve.js");
            const uid =
              (await resolveAuthIndexOwnerId(opts.resolveOwnerFb, opts.session)) ||
              (await resolveEffectiveOwnerId(opts.session, undefined, opts.resolveOwnerFb)) ||
              null;
            if (!uid || String(uid).startsWith("usr_dummy_")) return null;
            try {
              return await withDashboardTimeout(
                getSeLaunchpadReadModel(store, uid),
                8000,
                "getSeLaunchpadReadModel",
              );
            } catch (err) {
              console.warn("[dashboard] launchpad read model refresh failed:", err?.message || err);
              return null;
            }
          })()
        : Promise.resolve(null);

    const realtimeCalls = typeof opts.subscribeRemoteCalls === "function";
    const realtimePreps = typeof opts.subscribeRemotePreps === "function";
    const [remoteRecords, remotePreps, launchpadDoc] = await Promise.all([
      realtimeCalls
        ? Promise.resolve(dedupeAnalysesByCallIdentity(listPostCallAnalyses(email)))
        : resolveCallRecords(email, { ...opts, skipRemoteHistory: false }),
      realtimePreps || typeof prepsFetcher !== "function"
        ? Promise.resolve(null)
        : countPrepsGenerated(prepsFetcher),
      launchpadPromise,
    ]);

    if (!container.isConnected) return;
    const remoteMetrics = aggregateQualityMetrics(analysesWithQualityFromRecords(remoteRecords));
    let remoteLaunchMetrics = buildLaunchpadCallMetricsFromRecords(remoteRecords);

    if (launchpadDoc?.qualityMetrics) {
      remoteLaunchMetrics = {
        totalCalls: launchpadDoc.callMetrics?.totalCalls ?? remoteLaunchMetrics.totalCalls,
        callsThisWeek: launchpadDoc.callMetrics?.callsThisWeek ?? remoteLaunchMetrics.callsThisWeek,
        records: remoteRecords,
      };
    }

    const refreshedActivity = await buildRecentActivity(remoteRecords, remoteMetrics.usesLegacyCoach, opts);
    if (!container.isConnected) return;
    const taskMetrics = aggregateTaskMetrics(listTasks(email));
    const prepsCount =
      remotePreps ??
      Number(
        container
          .querySelector('.launch-kpi-value[data-stat="preps"]')
          ?.textContent?.replace(/\s*↻\s*/g, "")
          .trim() || 0,
      );
    patchLaunchKpis(container, taskMetrics, remoteLaunchMetrics, prepsCount);
    const section = container.querySelector(".dash-side-recent");
    if (section) {
      const signature = recentActivitySignature(refreshedActivity);
      if (section.dataset.activitySignature !== signature) {
        section.outerHTML = renderRecentCallsSideWithItems(refreshedActivity, { onViewAll: true });
        wireRecentActivitySection(container, opts);
      }
    }
    wireCallLinks(container, opts.onOpenCall);
    writeKpiSnapshot(email, kpiSnapshotFromMetrics(taskMetrics, remoteLaunchMetrics, prepsCount));
  } catch (err) {
    console.warn("[dashboard] remote refresh failed:", err?.message || err);
  }
}

function analysesWithQualityFromRecords(records) {
  return (records || []).filter(
    (r) => r.analysis?.qualityCoach || r.scorecard?.lines?.length || r.result?.scorecard?.lines?.length,
  );
}

/** Sync remote history at query time when auth is ready (mirrors briefs KPI lazy fetch). */
async function resolveCallRecords(email, opts = {}) {
  if (opts.skipRemoteHistory !== true && typeof opts.fetchRemoteHistory === "function") {
    try {
      const synced = await opts.fetchRemoteHistory();
      if (Array.isArray(synced)) {
        return dedupeAnalysesByCallIdentity(synced);
      }
    } catch (err) {
      console.warn("[dashboard] remote history fetch failed:", err?.message || err);
    }
  }
  return dedupeAnalysesByCallIdentity(listPostCallAnalyses(email));
}

/** Instant shell while launchpad metrics resolve. */
export function renderDashboardLoadingShell(container) {
  if (!container) return;
  container.innerHTML = `
    <div class="dash-one-pager one-pager launchpad launchpad--loading" role="status" aria-live="polite" aria-busy="true">
      <div class="launch-hero">
        <div class="launch-skeleton launch-skeleton--title" aria-hidden="true"></div>
      </div>
      <div class="launch-kpi-grid launch-kpi-grid--skeleton" aria-hidden="true">
        <div class="launch-skeleton launch-skeleton--kpi"></div>
        <div class="launch-skeleton launch-skeleton--kpi"></div>
        <div class="launch-skeleton launch-skeleton--kpi"></div>
      </div>
      <div class="dash-split launch-split">
        <div class="dash-split-main launch-skeleton launch-skeleton--board" aria-hidden="true"></div>
        <aside class="dash-split-side launch-side launch-skeleton launch-skeleton--side" aria-hidden="true"></aside>
      </div>
      ${renderLoadingPanel("Loading dashboard…")}
    </div>`;
}

/** Instant shell while manager team metrics resolve. */
export function renderManagerDashboardLoadingShell(container) {
  if (!container) return;
  container.innerHTML = `
    <div class="dash-one-pager one-pager manager-view manager-view--loading" role="status" aria-live="polite" aria-busy="true">
      <div class="head dash-head manager-head">
        <div class="launch-skeleton launch-skeleton--title" aria-hidden="true"></div>
        <div class="launch-skeleton launch-skeleton--subtitle" aria-hidden="true"></div>
      </div>
      <div class="launch-kpi-grid launch-kpi-grid--skeleton" aria-hidden="true">
        <div class="launch-skeleton launch-skeleton--kpi"></div>
        <div class="launch-skeleton launch-skeleton--kpi"></div>
        <div class="launch-skeleton launch-skeleton--kpi"></div>
      </div>
      <div class="launch-skeleton launch-skeleton--heatmap" aria-hidden="true"></div>
      ${renderLoadingPanel("Loading team dashboard…")}
    </div>`;
}

function recentCallForActivity(rec) {
  const sc = scorecardFromRecord(rec);
  let overallScore = null;
  if (sc) {
    const perCall = typeComposite([sc], sc.callType || "demo", { includeIneligible: true });
    overallScore = sc.overall ?? perCall.score ?? null;
  } else if (rec.analysis?.qualityCoach) {
    overallScore = normalizeQualityCoach(rec.analysis.qualityCoach).overallScore ?? null;
  }
  const mom = rec.analysis?.momentum || {};
  return {
    id: rec.id,
    company: companyFromRecord(rec),
    timestamp: rec.timestamp,
    overallScore,
    momentum: mom.status || "review",
  };
}

async function updateSideStats(container, email, opts = {}) {
  const m = aggregateTaskMetrics(listTasks(email));
  const open = container.querySelector('[data-stat="open"]');
  const preps = container.querySelector('[data-stat="preps"]');
  const doneWeek = container.querySelector('[data-stat="done-week"]');
  if (open) open.textContent = String(m.openTotal);
  if (preps) preps.textContent = String(await countPrepsGenerated(briefsCountFetcher(opts)));
  if (doneWeek) doneWeek.textContent = String(m.completedThisWeek);
}

function briefTimestamp(brief) {
  const idPart = String(brief.id || "").split("-").pop();
  const ts = Number(idPart);
  if (Number.isFinite(ts) && ts > 1e12) return ts;
  const when = Date.parse(String(brief.when || ""));
  return Number.isFinite(when) ? when : 0;
}

function renderRecentBriefRow(brief) {
  const factCount = brief.prep?.facts?.filter((f) => f.value && f.value !== "unknown").length || 0;
  const totalFacts = brief.prep?.facts?.length || 0;
  const status =
    totalFacts > 0
      ? `${factCount} of ${totalFacts} facts sourced`
      : "Discovery brief ready";
  return `
    <button type="button" class="launch-activity-row dash-brief-link" data-brief-id="${esc(brief.id)}">
      <span class="launch-activity-inner">
        <span class="launch-activity-icon tile-sand" aria-hidden="true"><fw-icon name="add-note" size="18"></fw-icon></span>
        <span class="launch-activity-body">
          <span class="launch-activity-title">${esc(brief.company || brief.meta?.company || "Account")} · Discovery brief</span>
          <span class="launch-activity-status" style="color:var(--dew-green)">${esc(status)}</span>
        </span>
        <span class="launch-activity-when">${esc(relativeWhen(briefTimestamp(brief)))}</span>
      </span>
    </button>`;
}

function buildRecentActivityLocal(callRecords, usesLegacyCoach = false, briefs = loadAllLocalBriefs()) {
  const callItems = [...(callRecords || [])]
    .sort((a, b) => (b.timestamp || 0) - (a.timestamp || 0))
    .slice(0, 12)
    .map((rec) => ({
      kind: "call",
      ts: rec.timestamp || 0,
      html: renderRecentActivityRow(recentCallForActivity(rec), usesLegacyCoach),
    }));

  const briefItems = briefs.slice(0, 12).map((b) => ({
    kind: "brief",
    ts: briefTimestamp(b),
    html: renderRecentBriefRow(b),
  }));

  return [...callItems, ...briefItems]
    .sort((a, b) => b.ts - a.ts)
    .slice(0, 6);
}

async function buildRecentActivity(callRecords, usesLegacyCoach = false, opts = {}) {
  let briefs = loadAllLocalBriefs();
  const fetchBriefs = briefsCountFetcher(opts);
  if (typeof fetchBriefs === "function") {
    try {
      const { mergeAllBriefs } = await import("./briefs-list-view.js");
      const remote = await fetchBriefs();
      briefs = mergeAllBriefs(briefs, remote || []);
    } catch {
      // demo / offline — local briefs only
    }
  }

  return buildRecentActivityLocal(callRecords, usesLegacyCoach, briefs);
}

function renderRecentCallsSideWithItems(items, opts = {}) {
  const signature = recentActivitySignature(items);
  if (!items.length) {
    return `
      <section class="dash-section launch-side dash-side-recent" data-activity-signature="${signature}" aria-labelledby="recent-heading">
        <fw-card class="launch-activity-card">
          <div class="launch-activity-head">
            <h2 id="recent-heading" class="dash-section-title">Recent activity</h2>
          </div>
          <p class="muted dash-side-empty" style="padding:20px 22px">Generate a brief or analyze a recording to see activity here.</p>
        </fw-card>
      </section>`;
  }

  const rows = items.map((i) => i.html).join("");

  return `
    <section class="dash-section launch-side dash-side-recent" data-activity-signature="${signature}" aria-labelledby="recent-heading">
      <fw-card class="launch-activity-card">
        <div class="launch-activity-head">
          <h2 id="recent-heading" class="dash-section-title">Recent activity</h2>
          ${opts.onViewAll ? `<button type="button" class="launch-activity-viewall" data-action="view-all-activity">View all</button>` : ""}
        </div>
        ${rows}
      </fw-card>
    </section>`;
}

function recentActivitySignature(items) {
  let hash = 2166136261;
  for (const item of items) {
    const value = `${item.kind}:${item.ts}:${item.html}`;
    for (let i = 0; i < value.length; i += 1) {
      hash ^= value.charCodeAt(i);
      hash = Math.imul(hash, 16777619);
    }
  }
  return `${items.length}:${hash >>> 0}`;
}

function mountDashboardTasks(container, email, opts = {}) {
  const boardMount = container.querySelector("#task-board-mount");
  if (!boardMount) return;

  const taskOpts = {
    ...opts,
    onTasksChanged: () => {
      opts.onTasksChanged?.();
      void updateLaunchKpis(container, email, opts);
    },
  };

  renderTaskBoard(boardMount, email, taskOpts);
}

function wireRecentActivitySection(container, opts = {}) {
  container.querySelectorAll(".dash-brief-link").forEach((btn) => {
    btn.addEventListener("click", () => {
      const id = btn.dataset.briefId;
      if (id) opts.onOpenBrief?.(id);
    });
  });
  container.querySelector('[data-action="view-all-activity"]')?.addEventListener("click", () => {
    opts.onOpenCalls?.();
  });
}

async function updateRecentActivitySection(container, callRecords, usesLegacyCoach, opts = {}) {
  const section = container.querySelector(".dash-side-recent");
  if (!section) return;
  const items = await buildRecentActivity(callRecords, usesLegacyCoach, opts);
  section.outerHTML = renderRecentCallsSideWithItems(items, { onViewAll: true });
  wireRecentActivitySection(container, opts);
}

async function updateLaunchKpis(container, email, opts = {}) {
  const callRecords = await resolveCallRecords(email, opts);
  const taskMetrics = aggregateTaskMetrics(listTasks(email));
  const callMetrics = buildLaunchpadCallMetricsFromRecords(callRecords);
  const prepsCount = await countPrepsGenerated(briefsCountFetcher(opts));
  const usesLegacyCoach = aggregateQualityMetrics(analysesWithQualityFromRecords(callRecords)).usesLegacyCoach;
  const grid = container.querySelector(".launch-kpi-grid");
  if (grid) {
    if (typeof opts.subscribeRemotePreps === "function") {
      patchLaunchKpis(container, taskMetrics, callMetrics, prepsCount);
    } else {
      grid.outerHTML = renderLaunchKpis(taskMetrics, callMetrics, prepsCount);
      wireLaunchKpiNav(container, email, opts);
    }
  }
  writeKpiSnapshot(email, kpiSnapshotFromMetrics(taskMetrics, callMetrics, prepsCount));
  await updateRecentActivitySection(container, callRecords, usesLegacyCoach, opts);
}

function wireLaunchKpiNav(container, email, opts = {}) {
  container.querySelectorAll("[data-kpi-nav]").forEach((btn) => {
    btn.addEventListener("click", () => {
      const nav = btn.dataset.kpiNav;
      const opts = container._launchpadOpts || {};
      if (nav === "tasks") {
        container.querySelector("#task-board-mount")?.scrollIntoView({ behavior: "smooth", block: "start" });
        return;
      }
      if (nav === "calls") {
        opts.onOpenCalls?.();
        return;
      }
      if (nav === "briefs") {
        opts.onOpenBriefs?.();
      }
    });
  });
}

/**
 * SE launchpad dashboard.
 * @param {HTMLElement} container
 * @param {string} email
 * @param {{ seName?: string, onOpenCall?: (id: string) => void, onPrep?: () => void, onAnalyze?: () => void, onCoaching?: () => void }} opts
 */
function renderLaunchpadFallback(container, email, opts, err) {
  stopRemotePrepsSubscribe(container);
  stopRemoteCallsSubscribe(container);
  const seName = opts.seName || displayNameForEmail(email) || "there";
  const { greeting } = getSessionGreeting();
  const firstName = firstNameFromDisplay(seName);
  const taskMetrics = aggregateTaskMetrics(listTasks(email));
  const callRecords = dedupeAnalysesByCallIdentity(listPostCallAnalyses(email));
  const launchCallMetrics = buildLaunchpadCallMetricsFromRecords(callRecords);
  container.innerHTML = `
    <div class="dash-one-pager one-pager launchpad">
      <div class="launch-hero">
        <h1 class="launch-greeting">${esc(greeting)}, ${esc(firstName)}</h1>
      </div>
      ${renderLaunchKpis(taskMetrics, launchCallMetrics, loadAllLocalBriefs().length)}
      <div class="dash-split launch-split">
        <div class="dash-split-main">
          <div id="task-board-mount"></div>
        </div>
        <aside class="dash-split-side launch-side">
          ${renderRecentCallsSideWithItems([], { onViewAll: true })}
        </aside>
      </div>
    </div>`;
  container._launchpadOpts = opts;
  wireLaunchKpiNav(container, email, opts);
  mountDashboardTasks(container, email, opts);
}

async function renderSeLaunchpadOnce(container, email, opts = {}) {
  const cached = readKpiSnapshot(email);
  const cachedMetrics = metricsFromKpiSnapshot(cached);
  const hasLocalData =
    dedupeAnalysesByCallIdentity(listPostCallAnalyses(email)).length > 0 ||
    loadAllLocalBriefs().length > 0;
  const hasCachedKpis = !!cachedMetrics;
  const hasReady = container.querySelector(".launchpad:not(.launchpad--loading)");
  if (!hasReady && !hasCachedKpis && !hasLocalData) {
    renderDashboardLoadingShell(container);
  }

  const watchdog = globalThis.setTimeout(() => {
    if (!container?.isConnected) return;
    if (!container.querySelector(".launchpad--loading")) return;
    renderLaunchpadFallback(container, email, opts, new Error("dashboard render watchdog"));
  }, 12000);

  try {
    let callRecords = dedupeAnalysesByCallIdentity(listPostCallAnalyses(email));
    let metrics = aggregateQualityMetrics(analysesWithQualityFromRecords(callRecords));
    let launchCallMetrics = buildLaunchpadCallMetricsFromRecords(callRecords);

    let taskMetrics = aggregateTaskMetrics(listTasks(email));
    let prepsCount = loadAllLocalBriefs().length;

    if (cachedMetrics) {
      if (!callRecords.length && cachedMetrics.launchCallMetrics.totalCalls > 0) {
        launchCallMetrics = { ...cachedMetrics.launchCallMetrics, records: callRecords };
      }
      if (!prepsCount && cachedMetrics.prepsCount > 0) {
        prepsCount = cachedMetrics.prepsCount;
      }
    }

    const remotePending = launchpadRemotePending(callRecords, prepsCount, opts, cached);
    const syncing = launchpadSyncingFlags(callRecords, prepsCount, cached, opts);
    const activityItems = buildRecentActivityLocal(callRecords, metrics.usesLegacyCoach);

    const seName = opts.seName || displayNameForEmail(email) || "there";
    const { greeting } = getSessionGreeting();
    const firstName = firstNameFromDisplay(seName);

    container.innerHTML = `
    <div class="dash-one-pager one-pager launchpad">
      <div class="launch-hero">
        <h1 class="launch-greeting">${esc(greeting)}, ${esc(firstName)}</h1>
      </div>
      ${renderLaunchKpis(taskMetrics, launchCallMetrics, prepsCount, { remotePending, syncing })}
      <div class="dash-split launch-split">
        <div class="dash-split-main">
          <div id="task-board-mount"></div>
        </div>
        <aside class="dash-split-side launch-side">
          ${renderRecentCallsSideWithItems(activityItems, { onViewAll: true })}
        </aside>
      </div>
    </div>`;

    container._launchpadOpts = opts;
    wireLaunchKpiNav(container, email, opts);

    mountDashboardTasks(container, email, {
      ...opts,
      onTasksChanged: () => {
        void updateLaunchKpis(container, email, opts);
      },
    });

    wireCallLinks(container, opts.onOpenCall);
    wireRecentActivitySection(container, opts);

    container.querySelectorAll('[data-action="prep"]').forEach((btn) => {
      btn.addEventListener("fwClick", () => opts.onPrep?.());
    });
    container.querySelectorAll('[data-action="analyze"]').forEach((btn) => {
      btn.addEventListener("fwClick", () => opts.onAnalyze?.());
    });

    if (!remotePending.calls && !remotePending.preps) {
      writeKpiSnapshot(email, kpiSnapshotFromMetrics(taskMetrics, launchCallMetrics, prepsCount));
    }

    wireRemotePrepsSubscribe(container, email, opts);
    wireRemoteCallsSubscribe(container, email, opts);
  } catch (err) {
    console.warn("[dashboard] renderSeLaunchpad failed:", err?.message || err);
    renderLaunchpadFallback(container, email, opts, err);
  } finally {
    globalThis.clearTimeout(watchdog);
  }

  await refreshLaunchpadRemote(container, email, opts);
}

const launchpadRenderStates = new WeakMap();

export function renderSeLaunchpad(container, email, opts = {}) {
  let state = launchpadRenderStates.get(container);
  if (!state) {
    state = { inFlight: null, latest: null, queued: false };
    launchpadRenderStates.set(container, state);
  }

  state.latest = { email, opts };
  if (state.inFlight) {
    state.queued = true;
    return state.inFlight;
  }

  state.inFlight = (async () => {
    do {
      state.queued = false;
      const latest = state.latest;
      await renderSeLaunchpadOnce(container, latest.email, latest.opts);
    } while (state.queued);
  })().finally(() => {
    state.inFlight = null;
  });
  return state.inFlight;
}

async function resolveEmailToUidMap(store, session, seEmails, isOrgView) {
  const { stableUserIdForEmail } = await import("./domain/id.js");
  const emailToUid = new Map();

  const canBulkOrg =
    isOrgView && session?.orgId && typeof store.listUsersByOrg === "function";
  const canBulkMgr =
    !isOrgView && session?.userId && typeof store.listUsersByManagerId === "function";

  if (canBulkOrg || canBulkMgr) {
    const users = canBulkOrg
      ? await store.listUsersByOrg(session.orgId)
      : await store.listUsersByManagerId(session.userId);
    const byEmail = new Map(
      users.map((u) => [String(u.email || "").trim().toLowerCase(), u])
    );
    const unresolved = [];
    for (const email of seEmails) {
      const user = byEmail.get(String(email || "").trim().toLowerCase());
      if (user?.id) emailToUid.set(email, user.id);
      else unresolved.push(email);
    }
    for (const email of unresolved) {
      const user = await store.getUserByEmail(email);
      emailToUid.set(email, user?.id || stableUserIdForEmail(email));
    }
    return emailToUid;
  }

  for (const email of seEmails) {
    const user = await store.getUserByEmail(email);
    emailToUid.set(email, user?.id || stableUserIdForEmail(email));
  }
  return emailToUid;
}

async function buildTeamMetrics(session) {
  const isOrgView = session?.isOrgDirector === true;
  const store = getStore();

  if (store.getReadModel) {
    if (isOrgView && session?.orgId) {
      const orgDoc = await getOrgMetricsReadModel(store, session.orgId);
      if (orgDoc?.teamMetrics && orgDoc?.seRows) {
        return {
          teamMetrics: orgDoc.teamMetrics,
          seRows: orgDoc.seRows,
          isOrgView: true,
          gapClusterRollups: orgDoc.gapClusterRollups || [],
          managerView: orgDoc.managerView || null,
          _fromReadModel: true,
        };
      }
    }
    if (!isOrgView && session?.teamId) {
      const teamDoc = await getTeamMetricsReadModel(store, session.teamId);
      if (teamDoc?.teamMetrics && teamDoc?.seRows) {
        return {
          teamMetrics: teamDoc.teamMetrics,
          seRows: teamDoc.seRows,
          isOrgView: false,
          managerView: teamDoc.managerView || null,
          _fromReadModel: true,
        };
      }
    }
  }

  // READ-TIME AGGREGATION (fallback until teamMetrics/orgMetrics backfill)
  const seEmails = session
    ? await listTeamSeEmailsAsync(session)
    : await listTeamSeEmails();

  const storePostCalls = await loadTeamCallSummariesFromStore(session);
  const teamNameByEmail = isOrgView ? await mapEmailToTeamName(seEmails) : new Map();
  const emailToUid = await resolveEmailToUidMap(store, session, seEmails, isOrgView);

  const allAnalyses = [];
  const seRows = [];

  for (const email of seEmails) {
    let analyses = listAnalysesWithQuality(email);
    const uid = emailToUid.get(email);

    if (!analyses.length && storePostCalls.length && uid) {
      const fromStore = storePostCalls.filter((r) => r.ownerId === uid);
      analyses = fromStore.filter(hasCoachingAnalysis);
    }

    const deduped = dedupeAnalysesByCallIdentity(analyses);
    allAnalyses.push(...deduped);
    const metrics = aggregateQualityMetrics(analyses);
    const followUps = aggregateFollowUps(email);
    seRows.push({
      email,
      name: displayNameForEmail(email),
      teamName: teamNameByEmail.get(email) || null,
      calls: metrics.totalCalls,
      avgScore: metrics.avgOverall,
      focusArea: metrics.worstDimension
        ? dimensionDisplayLabel(metrics.worstDimension.name, metrics.usesLegacyCoach)
        : "-",
      overdue: followUps.overdue,
    });
  }

  if (!allAnalyses.length && storePostCalls.length) {
    const dedupedStore = dedupeAnalysesByCallIdentity(
      storePostCalls.filter(hasCoachingAnalysis),
    );
    allAnalyses.push(...dedupedStore);
  }

  const teamMetrics = aggregateQualityMetrics(allAnalyses);
  return { teamMetrics, seRows, isOrgView };
}

function formatCompactUsd(n) {
  if (n == null || !Number.isFinite(n)) return "-";
  if (n >= 1_000_000) return `$${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `$${Math.round(n / 1_000)}K`;
  return `$${Math.round(n)}`;
}

function formatArrBand(low, high, point) {
  if (low != null && high != null && low !== high) {
    return `${formatCompactUsd(low)}–${formatCompactUsd(high)}`;
  }
  return formatCompactUsd(point ?? low ?? high);
}

function heatmapShade(score) {
  return heatmapShadeForScore(score);
}

function renderHeatmapCell(score, opts = {}) {
  const shade = heatmapShade(score);
  let cls = "team-heatmap-cell";
  if (opts.prominent) cls += " team-heatmap-cell--col-summary";
  if (opts.rowSummary) cls += " team-heatmap-cell--row-summary";
  const drillAttrs = [];
  if (opts.seEmail) drillAttrs.push(`data-se-email="${esc(opts.seEmail)}"`);
  if (opts.themeKey) drillAttrs.push(`data-theme-key="${esc(opts.themeKey)}"`);
  if (opts.drill) drillAttrs.push(`data-drill="${esc(opts.drill)}"`);
  const attrStr = drillAttrs.length ? ` ${drillAttrs.join(" ")}` : "";
  if (opts.clickable) {
    return `<td class="${cls}"><button type="button" class="team-heatmap-score team-heatmap-score-btn dash-drill-link"${attrStr} style="background:${shade.bg};color:${shade.fg}">${esc(shade.label)}</button></td>`;
  }
  return `<td class="${cls}"><div class="team-heatmap-score"${attrStr} style="background:${shade.bg};color:${shade.fg}">${esc(shade.label)}</div></td>`;
}

function meanThemeScores(themeKeys, scorecards, callTypeFilter) {
  const values = themeKeys
    .map((key) => themeAverage(scorecards, key, callTypeFilter, COACHING_AGG_OPTS).score)
    .filter((s) => s != null);
  if (!values.length) return null;
  return Math.round((values.reduce((a, b) => a + b, 0) / values.length) * 10) / 10;
}

function callHasNoNextStep(rec) {
  const mom = rec.analysis?.momentum?.status || "";
  const steps = rec.analysis?.nextSteps;
  const emptySteps =
    steps == null ||
    (Array.isArray(steps) && steps.length === 0) ||
    (typeof steps === "object" && !Array.isArray(steps) && Object.keys(steps).length === 0);
  return /stalled|risk/i.test(mom) || emptySteps;
}

/** @param {ReturnType<import("./domain/store.js").getStore>} store @param {object[]} dealRows */
async function enrichManagerDealRows(store, dealRows) {
  return Promise.all(
    dealRows.map(async (row) => {
      const { deal } = row;
      const signals = store.listDealSignalsByDeal ? await store.listDealSignalsByDeal(deal.id, 1) : [];
      const signal = signals[0] || null;
      const tc = store.getTechnicalCommitByDeal ? await store.getTechnicalCommitByDeal(deal.id) : null;
      const arrPoint = deal.arrEstimatePoint ?? null;
      return {
        ...row,
        traction: signal?.traction || null,
        daysSilent: signal?.daysSilent ?? null,
        arrPoint,
        arrLow: deal.arrEstimateLow ?? arrPoint,
        arrHigh: deal.arrEstimateHigh ?? arrPoint,
        tcStatus: tc?.status || null,
        aiAttach: tc?.aiAttach || null,
      };
    }),
  );
}

/** @param {object[]} allDeduped */
function buildTeamCoachingQueue(allDeduped) {
  const items = [];
  for (const rec of allDeduped) {
    if (!isCoachingQueueEligible(rec)) continue;
    const sc = scorecardFromRecord(rec);
    if (!sc) continue;
    const composite = typeComposite([sc], sc.callType, COACHING_AGG_OPTS);
    const score = composite.score;
    if (score == null || score > COACHING_QUEUE_SCORE_MAX) continue;

    let weakest = null;
    for (const line of sc.lines || []) {
      if (!line.applicable) continue;
      if (!weakest || line.score < weakest.score) {
        weakest = { themeKey: line.themeKey, score: line.score };
      }
    }

    const conf = sc.confidence;
    items.push({
      callId: rec.id,
      company: companyFromRecord(rec),
      seName: rec._seName || "-",
      seEmail: rec._seEmail || null,
      timestamp: rec.timestamp,
      callType: sc.callType,
      callTypeLabel: CALL_TYPE_LABELS[sc.callType] || sc.callType,
      score,
      scoreLabel: formatTypeComposite(composite),
      confidencePct: conf != null ? Math.round(conf * 100) : null,
      weakestTheme: weakest?.themeKey || null,
      weakestScore: weakest?.score ?? null,
    });
  }
  return items
    .sort((a, b) => (a.score ?? 100) - (b.score ?? 100))
    .slice(0, COACHING_QUEUE_MAX);
}

/** Rebuild coaching queue from read-model scorecards (applies score overrides at read time). */
function buildCoachingQueueFromReadModel(managerView, scoreOverrides) {
  if (!managerView?.seScorecardsByEmail) return [];
  const items = [];
  const callMeta = managerView.callMetaByCallId || {};

  for (const [email, scorecards] of Object.entries(managerView.seScorecardsByEmail)) {
    for (const sc of scorecards || []) {
      const withOverrides = applyScoreOverridesToScorecard(sc, scoreOverrides);
      if (!isEligibleForAggregate(withOverrides, COACHING_AGG_OPTS)) continue;
      const composite = typeComposite([withOverrides], withOverrides.callType, COACHING_AGG_OPTS);
      const score = composite.score;
      if (score == null || score > COACHING_QUEUE_SCORE_MAX) continue;

      let weakest = null;
      for (const line of withOverrides.lines || []) {
        const grade = line.grade ?? line.score;
        const unavailable = line.evidenceUnavailable ?? !line.applicable;
        if (unavailable) continue;
        if (!weakest || grade < weakest.score) {
          weakest = { themeKey: line.themeKey, score: grade };
        }
      }

      const meta = callMeta[sc.callId] || {};
      items.push({
        callId: sc.callId,
        company: meta.company || "Call",
        seName: meta.seName || displayNameForEmail(email),
        seEmail: meta.seEmail || email,
        timestamp: meta.timestamp,
        callType: withOverrides.callType,
        callTypeLabel: CALL_TYPE_LABELS[withOverrides.callType] || withOverrides.callType,
        score,
        scoreLabel: formatTypeComposite(composite),
        confidencePct:
          withOverrides.confidence != null ? Math.round(withOverrides.confidence * 100) : null,
        weakestTheme: weakest?.themeKey || null,
        weakestScore: weakest?.score ?? null,
      });
    }
  }

  return items
    .sort((a, b) => (a.score ?? 100) - (b.score ?? 100))
    .slice(0, COACHING_QUEUE_MAX);
}

/** Apply score overrides to read-model scorecards grouped by SE email. */
function hydrateManagerScorecardsFromReadModel(managerView, scoreOverrides) {
  /** @type {Map<string, object[]>} */
  const seScorecardsByEmail = new Map();
  const allEligibleScorecards = [];

  for (const [email, scorecards] of Object.entries(managerView.seScorecardsByEmail || {})) {
    const eligible = (scorecards || [])
      .map((sc) => applyScoreOverridesToScorecard(sc, scoreOverrides))
      .filter((sc) => isEligibleForAggregate(sc, COACHING_AGG_OPTS));
    seScorecardsByEmail.set(email, eligible);
    allEligibleScorecards.push(...eligible);
  }

  return { seScorecardsByEmail, allEligibleScorecards };
}

async function buildManagerTeamView(session) {
  const base = await buildTeamMetrics(session);
  const scoreOverrides = await loadScoreOverridesForSession(session);
  const isOrgView = session?.isOrgDirector === true;
  const seEmails = session ? await listTeamSeEmailsAsync(session) : await listTeamSeEmails();
  const store = getStore();

  /** @type {Map<string, object[]>} */
  let seScorecardsByEmail = new Map();
  let allEligibleScorecards = [];
  let allEligibleRecords = [];
  let allDeduped = [];
  let coachingQueue = [];

  if (base._fromReadModel && base.managerView?.seScorecardsByEmail) {
    const hydrated = hydrateManagerScorecardsFromReadModel(base.managerView, scoreOverrides);
    seScorecardsByEmail = hydrated.seScorecardsByEmail;
    allEligibleScorecards = hydrated.allEligibleScorecards;
    coachingQueue = buildCoachingQueueFromReadModel(base.managerView, scoreOverrides);

    const storePostCalls = await loadTeamCallSummariesFromStore(session);
    const emailToUid = await resolveEmailToUidMap(store, session, seEmails, isOrgView);
    for (const email of seEmails) {
      const uid = emailToUid.get(email);
      if (!uid || !storePostCalls.length) continue;
      const fromStore = storePostCalls.filter((r) => r.ownerId === uid);
      allEligibleRecords.push(...fromStore.filter(isCoachingQueueEligible));
    }
  } else {
    const storePostCalls = await loadTeamCallSummariesFromStore(session);
    const emailToUid = await resolveEmailToUidMap(store, session, seEmails, isOrgView);

    for (const email of seEmails) {
      let analyses = listAnalysesWithQuality(email);
      const uid = emailToUid.get(email);
      if (!analyses.length && storePostCalls.length && uid) {
        const fromStore = storePostCalls.filter((r) => r.ownerId === uid);
        analyses = fromStore.filter(hasCoachingAnalysis);
      }
      const deduped = dedupeAnalysesByCallIdentity(analyses).map((rec) => ({
        ...rec,
        _seEmail: email,
        _seName: displayNameForEmail(email),
      }));
      allDeduped.push(...deduped);

      const eligibleRecords = deduped.filter(isCoachingQueueEligible);
      allEligibleRecords.push(...eligibleRecords);
      const scorecards = eligibleRecords
        .map((rec) => scorecardFromRecord(rec, scoreOverrides))
        .filter(Boolean);
      seScorecardsByEmail.set(email, scorecards);
      allEligibleScorecards.push(...scorecards);
    }

    if (!allDeduped.length && storePostCalls.length) {
      const dedupedStore = dedupeAnalysesByCallIdentity(
        storePostCalls.filter(hasCoachingAnalysis),
      );
      allDeduped.push(...dedupedStore);
    }

    coachingQueue = buildTeamCoachingQueue(allDeduped);
  }

  const dealRows = await listDealsForSession(session);
  const enrichedDeals = await enrichManagerDealRows(store, dealRows);
  const coldDeals = enrichedDeals.filter((d) => d.traction === "cold");
  const coldArr = coldDeals.reduce((sum, d) => sum + (d.arrPoint || 0), 0);
  const tcDeals = enrichedDeals.filter((d) => d.tcStatus);
  const aiAttachCount = tcDeals.filter((d) => {
    const attach = String(d.aiAttach || "").toLowerCase();
    return attach && attach !== "none" && attach !== "no";
  }).length;
  const noNextStep = allEligibleRecords.filter(callHasNoNextStep).length;
  const scoredEligible = allEligibleRecords.length;

  const dealsNeedingAttention = enrichedDeals
    .filter(
      (d) =>
        d.traction === "cold" ||
        (d.traction === "warm" && (d.daysSilent ?? 0) >= 21),
    )
    .sort((a, b) => (b.arrPoint || 0) - (a.arrPoint || 0))
    .slice(0, MANAGER_DEALS_MAX);

  return {
    ...base,
    seScorecardsByEmail,
    allEligibleScorecards,
    dealsNeedingAttention,
    coachingQueue,
    teamSummary: {
      spineScore: base.teamMetrics.spine?.score,
      coldDealCount: coldDeals.length,
      coldArr,
      noNextStep,
      noNextStepPct: scoredEligible ? Math.round((noNextStep / scoredEligible) * 100) : 0,
      aiAttachPct: tcDeals.length ? Math.round((aiAttachCount / tcDeals.length) * 100) : 0,
      callsScored: base.teamMetrics.totalCalls,
      provisionalExcluded: base.teamMetrics.provisionalExcluded,
    },
    heatmapFilter: "spine",
  };
}

function renderManagerFilterBanner(filter) {
  if (filter === "spine") {
    return `
      <div class="manager-filter-banner manager-filter-banner--spine" role="status">
        <span class="manager-filter-eyebrow">Active filter</span>
        <strong class="manager-filter-label">Shared spine</strong>
        <span class="manager-filter-detail muted">call_flow · customer_engagement · objections · camera_on; comparable across every eligible call type. Provisional profiles excluded.</span>
      </div>`;
  }
  const typeLabel = CALL_TYPE_LABELS[filter] || filter;
  const prov = isProvisionalCallType(filter)
    ? `<span class="manager-filter-provisional">Provisional profile (no scored calls in heatmap yet)</span>`
    : "";
  return `
    <div class="manager-filter-banner" role="status">
      <span class="manager-filter-eyebrow">Active filter</span>
      <strong class="manager-filter-label">${esc(typeLabel)} only</strong>
      <span class="manager-filter-detail muted">Full ${esc(typeLabel)} profile theme set. Not comparable to other call types on this screen.</span>
      ${prov}
    </div>`;
}

function renderManagerHeatmapFilter(filter) {
  const typeOptions = CALL_TYPES.map(
    (ct) =>
      `<option value="${esc(ct)}"${filter === ct ? " selected" : ""}>${esc(CALL_TYPE_LABELS[ct] || ct)}: full profile${isProvisionalCallType(ct) ? " (provisional)" : ""}</option>`,
  ).join("");
  return `
    <div class="manager-heatmap-controls">
      <label class="manager-heatmap-filter-label" for="manager-heatmap-filter">Score view</label>
      <select id="manager-heatmap-filter" class="manager-heatmap-filter">
        <option value="spine"${filter === "spine" ? " selected" : ""}>Shared spine: core four (all types)</option>
        <optgroup label="One call type">
          ${typeOptions}
        </optgroup>
      </select>
    </div>`;
}

function renderManagerHeatmap(view, filter) {
  const themeKeys = heatmapThemeKeys(filter);
  const callTypeFilter = filter === "spine" ? null : filter;
  const { seRows, seScorecardsByEmail, allEligibleScorecards } = view;

  if (!seRows.length) {
    return `<p class="muted">No SE accounts configured.</p>`;
  }

  const headerCells = themeKeys
    .map((key) => `<th scope="col" class="team-heatmap-theme">${esc(themeLabel(key))}</th>`)
    .join("");

  const columnCells = themeKeys
    .map((key) => {
      const avg = themeAverage(allEligibleScorecards, key, callTypeFilter, COACHING_AGG_OPTS);
      return renderHeatmapCell(avg.score, {
        prominent: true,
        clickable: true,
        drill: "team-theme",
        themeKey: key,
      });
    })
    .join("");

  const bodyRows = seRows
    .map((se) => {
      const scorecards = seScorecardsByEmail.get(se.email) || [];
      const cells = themeKeys
        .map((key) => {
          const avg = themeAverage(scorecards, key, callTypeFilter, COACHING_AGG_OPTS);
          return renderHeatmapCell(avg.score, {
            clickable: true,
            drill: "se-theme",
            seEmail: se.email,
            themeKey: key,
          });
        })
        .join("");
      const rowAvg = meanThemeScores(themeKeys, scorecards, callTypeFilter);
      const rowAvgCell = renderHeatmapCell(rowAvg, { rowSummary: true });
      return `
        <tr>
          <th scope="row" class="team-heatmap-se">
            <button type="button" class="team-heatmap-se-link dash-drill-link" data-drill="se" data-se-email="${esc(se.email)}">${esc(se.name)}</button>
          </th>
          ${cells}
          ${rowAvgCell}
        </tr>`;
    })
    .join("");

  return `
    <div class="team-heatmap-wrap">
      <table class="team-heatmap">
        <thead>
          <tr>
            <th scope="col" class="team-heatmap-corner"></th>
            ${headerCells}
            <th scope="col" class="team-heatmap-row-summary-head muted">SE avg</th>
          </tr>
        </thead>
        <tbody>
          <tr class="team-heatmap-col-summary">
            <th scope="row" class="team-heatmap-col-summary-label">Team ↓</th>
            ${columnCells}
            <td class="team-heatmap-cell team-heatmap-cell--corner-muted" aria-hidden="true"></td>
          </tr>
          ${bodyRows}
        </tbody>
      </table>
    </div>
    <p class="team-heatmap-foot muted"><b>Read the columns, not the rows.</b> A red column is an enablement problem, not a person problem. Click any cell to see the calls behind it.</p>
    <div class="team-heatmap-legend muted">
      <span>Weak</span>
      ${CHART_SCORE_BANDS.map((band) => `<span class="team-heatmap-swatch" style="background:${band.bg}"></span>`).join("")}
      <span>Strong</span>
    </div>`;
}

function renderManagerMetricCards(summary, legacy) {
  const teamAvg = summary.spineScore;
  const teamCls = teamAvg != null ? barClass(teamAvg, QIP_SCORE_MAX) : "";
  const teamVal = legacy || teamAvg == null ? "-" : String(Math.round(teamAvg));
  const coldArr = formatCompactUsd(summary.coldArr);
  const aiVal = summary.aiAttachPct != null ? `${summary.aiAttachPct}%` : "-";
  return `
    <div class="dash-stats prep-action-grid manager-stats manager-team-stats manager-metrics-wire">
      <div class="dash-stat prep-action-block manager-metric-card">
        <span class="dash-stat-label">Team average</span>
        <span class="dash-stat-value manager-metric-num ${teamCls}">${teamVal}</span>
        <span class="dash-stat-sub muted manager-metric-hint">weighted by type</span>
      </div>
      <button type="button" class="dash-stat prep-action-block manager-metric-card manager-metric-link dash-drill-link" data-drill="deals-cold">
        <span class="dash-stat-label">Deals cold</span>
        <span class="dash-stat-value manager-metric-num weak">${summary.coldDealCount}</span>
        <span class="dash-stat-sub muted manager-metric-hint">${esc(coldArr)} exposed</span>
      </button>
      <button type="button" class="dash-stat prep-action-block manager-metric-card manager-metric-link dash-drill-link" data-drill="calls-no-next-step">
        <span class="dash-stat-label">No next step</span>
        <span class="dash-stat-value manager-metric-num manager-metric-warn">${summary.noNextStep}</span>
        <span class="dash-stat-sub muted manager-metric-hint">${summary.noNextStepPct}% of calls</span>
      </button>
      <div class="dash-stat prep-action-block manager-metric-card">
        <span class="dash-stat-label">AI attach</span>
        <span class="dash-stat-value manager-metric-num">${esc(aiVal)}</span>
        <span class="dash-stat-sub muted manager-metric-hint">of won deals</span>
      </div>
      <button type="button" class="dash-stat prep-action-block manager-metric-card manager-metric-link dash-drill-link" data-drill="calls-scored">
        <span class="dash-stat-label">Calls scored</span>
        <span class="dash-stat-value manager-metric-num">${summary.callsScored}</span>
        <span class="dash-stat-sub muted manager-metric-hint">${summary.provisionalExcluded ? `${summary.provisionalExcluded} provisional excluded` : "all 8 types"}</span>
      </button>
    </div>`;
}

function renderDealsNeedingAttention(deals) {
  if (!deals.length) {
    return `
      <section class="dash-section manager-deals-section">
        <h2 class="dash-section-title">Deals needing attention</h2>
        <fw-card><p class="muted">No cold or stalled deals in scope; sorted by ARR when they appear.</p></fw-card>
      </section>`;
  }
  const rows = deals
    .map((row) => {
      const traction = row.traction || "-";
      const tractionCls = traction === "cold" ? "weak" : "good";
      const arr = formatArrBand(row.arrLow, row.arrHigh, row.arrPoint);
      const silent =
        row.daysSilent != null ? `${row.daysSilent}d silent` : "-";
      return `
        <tr>
          <td>
            <div class="manager-deal-title">${esc(row.deal?.title || "Deal")}</div>
            <div class="muted manager-deal-account">${esc(row.account?.name || row.account?.domain || "-")}</div>
          </td>
          <td class="num">${esc(arr)}</td>
          <td><span class="qc-dim-score ${tractionCls}">${esc(String(traction))}</span></td>
          <td>${esc(row.primarySeName || "-")}</td>
          <td class="muted num">${esc(silent)}</td>
        </tr>`;
    })
    .join("");
  return `
    <section class="dash-section manager-deals-section">
      <h2 class="dash-section-title">Deals needing attention</h2>
      <p class="muted dash-section-sub">Cold and warm-but-silent deals · sorted by ARR</p>
      <div class="card-wire manager-table-card">
        <div class="manager-table-wrap">
          <table class="manager-deals-table">
            <thead>
              <tr>
                <th scope="col">Deal</th>
                <th scope="col">ARR</th>
                <th scope="col">Traction</th>
                <th scope="col">SE</th>
                <th scope="col">Silent</th>
              </tr>
            </thead>
            <tbody>${rows}</tbody>
          </table>
        </div>
      </div>
    </section>`;
}

function renderManagerCoachingQueue(queue) {
  if (!queue.length) {
    return `
      <section class="dash-section manager-coaching-queue-section">
        <h2 class="dash-section-title">Coaching queue</h2>
        <div class="card-wire card-wire--tight"><p class="muted">No high-confidence calls below ${COACHING_QUEUE_SCORE_MAX} right now. Low-confidence scores never generate a coaching conversation.</p></div>
      </section>`;
  }
  const rows = queue
    .map((item) => {
      const theme =
        item.weakestTheme != null
          ? `${themeLabel(item.weakestTheme)} · ${item.weakestScore ?? "-"}`
          : "-";
      const conf = item.confidencePct != null ? `${item.confidencePct}%` : "-";
      return `
        <tr>
          <td>
            <button type="button" class="coaching-call-link dash-call-link" data-call-id="${esc(item.callId)}" data-call-tab="qip"${item.weakestTheme ? ` data-expand-theme="${esc(item.weakestTheme)}" data-call-owner="${esc(item.seEmail || "")}"` : ""}>${esc(item.company)}</button>
          </td>
          <td>${esc(item.seName)}</td>
          <td>${esc(item.callTypeLabel)}</td>
          <td class="muted">${esc(formatShortDate(item.timestamp))}</td>
          <td>${esc(conf)}</td>
          <td><span class="qc-dim-score weak">${esc(String(item.score))} / 100</span></td>
          <td class="muted">${esc(theme)}</td>
        </tr>`;
    })
    .join("");
  return `
    <section class="dash-section manager-coaching-queue-section">
      <h2 class="dash-section-title">Coaching queue</h2>
      <p class="muted dash-section-sub">High-confidence calls only · composite ≤ ${COACHING_QUEUE_SCORE_MAX}</p>
      <div class="card-wire manager-table-card">
        <div class="manager-table-wrap">
          <table class="manager-coaching-queue-table">
            <thead>
              <tr>
                <th scope="col">Call</th>
                <th scope="col">SE</th>
                <th scope="col">Type</th>
                <th scope="col">Date</th>
                <th scope="col">Conf</th>
                <th scope="col">Score</th>
                <th scope="col">Weakest</th>
              </tr>
            </thead>
            <tbody>${rows}</tbody>
          </table>
        </div>
      </div>
    </section>`;
}

function mountManagerDashboard(container, view, opts = {}) {
  const filterSelect = container.querySelector("#manager-heatmap-filter");
  const heatmapMount = container.querySelector("#manager-heatmap-mount");
  const bannerMount = container.querySelector("#manager-filter-banner-mount");

  const applyFilter = (filter) => {
    view.heatmapFilter = filter;
    if (heatmapMount) heatmapMount.innerHTML = renderManagerHeatmap(view, filter);
    if (bannerMount) bannerMount.innerHTML = renderManagerFilterBanner(filter);
    wireManagerDrillDown(container, opts);
  };

  filterSelect?.addEventListener("change", () => {
    applyFilter(filterSelect.value || "spine");
  });

  wireManagerDrillDown(container, opts);
  wireCallLinks(container, (id, callOpts = {}) =>
    opts.onOpenCall?.(id, {
      tab: callOpts.tab,
      expandTheme: callOpts.expandTheme,
      ownerEmail: callOpts.ownerEmail,
    }),
  );
}

function wireManagerDrillDown(container, opts = {}) {
  container.querySelectorAll("[data-drill='se']").forEach((btn) => {
    const email = btn.dataset.seEmail;
    if (!email) return;
    const open = () => opts.onOpenSe?.(email, {});
    btn.addEventListener("click", open);
    btn.addEventListener("fwClick", open);
  });

  container.querySelectorAll("[data-drill='se-theme']").forEach((btn) => {
    const email = btn.dataset.seEmail;
    const theme = btn.dataset.themeKey;
    if (!email || !theme) return;
    const open = () => opts.onOpenSe?.(email, { theme });
    btn.addEventListener("click", open);
    btn.addEventListener("fwClick", open);
  });

  container.querySelectorAll("[data-drill='team-theme']").forEach((btn) => {
    const theme = btn.dataset.themeKey;
    if (!theme) return;
    const open = () => opts.onOpenTeamTheme?.(theme);
    btn.addEventListener("click", open);
    btn.addEventListener("fwClick", open);
  });

  container.querySelectorAll("[data-drill='deals-cold']").forEach((btn) => {
    const open = () => opts.onOpenFilteredDeals?.("cold");
    btn.addEventListener("click", open);
    btn.addEventListener("fwClick", open);
  });

  container.querySelectorAll("[data-drill='calls-no-next-step']").forEach((btn) => {
    const open = () => opts.onOpenFilteredCalls?.("no-next-step");
    btn.addEventListener("click", open);
    btn.addEventListener("fwClick", open);
  });

  container.querySelectorAll("[data-drill='calls-scored']").forEach((btn) => {
    const open = () => opts.onOpenFilteredCalls?.("scored");
    btn.addEventListener("click", open);
    btn.addEventListener("fwClick", open);
  });
}

function renderManagerSeTable(seRows, isOrgView = false) {
  if (!seRows.length) {
    return `<p class="muted">No SE accounts configured.</p>`;
  }
  const rows = seRows.map((se) => {
    const avgCls = se.avgScore != null ? barClass(se.avgScore, QIP_SCORE_MAX) : "";
    const avg = se.avgScore != null ? `${se.avgScore.toFixed(1)}/100` : "-";
    const overdueCls = se.overdue > 0 ? "weak" : "good";
    return `
      <tr>
        <td><button type="button" class="manager-se-link dash-drill-link" data-drill="se" data-se-email="${esc(se.email)}">${esc(se.name)}</button></td>
        ${isOrgView ? `<td>${esc(se.teamName || "-")}</td>` : ""}
        <td>${se.calls}</td>
        <td><span class="qc-dim-score ${avgCls}">${esc(avg)}</span></td>
        <td>${esc(se.focusArea)}</td>
        <td><span class="qc-dim-score ${overdueCls}">${se.overdue}</span></td>
      </tr>`;
  }).join("");

  return `
    <div class="card-wire manager-se-table-card">
      <div class="prep-form-eyebrow manager-se-eyebrow">Your SEs</div>
      <div class="manager-table-wrap">
        <table class="manager-se-table">
          <thead>
            <tr>
              <th scope="col" class="manager-se-col-name">SE</th>
              ${isOrgView ? `<th scope="col">Team</th>` : ""}
              <th scope="col">Calls</th>
              <th scope="col">Avg score</th>
              <th scope="col">Focus area</th>
              <th scope="col">Overdue</th>
            </tr>
          </thead>
          <tbody>${rows}</tbody>
        </table>
      </div>
    </div>`;
}

function managerDashboardSubtitle(view) {
  const { seRows, teamSummary, isOrgView } = view;
  const parts = [];
  if (isOrgView) parts.push("Org-wide roll-up");
  parts.push(`${seRows.length} SE${seRows.length === 1 ? "" : "s"}`);
  if (teamSummary.callsScored) {
    parts.push(`${teamSummary.callsScored} call${teamSummary.callsScored === 1 ? "" : "s"} scored`);
  }
  parts.push("click any SE or number to drill in");
  return parts.join(" · ");
}

/**
 * Manager team dashboard — wireframe §11.8: column-reading heatmap, deals, coaching queue.
 * @param {HTMLElement} container
 * @param {object} [session]
 * @param {{ onOpenCall?: (id: string, opts?: object) => void }} [opts]
 */
export async function renderManagerDashboard(container, session, opts = {}) {
  const hasReady = container.querySelector(".manager-view:not(.manager-view--loading)");
  if (!hasReady) {
    renderManagerDashboardLoadingShell(container);
  }
  const view = await buildManagerTeamView(session);
  const { teamMetrics, seRows, isOrgView, teamSummary, dealsNeedingAttention, coachingQueue } =
    view;
  const hasData = teamMetrics.totalCalls > 0 || seRows.length > 0;
  const legacy = teamMetrics.usesLegacyCoach;
  const filter = view.heatmapFilter || "spine";
  const title = "Team";
  const subtitle = managerDashboardSubtitle(view);

  container.innerHTML = `
    <div class="dash-one-pager one-pager manager-view manager-view--wireframe">
      <div class="head dash-head manager-head">
        <h1 class="one-pager-title">${esc(title)}</h1>
        <p class="sub muted manager-subtitle">${esc(subtitle)}</p>
      </div>
      ${hasData ? `
        ${renderManagerMetricCards(teamSummary, legacy)}
        <div class="card-wire manager-heatmap-card">
          <h2 class="manager-card-title">Where the team is weak</h2>
          ${renderManagerHeatmapFilter(filter)}
          <div id="manager-filter-banner-mount">${renderManagerFilterBanner(filter)}</div>
          <div id="manager-heatmap-mount">${renderManagerHeatmap(view, filter)}</div>
        </div>
        <div class="manager-secondary-grid">
          ${renderDealsNeedingAttention(dealsNeedingAttention)}
          ${renderManagerCoachingQueue(coachingQueue)}
        </div>
      ` : `
        <fw-card class="dash-empty">
          <fw-icon class="dash-empty-icon" name="agent" size="24" aria-hidden="true"></fw-icon>
          <h2>No team data yet</h2>
          <p class="muted">SEs need to analyze calls before team metrics appear here.</p>
        </fw-card>
      `}
      ${renderManagerSeTable(seRows, isOrgView)}
    </div>`;

  container._managerView = view;
  mountManagerDashboard(container, view, {
    ...opts,
    onOpenSe: opts.onOpenSe,
    onOpenTeamTheme: opts.onOpenTeamTheme,
    onOpenFilteredDeals: opts.onOpenFilteredDeals,
    onOpenFilteredCalls: opts.onOpenFilteredCalls,
  });
}

/**
 * @param {HTMLElement} container
 * @param {string} email
 * @param {{ seName?: string, onOpenCall?: (id: string) => void, onPrep?: () => void, onAnalyze?: () => void, onCoaching?: () => void }} opts
 */
export async function renderDashboard(container, email, opts = {}) {
  await renderSeLaunchpad(container, email, opts);
}

export {
  buildManagerTeamView,
  renderManagerHeatmap,
  renderManagerFilterBanner,
  teamThemeAveragesFromAccess as buildTeamThemeAverages,
};
