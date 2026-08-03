/**
 * Company domain auto-fill from prospect emails (corporate domains only).
 */

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/i;

export function parseProspectEmailsForDomain(raw) {
  const parts = String(raw || "")
    .split(/[,;]+/)
    .map((e) => e.trim().toLowerCase())
    .filter(Boolean);
  const seen = new Set();
  const out = [];
  for (const e of parts) {
    if (!EMAIL_RE.test(e)) continue;
    if (seen.has(e)) continue;
    seen.add(e);
    out.push(e);
    if (out.length >= 5) break;
  }
  return out;
}

export const PERSONAL_EMAIL_DOMAINS = new Set([
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
]);

const DOMAIN_RE = /^[a-z0-9]([a-z0-9-]*[a-z0-9])?(\.[a-z0-9]([a-z0-9-]*[a-z0-9])?)+$/;

export function normalizeCompanyDomain(raw) {
  return String(raw || "")
    .trim()
    .toLowerCase()
    .replace(/^https?:\/\//, "")
    .replace(/^www\./, "")
    .split("/")[0];
}

/** Display format for company website field (screenshot parity). */
export function formatCompanyWebsiteDisplay(domain) {
  const d = normalizeCompanyDomain(domain);
  if (!d) return "";
  return `https://www.${d}`;
}

function emailDomain(email) {
  const at = String(email || "").lastIndexOf("@");
  return at >= 0 ? email.slice(at + 1).trim().toLowerCase() : "";
}

/**
 * Corporate domain from first parsed prospect email, or null for personal/invalid.
 * @param {string} rawEmails
 */
export function domainFromFirstProspectEmail(rawEmails) {
  const emails = parseProspectEmailsForDomain(rawEmails);
  const first = emails[0];
  if (!first) return null;
  const domain = normalizeCompanyDomain(emailDomain(first));
  if (!domain || !DOMAIN_RE.test(domain)) return null;
  if (PERSONAL_EMAIL_DOMAINS.has(domain)) return null;
  return domain;
}

/**
 * @param {HTMLElement|null} domainField fw-input or inner input
 * @param {string} rawEmails
 * @param {{ userEdited?: boolean, lastAutoValue?: string|null }} opts
 * @returns {{ applied: string|null, lastAutoValue: string|null }}
 */
export function applyAutoCompanyDomain(domainField, rawEmails, opts = {}) {
  if (!domainField || opts.userEdited) {
    return { applied: null, lastAutoValue: opts.lastAutoValue ?? null };
  }

  const inferred = domainFromFirstProspectEmail(rawEmails);
  if (!inferred) {
    return { applied: null, lastAutoValue: opts.lastAutoValue ?? null };
  }

  const current = normalizeCompanyDomain(readDomainValue(domainField));
  const lastAuto = opts.lastAutoValue != null ? normalizeCompanyDomain(opts.lastAutoValue) : null;
  const mayOverwrite = !current || current === lastAuto;

  if (!mayOverwrite) {
    return { applied: null, lastAutoValue: lastAuto };
  }

  const display = formatCompanyWebsiteDisplay(inferred);
  setDomainValue(domainField, display);
  return { applied: inferred, lastAutoValue: inferred };
}

function readDomainValue(field) {
  if (typeof field.value === "string") return field.value;
  const inner = field.querySelector?.("input");
  return inner?.value ?? "";
}

function setDomainValue(field, value) {
  if ("value" in field) {
    field.value = value;
  }
  const inner = field.querySelector?.("input");
  if (inner) inner.value = value;
  field.dispatchEvent?.(new Event("input", { bubbles: true }));
  field.dispatchEvent?.(new CustomEvent("fwInput", { bubbles: true, detail: { value } }));
}

/** Resolve domain for submit: field value, else infer from emails. */
export function resolveCompanyDomainForSubmit(domainRaw, emailsRaw) {
  const fromField = normalizeCompanyDomain(domainRaw);
  if (fromField && DOMAIN_RE.test(fromField)) return fromField;
  const inferred = domainFromFirstProspectEmail(emailsRaw);
  if (inferred) return inferred;
  return fromField || "";
}

export function isPersonalEmailDomain(domain) {
  const d = normalizeCompanyDomain(domain);
  return d ? PERSONAL_EMAIL_DOMAINS.has(d) : false;
}

/** Mail-infra labels that are never the company name. */
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

const NON_PROSPECT_DOMAINS = new Set([
  ...PERSONAL_EMAIL_DOMAINS,
  "freshworks.com",
  "freshdesk.com",
  "freshservice.com",
]);

function labelToCompanyName(label) {
  if (!label || label.length < 2) return null;
  return label
    .replace(/[-_]+/g, " ")
    .split(" ")
    .filter(Boolean)
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
    .join(" ");
}

function companyNameFromDomainLabels(domain) {
  const d = normalizeCompanyDomain(domain);
  if (!d || !DOMAIN_RE.test(d) || NON_PROSPECT_DOMAINS.has(d)) return null;
  const labels = d.split(".").filter(Boolean);
  if (labels.length < 2) return null;
  let label = labels[0];
  if (DOMAIN_LABEL_NOISE.has(label) && labels.length > 2) label = labels[1];
  return labelToCompanyName(label);
}

/**
 * "alex@acme.com" -> "Acme". Returns null for free-mail domains.
 * @param {string} email
 */
export function companyNameFromEmail(email) {
  const domain = emailDomain(email);
  return companyNameFromDomainLabels(domain);
}

/** @param {string} domain */
export function companyNameFromDomain(domain) {
  return companyNameFromDomainLabels(domain);
}

/** Derive display company name from first prospect email, or null. */
export function companyNameFromPrimaryEmail(rawEmails) {
  const emails = parseProspectEmailsForDomain(rawEmails);
  return companyNameFromEmail(emails[0] || "") || null;
}

export { DOMAIN_RE };
