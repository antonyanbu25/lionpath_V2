// Pre-call (Discovery) output shape (v8): wireframe brief with prospects + ICP fitment.

import type { DemoGuidance } from "./prep/demo-guidance";
import type { RivalComparison } from "./prep/rivals";
import type { FishContextSizing } from "./prep/rivals-context";
import type { NewsSource } from "./prep/company-news";

/**
 * The four axes every brief compares an account on. Fixed, not model-chosen: an SE reading two
 * briefs side by side has to be comparing the same things, and the rows used to differ per brief
 * because the label was only *described* to the model — and gemini-schema.ts strips descriptions
 * before sending, so nothing constrained it at all. Declared here so `fitRow` can enum it.
 */
export const FIT_LABELS = [
  "Channel coverage",
  "Routing",
  "Reporting & analytics",
  "AI adoption",
] as const;

const fitRow = {
  type: "object",
  additionalProperties: false,
  required: ["label", "thisCompany", "industryNorm", "gap", "gapVerdict"],
  properties: {
    // enum, not description: descriptions are stripped from the responseSchema by
    // stripSchemaDescriptions (gemini-schema.ts), so a described-only label reached the model as
    // an unconstrained string. GEMINI_RESPONSE_SCHEMA_KEYS keeps `enum`, so this one sticks.
    label: { type: "string", enum: FIT_LABELS },
    thisCompany: { type: "string", description: "Max 8 words." },
    industryNorm: { type: "string", description: "Max 8 words." },
    gap: {
      type: "string",
      enum: ["large", "partial", "parity"],
      description: "large=red dot, partial=amber, parity=green",
    },
    gapVerdict: {
      type: "string",
      description: "One-word GAP verdict shown with dot (e.g. Behind, Partial, Aligned).",
    },
  },
} as const;

const discoveryPair = {
  type: "object",
  additionalProperties: false,
  required: ["question", "because"],
  properties: {
    question: { type: "string", description: "Discovery question, max 12 words." },
    because: { type: "string", description: "Why ask — max 12 words." },
  },
} as const;

const pcvRow = {
  type: "object",
  additionalProperties: false,
  required: ["pain", "capability", "values"],
  properties: {
    pain: {
      type: "string",
      description: "Pain from likelyPains or Additional context, max 12 words.",
    },
    capability: { type: "string", description: "Freshdesk/Omni feature for this pain, max 8 words." },
    values: {
      type: "array",
      minItems: 2,
      maxItems: 3,
      items: {
        type: "string",
        description:
          "Outcome bullet, max 10 words. At most one row may cite BENCHMARK KB.",
      },
    },
  },
} as const;

const sourcedFact = {
  type: "object",
  additionalProperties: false,
  required: ["key", "value", "sourceLabel"],
  properties: {
    key: { type: "string", description: "Fact label e.g. Industry, max 4 words." },
    value: { type: "string", description: "Fact value, max 12 words." },
    sourceLabel: { type: "string", description: "Must match sources[].label e.g. S1." },
  },
} as const;

const signalRow = {
  type: "object",
  additionalProperties: false,
  required: ["label", "value", "sourceLabel"],
  properties: {
    label: {
      type: "string",
      description:
        "One of: Incumbent tool, Integrations, Web chat widget, AI in their current tech stack, Support portal, Hiring support roles.",
    },
    value: { type: "string", description: "Signal value, max 12 words." },
    sourceLabel: { type: "string", description: "Must match sources[].label." },
  },
} as const;

