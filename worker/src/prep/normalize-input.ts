import { isValidCompanyDomain, normalizeCompanyDomain } from "../domain";
import type { PrepInput } from "./types";

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

export function normalizePrepInput(input: PrepInput): PrepInput {
  const emails = resolveProspectEmails(input);
  if (!emails.length) {
    throw new Error("At least one valid prospect email is required.");
  }

  const companyDomain = normalizeCompanyDomain(input.companyDomain || "");
  if (!companyDomain || !isValidCompanyDomain(companyDomain)) {
    throw new Error("A valid company domain is required (e.g. acme.com).");
  }

  const companyName = String(input.companyName || "").trim();
  if (!companyName) {
    throw new Error("companyName is required.");
  }

  return {
    ...input,
    companyName,
    companyDomain,
    prospectEmail: emails[0],
    prospectEmails: emails,
    prepType: input.prepType || "new_business",
    forceRefresh: !!input.forceRefresh,
  };
}

export function computeInputHash(input: PrepInput, emails: string[]): string {
  const payload = {
    companyDomain: input.companyDomain,
    companyName: input.companyName.toLowerCase(),
    emails: [...emails].sort(),
    playbookVersion: "1",
  };
  let h = 0;
  const s = JSON.stringify(payload);
  for (let i = 0; i < s.length; i++) h = (Math.imul(31, h) + s.charCodeAt(i)) | 0;
  return `h${Math.abs(h).toString(36)}`;
}
