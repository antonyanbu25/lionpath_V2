import type { PersonResearchFragment } from "../types";

const FETCH_TIMEOUT_MS = 8000;
const COMPETITOR_RE = /\b(zendesk|intercom|zoho|salesforce service cloud|servicenow|freshdesk|hubspot)\b/gi;
const YEARS_RE = /(\d{1,2})\+?\s*(?:years?|yrs?)\s*(?:of\s+)?(?:experience|exp)/i;
const ROLE_HINTS = [
  "director",
  "manager",
  "head of",
  "vp ",
  "vice president",
  "chief",
  "lead",
  "support",
  "customer success",
  "operations",
];

function localPart(email: string): string {
  return email.split("@")[0]?.replace(/[._+-]/g, " ").trim() || "";
}

function guessName(email: string, prospectName?: string): string {
  if (prospectName?.trim()) return prospectName.trim();
  const part = localPart(email);
  return part
    .split(/\s+/)
    .filter(Boolean)
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
    .join(" ");
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

function extractSnippets(html: string): { text: string; url: string }[] {
  const out: { text: string; url: string }[] = [];
  const resultRe = /<a[^>]+class="result__a"[^>]+href="([^"]+)"[^>]*>([\s\S]*?)<\/a>/gi;
  let m: RegExpExecArray | null;
  while ((m = resultRe.exec(html)) && out.length < 6) {
    const url = m[1].replace(/&amp;/g, "&");
    const text = m[2].replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim();
    if (text) out.push({ text, url });
  }
  if (out.length) return out;

  const snippetRe = /<a[^>]+class="[^"]*result[^"]*"[^>]+href="([^"]+)"[^>]*>([\s\S]*?)<\/a>/gi;
  while ((m = snippetRe.exec(html)) && out.length < 6) {
    const url = m[1].replace(/&amp;/g, "&");
    const text = m[2].replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim();
    if (text.length > 20) out.push({ text, url });
  }
  return out;
}

function inferRole(text: string): string | undefined {
  const lower = text.toLowerCase();
  for (const hint of ROLE_HINTS) {
    const idx = lower.indexOf(hint);
    if (idx >= 0) {
      const slice = text.slice(Math.max(0, idx - 10), idx + 60);
      const cleaned = slice.replace(/\s+/g, " ").trim();
      if (cleaned.length >= 8) return cleaned.slice(0, 80);
    }
  }
  return undefined;
}

function extractEmployers(text: string, companyName: string): string[] {
  const employers: string[] = [];
  const atRe = /\bat\s+([A-Z][A-Za-z0-9&.\- ]{2,40})/g;
  let m: RegExpExecArray | null;
  while ((m = atRe.exec(text)) && employers.length < 4) {
    const name = m[1].trim().replace(/\s+(LinkedIn|Profile).*$/i, "");
    if (name && !name.toLowerCase().includes(companyName.toLowerCase().slice(0, 6))) {
      employers.push(name);
    }
  }
  return [...new Set(employers)];
}

function buildExperienceSummary(parts: {
  totalExperience?: string;
  role?: string;
  employers?: string[];
  snippets?: string[];
}): string | undefined {
  const bits: string[] = [];
  if (parts.totalExperience) bits.push(parts.totalExperience);
  if (parts.role) bits.push(parts.role);
  if (parts.employers?.length) bits.push(`prior roles at ${parts.employers.slice(0, 2).join(", ")}`);
  if (!bits.length && parts.snippets?.length) {
    const joined = parts.snippets.join(" ").slice(0, 120);
    if (joined.length > 30) bits.push(joined);
  }
  return bits.length ? bits.join("; ").slice(0, 160) : undefined;
}

/** Google-style person search via DuckDuckGo HTML (LinkedIn-first, then broader web). */
export async function searchPersonWeb(
  email: string,
  companyName: string,
  prospectName?: string,
): Promise<PersonResearchFragment[]> {
  const name = guessName(email, prospectName);
  const queries = [
    `"${name}" ${companyName} site:linkedin.com`,
    `"${name}" ${companyName} linkedin profile experience`,
    `${localPart(email)} ${companyName} support director linkedin`,
  ];

  const fragments: PersonResearchFragment[] = [];

  for (const query of queries) {
    const html = await ddgSearch(query);
    if (!html) continue;

    const hits = extractSnippets(html);
    const linkedInHit = hits.find((h) => /linkedin\.com/i.test(h.url));
    const primary = linkedInHit || hits[0];
    if (!primary) continue;

    const combined = hits.map((h) => h.text).join(" ");
    const years = combined.match(YEARS_RE)?.[0];
    const role = inferRole(combined);
    const employers = extractEmployers(combined, companyName);
    const touchpoints = [...new Set((combined.match(COMPETITOR_RE) || []).map((t) => t.trim()))];

    fragments.push({
      source: linkedInHit ? "linkedin_search" : "web_search",
      email,
      name,
      role,
      totalExperience: years,
      experienceSummary: buildExperienceSummary({
        totalExperience: years,
        role,
        employers,
        snippets: hits.map((h) => h.text),
      }),
      priorEmployers: employers,
      competitorTouchpoints: touchpoints.slice(0, 4),
      snippets: hits.map((h) => h.text).slice(0, 3),
      url: primary.url,
      confidence: linkedInHit ? 72 : 55,
    });

    if (linkedInHit) break;
  }

  return fragments;
}
