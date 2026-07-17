// Server-side word-cap enforcement for prep/post-call JSON (v5).

import { attachPrepAssets } from "./prep-assets";
import {
  FACT_KEYS,
  FIT_LABELS,
  SIGNAL_LABELS,
  SIGNAL_LABEL_ALIASES,
  type PainCapabilityValueRow,
  type Prep,
  type PrepSource,
  type ProspectProfile,
  type IcpFit,
} from "./schema";
import type { PostCallAnalysis } from "./postcall-schema";

export const LIMITS = {
  TABLE_CELL: 8,
  BULLET: 12,
  REASON_WHY: 14,
  DESCRIPTION: 15,
  BECAUSE: 12,
  MOMENTUM_REASON: 18,
  INDUSTRY_USE_CASE: 10,
} as const;

const GAP_VERDICT_DEFAULTS: Record<string, string> = {
  large: "Behind",
  partial: "Partial",
  parity: "Aligned",
};

export function wordCount(text: string): number {
  return String(text ?? "")
    .trim()
    .split(/\s+/)
    .filter(Boolean).length;
}

export function trimWords(text: string, max: number): string {
  const words = String(text ?? "")
    .trim()
    .split(/\s+/)
    .filter(Boolean);
  if (words.length <= max) return words.join(" ");
  return words.slice(0, max).join(" ");
}

function isBlank(v: unknown): boolean {
  const s = String(v ?? "").trim();
  return !s || s === "-" || s.toLowerCase() === "unknown";
}

function trimCell(v: unknown): string {
  if (isBlank(v)) return "unknown";
  return trimWords(String(v), LIMITS.TABLE_CELL);
}

function trimBullet(v: unknown): string {
  if (isBlank(v)) return "";
  return trimWords(String(v), LIMITS.BULLET);
}

function trimReason(v: unknown): string {
  if (isBlank(v)) return "unknown";
  return trimWords(String(v), LIMITS.REASON_WHY);
}

function trimDescription(v: unknown): string {
  if (isBlank(v)) return "unknown";
  return trimWords(String(v), LIMITS.DESCRIPTION);
}

function trimBecause(v: unknown): string {
  if (isBlank(v)) return "";
  return trimWords(String(v), LIMITS.BECAUSE);
}

function trimMomentumReason(v: unknown): string {
  if (isBlank(v)) return "unknown";
  return trimWords(String(v), LIMITS.MOMENTUM_REASON);
}

function trimUseCase(v: unknown): string {
  if (isBlank(v)) return "";
  return trimWords(String(v), LIMITS.INDUSTRY_USE_CASE);
}

function trimGapVerdict(v: unknown, gap: string): string {
  const raw = String(v ?? "").trim();
  const oneWord = raw.split(/\s+/).filter(Boolean)[0];
  if (oneWord) return oneWord;
  return GAP_VERDICT_DEFAULTS[gap] || "Partial";
}

function trimBullets(arr: unknown, maxItems?: number): string[] {
  const items = (Array.isArray(arr) ? arr : [])
    .map((x) => trimBullet(x))
    .filter((x) => x && x !== "-");
  return maxItems ? items.slice(0, maxItems) : items;
}

const FIT_LABEL_LEGACY: Record<string, (typeof FIT_LABELS)[number]> = {
  "Omnichannel Support": "Support channels",
  "AI Deflection": "Self Serve",
};

function normalizeFitLabel(label: string, index: number): string {
  const raw = trimCell(label);
  const lower = raw.toLowerCase();
  for (const [legacy, canonical] of Object.entries(FIT_LABEL_LEGACY)) {
    if (lower.includes(legacy.toLowerCase()) || lower === legacy.toLowerCase()) return canonical;
  }
  for (const fixed of FIT_LABELS) {
    if (lower.includes(fixed.split(" ")[0].toLowerCase()) || lower === fixed.toLowerCase()) return fixed;
  }
  return FIT_LABELS[index] || raw;
}

