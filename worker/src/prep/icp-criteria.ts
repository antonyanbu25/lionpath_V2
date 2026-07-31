/**
 * ICP fitment criteria and the alignment tier derived from them.
 *
 * This must NOT live in icp-kb.ts: that file is a generated artifact
 * (`npm run build:icp` → generate-icp-kb.mjs overwrites it wholesale), so criteria
 * placed there would be destroyed on the next KB rebuild.
 *
 * Criteria are transcribed from src/icp/*.md — the Freshdesk Winning/Battle/Losing zone
 * trait axes, and the Omni Strong-fit / Moderate / Disqualifier lists. Nothing is invented
 * here: every criterion and every band name is checked back against those documents by
 * test-icp-criteria.ts.
 *
 * **There is no score.** An earlier build computed `met / decided * 100` and picked a
 * verdict from thresholds. Users rejected it: a percentage invites "how do two hits give
 * 65 out of 100" and a threshold invites "why is 67% Moderate", and neither number changed
 * what an SE did. The tier is now the ICP document's OWN classification of the account,
 * decided by the two facts that document uses to place a segment — see `placeAccount`.
 */

import type { IcpFit } from "../schema";

export type CriterionState = "met" | "unmet" | "unknown";

/** The alignment tiers users see. No score — see placeAccount for why. */
export type Tier = "Strong" | "Medium" | "Weak" | "Unknown";

/**
 * One band of a gating criterion: the ICP document's own name for a segment, and the tier
 * it corresponds to. `when` is prompt-only guidance for choosing between bands.
 */
export interface IcpBand {
  band: string;
  tier: Exclude<Tier, "Unknown">;
  when: string;
}

export interface IcpCriterion {
  /** Stable id — persisted in briefs, so do not rename. */
  id: string;
  /** SE-facing label, phrased as a requirement so "met" always reads as good news. */
  label: string;
  /** What evidence would satisfy it. Goes into the prompt, not the UI. */
  hint: string;
  /**
   * A hard KB disqualifier. `unmet` forces the Weak verdict outright rather than
   * costing one point — that is what the KB's "Disqualifiers / weak fit" section
   * means, and averaging it away would produce a Strong verdict for an account we
   * cannot serve. `unknown` is NOT a hit.
   */
  disqualifying?: boolean;
  /**
   * Present only on the two criteria per product that PLACE the account in a zone. The
   * model picks one band; the tier is the lowest band across them. Everything else is
   * evidence and cannot move the verdict.
   *
   * A gating criterion does NOT also carry `disqualifying` — its bottom band already maps
   * to Weak, so the flag would state the same thing twice.
   */
  gating?: { bands: IcpBand[] };
  /**
   * Which ICP source document this criterion comes from, and a verbatim phrase from it.
   *
   * This is the answer to "on what basis do we define the ICP" — every criterion traces
   * to a line in src/icp/*.md, the same files generate-icp-kb.mjs builds icp-kb.ts from.
   * test-icp-criteria.ts greps each `anchor` out of the named file, so a criterion that
   * drifts from the source document (or an axis quietly invented here) fails the build.
   */
  source: {
    doc: "freshdesk.md" | "freshdesk-omni.md";
    /** The named trait axis or section heading in that document. */
    axis: string;
    /** Verbatim single-line substring that must still exist in the document. */
    anchor: string;
  };
}

export type IcpProduct = IcpFit["product"];

/**
 * Freshdesk: one criterion per trait axis named on the zone cards in freshdesk.md —
 * Company Size, Industry, Pain points, Support Maturity, Tech Stack, Buying Intent,
 * Incumbent Vendor, Query Volume, Growth Stage, Decision Driver — plus `deployment`,
 * derived from the Losing Zone pain points because an on-prem mandate is a hard block
 * rather than one axis among ten.
 *
 * The card's eleventh axis, "Use Cases", is deliberately not a criterion: it names the
 * play to run, not a test of fit.
 */