const prospectRow = {
  type: "object",
  additionalProperties: false,
  required: ["name", "role", "totalExperience", "priorEmployers", "competitorTouchpoints", "sourceLabel"],
  properties: {
    name: { type: "string", description: "Prospect full name, max 6 words." },
    role: { type: "string", description: "Job title, max 8 words." },
    totalExperience: { type: "string", description: "Years experience e.g. 12 years, max 6 words." },
    priorEmployers: {
      type: "array",
      maxItems: 6,
      items: { type: "string", description: "Prior employer, max 6 words." },
    },
    summary: { type: "string", description: "2-4 sentence profile summary from LinkedIn, max 80 words." },
    skills: {
      type: "array",
      maxItems: 8,
      items: { type: "string", description: "Skill label, max 4 words." },
    },
    languages: {
      type: "array",
      maxItems: 6,
      items: { type: "string", description: "Language, max 4 words." },
    },
    education: {
      type: "array",
      maxItems: 4,
      items: { type: "string", description: "Education line, max 12 words." },
    },
    competitorTouchpoints: {
      type: "array",
      maxItems: 4,
      items: {
        type: "string",
        description: "Known use of Zendesk/Intercom/Zoho/etc., max 8 words.",
      },
    },
    sourceLabel: { type: "string", description: "Must match sources[].label." },
    discHint: {
      type: "object",
      additionalProperties: false,
      properties: {
        primary: { type: "string", enum: ["D", "I", "S", "C", "unknown"] },
        secondary: { type: "string" },
        confidence: { type: "string", enum: ["low", "medium", "high"] },
        evidence: { type: "array", items: { type: "string" }, maxItems: 4 },
        dos: { type: "array", items: { type: "string" }, maxItems: 3 },
        donts: { type: "array", items: { type: "string" }, maxItems: 3 },
        inferred: { type: "boolean" },
        source: { type: "string" },
      },
      description: "Inferred DISC hint when evidence exists in research.",
    },
  },
} as const;

const meddpiccFieldSlot = {
  type: "object",
  additionalProperties: false,
  properties: {
    value: { type: "string" },
    status: { type: "string", enum: ["unknown", "partial", "confirmed"] },
    contactId: { type: "string" },
  },
} as const;

const meddpiccHintsBlock = {
  type: "object",
  additionalProperties: false,
  properties: {
    metrics: meddpiccFieldSlot,
    economicBuyer: meddpiccFieldSlot,
    decisionCriteria: meddpiccFieldSlot,
    decisionProcess: meddpiccFieldSlot,
    paperProcess: meddpiccFieldSlot,
    identifyPain: meddpiccFieldSlot,
    champion: meddpiccFieldSlot,
    competition: meddpiccFieldSlot,
  },
  description: "Optional MEDDPICC hints populated only when prep evidence supports them.",
} as const;

const icpCriterionRow = {
  type: "object",
  additionalProperties: false,
  required: ["id", "state", "evidence"],
  properties: {
    id: {
      type: "string",
      description:
        "Criterion id from the ICP CRITERIA list for the chosen product. Never invent an id.",
    },
    state: {
      type: "string",
      enum: ["met", "unmet", "unknown"],
      description: "unknown when research is silent — do NOT guess unmet.",
    },
    evidence: {
      type: "string",
      description: "One line of evidence from the research facts, max 14 words. Empty when unknown.",
    },
    sourceLabel: {
      type: "string",
      description: "sources[].label backing the evidence. Required whenever state is met or unmet.",
    },
    band: {
      type: "string",
      description:
        "[GATING criteria ONLY] Copy exactly one band name from that criterion's band list. Omit for every non-gating criterion. The alignment tier is derived from these server-side.",
    },
  },
} as const;

const icpFitBlock = {
  type: "object",
  additionalProperties: false,
  // `criteria` is what makes the rest of the ICP chain live. synthesize.ts already sends the
  // criteria list to the model under "=== ICP CRITERIA ===", icp-criteria.ts derives the tier
  // from the returned bands, and precall-render.js renders the tick list — but the schema did
  // not permit `criteria` in the response, so icpFit.criteria was always undefined and every
  // brief showed "Unknown alignment" with an empty list. The prompt asked; the schema refused.
  required: ["product", "verdict", "criteria", "gaps"],
  properties: {
    product: {
      type: "string",
      enum: ["Freshdesk Omni", "Freshdesk"],
      description: "Which Freshworks product best fits this account.",
    },
    verdict: {
      type: "string",
      enum: ["Strong", "Medium", "Weak", "Unknown"],
      description:
        "Derived server-side from the gating criteria's bands — fill it in, but it is not final.",
    },
    criteria: {
      type: "array",
      maxItems: 12,
      items: icpCriterionRow,
      description:
        "One row per criterion id for the chosen product. The verdict is derived from the gating criteria's bands.",
    },
    gaps: {
      type: "array",
      maxItems: 2,
      items: { type: "string", description: "ICP gap to probe, max 10 words." },
    },
    // `score` removed: an unrubriced 0-100 that nothing derived and the UI no longer renders.
    // `highlights` removed: it restated the met criteria the tick list now shows directly.
    // `frameworkRefs` removed: unvalidated free text whose only job — naming the zone — is now
    // done by the server-derived `zone`, which can only hold a band the ICP document defines.
  },
} as const;

