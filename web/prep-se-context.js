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

const CHANNEL_ALIASES = [
  { re: /\b(?:wa|whatsapp)\b/i, label: "WhatsApp" },
  { re: /\binstagram\b|\big\b/i, label: "Instagram" },
  { re: /\bfacebook\b|\bfb\b/i, label: "Facebook" },
  { re: /\bsms\b/i, label: "SMS" },
  { re: /\bemail\b/i, label: "Email" },
  { re: /\blive chat\b|\bweb chat\b/i, label: "Live chat" },
  { re: /\bphone\b|\bvoice\b|\bcall center\b/i, label: "Phone" },
];

const INQUIRY_THEMES = [
  { re: /\bvisa\b/i, label: "visa" },
  { re: /\bpassport\b|\bpasspotr\b/i, label: "passport" },
  { re: /\border status\b/i, label: "order status" },
  { re: /\brefund\b/i, label: "refunds" },
  { re: /\bwarranty\b/i, label: "warranty" },
  { re: /\binquir(?:y|ies|e)\b/i, label: "customer inquiries" },
];

/** @param {string|undefined} additionalContext */
export function parseSeDiscoveryHints(additionalContext) {
  const text = String(additionalContext || "").trim();
  /** @type {string[]} */
  const channels = [];
  /** @type {string[]} */
  const inquiryThemes = [];
  let teamScale = "";

  if (!text) return { channels, inquiryThemes, teamScale };

  const channelsMatch = text.match(/channels?\s*[:=]\s*([^\n;]+)/i);
  const channelBlob = channelsMatch ? `${channelsMatch[1]} ${text}` : text;
  for (const { re, label } of CHANNEL_ALIASES) {
    if (re.test(channelBlob) && !channels.includes(label)) channels.push(label);
  }

  for (const { re, label } of INQUIRY_THEMES) {
    if (re.test(text) && !inquiryThemes.includes(label)) inquiryThemes.push(label);
  }

  const usersMatch =
    text.match(/\busers?\s*[:=]\s*(\d+\s*[-–—]\s*\d+|\d+\+?)/i) ||
    text.match(/\b(\d+\s*[-–—]\s*\d+)\s*(?:users?|agents?|people|staff)\b/i) ||
    text.match(/\b(\d+\+?\s*(?:support\s*)?agents?)\b/i);
  if (usersMatch) teamScale = trimSignalValue(usersMatch[1].replace(/\s+/g, " "));

  return { channels, inquiryThemes, teamScale };
}

function hasDiscoveryHints(hints) {
  return hints.channels.length > 0 || hints.inquiryThemes.length > 0 || !!hints.teamScale;
}

function channelPhrase(channels) {
  if (!channels.length) return "";
  if (channels.length === 1) return channels[0];
  if (channels.length === 2) return `${channels[0]} and ${channels[1]}`;
  return `${channels.slice(0, -1).join(", ")}, and ${channels[channels.length - 1]}`;
}

function inquiryPhrase(themes) {
  if (!themes.length) return "customer inquiries";
  if (themes.length === 1) return themes[0];
  return themes.slice(0, 3).join(", ");
}

function kitAnchoredToSe(kit, hints) {
  if (!kit?.length || !hasDiscoveryHints(hints)) return !!kit?.length;
  const blob = kit.map((k) => `${k.question} ${k.because}`).join(" ").toLowerCase();
  const channelHit = hints.channels.some((c) => blob.includes(c.toLowerCase().split(" ")[0]));
  const themeHit = hints.inquiryThemes.some((t) => blob.includes(t.toLowerCase()));
  const scaleHit =
    hints.teamScale ?
      blob.includes(hints.teamScale.replace(/\s/g, "")) || /\bteam\b|\bagent\b|\buser\b/i.test(blob)
    : false;
  return (channelHit || themeHit) && (themeHit || scaleHit || channelHit);
}

function painsAnchoredToSe(pains, hints) {
  if (!pains?.length || !hasDiscoveryHints(hints)) return !!pains?.length;
  const blob = pains.join(" ").toLowerCase();
  const channelHit = hints.channels.some((c) => blob.includes(c.toLowerCase().split(" ")[0]));
  const themeHit = hints.inquiryThemes.some((t) => blob.includes(t.toLowerCase()));
  return channelHit || themeHit;
}

function buildSePains(hints) {
  const pains = [];
  const channels = channelPhrase(hints.channels);
  const themes = inquiryPhrase(hints.inquiryThemes);

  if (hints.channels.length && hints.inquiryThemes.length) {
    pains.push(trimSignalValue(`Multi-channel ${themes} on ${channels}`));
  } else if (hints.channels.length) {
    pains.push(trimSignalValue(`Fragmented ${channels} support threads`));
  } else if (hints.inquiryThemes.length) {
    pains.push(trimSignalValue(`High volume ${themes} without automation`));
  }

  if (hints.teamScale) {
    pains.push(trimSignalValue(`Small team (${hints.teamScale}) covering multiple channels`));
  }

  return pains.slice(0, 3);
}

function buildSeDiscoveryKit(hints) {
  const channels = channelPhrase(hints.channels);
  const themes = inquiryPhrase(hints.inquiryThemes);
  /** @type {{ question: string, because: string }[]} */
  const kit = [];

  if (hints.channels.length) {
    kit.push({
      question: trimSignalValue(`How do you route and track ${themes} across ${channels}?`),
      because: trimSignalValue(`SE notes cite ${channels} for ${themes}`),
    });
  }

  if (hints.inquiryThemes.length) {
    kit.push({
      question: trimSignalValue(`What tools handle ${themes} today and where do requests fall through?`),
      because: trimSignalValue(`SE flagged ${themes} as a primary inquiry type`),
    });
  }

  if (hints.teamScale) {
    kit.push({
      question: trimSignalValue(`With about ${hints.teamScale} people, how do you prioritize queues?`),
      because: trimSignalValue(`SE noted team scale of ${hints.teamScale}`),
    });
  }

  return kit.slice(0, 3);
}

/** @param {object} prep @param {string|undefined} additionalContext */
export function applySeContextToDiscovery(prep, additionalContext) {
  if (!prep) return prep;
  const hints = parseSeDiscoveryHints(additionalContext);
  if (!hasDiscoveryHints(hints)) return prep;

  let likelyPains = [...(prep.likelyPains || [])].filter(Boolean);
  let discoveryKit = [...(prep.discoveryKit || [])];

  if (!painsAnchoredToSe(likelyPains, hints)) {
    likelyPains = [...buildSePains(hints), ...likelyPains].slice(0, 5);
  }

  if (!kitAnchoredToSe(discoveryKit, hints)) {
    discoveryKit = [...buildSeDiscoveryKit(hints), ...discoveryKit].slice(0, 3);
  }

  return { ...prep, likelyPains, discoveryKit };
}