const FRESHDESK_CRITERIA: IcpCriterion[] = [
  {
    id: "companySize",
    label: "Company size",
    hint: "Employee headcount. This is the primary axis the ICP card uses to place a segment.",
    // GATING. Employee count is the one fact the card's segment slide keys off, and it is
    // rarely disputed.
    gating: {
      bands: [
        { band: "Winning Zone", tier: "Strong", when: "50–500 employees" },
        { band: "Battle Zone", tier: "Medium", when: "500–5,000 employees" },
        { band: "Losing Zone", tier: "Weak", when: "more than 5,000 employees" },
        {
          band: "Lower Priority",
          tier: "Weak",
          when: "fewer than 50 employees — micro-SMB, high churn risk",
        },
      ],
    },
    source: { doc: "freshdesk.md", axis: "Company Size", anchor: "Company Size : 50–500 employees" },
  },
  {
    id: "industry",
    label: "Industry",
    hint: "Which zone's industry list they belong to.",
    // GATING, but note it has NO Battle-only band: freshdesk.md gives Winning and Battle
    // identical industry lists, so industry cannot distinguish them. Combined with
    // lowest-band-wins, that means industry can cap a read but never promote one — which
    // is exactly what the document supports.
    gating: {
      bands: [
        {
          band: "Winning Zone",
          tier: "Strong",
          when: "Retail & ecommerce, Business & Professional Services, Manufacturing, SaaS, Fintech, Travel, Education, Online Gaming, Logistics, IT Infra & Services",
        },
        {
          band: "Losing Zone",
          tier: "Weak",
          when: "BFSI, Telecom, Healthcare or Public Sector — the compliance-heavy industries",
        },
      ],
    },
    source: { doc: "freshdesk.md", axis: "Industry", anchor: "Industry: Retail & ecommerce" },
  },
  {
    id: "supportMaturity",
    label: "Shared inbox or a struggling helpdesk",
    hint: "No dedicated support function / shared-inbox chaos, or an established helpdesk struggling with efficiency and integration.",
    source: { doc: "freshdesk.md", axis: "Support Maturity", anchor: "Support Maturity: No dedicated support" },
  },
  {
    id: "queryVolume",
    label: "1K–200K monthly interactions",
    hint: "Winning zone 1K–50K, Battle zone 50K–200K. Over 500K is Losing zone.",
    source: { doc: "freshdesk.md", axis: "Query Volume", anchor: "Query Volume: 1K–50K monthly" },
  },
  {
    id: "incumbent",
    label: "Displaceable incumbent",
    hint: "Email, native tools, Zendesk, Intercom or Zoho Desk. ServiceNow, Salesforce Enterprise or Oracle is Losing zone.",
    source: { doc: "freshdesk.md", axis: "Incumbent Vendor", anchor: "Incumbent Vendor: Email, Native" },
  },
  {
    id: "techStack",
    label: "Cloud-native stack",
    hint: "HubSpot, Shopify, Google Workspace, Slack, or a partial cloud/legacy mix. On-prem CRM/ERP is Losing zone.",
    source: { doc: "freshdesk.md", axis: "Tech Stack", anchor: "Tech Stack: Cloud-native tools" },
  },
  {
    id: "buyingIntent",
    label: "Actively modernising CX",
    hint: "Scaling CX fast and seeking automation/self-service, or exploring modernisation and needing proof of value. Seeking configurability and IT control is Losing zone.",
    source: { doc: "freshdesk.md", axis: "Buying Intent", anchor: "Buying Intent: Scaling CX fast" },
  },
  {
    id: "growthStage",
    label: "Fast-scaling SMB or mature mid-market",
    hint: "Fast-scaling SMB, Series A–C, or mature/bootstrapped mid-market.",
    source: { doc: "freshdesk.md", axis: "Growth Stage", anchor: "Growth Stage: Fast-scaling SMBs" },
  },
  {
    id: "decisionDriver",
    label: "Buys on ease, automation and time-to-value",
    hint: "Ease of use, automation, fast time-to-value, affordability — not security/compliance/deep customization.",
    source: { doc: "freshdesk.md", axis: "Decision Driver", anchor: "Decision Driver: Ease of use, automation" },
  },
  {
    id: "painFit",
    label: "Pains match the platform",
    hint: "Repetitive query volume, disconnected systems, poor CSAT visibility, or pricing and hidden-cost pain.",
    source: { doc: "freshdesk.md", axis: "Pain points", anchor: "high volume of repetitive queries" },
  },
  {
    id: "deployment",
    label: "Cloud deployment is acceptable",
    hint: "Mark unmet only on a stated on-prem, data-residency or deep-customization mandate.",
    disqualifying: true,
    source: { doc: "freshdesk.md", axis: "Pain points (Losing Zone)", anchor: "data residency, on-prem control" },
  },
];

