// Server-side word-cap enforcement for Gemini prep/post-call JSON.

import type { Prep } from "./schema";
import type { PostCallAnalysis } from "./postcall-schema";

export const LIMITS = {
  TABLE_CELL: 10,
  BULLET: 14,
  SECTION_INTRO: 25,
  BECAUSE: 12,
  MOMENTUM_REASON: 20,
} as const;

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

function trimCell(v: unknown): string {
  return trimWords(String(v ?? "-"), LIMITS.TABLE_CELL);
}

function trimBullet(v: unknown): string {
  return trimWords(String(v ?? ""), LIMITS.BULLET);
}

function trimIntro(v: unknown): string {
  return trimWords(String(v ?? ""), LIMITS.SECTION_INTRO);
}

function trimBecause(v: unknown): string {
  return trimWords(String(v ?? ""), LIMITS.BECAUSE);
}

function trimMomentumReason(v: unknown): string {
  return trimWords(String(v ?? ""), LIMITS.MOMENTUM_REASON);
}

function trimBullets(arr: unknown, maxItems?: number): string[] {
  const items = (Array.isArray(arr) ? arr : [])
    .map((x) => trimBullet(x))
    .filter((x) => x && x !== "-");
  return maxItems ? items.slice(0, maxItems) : items;
}

export function normalizePrepOutput(raw: Prep): Prep {
  return {
    description: trimIntro(raw.description),
    fitSnapshot: (raw.fitSnapshot || []).slice(0, 6).map((row) => ({
      label: trimCell(row.label),
      thisCompany: trimCell(row.thisCompany),
      industryNorm: trimCell(row.industryNorm),
      gap: row.gap === "large" || row.gap === "partial" || row.gap === "parity" ? row.gap : "partial",
    })),
    businessContext: {
      market: trimCell(raw.businessContext?.market),
      model: trimCell(raw.businessContext?.model),
      users: trimCell(raw.businessContext?.users),
      uptimeNeed: trimCell(raw.businessContext?.uptimeNeed),
      incumbent: trimCell(raw.businessContext?.incumbent),
      industryUseCase: trimCell(raw.businessContext?.industryUseCase),
      fundingParent: trimCell(raw.businessContext?.fundingParent),
      workflows: trimBullets(raw.businessContext?.workflows, 4),
    },
    discoveryKit: (raw.discoveryKit || []).slice(0, 4).map((item) => ({
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

export function normalizePostCallOutput(raw: PostCallAnalysis): PostCallAnalysis {
  const qc = raw.qualityCoach;
  return {
    callHeader: {
      title: trimIntro(raw.callHeader?.title),
      duration: trimCell(raw.callHeader?.duration),
      date: trimCell(raw.callHeader?.date),
      attendees: (raw.callHeader?.attendees || []).map((a) => ({
        name: trimCell(a.name),
        role: trimCell(a.role),
        influence:
          a.influence === "high" || a.influence === "medium" || a.influence === "low"
            ? a.influence
            : "medium",
      })),
    },
    momentum: {
      status:
        raw.momentum?.status === "Advancing" ||
        raw.momentum?.status === "Stalled" ||
        raw.momentum?.status === "At risk"
          ? raw.momentum.status
          : "Stalled",
      reason: trimMomentumReason(raw.momentum?.reason),
      topAction: trimCell(raw.momentum?.topAction),
      topActionDue: trimCell(raw.momentum?.topActionDue),
    },
    followUpTable: (raw.followUpTable || []).map((row) => ({
      category: row.category,
      thisCall: trimCell(row.thisCall),
      followUp: trimCell(row.followUp),
    })),
    signals: {
      painsConfirmed: trimBullets(raw.signals?.painsConfirmed, 4),
      objectionsOpen: trimBullets(raw.signals?.objectionsOpen, 4),
      competitors: trimBullets(raw.signals?.competitors, 4),
    },
    nextSteps: (raw.nextSteps || []).map((row) => ({
      owner: trimCell(row.owner),
      action: trimCell(row.action),
      due: trimCell(row.due),
      why: trimCell(row.why),
      isRisk: !!row.isRisk,
    })),
    qualityCoach: {
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
    },
    artifacts: {
      suggestedFollowUpEmail: {
        subject: trimIntro(raw.artifacts?.suggestedFollowUpEmail?.subject),
        body: String(raw.artifacts?.suggestedFollowUpEmail?.body ?? ""),
      },
      crmNotes: String(raw.artifacts?.crmNotes ?? ""),
    },
  };
}