function trimDisplacement(v: unknown): "greenfield" | "homegrown" | "entrenched" {
  const s = String(v ?? "").trim().toLowerCase();
  if (s === "greenfield" || s === "homegrown" || s === "entrenched") return s;
  return "greenfield";
}

function clampConfidence(v: unknown): number {
  const n = typeof v === "number" ? v : Number(v);
  if (!Number.isFinite(n)) return 50;
  return Math.max(0, Math.min(100, Math.round(n)));
}

function confidenceBand(conf: number): "High" | "Medium" | "Low" {
  if (conf >= 80) return "High";
  if (conf >= 55) return "Medium";
  return "Low";
}

function normalizeSources(raw: Prep): PrepSource[] {
  const items = (raw.sources || []).map((s, i) => {
    const legacy = s as PrepSource & { claim?: string };
    const label = String(legacy.label ?? `S${i + 1}`).trim() || `S${i + 1}`;
    const title = trimBullet(legacy.title ?? legacy.claim ?? "Source");
    const url = String(legacy.url ?? "").trim() || "unknown";
    return { label, title, url, confidence: clampConfidence(legacy.confidence) };
  });
  if (items.length >= 3) return items.slice(0, 8);
  while (items.length < 3) {
    const idx = items.length + 1;
    items.push({ label: `S${idx}`, title: "unknown", url: "unknown", confidence: 50 });
  }
  return items;
}

function pickSourceLabel(sources: PrepSource[], preferred?: string, index = 0): string {
  const labels = new Set(sources.map((s) => s.label));
  const p = String(preferred ?? "").trim();
  if (p && labels.has(p)) return p;
  return sources[index]?.label || sources[0]?.label || "S1";
}

function normalizeFacts(raw: Prep, sources: PrepSource[]): Prep["facts"] {
  const incoming = Array.isArray(raw.facts) ? raw.facts : [];
  if (incoming.length) {
    return incoming.slice(0, 8).map((f, i) => ({
      key: trimCell(f.key) !== "unknown" ? trimWords(String(f.key), 4) : FACT_KEYS[i] || "Fact",
      value: trimWords(String(f.value ?? ""), 12) || "unknown",
      sourceLabel: pickSourceLabel(sources, f.sourceLabel, i),
    }));
  }
  const bc = raw.businessContext || ({} as Prep["businessContext"]);
  const csa = raw.companySizeAgents || { agents: "unknown", estimated: false };
  const agentsVal = trimCell(csa.agents);
  const fallback = [
    { key: "Industry", value: trimCell(bc.market) },
    { key: "Head office", value: trimCell(bc.headOffice) },
    { key: "Company size", value: trimCell(bc.users) },
    { key: "Support team", value: agentsVal },
    { key: "Business model", value: trimCell(bc.model) },
    { key: "Ownership", value: trimCell(bc.fundingParent) },
    { key: "Parent company", value: trimCell(bc.fundingParent) },
    { key: "Languages", value: trimCell(bc.languages) },
  ];
  return fallback.map((f, i) => ({
    key: f.key,
    value: f.value,
    sourceLabel: pickSourceLabel(sources, undefined, i % sources.length),
  }));
}

function normalizeSignalLabel(label: string): (typeof SIGNAL_LABELS)[number] {
  const trimmed = String(label ?? "").trim();
  if ((SIGNAL_LABELS as readonly string[]).includes(trimmed)) {
    return trimmed as (typeof SIGNAL_LABELS)[number];
  }
  const alias = SIGNAL_LABEL_ALIASES[trimmed];
  if (alias) return alias;
  const lower = trimmed.toLowerCase();
  for (const canonical of SIGNAL_LABELS) {
    if (lower.includes(canonical.toLowerCase()) || canonical.toLowerCase().includes(lower)) {
      return canonical;
    }
  }
  if (/uses ai|ai already/i.test(trimmed)) return "AI in their current tech stack";
  return SIGNAL_LABELS[0];
}