const useCaseRow = {
  type: "object",
  additionalProperties: false,
  required: ["name", "steps"],
  properties: {
    name: { type: "string", description: "Use case name, max 10 words." },
    steps: {
      type: "array",
      maxItems: 5,
      items: { type: "string", description: "Demo click path step, max 12 words." },
    },
  },
} as const;

export const PREP_SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: [
    "description",
    "about",
    "incumbent",
    "fitSnapshot",
    "facts",
    "signals",
    "supportJD",
    "likelyPains",
    "industryUseCases",
    "checklist",
    "companySizeAgents",
    "businessContext",
    "discoveryKit",
    "painCapabilityValue",
    "attendees",
    "prospects",
    "icpFit",
    "sources",
  ],
  properties: {
    description: { type: "string", description: "One-line company description, max 15 words." },
    about: { type: "string", description: "About paragraph for account facts card, max 60 words." },
    incumbent: {
      type: "object",
      additionalProperties: false,
      required: ["incumbent_name", "displacement"],
      properties: {
        incumbent_name: { type: "string", description: "Current support stack/vendor, max 8 words." },
        displacement: {
          type: "string",
          enum: ["greenfield", "homegrown", "entrenched"],
          description: "greenfield=no incumbent, homegrown=internal tools, entrenched=locked vendor",
        },
      },
    },
    fitSnapshot: {
      type: "array",
      minItems: 4,
      maxItems: 4,
      items: fitRow,
      description:
        "FIT section — exactly one row per label in the label enum, in that order. Max 8 words per cell.",
    },
    facts: {
      type: "array",
      maxItems: 8,
      items: sourcedFact,
      description:
        "Account facts rows: Industry, Head office, Company size, Support team, Business model, Ownership, Parent company, Languages.",
    },
    signals: {
      type: "array",
      minItems: 6,
      maxItems: 6,
      items: signalRow,
      description: "Six fixed signal labels with values and sourceLabel.",
    },
    supportJD: {
      type: "object",
      additionalProperties: false,
      required: ["title", "sourceLabel", "bullets"],
      properties: {
        title: { type: "string", description: "LinkedIn job title, max 12 words." },
        sourceLabel: { type: "string", description: "Must match sources[].label." },
        bullets: {
          type: "array",
          maxItems: 4,
          items: { type: "string", description: "JD responsibility bullet, max 14 words." },
        },
      },
    },
    likelyPains: {
      type: "array",
      maxItems: 5,
      items: { type: "string", description: "Likely pain point, max 12 words." },
    },
    industryUseCases: {
      type: "array",
      maxItems: 1,
      items: useCaseRow,
      description: "Deprecated — always return empty array [].",
    },
    checklist: {
      type: "array",
      maxItems: 6,
      items: { type: "string", description: "Sandbox setup checklist item, max 10 words." },
    },
    companySizeAgents: {
      type: "object",
      additionalProperties: false,
      required: ["agents", "estimated"],
      properties: {
        agents: { type: "string", description: "Support agent count or range, max 8 words." },
        estimated: {
          type: "boolean",
          description: "true if count is inferred — UI shows est. label",
        },
      },
    },
    businessContext: {
      type: "object",
      additionalProperties: false,
      required: ["market", "model", "users", "uptimeNeed", "fundingParent", "headOffice", "languages"],
      properties: {
        market: { type: "string", description: "Max 8 words." },
        model: { type: "string", description: "Business model, max 8 words." },
        users: { type: "string", description: "Max 8 words." },
        uptimeNeed: { type: "string", description: "Max 8 words." },
        fundingParent: { type: "string", description: "Max 8 words." },
        headOffice: { type: "string", description: "Max 8 words." },
        languages: { type: "string", description: "Max 8 words." },
      },
    },
    discoveryKit: {
      type: "array",
      maxItems: 3,
      items: discoveryPair,
      description: "Ask this / Because pairs for discovery.",
    },
    painCapabilityValue: {
      type: "array",
      minItems: 1,
      maxItems: 5,
      items: pcvRow,
      description:
        "Demo script: one row per prioritized pain (Additional context first, then likelyPains). Pain → feature → values.",
    },
    attendees: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        required: ["name", "role", "decisionPower"],
        properties: {
          name: { type: "string" },
          role: { type: "string", description: "Max 8 words." },
          decisionPower: {
            type: "string",
            enum: ["decision_maker", "influencer", "unknown"],
          },
        },
      },
    },
    prospects: {
      type: "array",
      minItems: 1,
      maxItems: 5,
      items: prospectRow,
      description:
        "One entry per meeting attendee/prospect — role, experience, prior employers, competitor touchpoints.",
    },
    icpFit: icpFitBlock,
    meddpiccHints: meddpiccHintsBlock,
    sources: {
      type: "array",
      minItems: 3,
      maxItems: 8,
      items: {
        type: "object",
        additionalProperties: false,
        required: ["label", "title", "url", "confidence"],
        properties: {
          label: { type: "string", description: "Source code S1, S2, etc." },
          title: { type: "string", description: "Source title, max 12 words." },
          url: { type: "string" },
          confidence: {
            type: "number",
            description: "0-100. High >=80, Medium >=55, else Low.",
          },
        },
      },
    },
  },
} as const;

