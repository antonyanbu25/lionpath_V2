/**
 * Recent company news, from its own grounded search.
 *
 * The Recent news panel used to be assembled from whatever research facts happened to carry
 * `category: "news"`. Three separate paths let the SE's own typed context become "news" that way,
 * so the panel read the SE's notes back to them under an INPUT badge. Those paths are closed; this
 * module is where news actually comes from.
 *
 * Same grounding discipline as rivals.ts: the model names the publisher domain it read each item
 * from, and that domain is checked against the citation set Gemini itself returned. The citation
 * set is ground truth the model does not control, so a plausibly-spelled invented source cannot
 * survive. Anything unverifiable is dropped and logged rather than shown.
 */

import { extractJson } from "../json";
import { getProvider } from "../providers";
import type { RecentNewsItem } from "../schema";
import { dedupeCitations, normalizeCitations, resolveRedirectUrls } from "./citations";
import type { Citation } from "../providers/types";
import type { LlmResult } from "../providers/types";
import type { Env } from "./types";

export const MAX_NEWS_ITEMS = 4;
/** Recency bar. Anything older is not "recent news" to an SE on a call today. */
export const NEWS_WINDOW_MONTHS = 12;

export interface NewsSource {
  label: string;
  domain: string;
  url: string;
  title: string;
}

export interface CompanyNews {
  items: RecentNewsItem[];
  sources: NewsSource[];
  /** Items dropped for want of a verifiable source. Never silently thinned. */
  dropped: string[];
}

const NEWS_SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: ["items"],
  properties: {
    items: {
      type: "array",
      maxItems: MAX_NEWS_ITEMS,
      items: {
        type: "object",
        additionalProperties: false,
        required: ["headline", "detail", "sourceDomain"],
        properties: {
          headline: { type: "string", description: "The event in at most 8 words." },
          detail: {
            type: "string",
            description: "One line of substance from the article, max 18 words. No opinion.",
          },
          sourceDomain: {
            type: "string",
            description:
              "Publisher domain of the page this was read from, e.g. 'reuters.com'. Must be a page search actually returned.",
          },
          publishedAt: {
            type: "string",
            description: "Publication date as the source states it, e.g. '2026-03' or 'March 2026'.",
          },
        },
      },
    },
  },
} as const;

const SYSTEM_PROMPT = `You find recent news about a company for a Solution Engineer about to speak to them.

Use web search. Report only what a page you actually retrieved says.

RULES
- Anything genuinely newsworthy about the company counts: funding, launches, leadership moves, acquisitions, expansion, results, regulatory or outage events. Judge newsworthiness the way a business reader would.
- Last ${NEWS_WINDOW_MONTHS} months only. Older items are not recent news — omit them rather than stretching the window.
- Give the publisher domain you read each item from. If you did not retrieve a page for it, omit the item.
- Never infer, combine or extrapolate an event. No item without a page behind it.
- This is about the company itself, not its market or its software vendors. Skip anything about which support tools they use — that is covered elsewhere in the brief.
- Returning nothing is a correct answer when nothing recent was published. Do not pad.`;

function buildUserPrompt(input: { companyName: string; companyDomain?: string }): string {
  return [
    `COMPANY: ${input.companyName}`,
    input.companyDomain ? `DOMAIN: ${input.companyDomain}` : "",
    "",
    `What has been published about ${input.companyName} in the last ${NEWS_WINDOW_MONTHS} months? Up to ${MAX_NEWS_ITEMS} items, most significant first, each with the publisher domain you read it from.`,
  ]
    .filter(Boolean)
    .join("\n");
}

interface RawNewsItem {
  headline?: string;
  detail?: string;
  sourceDomain?: string;
  publishedAt?: string;
}

/** Index the call's real citations by publisher domain, minting a stable label per domain. */
export function buildNewsSources(citations: Citation[] | undefined): {
  byDomain: Map<string, NewsSource>;
  sources: NewsSource[];
} {
  const byDomain = new Map<string, NewsSource>();
  const sources: NewsSource[] = [];
  for (const cite of dedupeCitations(normalizeCitations(citations))) {
    // normalizeCitations already prefers the resolved publisher URL and falls back to Gemini's
    // title for the domain when the URI is still a grounding redirect. No domain means no
    // identity to verify a claim against, so the entry is unusable here.
    const domain = String(cite.domain || "").trim().toLowerCase();
    if (!domain || byDomain.has(domain)) continue;
    const source: NewsSource = {
      label: `N${sources.length + 1}`,
      domain,
      url: cite.uri,
      title: cite.title || domain,
    };
    byDomain.set(domain, source);
    sources.push(source);
  }
  return { byDomain, sources };
}