function normalizeSignals(raw: Prep, sources: PrepSource[]): Prep["signals"] {
  const byLabel = new Map<string, { value: string; sourceLabel?: string }>();
  for (const row of raw.signals || []) {
    const canonical = normalizeSignalLabel(String(row.label ?? ""));
    byLabel.set(canonical, {
      value: String(row.value ?? ""),
      sourceLabel: row.sourceLabel,
    });
  }
  return SIGNAL_LABELS.map((label, i) => {
    const hit = byLabel.get(label);
    const inc = raw.incumbent?.incumbent_name;
    let value = hit?.value;
    if (!value || isBlank(value)) {
      if (label === "Incumbent tool" && inc) value = inc;
      else value = "unknown";
    }
    return {
      label,
      value: trimWords(String(value), 12) || "unknown",
      sourceLabel: pickSourceLabel(sources, hit?.sourceLabel, i % sources.length),
    };
  });
}

function normalizeSupportJD(raw: Prep, sources: PrepSource[]): Prep["supportJD"] {
  const jd = raw.supportJD || { title: "", sourceLabel: "", bullets: [] };
  return {
    title: trimWords(jd.title || "Support agent role", 12),
    sourceLabel: pickSourceLabel(sources, jd.sourceLabel, 1),
    bullets: trimBullets(jd.bullets, 4).map((b) => trimWords(b, 14)).filter(Boolean),
  };
}

function normalizeEvaluatorJD(raw: Prep): Prep["evaluatorJD"] {
  const tools = trimBullets(raw.evaluatorJD?.tools, 8)
    .map((t) => trimWords(t, 4))
    .filter(Boolean);
  return { tools };
}

function normalizeUseCases(_raw: Prep): Prep["industryUseCases"] {
  return [];
}

const DEFAULT_PCV_FALLBACKS: Omit<PainCapabilityValueRow, "pain">[] = [
  {
    capability: "KB widget + portal",
    values: ["Fewer repeat contacts", "Higher deflection rate"],
  },
  {
    capability: "Unified agent inbox",
    values: ["Faster first response", "Less context switching"],
  },
  {
    capability: "Dashboards + automations",
    values: ["Proactive SLA control", "Clear team metrics"],
  },
  {
    capability: "AI agent assist",
    values: ["Shorter handle time", "Consistent replies"],
  },
  {
    capability: "Omnichannel routing",
    values: ["One queue view", "Better prioritization"],
  },
];

