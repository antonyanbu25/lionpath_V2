import type { Prep } from "../schema";

export type SeDiscoveryHints = {
  channels: string[];
  inquiryThemes: string[];
  teamScale: string;
};

function trimWords(value: string, max = 12): string {
  return String(value || "")
    .trim()
    .split(/\s+/)
    .slice(0, max)
    .join(" ");
}

const CHANNEL_ALIASES: { re: RegExp; label: string }[] = [
  { re: /\b(?:wa|whatsapp)\b/i, label: "WhatsApp" },
  { re: /\binstagram\b|\big\b/i, label: "Instagram" },
  { re: /\bfacebook\b|\bfb\b/i, label: "Facebook" },
  { re: /\bsms\b/i, label: "SMS" },
  { re: /\bemail\b/i, label: "Email" },
  { re: /\blive chat\b|\bweb chat\b/i, label: "Live chat" },
  { re: /\bphone\b|\bvoice\b|\bcall center\b/i, label: "Phone" },
];

const INQUIRY_THEMES: { re: RegExp; label: string }[] = [
  { re: /\bvisa\b/i, label: "visa" },
  { re: /\bpassport\b|\bpasspotr\b/i, label: "passport" },
  { re: /\border status\b/i, label: "order status" },
  { re: /\brefund\b/i, label: "refunds" },
  { re: /\bwarranty\b/i, label: "warranty" },
  { re: /\binquir(?:y|ies|e)\b/i, label: "customer inquiries" },
];

/** Parse common SE note patterns for discovery grounding (keep in sync with web/prep-se-context.js). */
export function parseSeDiscoveryHints(additionalContext: string | undefined): SeDiscoveryHints {
  const text = String(additionalContext || "").trim();
  const channels: string[] = [];
  const inquiryThemes: string[] = [];
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
  if (usersMatch) teamScale = trimWords(usersMatch[1].replace(/\s+/g, " "));

  return { channels, inquiryThemes, teamScale };
}

function hasHints(hints: SeDiscoveryHints): boolean {
  return hints.channels.length > 0 || hints.inquiryThemes.length > 0 || !!hints.teamScale;
}

function channelPhrase(channels: string[]): string {
  if (!channels.length) return "";
  if (channels.length === 1) return channels[0];
  if (channels.length === 2) return `${channels[0]} and ${channels[1]}`;
  return `${channels.slice(0, -1).join(", ")}, and ${channels[channels.length - 1]}`;
}

function inquiryPhrase(themes: string[]): string {
  if (!themes.length) return "customer inquiries";
  if (themes.length === 1) return themes[0];
  return themes.slice(0, 3).join(", ");
}

function kitAnchoredToSe(kit: Prep["discoveryKit"], hints: SeDiscoveryHints): boolean {
  if (!kit?.length || !hasHints(hints)) return !!kit?.length;
  const blob = kit
    .map((k) => `${k.question} ${k.because}`)
    .join(" ")
    .toLowerCase();
  const channelHit = hints.channels.some((c) => blob.includes(c.toLowerCase().split(" ")[0]));
  const themeHit = hints.inquiryThemes.some((t) => blob.includes(t.toLowerCase()));
  const scaleHit = hints.teamScale ? blob.includes(hints.teamScale.replace(/\s/g, "")) || /\bteam\b|\bagent\b|\buser\b/i.test(blob) : false;
  return (channelHit || themeHit) && (themeHit || scaleHit || channelHit);
}

function painsAnchoredToSe(pains: string[], hints: SeDiscoveryHints): boolean {
  if (!pains?.length || !hasHints(hints)) return !!pains?.length;
  const blob = pains.join(" ").toLowerCase();
  const channelHit = hints.channels.some((c) => blob.includes(c.toLowerCase().split(" ")[0]));
  const themeHit = hints.inquiryThemes.some((t) => blob.includes(t.toLowerCase()));
  return channelHit || themeHit;
}

function buildSePains(hints: SeDiscoveryHints): string[] {
  const pains: string[] = [];
  const channels = channelPhrase(hints.channels);
  const themes = inquiryPhrase(hints.inquiryThemes);

  if (hints.channels.length && hints.inquiryThemes.length) {
    pains.push(trimWords(`Multi-channel ${themes} on ${channels}`));
  } else if (hints.channels.length) {
    pains.push(trimWords(`Fragmented ${channels} support threads`));
  } else if (hints.inquiryThemes.length) {
    pains.push(trimWords(`High volume ${themes} without automation`));
  }

  if (hints.teamScale) {
    pains.push(trimWords(`Small team (${hints.teamScale}) covering multiple channels`));
  }

  return pains.slice(0, 3);
}

function buildSeDiscoveryKit(hints: SeDiscoveryHints): Prep["discoveryKit"] {
  const channels = channelPhrase(hints.channels);
  const themes = inquiryPhrase(hints.inquiryThemes);
  const kit: Prep["discoveryKit"] = [];

  if (hints.channels.length) {
    kit.push({
      question: trimWords(`How do you route and track ${themes} across ${channels}?`),
      because: trimWords(`SE notes cite ${channels} for ${themes}`),
    });
  }

  if (hints.inquiryThemes.length) {
    kit.push({
      question: trimWords(`What tools handle ${themes} today and where do requests fall through?`),
      because: trimWords(`SE flagged ${themes} as a primary inquiry type`),
    });
  }

  if (hints.teamScale) {
    kit.push({
      question: trimWords(`With about ${hints.teamScale} people, how do you prioritize queues?`),
      because: trimWords(`SE noted team scale of ${hints.teamScale}`),
    });
  }

  return kit.slice(0, 3);
}

/** Fill discoveryKit and likelyPains from SE notes when LLM output is generic or empty. */
export function applySeContextToDiscovery(prep: Prep, additionalContext: string | undefined): Prep {
  const hints = parseSeDiscoveryHints(additionalContext);
  if (!hasHints(hints)) return prep;

  let likelyPains = [...(prep.likelyPains || [])].filter(Boolean);
  let discoveryKit = [...(prep.discoveryKit || [])];

  if (!painsAnchoredToSe(likelyPains, hints)) {
    const sePains = buildSePains(hints);
    likelyPains = [...sePains, ...likelyPains].slice(0, 5);
  }

  if (!kitAnchoredToSe(discoveryKit, hints)) {
    const seKit = buildSeDiscoveryKit(hints);
    discoveryKit = [...seKit, ...discoveryKit].slice(0, 3);
  }

  return { ...prep, likelyPains, discoveryKit };
}