/**
 * Freshdesk Omni: all five bullets of the "Disqualifiers / weak fit" section in
 * freshdesk-omni.md (the first bullet is two independent tests, so it becomes two
 * criteria), plus the Strong-fit and Moderate-fit indicators and the firmographic and
 * channel-signal sections.
 */
const FRESHDESK_OMNI_CRITERIA: IcpCriterion[] = [
  {
    id: "agentScale",
    label: "Support agent count",
    hint: "Support agent headcount (FTE plus BPO).",
    // GATING. No `disqualifying` flag: the "Disqualified" band already maps to Weak.
    gating: {
      bands: [
        { band: "Strong fit", tier: "Strong", when: "50 or more support agents" },
        {
          band: "Moderate fit",
          tier: "Medium",
          // DOC GAP: freshdesk-omni.md classifies "<15" as a disqualifier and "20-49" as
          // moderate, leaving 15-19 unclassified. Mapped to the nearest band. Settle this
          // on the next ICP refresh rather than guessing differently each time.
          when: "15 to 49 support agents",
        },
        {
          band: "Disqualifier",
          tier: "Weak",
          when: "fewer than 15 support agents",
        },
      ],
    },
    source: {
      doc: "freshdesk-omni.md",
      axis: "Firmographics / Disqualifiers",
      anchor: "primary SE motion: 50+ agents",
    },
  },
  {
    id: "channelMix",
    label: "Channel mix",
    hint: "Which channels are live today, and whether an omnichannel roadmap is stated.",
    // GATING. No `disqualifying` flag: the "Disqualified" band already maps to Weak.
    gating: {
      bands: [
        {
          band: "Strong fit",
          tier: "Strong",
          when: "omnichannel live (email + chat + voice or social) or a stated roadmap within 12 months",
        },
        {
          band: "Moderate fit",
          tier: "Medium",
          when: "two or three channels but no voice yet",
        },
        {
          band: "Disqualifier",
          tier: "Weak",
          when: "email-only with no chat or voice plans",
        },
      ],
    },
    source: {
      doc: "freshdesk-omni.md",
      axis: "Disqualifiers / weak fit",
      anchor: "no chat/voice plans",
    },
  },
  {
    id: "serviceMotion",
    label: "Customer-support motion",
    hint: "Mark unmet for a pure ITSM or field-service motion — that is Freshservice, not Omni.",
    disqualifying: true,
    source: {
      doc: "freshdesk-omni.md",
      axis: "Disqualifiers / weak fit",
      anchor: "Pure ITSM/field service motion",
    },
  },
  {
    id: "deployment",
    label: "Cloud deployment is acceptable",
    hint: "Mark unmet on a hard on-prem or non-cloud requirement. Regional data residency alone is not a disqualifier.",
    disqualifying: true,
    source: {
      doc: "freshdesk-omni.md",
      axis: "Disqualifiers / weak fit",
      anchor: "Hard requirement for on-prem or non-cloud deployment",
    },
  },
  {
    id: "stackOwnership",
    label: "Owns its stack decisions",
    hint: "Mark unmet for a BPO-only buyer with no product ownership of stack decisions.",
    disqualifying: true,
    source: {
      doc: "freshdesk-omni.md",
      axis: "Disqualifiers / weak fit",
      anchor: "BPO-only buyer with no product ownership",
    },
  },
  {
    id: "commercialFit",
    label: "Budget and growth path fit",
    hint: "Mark unmet when the buyer wants a free tier only with no growth path, or the budget is mismatched to the scope. Price sensitivity alone is not a disqualifier.",
    disqualifying: true,
    source: {
      doc: "freshdesk-omni.md",
      axis: "Disqualifiers / weak fit",
      anchor: "seeking free tier only with no growth path",
    },
  },
  {
    id: "industry",
    label: "Target industry",
    hint: "SaaS, e-commerce/marketplace, fintech, travel/hospitality, non-clinical healthcare support, telecom, consumer subscription.",
    source: {
      doc: "freshdesk-omni.md",
      axis: "Firmographics",
      anchor: "Industries: SaaS, e-commerce/marketplace",
    },
  },
  {
    id: "toolSprawl",
    label: "Tool sprawl to consolidate",
    hint: "Separate chat, voice and email systems today; agents switching between tools.",
    source: {
      doc: "freshdesk-omni.md",
      axis: "Strong fit indicators",
      anchor: "Pain with tool sprawl",
    },
  },
  {
    id: "volume",
    label: "High inbound volume across channels",
    hint: "High inbound across channels, or voice/chat queues with wait-time or abandonment pain.",
    source: {
      doc: "freshdesk-omni.md",
      axis: "Channel & support motion signals",
      anchor: "High inbound volume across channels",
    },
  },
  {
    id: "aiAppetite",
    label: "Open to AI deflection and copilot",
    hint: "Executive mandate on cost per contact, or appetite for AI deflection plus copilot in the same platform.",
    source: {
      doc: "freshdesk-omni.md",
      axis: "Strong fit indicators",
      anchor: "Openness to AI deflection + copilot",
    },
  },
  {
    id: "selfService",
    label: "Self-service exists but underperforms",
    hint: "Portal or KB in place with low or unknown deflection rates.",
    source: {
      doc: "freshdesk-omni.md",
      axis: "Channel & support motion signals",
      anchor: "deflection rates are low or unknown",
    },
  },
];