function normalizePainKey(str: string): string {
  return String(str || "")
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function painsMatch(a: string, b: string): boolean {
  const na = normalizePainKey(a);
  const nb = normalizePainKey(b);
  if (!na || !nb) return false;
  if (na === nb) return true;
  if (na.includes(nb) || nb.includes(na)) return true;
  const wa = new Set(na.split(" ").filter((w) => w.length > 3));
  const wb = new Set(nb.split(" ").filter((w) => w.length > 3));
  let overlap = 0;
  for (const w of wa) if (wb.has(w)) overlap++;
  return overlap >= 2;
}

function collectPcvValues(row: PainCapabilityValueRow & { value?: string }): string[] {
  const fromArray = Array.isArray(row.values)
    ? row.values.map((v) => trimWords(String(v), 10)).filter((v) => v && v !== "unknown")
    : [];
  if (fromArray.length >= 2) return fromArray.slice(0, 3);
  const legacy = row.value ? trimWords(String(row.value), 10) : "";
  if (legacy && legacy !== "unknown") fromArray.unshift(legacy);
  return fromArray;
}

function normalizePcvValues(
  row: (PainCapabilityValueRow & { value?: string }) | undefined,
  fallback: Omit<PainCapabilityValueRow, "pain">,
): string[] {
  const items = row ? collectPcvValues(row) : [];
  const fallbackItems = fallback.values.filter(Boolean);
  while (items.length < 2 && fallbackItems.length) {
    const next = fallbackItems[items.length % fallbackItems.length];
    if (next && !items.includes(next)) items.push(next);
    else break;
  }
  if (items.length < 2 && items.length === 1) {
    items.push(fallbackItems[1] || fallbackItems[0] || "Better customer outcomes");
  }
  return items.slice(0, 3).length >= 2 ? items.slice(0, 3) : fallbackItems.slice(0, 2);
}

function fallbackPcvForIndex(index: number): Omit<PainCapabilityValueRow, "pain"> {
  return DEFAULT_PCV_FALLBACKS[index % DEFAULT_PCV_FALLBACKS.length];
}

function normalizePainCapabilityValue(
  raw: Prep,
  likelyPains: string[],
): PainCapabilityValueRow[] {
  const pains = likelyPains.filter((p) => p && p !== "unknown").slice(0, 5);
  const incoming = Array.isArray(raw.painCapabilityValue) ? raw.painCapabilityValue : [];
  const used = new Set<number>();

  const pickRow = (pain: string, index: number) => {
    let hitIdx = incoming.findIndex(
      (r, idx) => !used.has(idx) && painsMatch(String(r.pain ?? ""), pain),
    );
    if (hitIdx < 0) {
      hitIdx = incoming.findIndex((_, idx) => !used.has(idx));
    }
    if (hitIdx >= 0) used.add(hitIdx);
    const hit = hitIdx >= 0 ? incoming[hitIdx] : undefined;
    const fallback = fallbackPcvForIndex(index);
    const painText = trimWords(String(hit?.pain || pain), 12) || pain;
    const capability =
      hit?.capability && trimCell(hit.capability) !== "unknown"
        ? trimCell(hit.capability)
        : fallback.capability;
    return {
      pain: painText,
      capability,
      values: normalizePcvValues(hit as PainCapabilityValueRow & { value?: string }, fallback),
    };
  };

  if (pains.length >= 1) {
    return pains.map((pain, i) => pickRow(pain, i));
  }

  if (incoming.length >= 1) {
    return incoming.slice(0, 5).map((row, i) => {
      const fallback = fallbackPcvForIndex(i);
      const pain = trimWords(String(row.pain ?? ""), 12) || fallback.capability;
      return {
        pain,
        capability:
          row.capability && trimCell(row.capability) !== "unknown"
            ? trimCell(row.capability)
            : fallback.capability,
        values: normalizePcvValues(row as PainCapabilityValueRow & { value?: string }, fallback),
      };
    });
  }

  const fallback = fallbackPcvForIndex(0);
  return [
    {
      pain: "Manual support workflows",
      capability: fallback.capability,
      values: fallback.values,
    },
  ];
}

function normalizeProspects(raw: Prep, sources: PrepSource[]): ProspectProfile[] {
  const incoming = Array.isArray(raw.prospects) ? raw.prospects : [];
  const normalized = incoming.slice(0, 5).map((p, i) => ({
    name: trimCell(p.name),
    role: trimCell(p.role),
    totalExperience: trimWords(String(p.totalExperience ?? ""), 6) || "unknown",
    experienceSummary: trimWords(String(p.experienceSummary ?? ""), 20) || "unknown",
    priorEmployers: trimBullets(p.priorEmployers, 4).map((e) => trimWords(e, 6)).filter(Boolean),
    competitorTouchpoints: trimBullets(p.competitorTouchpoints, 4)
      .map((t) => trimWords(t, 8))
      .filter(Boolean),
    sourceLabel: pickSourceLabel(sources, p.sourceLabel, i % sources.length),
  }));

  if (normalized.length >= 1) return normalized;

  const fromAttendees = (raw.attendees || [])
    .filter((a) => !isBlank(a.name) && a.name !== "unknown")
    .slice(0, 5)
    .map((a, i) => ({
      name: trimCell(a.name),
      role: trimCell(a.role),
      totalExperience: "unknown",
      experienceSummary: "unknown",
      priorEmployers: [] as string[],
      competitorTouchpoints: [] as string[],
      sourceLabel: pickSourceLabel(sources, undefined, i % sources.length),
    }));

  if (fromAttendees.length >= 1) return fromAttendees;

  return [
    {
      name: "unknown",
      role: "unknown",
      totalExperience: "unknown",
      experienceSummary: "unknown",
      priorEmployers: [],
      competitorTouchpoints: [],
      sourceLabel: pickSourceLabel(sources, undefined, 0),
    },
  ];
}

function normalizeIcpFit(raw: Prep): IcpFit {
  const fit = raw.icpFit || ({} as IcpFit);
  const product = fit.product === "Freshdesk Omni" || fit.product === "Freshdesk" ? fit.product : "Freshdesk";
  const verdict =
    fit.verdict === "Strong" ||
    fit.verdict === "Moderate" ||
    fit.verdict === "Weak" ||
    fit.verdict === "Unknown"
      ? fit.verdict
      : "Unknown";
  let score: number | undefined;
  if (typeof fit.score === "number" && Number.isFinite(fit.score)) {
    score = Math.max(0, Math.min(100, Math.round(fit.score)));
  }
  return {
    product,
    verdict,
    score,
    highlights: trimBullets(fit.highlights, 2).map((h) => trimWords(h, 10)).filter(Boolean),
    gaps: trimBullets(fit.gaps, 2).map((g) => trimWords(g, 10)).filter(Boolean),
    frameworkRefs: trimBullets(fit.frameworkRefs, 2).map((r) => trimWords(r, 8)).filter(Boolean),
  };
}

export function normalizePrepOutput(raw: Prep): Prep {
  const bc = raw.businessContext || ({} as Prep["businessContext"]);
  const fitRows = (raw.fitSnapshot || []).slice(0, 3).map((row, index) => {
    const gap =
      row.gap === "large" || row.gap === "partial" || row.gap === "parity" ? row.gap : "partial";
    return {
      label: normalizeFitLabel(row.label, index),
      thisCompany: trimCell(row.thisCompany),
      industryNorm: trimCell(row.industryNorm),
      gap,
      gapVerdict: trimGapVerdict(row.gapVerdict, gap),
    };
  });
  while (fitRows.length < 3) {
    const index = fitRows.length;
    fitRows.push({
      label: FIT_LABELS[index],
      thisCompany: "unknown",
      industryNorm: "unknown",
      gap: "partial",
      gapVerdict: "Partial",
    });
  }

  const sources = normalizeSources(raw);
  const likelyPains = trimBullets(raw.likelyPains, 5).map((p) => trimWords(p, 12)).filter(Boolean);
  const normalized: Prep = {
    description: trimDescription(raw.description),
    about: trimWords(String(raw.about ?? raw.description ?? ""), 60) || trimDescription(raw.description),
    incumbent: {
      incumbent_name: trimCell(raw.incumbent?.incumbent_name),
      displacement: trimDisplacement(raw.incumbent?.displacement),
    },
    fitSnapshot: fitRows,
    facts: normalizeFacts(raw, sources),
    signals: normalizeSignals(raw, sources),
    supportJD: normalizeSupportJD(raw, sources),
    evaluatorJD: normalizeEvaluatorJD(raw),
    likelyPains,
    industryUseCases: normalizeUseCases(raw),
    checklist: trimBullets(raw.checklist, 6).map((c) => trimWords(c, 10)).filter(Boolean),
    companySizeAgents: {
      agents: trimCell(raw.companySizeAgents?.agents),
      estimated: !!raw.companySizeAgents?.estimated,
    },
    businessContext: {
      market: trimCell(bc.market),
      model: trimCell(bc.model),
      users: trimCell(bc.users),
      uptimeNeed: trimCell(bc.uptimeNeed),
      fundingParent: trimCell(bc.fundingParent),
      headOffice: trimCell(bc.headOffice),
      languages: trimCell(bc.languages),
    },
    discoveryKit: (raw.discoveryKit || []).slice(0, 3).map((item) => ({
      question: trimBullet(item.question),
      because: trimBecause(item.because),
    })),
    painCapabilityValue: normalizePainCapabilityValue(raw, likelyPains),
    attendees: (raw.attendees || []).map((a) => ({
      name: trimCell(a.name),
      role: trimCell(a.role),
      decisionPower:
        a.decisionPower === "decision_maker" || a.decisionPower === "influencer"
          ? a.decisionPower
          : "unknown",
    })),
    prospects: normalizeProspects(raw, sources),
    icpFit: normalizeIcpFit(raw),
    sources,
  };
  normalized.assets = attachPrepAssets(normalized);
  return normalized;
}

export { confidenceBand, clampConfidence };

type LoosePostCallAttendee = {
  name?: string;
  role?: string;
  influence?: string;
  engagement?: string;
};

type LoosePostCall = PostCallAnalysis & {
  callSummary?: {
    headline?: string;
    duration?: string;
    date?: string;
    attendees?: LoosePostCallAttendee[];
  };
  attendees?: LoosePostCallAttendee[];
};

function asAttendeeArray(value: unknown): LoosePostCallAttendee[] {
  return Array.isArray(value) ? (value as LoosePostCallAttendee[]) : [];
}

function coalescePostCallAttendees(raw: LoosePostCall): LoosePostCallAttendee[] {
  return asAttendeeArray(
    raw.callHeader?.attendees ?? raw.attendees ?? raw.callSummary?.attendees,
  );
}

function mapPostCallAttendees(list: LoosePostCallAttendee[]): PostCallAnalysis["callHeader"]["attendees"] {
  return list.map((a) => ({
    name: trimCell(a?.name),
    role: trimCell(a?.role),
    influence:
      a?.influence === "high" || a?.influence === "medium" || a?.influence === "low"
        ? a.influence
        : ("medium" as const),
  }));
}

function normalizeActionKey(text: string): string {
  return String(text ?? "")
    .toLowerCase()
    .replace(/[^\w\s]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function actionTextsSimilar(a: string, b: string): boolean {
  const na = normalizeActionKey(a);
  const nb = normalizeActionKey(b);
  if (!na || !nb) return false;
  if (na === nb) return true;
  if (na.includes(nb) || nb.includes(na)) return true;
  const wa = new Set(na.split(" ").filter((w) => w.length > 2));
  const wb = new Set(nb.split(" ").filter((w) => w.length > 2));
  if (!wa.size || !wb.size) return false;
  let overlap = 0;
  for (const w of wa) if (wb.has(w)) overlap++;
  return overlap / Math.min(wa.size, wb.size) >= 0.6;
}

function followUpTexts(
  followUpTable: PostCallAnalysis["followUpTable"],
): string[] {
  return followUpTable
    .flatMap((row) => [row.thisCall, row.followUp])
    .filter((t) => !isBlank(t) && t !== "unknown");
}

function dedupeNextSteps(
  nextSteps: PostCallAnalysis["nextSteps"],
  followUpTable: PostCallAnalysis["followUpTable"],
): PostCallAnalysis["nextSteps"] {
  const fuTexts = followUpTexts(followUpTable);
  return nextSteps.filter((step) => {
    if (step.isRisk) return true;
    if (isBlank(step.action) || step.action === "unknown") return false;
    return !fuTexts.some((fu) => actionTextsSimilar(step.action, fu));
  });
}

function inferSeOwner(attendees: PostCallAnalysis["callHeader"]["attendees"]): string {
  const se = attendees.find((a) => /se|solution|engineer/i.test(String(a.role ?? "")));
  if (se && !isBlank(se.name) && se.name !== "unknown") return se.name;
  const named = attendees.find((a) => !isBlank(a.name) && a.name !== "unknown");
  return named?.name || "SE";
}

function injectRiskRow(
  nextSteps: PostCallAnalysis["nextSteps"],
  missed: string | undefined,
  momentum: PostCallAnalysis["momentum"],
  attendees: PostCallAnalysis["callHeader"]["attendees"],
): PostCallAnalysis["nextSteps"] {
  if (isBlank(missed)) return nextSteps;
  const action = trimCell(String(missed).replace(/^risk:\s*/i, ""));
  if (isBlank(action) || action === "unknown") return nextSteps;
  const hasRisk = nextSteps.some(
    (s) => s.isRisk || actionTextsSimilar(s.action, action),
  );
  if (hasRisk) return nextSteps;
  const riskRow: PostCallAnalysis["nextSteps"][number] = {
    owner: trimCell(inferSeOwner(attendees)),
    action,
    due: trimCell("Next call"),
    why: trimReason(momentum?.reason || "Deal momentum at risk"),
    isRisk: true,
  };
  return [riskRow, ...nextSteps];
}

export function normalizePostCallOutput(raw: LoosePostCall): PostCallAnalysis {
  const qc = raw.qualityCoach;
  const cs = raw.callSummary;
  const hdr = raw.callHeader;
  const callHeader = {
    title: trimDescription(hdr?.title ?? cs?.headline ?? (raw as { title?: string }).title),
    duration: trimCell(hdr?.duration ?? cs?.duration ?? (raw as { duration?: string }).duration),
    date: trimCell(hdr?.date ?? cs?.date ?? (raw as { date?: string }).date),
    attendees: mapPostCallAttendees(coalescePostCallAttendees(raw)),
  };
  const momentum = {
    status:
      raw.momentum?.status === "Advancing" ||
      raw.momentum?.status === "Stalled" ||
      raw.momentum?.status === "At risk"
        ? raw.momentum.status
        : ("Stalled" as const),
    reason: trimMomentumReason(raw.momentum?.reason),
    topAction: trimCell(raw.momentum?.topAction),
    topActionDue: trimCell(raw.momentum?.topActionDue),
  };
  const followUpTable = (raw.followUpTable || []).map((row) => ({
    category: row.category,
    thisCall: trimCell(row.thisCall),
    followUp: trimCell(row.followUp),
  }));
  const qualityCoach = {
    overallScore: raw.qualityCoach?.overallScore ?? 0,
    overallLabel: raw.qualityCoach?.overallLabel ?? "",
    dimensions: (qc?.dimensions || []).map((d) => ({
      name: String(d.name ?? ""),
      score: typeof d.score === "number" ? d.score : 3,
      maxScore: 5,
      feedback: trimBullet(d.feedback),
      evidence: trimBullet(d.evidence),
    })),
    strengths: trimBullets(qc?.strengths, 2),
    improvements: trimBullets(qc?.improvements, 2),
    missedOpportunities: trimBullets(qc?.missedOpportunities, 1),
  };
  const baseNextSteps = (raw.nextSteps || []).map((row) => ({
    owner: trimCell(row.owner),
    action: trimCell(row.action),
    due: trimCell(row.due),
    why: trimReason(row.why),
    isRisk: !!row.isRisk,
  }));
  const withRisk = injectRiskRow(
    baseNextSteps,
    qualityCoach.missedOpportunities[0],
    momentum,
    callHeader.attendees,
  );
  const nextSteps = dedupeNextSteps(withRisk, followUpTable);

  return {
    callHeader,
    momentum,
    followUpTable,
    signals: {
      painsConfirmed: trimBullets(raw.signals?.painsConfirmed, 4),
      objectionsOpen: trimBullets(raw.signals?.objectionsOpen, 4),
      competitors: trimBullets(raw.signals?.competitors, 4),
    },
    nextSteps,
    qualityCoach,
    artifacts: {
      suggestedFollowUpEmail: {
        subject: trimDescription(raw.artifacts?.suggestedFollowUpEmail?.subject),
        body: String(raw.artifacts?.suggestedFollowUpEmail?.body ?? ""),
      },
      crmNotes: String(raw.artifacts?.crmNotes ?? ""),
    },
  };
}
