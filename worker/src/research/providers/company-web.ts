import { suggestDomain } from "../../domain";
import type { CompanyResearchFragment } from "../types";

const FETCH_TIMEOUT_MS = 8000;
const MAX_SNIPPET_CHARS = 600;

const TEAM_PATHS = ["/about", "/about-us", "/team", "/leadership", "/company", "/who-we-are"];

function stripHtml(html: string): string {
  return html
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

async function fetchText(url: string): Promise<string | null> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
  try {
    const res = await fetch(url, {
      signal: controller.signal,
      headers: { "user-agent": "SE-Prep-Research/1.0 (+https://freshworks.com)" },
      redirect: "follow",
    });
    if (!res.ok) return null;
    const ct = res.headers.get("content-type") || "";
    if (!ct.includes("text/html") && !ct.includes("text/plain")) return null;
    const html = await res.text();
    return stripHtml(html).slice(0, MAX_SNIPPET_CHARS);
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}

/** Fetch company homepage and common team/about pages. */
export async function fetchCompanyWeb(
  companyName: string,
  domain: string,
): Promise<CompanyResearchFragment[]> {
  const hosts = new Set<string>();
  if (domain) hosts.add(domain.replace(/^www\./, ""));
  const suggested = suggestDomain(companyName);
  if (suggested) hosts.add(suggested.replace(/^www\./, ""));

  const out: CompanyResearchFragment[] = [];

  for (const host of hosts) {
    const base = `https://${host}`;
    const homepage = await fetchText(base);
    if (homepage) {
      out.push({
        source: "company_web",
        snippets: [homepage],
        url: base,
        confidence: 65,
      });
    }

    for (const path of TEAM_PATHS) {
      const text = await fetchText(`${base}${path}`);
      if (text && text.length > 80) {
        out.push({
          source: "company_web",
          snippets: [text],
          url: `${base}${path}`,
          confidence: 60,
        });
        break;
      }
    }
    if (out.length) break;
  }

  return out;
}