export const ICP_CRITERIA: Record<IcpProduct, IcpCriterion[]> = {
  Freshdesk: FRESHDESK_CRITERIA,
  "Freshdesk Omni": FRESHDESK_OMNI_CRITERIA,
};

export function criteriaForProduct(product: string | undefined): IcpCriterion[] {
  return ICP_CRITERIA[product === "Freshdesk Omni" ? "Freshdesk Omni" : "Freshdesk"];
}

export function criterionById(product: string | undefined, id: string): IcpCriterion | undefined {
  return criteriaForProduct(product).find((c) => c.id === id);
}

/** Ordered worst-to-best, so `Math.min` over indices gives the lowest band. */
const TIER_ORDER: Tier[] = ["Weak", "Medium", "Strong"];

export function gatingCriteria(product: string | undefined): IcpCriterion[] {
  return criteriaForProduct(product).filter((c) => c.gating);
}

export interface PlacedGatingRow {
  id: string;
  label: string;
  /** The band name from the ICP document, e.g. "Winning Zone". */
  band: string;
  tier: Exclude<Tier, "Unknown">;
  evidence: string;
  sourceLabel?: string;
}

export interface IcpPlacement {
  tier: Tier;
  /** The framework's own name for where this account sits. Empty when unplaced. */
  zone: string;
  /** The gating facts that produced the tier, in definition order. */
  gating: PlacedGatingRow[];
  /** Gating criteria with no usable band — the reason a tier is Unknown. */
  missingGating: Array<{ id: string; label: string }>;
  supports: IcpCriterionLike[];
  contradicts: IcpCriterionLike[];
  unknown: IcpCriterionLike[];
  /** Labels of non-gating disqualifying criteria that came back unmet. */
  disqualifiers: string[];
}

export interface IcpCriterionLike {
  id?: string;
  label?: string;
  state?: string;
  evidence?: string;
  sourceLabel?: string;
  band?: string;
  disqualifying?: boolean;
}

/** The band a criterion's `band` string resolves to, or undefined if it is not one of its own. */
export function resolveBand(
  def: IcpCriterion,
  band: string | undefined,
): IcpBand | undefined {
  const wanted = String(band || "").trim().toLowerCase();
  if (!wanted || !def.gating) return undefined;
  return def.gating.bands.find((b) => b.band.toLowerCase() === wanted);
}

/**
 * The single source of truth for the ICP verdict.
 *
 * No arithmetic, by design. A percentage invited "how do two hits give 65 out of 100" and
 * a threshold invited "why is 67% Moderate" — neither argument is winnable and neither
 * number changed what an SE did. Instead the tier is the ICP document's OWN
 * classification of the account, decided by the two facts that document uses to place a
 * segment, and every other criterion is evidence the SE reads rather than an input.
 *
 * Lowest band wins: overstating fit is the expensive error in a qualification tool. It
 * also falls out of the docs — `freshdesk.md` gives Winning and Battle identical industry
 * lists, so industry can only cap a read, never promote one.
 */
