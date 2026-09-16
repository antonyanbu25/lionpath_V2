// Server-side demo asset catalog — URLs are not LLM-generated.

import type { Prep } from "./schema";

export type AssetExt = "DOC" | "SHEET" | "PDF" | "PPT";

export interface PrepAsset {
  label: string;
  ext: AssetExt;
  url: string;
}

const DEMO_CATALOG: Record<string, { label: string; url: string }> = {
  customerReference: {
    label: "Customer reference",
    url: "https://docs.google.com/presentation/d/1vjhWQKBXRiCsb0QQ6tyaBmGUoJPiF2Y88y8VHVhyDhA/edit?slide=id.g3411510ade7_3_7118#slide=id.g3411510ade7_3_7118",
  },
  slidePack: {
    label: "Slide pack",
    url: "https://docs.google.com/presentation/d/1-QoIqdng2x9Ok8J8PI52v3s6HI4_g_ye3qNPCCfLGWQ/edit?slide=id.g341c8126285_0_0#slide=id.g341c8126285_0_0",
  },
  roiSlidepack: {
    label: "ROI slide pack",
    url: "https://docs.google.com/presentation/d/1Skk8WZtUUbNBXC_2V5radhumw9nc4a9TUrrmEGHI3UI/edit?slide=id.g33e8f64c18a_0_24#slide=id.g33e8f64c18a_0_24",
  },
  zendeskBattlecard: {
    label: "Zendesk vs Freshdesk",
    url: "https://docs.google.com/document/d/1A9qgfUpTa0IWYPTk-obbdl8IZX9fyFw7GFbIAcak08k/edit?tab=t.0",
  },
  intercomBattlecard: {
    label: "Intercom vs Freshdesk",
    url: "https://docs.google.com/document/d/1KjLZMl0AG8X23V1QypwVWFCnCi0XHCMVh89962lGFTU/edit?tab=t.0#heading=h.576h6x71fz77",
  },
  demoScript: {
    label: "Demo script",
    url: "https://docs.google.com/spreadsheets/d/1Tajnf0phDpio8iexSBA11UQyntgnpyt6lzpJtzcNcIA/edit?gid=1110819265#gid=1110819265",
  },
};

/** Labels passed to demo-guidance so leadAsset references stay in the asset catalog. */
export const DEMO_ASSET_LABELS: string[] = Object.values(DEMO_CATALOG).map((e) => e.label);

function inferExt(url: string): AssetExt {
  const u = url.toLowerCase();
  if (u.includes("/document/")) return "DOC";
  // A Google Sheet. This returned "ENV" — a badge that told the SE nothing about
  // what they were about to open, on the one asset that is a spreadsheet.
  if (u.includes("/spreadsheets/")) return "SHEET";
  if (u.includes(".pdf")) return "PDF";
  return "PPT";
}

function gatherText(prep: Prep): string {
  const parts: string[] = [];
  const push = (v: unknown) => {
    if (v != null && String(v).trim()) parts.push(String(v));
  };
  push(prep.description);
  push(prep.about);
  push(prep.incumbent?.incumbent_name);
  for (const row of prep.fitSnapshot || []) {
    push(row.label);
    push(row.thisCompany);
    push(row.industryNorm);
  }
  for (const uc of prep.industryUseCases || []) {
    push(typeof uc === "string" ? uc : uc.name);
  }
  for (const s of prep.signals || []) {
    push(s.label);
    push(s.value);
  }
  return parts.join(" ").toLowerCase();
}

function parseAgentCount(prep: Prep): number | null {
  const raw = prep.companySizeAgents?.agents;
  if (!raw || String(raw).trim().toLowerCase() === "unknown") return null;
  const nums = String(raw).match(/\d+/g);
  if (!nums?.length) return null;
  return Math.max(...nums.map((n) => Number(n)));
}

export function attachPrepAssets(prep: Prep, max = 5): PrepAsset[] {
  const text = gatherText(prep);
  const keys: string[] = ["demoScript", "customerReference", "slidePack"];
  const midMarket = /\b(saas|fintech|ecommerce|enterprise)\b/i.test(text);
  const agentCount = parseAgentCount(prep);
  if ((agentCount != null && agentCount > 10) || midMarket) keys.push("roiSlidepack");
  if (text.includes("zendesk")) keys.push("zendeskBattlecard");
  if (text.includes("intercom")) keys.push("intercomBattlecard");

  const seen = new Set<string>();
  const assets: PrepAsset[] = [];
  for (const key of keys) {
    if (seen.has(key)) continue;
    seen.add(key);
    const entry = DEMO_CATALOG[key];
    if (!entry) continue;
    assets.push({ label: entry.label, url: entry.url, ext: inferExt(entry.url) });
    if (assets.length >= max) break;
  }
  return assets;
}