/** Match a model-claimed domain against a real one, tolerating a `www.` or subdomain prefix. */
function resolveDomain(
  claimed: string | undefined,
  byDomain: Map<string, NewsSource>,
): NewsSource | null {
  const key = String(claimed || "")
    .trim()
    .toLowerCase()
    .replace(/^https?:\/\//, "")
    .replace(/^www\./, "")
    .split("/")[0];
  if (!key) return null;
  const direct = byDomain.get(key);
  if (direct) return direct;
  // "uk.reuters.com" cited as "reuters.com" (and the reverse) is the same publisher.
  for (const [domain, source] of byDomain) {
    if (domain.endsWith(`.${key}`) || key.endsWith(`.${domain}`)) return source;
  }
  return null;
}

function trimWords(v: unknown, max: number): string {
  const parts = String(v ?? "")
    .trim()
    .split(/\s+/)
    .filter(Boolean);
  return parts.length <= max ? parts.join(" ") : `${parts.slice(0, max).join(" ")}…`;
}

/**
 * Keep only items traceable to a citation the search actually returned. Pure, so the grounding
 * rule is testable without a provider.
 */
export function shapeCompanyNews(
  raw: { items?: RawNewsItem[] } | null | undefined,
  citations: Citation[] | undefined,
): CompanyNews | null {
  const dropped: string[] = [];
  const { byDomain, sources } = buildNewsSources(citations);
  if (!byDomain.size) {
    console.warn("[prep/company-news] no grounded citations returned — nothing can be sourced");
    return null;
  }

  const items: RecentNewsItem[] = [];
  const seen = new Set<string>();
  for (const rawItem of raw?.items || []) {
    const headline = trimWords(rawItem?.headline, 8);
    const detail = trimWords(rawItem?.detail, 18);
    if (!headline) continue;

    const source = resolveDomain(rawItem?.sourceDomain, byDomain);
    if (!source) {
      dropped.push(`"${headline}": cited "${rawItem?.sourceDomain || "nothing"}", not in the search results`);
      continue;
    }
    const key = headline.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);

    items.push({ headline, detail, sourceLabel: source.label });
    if (items.length >= MAX_NEWS_ITEMS) break;
  }

  if (dropped.length) {
    console.warn(`[prep/company-news] dropped ${dropped.length} item(s): ${dropped.join("; ")}`);
  }
  if (!items.length) return null;

  // Only sources something actually cites, so the chip list matches the items shown.
  const cited = new Set(items.map((i) => i.sourceLabel));
  return { items, sources: sources.filter((s) => cited.has(s.label)), dropped };
}

/**
 * Grounded company news. Returns null whenever nothing is traceable — an absent panel is honest,
 * and is much better than the SE's own notes handed back as news.
 */
export async function generateCompanyNews(
  env: Env,
  input: { companyName: string; companyDomain?: string },
): Promise<CompanyNews | null> {
  if (!input?.companyName) return null;
  const provider = getProvider(env);

  let result: LlmResult | null = null;
  try {
    result = await provider.generate({
      system: SYSTEM_PROMPT,
      user: buildUserPrompt(input),
      maxTokens: 1200,
      temperature: 0.2,
      // Grounded: the citation set this returns is the only thing an item can be traced to.
      research: true,
      jsonSchema: NEWS_SCHEMA as unknown as Record<string, unknown>,
      step: "prep/company-news",
    });
  } catch (err) {
    console.warn("prep/company-news skipped:", (err as Error).message);
    result = null;
  }

  if (result) {
    try {
      const normalized = dedupeCitations(normalizeCitations(result.citations));
      const resolved = await resolveRedirectUrls(normalized);
      const shaped = shapeCompanyNews(
        extractJson<{ items?: RawNewsItem[] }>(result.text),
        resolved,
      );
      if (shaped) return shaped;
    } catch (err) {
      console.warn("prep/company-news unparsable:", (err as Error).message);
    }
  }

  const { searchCompanyNewsWeb } = await import("../research/providers/company-news-search");
  try {
    const ddg = await searchCompanyNewsWeb(input);
    if (ddg) {
      console.info(`[prep/company-news] DDG fallback returned ${ddg.items.length} item(s)`);
      return ddg;
    }
  } catch (err) {
    console.warn("prep/company-news DDG fallback skipped:", (err as Error).message);
  }
  return null;
}
