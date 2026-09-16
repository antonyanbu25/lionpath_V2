/**
 * Research input hash — must stay in sync with worker/src/prep/input-hash.ts
 */

export const PREP_PLAYBOOK_VERSION = "3";

/** @param {string} value */
export function fingerprintString(value) {
  const norm = String(value || "")
    .replace(/\r\n/g, "\n")
    .trim();
  if (!norm) return "";
  let h = 0;
  const tagged = `fp1:${norm}`;
  for (let i = 0; i < tagged.length; i++) h = (Math.imul(31, h) + tagged.charCodeAt(i)) | 0;
  return Math.abs(h).toString(36);
}

/** @param {string | undefined} kaiaMeetingUrl */
export function computeKaiaRef(kaiaMeetingUrl) {
  const raw = String(kaiaMeetingUrl || "").trim().split(/\s/)[0];
  if (!raw) return "";
  try {
    const u = new URL(raw);
    if (u.hostname.toLowerCase() !== "engage.freshworks.com") return "";
    const short = u.pathname.match(/^\/s\/([^/?#]+)/i)?.[1];
    if (short) return `s:${short}`;
    const token = u.pathname.match(/^\/kaia\/share\/([^/?#]+)/i)?.[1];
    if (token) return `share:${fingerprintString(token)}`;
  } catch {
    return "";
  }
  return "";
}

/** @param {string | undefined} additionalContext */
export function computeContextFp(additionalContext) {
  return fingerprintString(String(additionalContext || ""));
}

/** @param {object} payload */
export function hashInputPayload(payload) {
  let h = 0;
  const s = JSON.stringify(payload);
  for (let i = 0; i < s.length; i++) h = (Math.imul(31, h) + s.charCodeAt(i)) | 0;
  return `h${Math.abs(h).toString(36)}`;
}

/**
 * @param {string} companyName
 * @param {string} companyDomain
 * @param {string[]} emails
 * @param {string} linkedinFingerprint
 * @param {{ kaiaMeetingUrl?: string, additionalContext?: string }} [options]
 */
export function computePrepInputHash(
  companyName,
  companyDomain,
  emails,
  linkedinFingerprint = "",
  options = {},
) {
  const payload = {
    companyDomain: normalizeDomain(companyDomain),
    companyName: String(companyName || "").toLowerCase(),
    emails: [...emails].sort(),
    playbookVersion: PREP_PLAYBOOK_VERSION,
    linkedin: linkedinFingerprint || "",
    kaiaRef: computeKaiaRef(options.kaiaMeetingUrl),
    contextFp: computeContextFp(options.additionalContext),
  };
  return hashInputPayload(payload);
}

/** @param {string} domain */
function normalizeDomain(domain) {
  return String(domain || "")
    .trim()
    .toLowerCase()
    .replace(/^https?:\/\//, "")
    .replace(/^www\./, "")
    .split("/")[0];
}
