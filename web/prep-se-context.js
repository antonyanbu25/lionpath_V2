/** SE notes → six fixed prep signal labels (keep in sync with worker/src/prep/se-context-facts.ts). */

export const SIGNAL_LABELS = [
  "Incumbent tool",
  "Integrations",
  "Web chat widget",
  "AI in their current tech stack",
  "Support portal",
  "Hiring support roles",
];

const INCUMBENT_PATTERNS = [
  { re: /\bzendesk\b/i, value: "Zendesk" },
  { re: /\bfreshdesk\b/i, value: "Freshdesk" },
  { re: /\bintercom\b/i, value: "Intercom" },
  { re: /\bsalesforce(?: service cloud)?\b/i, value: "Salesforce Service Cloud" },
  { re: /\bservicenow\b/i, value: "ServiceNow" },
  { re: /\bhelp scout\b/i, value: "Help Scout" },
  { re: /\bkustomer\b/i, value: "Kustomer" },
  { re: /\bgladly\b/i, value: "Gladly" },
  { re: /\bfront\b/i, value: "Front" },
];

function trimSignalValue(value, maxWords = 12) {
  return String(value || "")
    .trim()
    .split(/\s+/)
    .slice(0, maxWords)
    .join(" ");
}

function isUnknownSignalValue(value) {
  const s = String(value ?? "").trim().toLowerCase();
  return !s || s === "unknown" || s === "-";
}

export function parseSeContextSignals(additionalContext) {
  const text = String(additionalContext || "").trim();
  if (!text) return {};

  /** @type {Record<string, string>} */
  const out = {};

  for (const { re, value } of INCUMBENT_PATTERNS) {
    if (re.test(text) && !out["Incumbent tool"]) out["Incumbent tool"] = value;
  }

  const usesMatch = text.match(
    /\b(?:uses?|using|on|with|currently on|running|evaluating|migrating from|replacing)\s+([A-Za-z][A-Za-z0-9 .-]{1,40})/i,
  );
  if (usesMatch && !out["Incumbent tool"]) {
    out["Incumbent tool"] = trimSignalValue(usesMatch[1].replace(/\s+(for|and|with).*$/i, ""));
  }

  const integrations = [];
  if (/\bsalesforce\b/i.test(text)) integrations.push("Salesforce");
  if (/\bhubspot\b/i.test(text)) integrations.push("HubSpot");
  if (/\bshopify\b/i.test(text)) integrations.push("Shopify");
  if (/\bstripe\b/i.test(text)) integrations.push("Stripe");
  if (/\bjira\b/i.test(text)) integrations.push("Jira");
  if (integrations.length) out["Integrations"] = integrations.slice(0, 3).join(", ");

  if (/\b(live chat|web chat|chat widget|messaging widget|on-site chat)\b/i.test(text)) {
    out["Web chat widget"] = "Live chat mentioned";
  }

  if (/\b(ai chatbot|chatbot|copilot|gpt|virtual agent|deflection bot|ai assist|ai agent)\b/i.test(text)) {
    const aiLine =
      text.match(/\b(?:ai chatbot|chatbot|copilot|gpt[^.\n]{0,40}|virtual agent[^.\n]{0,30})/i)?.[0] ||
      "AI mentioned in notes";
    out["AI in their current tech stack"] = trimSignalValue(aiLine);
  }

  if (/\b(help center|support portal|self-?service portal|customer portal|kb portal)\b/i.test(text)) {
    out["Support portal"] = "Support portal mentioned";
  }

  const hiringMatch = text.match(
    /\b(\d+\+?\s*(?:support\s*)?agents?|\d+\s*open\s*(?:support\s*)?roles?|hiring\s+\d+|headcount\s+\d+)/i,
  );
  if (hiringMatch) {
    out["Hiring support roles"] = trimSignalValue(hiringMatch[0]);
  } else if (/\bhiring\b/i.test(text) && /\b(support|agent|cx|customer service)\b/i.test(text)) {
    out["Hiring support roles"] = "Support hiring noted";
  }

  return out;
}

/** @param {object} prep @param {string|undefined} additionalContext */
export function applySeContextToPrep(prep, additionalContext) {
  if (!prep) return prep;
  const hints = parseSeContextSignals(additionalContext);
  if (!Object.keys(hints).length) return prep;

  const seSource = { label: "SE", title: "SE additional context", url: "se-context", confidence: 88 };
  const sources = [...(prep.sources || [])];
  if (!sources.some((s) => s.label === "SE")) sources.unshift(seSource);

  const byLabel = new Map((prep.signals || []).map((s) => [s.label, s]));
  for (const label of SIGNAL_LABELS) {
    const hint = hints[label];
    if (!hint) continue;
    const existing = byLabel.get(label);
    if (!existing || isUnknownSignalValue(existing.value)) {
      byLabel.set(label, { label, value: trimSignalValue(hint), sourceLabel: "SE" });
    }
  }

  return {
    ...prep,
    sources,
    signals: SIGNAL_LABELS.map(
      (label) => byLabel.get(label) || { label, value: "unknown", sourceLabel: sources[0]?.label || "S1" },
    ),
  };
}
