/**
 * Parallel DuckDuckGo news crawl — runs alongside Gemini grounded search.
 */

import type { CompanyNews, NewsSource } from "../../prep/company-news";
import { MAX_NEWS_ITEMS } from "../../prep/company-news";
import type { RecentNewsItem } from "../../schema";

const FETCH_TIMEOUT_MS = 8000;
const MAX_DDG_RESULTS = 5;

const SKIP_URL_RE =
  /linkedin\.com|facebook\.com|twitter\.com|x\.com|instagram\.com|glassdoor\.com|indeed\.com|\/careers|\/jobs|login|signin|wikipedia\.org\/wiki\/list/i;

const NEWS_TITLE_RE =
  /\b(news|funding|raised|series|acquisition|merger|launch|announc|partnership|appoint|ceo|cfo|revenue|earnings|ipo|expand|invest)\b/i;

function trimWords(v: string, max: number): string {
  const parts = String(v || "")
    .trim()
    .split(/\s+/)
    .filter(Boolean);
  return parts.length <= max ? parts.join(" ") : `${parts.slice(0, max).join(" ")}…`;
}

function domainFromUrl(url: string): string {
  try {
    return new URL(url).hostname.replace(/^www\./, "").toLowerCase();
  } catch {
    return "";
  }
}

/** True when a DDG hit looks like a news article, not a profile or careers page. */
export function isNewsLikeUrl(url: string): boolean {
  const u = String(url || "").trim();
  if (!u || !/^https?:\/\//i.test(u)) return false;
  return !SKIP_URL_RE.test(u);
}

export interface DdgNewsHit {
  title: string;
  snippet: string;
  url: string;
}

/** Parse DuckDuckGo HTML result blocks into news-like hits. Exported for unit tests. */
export function extractNewsHitsFromHtml(html: string, maxItems = MAX_DDG_RESULTS): DdgNewsHit[] {
  const out: DdgNewsHit[] = [];
  const seen = new Set<string>();
  const blockRe =
    /<a[^>]+class="result__a"[^>]+href="([^"]+)"[^>]*>([\s\S]*?)<\/a>([\s\S]{0,800}?)(?=<a[^>]+class="result__a"|$)/gi;
  let m: RegExpExecArray | null;
  while ((m = blockRe.exec(html)) && out.length < maxItems) {
    const url = m[1].replace(/&amp;/g, "&");
    const title = m[2].replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim();
    const blockTail = m[3] || "";
    const snippetMatch = blockTail.match(/class="result__snippet"[^>]*>([\s\S]*?)<\//i);
    const snippet = (snippetMatch?.[1] || "")
      .replace(/<[^>]+>/g, " ")
      .replace(/\s+/g, " ")
      .trim();
    if (!title || !isNewsLikeUrl(url)) continue;
    const key = url.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    out.push({ title, snippet: snippet || title, url });
  }

  if (out.length) return out;

  const fallbackRe = /<a[^>]+class="result__a"[^>]+href="([^"]+)"[^>]*>([\s\S]*?)<\/a>/gi;
  while ((m = fallbackRe.exec(html)) && out.length < maxItems) {
    const url = m[1].replace(/&amp;/g, "&");
    const title = m[2].replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim();
    if (!title || title.length < 12 || !isNewsLikeUrl(url)) continue;
    const key = url.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    out.push({ title, snippet: title, url });
  }
  return out;
}

async function ddgSearch(query: string): Promise<string> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
  try {
    const res = await fetch("https://html.duckduckgo.com/html/", {
      method: "POST",
      signal: controller.signal,
      headers: {
        "content-type": "application/x-www-form-urlencoded",
        "user-agent": "SE-Prep-Research/1.0",
      },
      body: `q=${encodeURIComponent(query)}`,
    });
    if (!res.ok) return "";
    return await res.text();
  } catch {
    return "";
  } finally {
    clearTimeout(timer);
  }
}

/** Prefer titles/snippets that read like news, not generic homepages. */
export function rankNewsHits(hits: DdgNewsHit[], companyName: string): DdgNewsHit[] {
  const needle = String(companyName || "").trim().toLowerCase();
  return [...hits].sort((a, b) => {
    const score = (h: DdgNewsHit) => {
      let s = 0;
      const blob = `${h.title} ${h.snippet}`.toLowerCase();
      if (needle && blob.includes(needle)) s += 2;
      if (NEWS_TITLE_RE.test(h.title)) s += 2;
      if (NEWS_TITLE_RE.test(h.snippet)) s += 1;
      if (/freshworks\.com\/\w/i.test(h.url) && !/\/(blog|news|press)/i.test(h.url)) s -= 1;
      return s;
    };
    return score(b) - score(a);
  });
}

/** Turn parsed DDG hits into the same shape as grounded company news. */
export function companyNewsFromHits(hits: DdgNewsHit[]): CompanyNews | null {
  const items: RecentNewsItem[] = [];
  const sources: NewsSource[] = [];
  const byDomain = new Map<string, NewsSource>();

  for (const hit of hits) {
    const headline = trimWords(hit.title, 8);
    const detail = trimWords(hit.snippet, 18);
    if (!headline) continue;

    const domain = domainFromUrl(hit.url);
    if (!domain) continue;

    let source = byDomain.get(domain);
    if (!source) {
      source = {
        label: `N${sources.length + 1}`,
        domain,
        url: hit.url,
        title: domain,
      };
      byDomain.set(domain, source);
      sources.push(source);
    }

    items.push({
      headline,
      detail,
      sourceLabel: source.label,
      articleUrl: hit.url,
    });
    if (items.length >= MAX_NEWS_ITEMS) break;
  }

  if (!items.length) return null;
  const cited = new Set(items.map((i) => i.sourceLabel));
  return { items, sources: sources.filter((s) => cited.has(s.label)), dropped: [] };
}

function buildNewsQueries(companyName: string, companyDomain?: string): string[] {
  const name = String(companyName || "").trim();
  if (!name) return [];
  const domain = String(companyDomain || "").trim();
  const queries = [
    `"${name}" news`,
    `"${name}" funding OR acquisition OR launch`,
    `${name} latest news`,
    `${name} company announcement`,
  ];
  if (domain) queries.push(`"${name}" news site:${domain}`);
  return queries;
}

/** Crawl DuckDuckGo for recent news — all queries in parallel. */
export async function searchCompanyNewsWeb(input: {
  companyName: string;
  companyDomain?: string;
}): Promise<CompanyNews | null> {
  if (!input?.companyName) return null;

  const queries = buildNewsQueries(input.companyName, input.companyDomain);
  const htmlPages = await Promise.all(queries.map((q) => ddgSearch(q)));

  const seen = new Set<string>();
  const hits: DdgNewsHit[] = [];

  for (const html of htmlPages) {
    if (!html) continue;
    for (const hit of extractNewsHitsFromHtml(html, MAX_DDG_RESULTS)) {
      const key = hit.url.toLowerCase();
      if (seen.has(key)) continue;
      seen.add(key);
      hits.push(hit);
    }
  }

  const ranked = rankNewsHits(hits, input.companyName).slice(0, MAX_NEWS_ITEMS);
  return companyNewsFromHits(ranked);
}
