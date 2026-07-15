// Server-side word-cap enforcement for prep/post-call JSON (v5).

import type { Prep } from "./schema";
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

const FIT_LABELS = ["Omnichannel Support", "AI Deflection", "Agent Assist"] as const;

function normalizeFitLabel(label: string, index: number): string {
  const raw = trimCell(label);
  const lower = raw.toLowerCase();
  for (const fixed of FIT_LABELS) {
    if (lower.includes(fixed.split(" ")[0].toLowerCase())) return fixed;
  }
  return FIT_LABELS[index] || raw;
}

function trimDisplacement(v: unknown): "greenfield" | "homegrown" | "entrenched" {
  const s = String(v ?? "").trim().toLowerCase();
  if (s === "greenfield" || s === "homegrown" || s === "entrenched") return s;
  return "greenfield";
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

  return {
    description: trimDescription(raw.description),
    incumbent: {
      incumbent_name: trimCell(raw.incumbent?.incumbent_name),
      displacement: trimDisplacement(raw.incumbent?.displacement),
    },
    fitSnapshot: fitRows,
    industryUseCases: (Array.isArray(raw.industryUseCases) ? raw.industryUseCases : [])
      .map((x) => trimUseCase(x))
      .filter((x) => x)
      .slice(0, 3),
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
    painCapabilityValue: (raw.painCapabilityValue || []).slice(0, 3).map((row) => ({
      pain: trimCell(row.pain),
      capability: trimCell(row.capability),
      value: trimCell(row.value),
    })),
    attendees: (raw.attendees || []).map((a) => ({
      name: trimCell(a.name),
      role: trimCell(a.role),
      decisionPower:
        a.decisionPower === "decision_maker" || a.decisionPower === "influencer"
          ? a.decisionPower
          : "unknown",
    })),
    sources: (raw.sources || []).map((s) => ({
      claim: trimBullet(s.claim),
      url: String(s.url ?? "").trim() || "unknown",
    })),
  };
}

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