export interface FitSnapshotRow {
  label: string;
  thisCompany: string;
  industryNorm: string;
  gap: "large" | "partial" | "parity";
  gapVerdict: string;
}

export interface DiscoveryKitItem {
  question: string;
  because: string;
}

export interface PainCapabilityValueRow {
  pain: string;
  capability: string;
  values: string[];
}

export interface SourcedFact {
  key: string;
  value: string;
  sourceLabel: string;
}

export interface SignalRow {
  label: string;
  value: string;
  sourceLabel: string;
}

export interface ProspectDiscHint {
  primary?: "D" | "I" | "S" | "C" | "unknown";
  secondary?: string;
  confidence?: "low" | "medium" | "high";
  evidence?: string[];
  /**
   * How to run the conversation with this person: 3 dos, 3 don'ts, from the DISC read.
   *
   * These replace the old Ask/Watch/Match display, which relabelled `evidence[0..2]` with verbs
   * by array index — evidence is a set of quotes, so calling quote #1 "Ask" and quote #3 "Match"
   * meant nothing. Because they live on the enrichment, they exist only for a contact with a
   * profile, which is also the only case where a DISC read exists at all.
   */
  dos?: string[];
  donts?: string[];
  inferred?: boolean;
  source?: string;
}

export interface ProspectProfile {
  name: string;
  role: string;
  totalExperience: string;
  priorEmployers: string[];
  competitorTouchpoints: string[];
  sourceLabel: string;
  summary?: string;
  skills?: string[];
  languages?: string[];
  education?: string[];
  discHint?: ProspectDiscHint;
  influence?: { level: "high" | "medium" | "low" | "unknown"; decisionRole: string };
}

/** One ICP criterion's evaluated state for an account — see prep/icp-criteria.ts. */
export interface IcpCriterionRow {
  id: string;
  /** SE-facing label — comes from the criterion definition, never the model. */
  label?: string;
  state: "met" | "unmet" | "unknown";
  evidence?: string;
  sourceLabel?: string;
  /** The ICP document's own band name, present only on decided gating rows. */
  band?: string;
  disqualifying?: boolean;
  /** Whether this criterion placed the account's tier — from the definition, not the model. */
  gating?: boolean;
}

