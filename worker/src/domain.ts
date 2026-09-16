// Domain heuristics for prep research — catch typos and mismatches vs company name.

const TYPO_MARKERS = [
  "acadmey",
  "academey",
  "acadamy",
  "acadimy",
  "goggle",
  "gooogle",
  "facebok",
];

const WELL_KNOWN_DOMAINS: Record<string, string> = {
  "khan academy": "khanacademy.org",
  "khan academey": "khanacademy.org",
};

export const DOMAIN_RE = /^[a-z0-9]([a-z0-9-]*\.)+[a-z]{2,}$/;

function normalizeSlug(s: string): string {
  return s.toLowerCase().replace(/[^a-z0-9]/g, "");
}

/** Normalize user-entered company domain (strip protocol/www/path). */
export function normalizeCompanyDomain(raw: string): string {
  return String(raw || "")
    .trim()
    .toLowerCase()
    .replace(/^https?:\/\//, "")
    .replace(/^www\./, "")
    .split("/")[0]
    .split("?")[0];
}

export function isValidCompanyDomain(raw: string): boolean {
  const d = normalizeCompanyDomain(raw);
  return !!d && DOMAIN_RE.test(d);
}

function levenshtein(a: string, b: string): number {
  const m = a.length;
  const n = b.length;
  const dp = Array.from({ length: m + 1 }, () => new Array<number>(n + 1).fill(0));
  for (let i = 0; i <= m; i++) dp[i][0] = i;
  for (let j = 0; j <= n; j++) dp[0][j] = j;
  for (let i = 1; i <= m; i++) {
    for (let j = 1; j <= n; j++) {
      dp[i][j] =
        a[i - 1] === b[j - 1]
          ? dp[i - 1][j - 1]
          : 1 + Math.min(dp[i - 1][j], dp[i][j - 1], dp[i - 1][j - 1]);
    }
  }
  return dp[m][n];
}

/** Suggest a likely official domain from a company name (well-known map + simple slug). */
export function suggestDomain(companyName: string): string | undefined {
  const key = companyName.trim().toLowerCase();
  if (WELL_KNOWN_DOMAINS[key]) return WELL_KNOWN_DOMAINS[key];

  const words = key.split(/\s+/).filter(Boolean);
  if (words.length >= 1 && words.length <= 4) {
    const slug = normalizeSlug(words.join(""));
    if (slug.length >= 4) return `${slug}.com`;
  }
  return undefined;
}

/** True when the email domain looks misspelled or unrelated to the company name. */
export function isLikelyInvalidDomain(domain: string, companyName?: string): boolean {
  const d = domain.toLowerCase().replace(/^www\./, "").trim();
  if (!d || !DOMAIN_RE.test(d)) return true;

  const base = d.split(".")[0];
  if (TYPO_MARKERS.some((m) => base.includes(m))) return true;

  if (!companyName?.trim()) return false;

  const companySlug = normalizeSlug(companyName);
  const domainSlug = normalizeSlug(base.replace(/^the/, ""));
  if (!companySlug || !domainSlug) return false;

  const suggested = suggestDomain(companyName);
  if (suggested) {
    const suggestedBase = normalizeSlug(suggested.split(".")[0]);
    if (suggestedBase !== domainSlug) {
      const dist = levenshtein(companySlug, domainSlug);
      const ratio = dist / Math.max(companySlug.length, domainSlug.length);
      if (ratio > 0.2 || TYPO_MARKERS.some((m) => base.includes(m))) return true;
    }
  }

  const dist = levenshtein(companySlug, domainSlug);
  const maxLen = Math.max(companySlug.length, domainSlug.length);
  if (maxLen >= 6 && dist / maxLen > 0.3) return true;

  const words = companyName
    .toLowerCase()
    .split(/\s+/)
    .map(normalizeSlug)
    .filter((w) => w.length >= 3);
  if (words.length >= 2) {
    const matched = words.filter((w) => domainSlug.includes(w));
    if (matched.length < Math.ceil(words.length / 2)) return true;
  }

  return false;
}
