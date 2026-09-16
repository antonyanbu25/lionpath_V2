const EMAIL_RE = /[a-z0-9._%+-]+@[a-z0-9.-]+\.[a-z]{2,}/gi;

export const FREE_MAIL_DOMAINS = new Set([
  "gmail.com",
  "googlemail.com",
  "outlook.com",
  "hotmail.com",
  "live.com",
  "msn.com",
  "yahoo.com",
  "yahoo.co.uk",
  "yahoo.co.in",
  "icloud.com",
  "me.com",
  "mac.com",
  "aol.com",
  "protonmail.com",
  "proton.me",
  "zoho.com",
  "rediffmail.com",
  "gmx.com",
  "mail.com",
  "qq.com",
  "163.com",
]);

export function normalizeEmail(raw: string): string | null {
  const email = String(raw || "").trim().toLowerCase();
  if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return null;
  return email;
}

export function emailDomain(email: string): string | null {
  const at = email.lastIndexOf("@");
  if (at < 0) return null;
  return email.slice(at + 1).trim().toLowerCase().replace(/^www\./, "");
}

export function isFreeMailDomain(domain: string | null | undefined): boolean {
  const d = String(domain || "")
    .trim()
    .toLowerCase()
    .replace(/^www\./, "")
    .split("/")[0];
  return d ? FREE_MAIL_DOMAINS.has(d) : false;
}

/** Scan transcript / HTML for email addresses. */
export function extractEmailsFromText(...chunks: (string | undefined)[]): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const chunk of chunks) {
    if (!chunk) continue;
    const matches = chunk.match(EMAIL_RE) || [];
    for (const raw of matches) {
      const email = normalizeEmail(raw);
      if (!email || seen.has(email)) continue;
      seen.add(email);
      out.push(email);
    }
  }
  return out;
}

export function mergeParticipantEmails(
  ...groups: (string[] | undefined)[]
): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const group of groups) {
    for (const raw of group || []) {
      const email = normalizeEmail(raw);
      if (!email || seen.has(email)) continue;
      seen.add(email);
      out.push(email);
    }
  }
  return out;
}

export function corporateDomainsFromEmails(emails: string[]): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const email of emails) {
    const domain = emailDomain(email);
    if (!domain || isFreeMailDomain(domain) || seen.has(domain)) continue;
    seen.add(domain);
    out.push(domain);
  }
  return out;
}

export function freeMailDomainsFromEmails(emails: string[]): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const email of emails) {
    const domain = emailDomain(email);
    if (!domain || !isFreeMailDomain(domain) || seen.has(domain)) continue;
    seen.add(domain);
    out.push(domain);
  }
  return out;
}
