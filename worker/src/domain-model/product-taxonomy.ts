/** Product gap taxonomy v1.0 — spec §8, ADR-006. Fixed lists; no free-text product area. */

export const PRODUCT_TAXONOMY_VERSION = "1.0";

export const PRODUCT_AREAS = [
  "ticketing_workflow",
  "channels",
  "ai_customer_facing",
  "ai_agent_facing",
  "ai_platform",
  "knowledge",
  "reporting_analytics",
  "admin_config",
  "integrations_extensibility",
  "itsm_specific",
  "crm_sales_specific",
  "platform",
  "commercial",
  "other",
] as const;

export type ProductArea = (typeof PRODUCT_AREAS)[number];

export const PRODUCT_SUB_AREAS: Record<ProductArea, readonly string[]> = {
  ticketing_workflow: [
    "ticket_lifecycle",
    "sla_escalation",
    "automation_routing",
    "forms_fields",
    "other",
  ],
  channels: ["email", "whatsapp", "chat_messaging", "voice", "social", "in_app", "other"],
  ai_customer_facing: ["ai_agent_bot", "deflection", "self_service", "knowledge_answers", "other"],
  ai_agent_facing: ["copilot", "summarization", "drafting", "next_best_action", "other"],
  ai_platform: ["model_config", "guardrails", "training_tuning", "ai_analytics", "other"],
  knowledge: ["kb_authoring", "external_sources", "search", "multilingual", "other"],
  reporting_analytics: ["prebuilt_reports", "custom_reports", "dashboards", "data_export", "other"],
  admin_config: ["user_role_management", "bulk_config", "sandbox", "migration_tooling", "other"],
  integrations_extensibility: [
    "native_integrations",
    "api",
    "webhooks",
    "marketplace",
    "custom_apps",
    "other",
  ],
  itsm_specific: ["asset_cmdb", "change_release", "project_ppm", "contracts", "other"],
  crm_sales_specific: ["pipeline", "sequences", "quoting", "forecasting", "other"],
  platform: ["performance_scale", "uptime", "mobile", "accessibility", "ui_ux", "other"],
  commercial: ["packaging", "pricing", "licensing_model", "contract_terms", "other"],
  other: ["other"],
};

export const CROSS_CUTTING_TAGS = [
  "data_residency",
  "security_compliance",
  "localization",
  "scale_limits",
  "accessibility",
  "migration",
  "tco",
] as const;

export type CrossCuttingTag = (typeof CROSS_CUTTING_TAGS)[number];

export const GAP_DISPOSITIONS = [
  "hard_blocker",
  "workaround_offered",
  "roadmap_deflection",
  "se_didnt_know",
] as const;

export type GapDisposition = (typeof GAP_DISPOSITIONS)[number];

export const DEAL_IMPACTS = ["blocker", "friction", "nice_to_have"] as const;

export type DealImpact = (typeof DEAL_IMPACTS)[number];

export const GAP_TYPES = ["real_gap", "enablement_gap"] as const;

export type GapType = (typeof GAP_TYPES)[number];

export const PRODUCT_GAP_STATUSES = [
  "draft",
  "in_review",
  "published",
  "routed_enablement",
  "published_enablement",
  "dismissed",
  "merged",
] as const;

export type ProductGapStatus = (typeof PRODUCT_GAP_STATUSES)[number];

export function isProductArea(value: string): value is ProductArea {
  return (PRODUCT_AREAS as readonly string[]).includes(value);
}

export function isValidSubArea(area: ProductArea, subArea: string): boolean {
  return (PRODUCT_SUB_AREAS[area] as readonly string[]).includes(subArea);
}

export function normalizeProductArea(raw: unknown): ProductArea {
  const v = String(raw || "")
    .trim()
    .toLowerCase()
    .replace(/[\s&/]+/g, "_")
    .replace(/[^a-z0-9_]/g, "")
    .replace(/_+/g, "_")
    .replace(/^_|_$/g, "");
  if (isProductArea(v)) return v;
  return "other";
}

export function normalizeSubArea(area: ProductArea, raw: unknown): string {
  const v = String(raw || "")
    .trim()
    .toLowerCase()
    .replace(/[\s&/]+/g, "_")
    .replace(/[^a-z0-9_]/g, "")
    .replace(/_+/g, "_")
    .replace(/^_|_$/g, "");
  if (isValidSubArea(area, v)) return v;
  return "other";
}

export function normalizeCrossCuttingTags(raw: unknown): CrossCuttingTag[] {
  if (!Array.isArray(raw)) return [];
  const out: CrossCuttingTag[] = [];
  for (const item of raw) {
    const v = String(item || "")
      .trim()
      .toLowerCase()
      .replace(/[\s&/]+/g, "_")
      .replace(/[^a-z0-9_]/g, "")
      .replace(/_+/g, "_");
    if ((CROSS_CUTTING_TAGS as readonly string[]).includes(v) && !out.includes(v as CrossCuttingTag)) {
      out.push(v as CrossCuttingTag);
    }
  }
  return out;
}