export interface IcpFit {
  product: "Freshdesk Omni" | "Freshdesk";
  verdict: "Strong" | "Medium" | "Weak" | "Unknown";
  score?: number;
  /** Pre-criteria field — Gemini's legacy responseSchema still requires it; normalizeIcpFit omits it. */
  highlights?: string[];
  gaps: string[];
  /** Pre-criteria field — Gemini's legacy responseSchema still requires it; normalizeIcpFit omits it. */
  frameworkRefs?: string[];
  /** Per-criterion breakdown — absent on pre-criteria legacy briefs. */
  criteria?: IcpCriterionRow[];
  /** The framework's own name for where this account sits, e.g. "Winning Zone". */
  zone?: string;
}

export interface SupportJD {
  title: string;
  sourceLabel: string;
  bullets: string[];
}

export interface IndustryUseCase {
  name: string;
  steps: string[];
}

export interface PrepSource {
  label: string;
  title: string;
  url: string;
  confidence: number;
  /** Human-friendly name shown in the UI — see prep/source-display.ts. */
  displayName?: string;
}

export interface PrepAsset {
  label: string;
  ext: "DOC" | "SHEET" | "PDF" | "PPT";
  url: string;
}

/** Company news from Gemini web research — not tech-stack signals. */
export interface RecentNewsItem {
  headline: string;
  detail: string;
  sourceLabel: string;
  /** Direct article URL when available (e.g. DDG fallback). */
  articleUrl?: string;
}

export interface Prep {
  description: string;
  about: string;
  incumbent: {
    incumbent_name: string;
    displacement: "greenfield" | "homegrown" | "entrenched";
  };
  fitSnapshot: FitSnapshotRow[];
  facts: SourcedFact[];
  signals: SignalRow[];
  supportJD: SupportJD;
  likelyPains: string[];
  industryUseCases: IndustryUseCase[];
  checklist: string[];
  companySizeAgents: {
    agents: string;
    estimated: boolean;
  };
  businessContext: {
    market: string;
    model: string;
    users: string;
    uptimeNeed: string;
    fundingParent: string;
    headOffice: string;
    languages: string;
  };
  discoveryKit: DiscoveryKitItem[];
  painCapabilityValue: PainCapabilityValueRow[];
  attendees: { name: string; role: string; decisionPower: "decision_maker" | "influencer" | "unknown" }[];
  prospects: ProspectProfile[];
  icpFit: IcpFit;
  sources: PrepSource[];
  /** Populated server-side, primarily by the grounded search in prep/company-news.ts. */
  recentNews?: RecentNewsItem[];
  /**
   * Publishers behind `recentNews`, carrying their own N1..Nn labels. Deliberately NOT merged
   * into `sources`: a news item and a prep fact are traceable to different searches, and
   * collapsing them would misattribute both.
   */
  newsSources?: NewsSource[];
  assets?: PrepAsset[];
  meddpiccHints?: Record<
    string,
    { value?: string; status?: "unknown" | "partial" | "confirmed"; contactId?: string }
  >;
  /** Demo-day talking points, generated separately — see prep/demo-guidance.ts. */
  demoGuidance?: DemoGuidance;
  /**
   * The PROSPECT's market rivals and how it sizes up against them. Note the name: `incumbent`
   * and `ProspectProfile.competitorTouchpoints` already mean *our* competitors (Zendesk,
   * Intercom), so "competitor" was taken. Absent from PREP_SCHEMA — attached by its own
   * grounded call (prep/rivals.ts), which drops anything it cannot trace to a citation.
   */
  rivals?: RivalComparison;
  /** Company sizing from SE context when grounded rivals search found nothing. */
  fishContext?: FishContextSizing;
}

export const SIGNAL_LABELS = [
  "Incumbent tool",
  "Integrations",
  "Web chat widget",
  "AI in their current tech stack",
  "Support portal",
  "Hiring support roles",
] as const;

/** Legacy signal label aliases for cached preps. */
export const SIGNAL_LABEL_ALIASES: Record<string, (typeof SIGNAL_LABELS)[number]> = {
  "Uses AI already": "AI in their current tech stack",
};

export const FACT_KEYS = [
  "Industry",
  "Head office",
  "Company size",
  "Support team",
  "Business model",
  "Ownership",
  "Parent company",
  "Languages",
] as const;
