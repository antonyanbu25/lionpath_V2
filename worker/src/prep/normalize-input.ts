import { isValidCompanyDomain, normalizeCompanyDomain } from "../domain";
import type { PrepInput, NormalizedPrepInput } from "./types";
import { computeInputHash as computeInputHashImpl } from "./input-hash";
import { normalizeLinkedInExports } from "./linkedin-pdf";

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/i;

/** Parse comma/semicolon-separated emails; dedupe; cap at 5. */
export function resolveProspectEmails(input: PrepInput): string[] {
  const fromArray = (input.prospectEmails || []).map((e) => String(e).trim().toLowerCase()).filter(Boolean);
  const fromString = String(input.prospectEmail || "")
    .split(/[,;]+/)
    .map((e) => e.trim().toLowerCase())
    .filter(Boolean);
  const merged = [...fromArray, ...fromString].filter((e) => EMAIL_RE.test(e));
  const seen = new Set<string>();
  const out: string[] = [];
  for (const e of merged) {
    if (seen.has(e)) continue;
    seen.add(e);
    out.push(e);
    if (out.length >= 5) break;
  }
  return out;
}

export function deriveDomain(email: string): string {
  const at = email.lastIndexOf("@");
  return at >= 0 ? email.slice(at + 1).trim().toLowerCase() : "";
}

const PERSONAL_EMAIL_DOMAINS = new Set([
  "gmail.com",
  "googlemail.com",
  "outlook.com",
  "hotmail.com",
  "live.com",
  "msn.com",
  "yahoo.com",
  "yahoo.co.uk",
  "icloud.com",
  "me.com",
  "mac.com",
  "aol.com",
  "protonmail.com",
  "proton.me",
  "zoho.com",
  "freshworks.com",
  "freshdesk.com",
  "freshservice.com",
]);

const DOMAIN_LABEL_NOISE = new Set([
  "mail",
  "email",
  "smtp",
  "mx",
  "corp",
  "corporate",
  "internal",
  "www",
  "info",
  "go",
  "my",
  "app",
  "get",
]);

function labelToCompanyName(label: string): string | null {
  if (!label || label.length < 2) return null;
  return label
    .replace(/[-_]+/g, " ")
    .split(" ")
    .filter(Boolean)
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
    .join(" ");
}

function companyNameFromDomainLabels(domain: string): string | null {
  const d = domain.toLowerCase().replace(/^www\./, "").trim();
  if (!d || PERSONAL_EMAIL_DOMAINS.has(d)) return null;
  const labels = d.split(".").filter(Boolean);
  if (labels.length < 2) return null;
  let label = labels[0];
  if (DOMAIN_LABEL_NOISE.has(label) && labels.length > 2) label = labels[1];
  return labelToCompanyName(label);
}

/** Derive display company name from prospect email domain. */
export function deriveCompanyNameFromEmail(email: string): string | null {
  const at = email.lastIndexOf("@");
  if (at < 0) return null;
  return companyNameFromDomainLabels(email.slice(at + 1));
}

export function deriveCompanyNameFromDomain(domain: string): string | null {
  return companyNameFromDomainLabels(normalizeCompanyDomain(domain));
}

export function resolveCompanyName(input: PrepInput, emails: string[]): string {
  const explicit = String(input.companyName || "").trim();
  if (explicit) return explicit;
  const fromEmail = deriveCompanyNameFromEmail(emails[0] || "");
  if (fromEmail) return fromEmail;
  const fromDomain = deriveCompanyNameFromDomain(input.companyDomain || "");
  if (fromDomain) return fromDomain;
  throw new Error(
    "Could not derive company name — use a corporate prospect email or a recognizable company domain.",
  );
}

export function normalizePrepInput(input: PrepInput): NormalizedPrepInput {
  const emails = resolveProspectEmails(input);
  if (!emails.length) {
    throw new Error("At least one valid prospect email is required.");
  }

  const companyDomain = normalizeCompanyDomain(input.companyDomain || "");
  if (!companyDomain || !isValidCompanyDomain(companyDomain)) {
    throw new Error("A valid company domain is required (e.g. acme.com).");
  }

  const companyName = resolveCompanyName(input, emails);

  return {
    ...input,
    companyName,
    companyDomain,
    prospectEmail: emails[0],
    prospectEmails: emails,
    prepType: input.prepType || "new_business",
    forceRefresh: !!input.forceRefresh,
    linkedinProfileExports: normalizeLinkedInExports(input.linkedinProfileExports),
  };
}

export function computeInputHash(input: PrepInput, emails: string[]): string {
  return computeInputHashImpl(input, emails);
}