export function placeAccount(
  rows: IcpCriterionLike[] | undefined,
  product?: string,
): IcpPlacement {
  const defs = criteriaForProduct(product);
  // Array.isArray, not `rows || []`: this takes model output straight off the wire, and a
  // non-array (a number, a bare string) is truthy — a string would even iterate as
  // characters rather than throwing.
  const byId = new Map<string, IcpCriterionLike>();
  for (const row of Array.isArray(rows) ? rows : []) {
    const id = String(row?.id || "");
    if (id) byId.set(id, row);
  }

  const gating: PlacedGatingRow[] = [];
  const missingGating: Array<{ id: string; label: string }> = [];
  const supports: IcpCriterionLike[] = [];
  const contradicts: IcpCriterionLike[] = [];
  const unknown: IcpCriterionLike[] = [];
  const disqualifiers: string[] = [];

  for (const def of defs) {
    const row = byId.get(def.id);
    const state = row?.state === "met" || row?.state === "unmet" ? row.state : "unknown";

    if (def.gating) {
      const resolved = resolveBand(def, row?.band);
      // A gating criterion only places the account when it names one of its OWN bands.
      // An unknown state, a missing band or an invented band all leave it unplaced.
      if (resolved && state !== "unknown") {
        gating.push({
          id: def.id,
          label: def.label,
          band: resolved.band,
          tier: resolved.tier,
          evidence: String(row?.evidence || "").trim(),
          ...(row?.sourceLabel ? { sourceLabel: row.sourceLabel } : {}),
        });
      } else {
        missingGating.push({ id: def.id, label: def.label });
      }
      // Gating criteria are reported in the placement, never also in the evidence groups.
      continue;
    }

    const entry: IcpCriterionLike = {
      id: def.id,
      label: def.label,
      state,
      evidence: String(row?.evidence || "").trim(),
      ...(row?.sourceLabel ? { sourceLabel: row.sourceLabel } : {}),
      ...(def.disqualifying ? { disqualifying: true } : {}),
    };
    if (state === "met") supports.push(entry);
    else if (state === "unmet") {
      contradicts.push(entry);
      if (def.disqualifying) disqualifiers.push(def.label);
    } else unknown.push(entry);
  }

  let tier: Tier;
  let zone = "";
  if (!gating.length) {
    tier = "Unknown";
  } else {
    // Lowest band across the placed gating facts.
    const lowest = gating.reduce(
      (worst, g) => (TIER_ORDER.indexOf(g.tier) < TIER_ORDER.indexOf(worst.tier) ? g : worst),
      gating[0],
    );
    tier = lowest.tier;
    zone = lowest.band;
  }

  // A hard disqualifier outranks the placement — that is what the KB's disqualifier
  // section means, and a Strong-placed account we cannot serve is worse than no verdict.
  if (disqualifiers.length) {
    tier = "Weak";
    if (!zone) zone = "";
  }

  return { tier, zone, gating, missingGating, supports, contradicts, unknown, disqualifiers };
}

/** Prompt block listing the exact ids the model may use, with their evidence hints. */
export function criteriaPromptBlock(product: IcpProduct): string {
  return criteriaForProduct(product)
    .map((c) => {
      const flag = c.gating ? " [GATING]" : c.disqualifying ? " [DISQUALIFIER]" : "";
      const bands = c.gating
        ? `\n    bands (pick exactly one, verbatim): ${c.gating.bands
            .map((b) => `"${b.band}" when ${b.when}`)
            .join("; ")}`
        : "";
      return `- ${c.id}: ${c.label}${flag} — ${c.hint}${bands}`;
    })
    .join("\n");
}

/** Both products, for the synthesis system prompt (product is chosen by the model). */
export function allCriteriaPromptBlock(): string {
  return (Object.keys(ICP_CRITERIA) as IcpProduct[])
    .map((p) => `${p} criteria ids:\n${criteriaPromptBlock(p)}`)
    .join("\n\n");
}
