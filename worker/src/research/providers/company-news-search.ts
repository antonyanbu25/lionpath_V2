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

/** Strip HTML entities, URLs and timestamps DDG embeds in titles/snippets. */
export function cleanDdgText(raw: string): string {
  return String(raw || "")
    .replace(/&nbsp;|&amp;|&quot;|&#\d+;/gi, " ")
    .replace(/https?:\/\/\S+/gi, "")
    .replace(/\d{4}-\d{2}-\d{2}T[\d:.Z]+/gi, "")
    .replace(/\s+/g, " ")
    .trim();
}

function headlineFromHit(hit: DdgNewsHit): string {
  let title = cleanDdgText(hit.title);
  const snippet = cleanDdgText(hit.snippet);
  if (/newsroom|topic\/|press-releases|\/news\/default/i.test(hit.url) && snippet.length > 24) {
    const first = snippet.split(/[.!?]/).find((s) => s.trim().length > 20);
    if (first) title = first.trim();
  }
  return trimWords(title, 8);
}

function detailFromHit(hit: DdgNewsHit): string {
  const snippet = cleanDdgText(hit.snippet);
  const title = cleanDdgText(hit.title);
  const detail = snippet && snippet.toLowerCase() !== title.toLowerCase() ? snippet : title;
  return trimWords(detail, 18);
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
        "user-agent":
          "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
        accept: "text/html,application/xhtml+xml",
        "accept-language": "en-US,en;q=0.9",
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

async function ddgSearchWithRetry(query: string): Promise<string> {
  for (let attempt = 0; attempt < 2; attempt++) {
    const html = await ddgSearch(query);
    if (html.length > 400) return html;
  }
  return "";
}

function collectHitsFromPages(htmlPages: string[], seen: Set<string>, limit: number): DdgNewsHit[] {
  const hits: DdgNewsHit[] = [];
  for (const html of htmlPages) {
    if (!html) continue;
    for (const hit of extractNewsHitsFromHtml(html, MAX_DDG_RESULTS)) {
      const key = hit.url.toLowerCase();
      if (seen.has(key)) continue;
      seen.add(key);
      hits.push(hit);
      if (hits.length >= limit) return hits;
    }
  }
  return hits;
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
    const headline = headlineFromHit(hit);
    const detail = detailFromHit(hit);
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

/** Google News RSS — reliable when DDG rate-limits. */
async function fetchGoogleNewsRss(companyName: string): Promise<DdgNewsHit[]> {
  const q = encodeURIComponent(`${companyName} when:1y`);
  const url = `https://news.google.com/rss/search?q=${q}&hl=en-US&gl=US&ceid=US:en`;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
  try {
    const res = await fetch(url, {
      signal: controller.signal,
      headers: {
        "user-agent":
          "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
        accept: "application/rss+xml, application/xml, text/xml, */*",
      },
    });
    if (!res.ok) return [];
    const xml = await res.text();
    const out: DdgNewsHit[] = [];
    const itemRe = /<item>([\s\S]*?)<\/item>/gi;
    let m: RegExpExecArray | null;
    while ((m = itemRe.exec(xml)) && out.length < MAX_DDG_RESULTS * 2) {
      const block = m[1];
      const title = block.match(/<title>(?:<!\[CDATA\[)?([\s\S]*?)(?:\]\]>)?<\/title>/i)?.[1] || "";
      const link = block.match(/<link>([\s\S]*?)<\/link>/i)?.[1]?.trim() || "";
      const desc =
        block.match(/<description>(?:<!\[CDATA\[)?([\s\S]*?)(?:\]\]>)?<\/description>/i)?.[1] || "";
      const cleanTitle = cleanDdgText(title.replace(/<[^>]+>/g, " "));
      const cleanDesc = cleanDdgText(desc.replace(/<[^>]+>/g, " "));
      if (!cleanTitle || !link || !isNewsLikeUrl(link)) continue;
      out.push({ title: cleanTitle, snippet: cleanDesc || cleanTitle, url: link });
    }
    return out;
  } catch {
    return [];
  } finally {
    clearTimeout(timer);
  }
}

/** Crawl DuckDuckGo for recent news — all queries in parallel. */
export async function searchCompanyNewsWeb(input: {
  companyName: string;
  companyDomain?: string;
}): Promise<CompanyNews | null> {
  if (!input?.companyName) return null;

  const queries = buildNewsQueries(input.companyName, input.companyDomain);
  console.info(`[prep/company-news/ddg] ${input.companyName}: ${queries.length} parallel queries + Google News RSS`);

  const seen = new Set<string>();
  const [ddgPages, rssHits] = await Promise.all([
    Promise.all(queries.map((q) => ddgSearchWithRetry(q))),
    fetchGoogleNewsRss(input.companyName),
  ]);

  let hits = collectHitsFromPages(ddgPages, seen, MAX_NEWS_ITEMS * 2);
  for (const hit of rssHits) {
    const key = hit.url.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    hits.push(hit);
  }

  if (!hits.length) {
    console.warn(`[prep/company-news/ddg] ${input.companyName}: parallel empty — sequential retry`);
    for (const q of queries) {
      const html = await ddgSearchWithRetry(q);
      const batch = collectHitsFromPages([html], seen, MAX_NEWS_ITEMS * 2);
      hits.push(...batch);
      if (hits.length >= 3) break;
    }
  }

  const ranked = rankNewsHits(hits, input.companyName).slice(0, MAX_NEWS_ITEMS);
  const result = companyNewsFromHits(ranked);
  console.info(
    `[prep/company-news/ddg] ${input.companyName}: ddg+rsshits=${hits.length} rss=${rssHits.length} → ${result?.items.length ?? 0} items`,
  );
  return result;
}
