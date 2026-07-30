/** Shared domain constants (no imports from auth to avoid cycles). */

export const DEMO_ORG_ID = "org_freshworks_se";
export const TEAM_AJAY_ID = "team_ajay";
export const TEAM_NIKIL_ID = "team_nikil";
export const TEAM_PREETHI_SRI_ID = "team_preethi_sri";
export const TEAM_PREETHI_SRIRAM_ID = "team_preethi_sriram";

/** User-facing team labels (region + motion). Internal ids stay team_ajay / team_nikil. */
export const TEAM_NAME_INTERNATIONAL_NB = "International - NB";
export const TEAM_NAME_NORTH_AMERICA_NB = "North America - NB";

/** @type {Record<string, string>} */
export const TEAM_DISPLAY_NAMES = {
  [TEAM_AJAY_ID]: TEAM_NAME_INTERNATIONAL_NB,
  [TEAM_NIKIL_ID]: TEAM_NAME_NORTH_AMERICA_NB,
  [TEAM_PREETHI_SRI_ID]: "Preethi Sri Squad",
  [TEAM_PREETHI_SRIRAM_ID]: "Preethi Sriram Squad",
};

/** @param {string|null|undefined} teamId */
export function teamDisplayName(teamId) {
  if (!teamId) return null;
  return TEAM_DISPLAY_NAMES[teamId] || null;
}

/** All squad team ids in the Freshworks CX SE org. */
export const SQUAD_TEAM_IDS = [
  TEAM_AJAY_ID,
  TEAM_NIKIL_ID,
  TEAM_PREETHI_SRI_ID,
  TEAM_PREETHI_SRIRAM_ID,
];

/** @deprecated Use TEAM_AJAY_ID. kept for imports during transition */
export const TEAM_ANTONY_ID = TEAM_AJAY_ID;
/** @deprecated Use TEAM_AJAY_ID */
export const DEMO_TEAM_A_ID = TEAM_AJAY_ID;
/** @deprecated Use TEAM_AJAY_ID */
export const DEMO_TEAM_ID = TEAM_AJAY_ID;

/** Consumer / webmail domains. must not become account slugs or stored account domains. */
export const FREE_MAIL_DOMAINS = new Set([
  "gmail.com",
  "googlemail.com",
  "outlook.com",
  "hotmail.com",
  "live.com",
  "yahoo.com",
  "yahoo.co.in",
  "icloud.com",
  "me.com",
  "aol.com",
  "proton.me",
  "protonmail.com",
  "gmx.com",
  "mail.com",
  "zoho.com",
  "rediffmail.com",
  "qq.com",
  "163.com",
]);

/** @param {string|null|undefined} domain */
export function isFreeMailDomain(domain) {
  const d = String(domain || "")
    .trim()
    .toLowerCase()
    .replace(/^www\./, "")
    .split("/")[0];
  return d ? FREE_MAIL_DOMAINS.has(d) : false;
}
