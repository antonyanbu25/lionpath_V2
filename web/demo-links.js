export const DEMO_LINKS = {
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

const CORE_KEYS = ["demoScript", "customerReference", "slidePack"];
const MID_MARKET_KEYWORDS = /\b(saas|fintech|ecommerce|e-?commerce|enterprise)\b/i;
const SAAS_TECH_KEYWORDS = /\b(saas|software|tech|technology|platform|cloud|b2b)\b/i;
const EDU_NONPROFIT_KEYWORDS = /\b(education|university|school|nonprofit|non-?profit|ngo|charity)\b/i;

function gatherPrepText(prep) {
  const parts = [];
  const push = (v) => {
    if (v != null && String(v).trim()) parts.push(String(v));
  };

  push(prep?.incumbent?.incumbent_name);
  push(prep?.description);

  const bc = prep?.businessContext || {};
  for (const value of Object.values(bc)) {
    if (Array.isArray(value)) value.forEach(push);
    else if (value && typeof value === "object") Object.values(value).forEach(push);
    else push(value);
  }

  for (const row of prep?.fitSnapshot || []) {
    push(row.label);
    push(row.thisCompany);
    push(row.industryNorm);
    push(row.gapVerdict);
  }

  for (const row of prep?.industryUseCases || []) {
    push(typeof row === "string" ? row : row?.name);
  }

  for (const src of prep?.sources || []) {
    push(src.title ?? src.claim);
    push(src.url);
  }

  return parts.join(" ").toLowerCase();
}

function containsKeyword(prep, keyword) {
  return gatherPrepText(prep).includes(String(keyword).toLowerCase());
}

function parseAgentCount(prep) {
  const raw = prep?.companySizeAgents?.agents;
  if (!raw || String(raw).trim().toLowerCase() === "unknown") return null;
  const nums = String(raw).match(/\d+/g);
  if (!nums?.length) return null;
  return Math.max(...nums.map((n) => Number(n)));
}

function isMidMarketPlus(prep) {
  const count = parseAgentCount(prep);
  if (count != null && count > 10) return true;
  return MID_MARKET_KEYWORDS.test(gatherPrepText(prep));
}

/**
 * Pick up to 5 demo resource links from prep signals.
 * Core: demo script, customer reference, slide pack.
 * Conditional: ROI (mid-market+), Zendesk/Intercom battlecards (incumbent traces).
 */
export function pickDemoLinks(prep, max = 5) {
  const text = gatherPrepText(prep);
  const conditionals = [];

  if (containsKeyword(prep, "zendesk")) conditionals.push("zendeskBattlecard");
  if (containsKeyword(prep, "intercom")) conditionals.push("intercomBattlecard");
  if (isMidMarketPlus(prep)) conditionals.push("roiSlidepack");

  if (SAAS_TECH_KEYWORDS.test(text)) {
    const roiIdx = conditionals.indexOf("roiSlidepack");
    if (roiIdx > 0) {
      conditionals.splice(roiIdx, 1);
      conditionals.unshift("roiSlidepack");
    }
  }

  if (EDU_NONPROFIT_KEYWORDS.test(text)) {
    const roiIdx = conditionals.indexOf("roiSlidepack");
    if (roiIdx >= 0) conditionals.splice(roiIdx, 1);
  }

  const selected = [...CORE_KEYS];
  for (const key of conditionals) {
    if (selected.length >= max) break;
    if (!selected.includes(key)) selected.push(key);
  }

  return selected.map((key) => ({ key, ...DEMO_LINKS[key] })).filter((link) => link.url);
}
